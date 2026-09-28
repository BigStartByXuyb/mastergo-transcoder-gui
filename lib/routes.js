"use strict";

const { sendJson, sendText, readBody, serveStatic } = require("./http.js");
const { readPipelineSteps } = require("./plugin.js");
const { UserError } = require("./errors.js");

// 路由表：每条 = 一个方法 + 一个路径 + 一个 handler。
// handler 返回对象则自动以 200 JSON 回；`body: true` 表示先解析 JSON 请求体。
function createRoutes(deps) {
  const resolver = deps.resolver;
  const plugin = deps.plugin;
  const version = deps.version;
  const runs = deps.runs;
  const settings = deps.settings;
  const pending = deps.pending;
  const ai = deps.ai;
  const artifacts = deps.artifacts;
  const board = deps.board;
  const confirm = deps.confirm;
  const pendingQueue = deps.pendingQueue;

  function pluginSummary() {
    return {
      root: plugin.root,
      version: plugin.version,
      engine: plugin.engine,
      engineExists: plugin.engineExists,
      runAllExists: plugin.runAllExists
    };
  }

  return [
    {
      method: "GET",
      path: "/api/health",
      handler: function () {
        return {
          ok: true,
          version: version,
          plugin: pluginSummary(),
          frames: resolver.framesOfAllFiles()
        };
      }
    },
    {
      method: "GET",
      path: "/api/plugin",
      handler: function () {
        // 步骤清单不写死在 GUI：插件改了流程，这里跟着变。
        const steps = readPipelineSteps(plugin.root);
        return { ok: true, plugin: pluginSummary(), steps: steps };
      }
    },
    {
      method: "POST",
      path: "/api/resolve",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        if (body.projectDir) resolver.registerProjectFrames(String(body.projectDir));
        return resolver.resolveQuery({
          link: body.link,
          frameLink: body.frameLink || ""
        });
      }
    },
    {
      method: "POST",
      path: "/api/run",
      body: true,
      handler: function (context) {
        return { ok: true, job: runs.start(context.body || {}) };
      }
    },
    {
      method: "POST",
      path: "/api/run/stop",
      body: true,
      handler: function (context) {
        return { ok: true, job: runs.stop((context.body || {}).runId || "") };
      }
    },
    {
      /*
       * 从断点继续。
       *
       * 取这次运行里**第一条没跑完的路线**：它可能失败停在某一步，也可能压根没开始（AB 里 A 成功、
       * B 还没轮到）。续跑参数全部继承原次运行——包括 -Ui / -Overwrite / -AllowEmptyLedger 这些
       * 命令行专属输入，缺一个就会在不同前置条件下静默继续（插件自己在续跑提示里也强调这点）。
       */
      method: "POST",
      path: "/api/run/resume",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        const job = runs.status(body.runId || "");
        if (!job) throw new UserError("NO_JOB", "找不到这次运行", "刷新页面看当前运行状态。");
        const pending = job.runs.find((run) => run.state !== "done");
        if (!pending) throw new UserError("ALL_DONE", "这次运行已经跑完了", "没有需要继续的路线。");
        const stepName = pending.failure ? pending.failure.stepName : "";
        const request = job.request;
        /*
         * 续跑默认带 -Overwrite：同一次转换继续跑，目标里那份产物本来就是它自己刚生成的，
         * 不带就会在 bundle 处再撞一次「目标文件已存在」，永远走不到头。
         * 但这碰了插件「默认不覆盖已有页面」的安全阀，所以调用方可以显式关掉（body.overwrite === false）。
         */
        const overwrite = body.overwrite === false ? false : true;
        return {
          ok: true,
          mode: pending.label,
          resumedFrom: stepName || "起点",
          overwrite: overwrite,
          job: runs.start({
            projectRoot: request.projectRoot,
            target: request.target,
            fileId: request.fileId,
            layerId: request.layerId,
            ui: request.ui,
            mode: pending.label,
            overwrite: overwrite,
            allowEmptyLedger: request.allowEmptyLedger,
            progress: stepName
          })
        };
      }
    },
    {
      method: "GET",
      path: "/api/run/status",
      handler: function (context) {
        return { ok: true, job: runs.status(context.url.searchParams.get("runId") || "") };
      }
    },
    {
      method: "GET",
      path: "/api/run/log",
      handler: function (context) {
        const slice = runs.log(
          context.url.searchParams.get("runId") || "",
          Number(context.url.searchParams.get("from") || 0)
        );
        return { ok: true, ...slice };
      }
    },
    {
      method: "GET",
      path: "/api/settings",
      handler: function () {
        return { ok: true, settings: settings.read() };
      }
    },
    {
      method: "POST",
      path: "/api/settings",
      body: true,
      handler: function (context) {
        return { ok: true, settings: settings.write(context.body || {}) };
      }
    },
    {
      method: "GET",
      path: "/api/pending",
      handler: function (context) {
        return {
          ok: true,
          pending: pending.inspect({
            projectRoot: context.url.searchParams.get("projectRoot") || "",
            target: context.url.searchParams.get("target") || ""
          })
        };
      }
    },
    {
      // 所有还缺语义输入的页面：看板任务与流水线直跑的运行一起列，按页面去重。
      method: "GET",
      path: "/api/pending/list",
      handler: function () {
        return { ok: true, queue: pendingQueue.snapshot() };
      }
    },
    {
      method: "GET",
      path: "/api/artifacts",
      handler: function (context) {
        return {
          ok: true,
          artifacts: artifacts.read({
            projectRoot: context.url.searchParams.get("projectRoot") || "",
            target: context.url.searchParams.get("target") || ""
          })
        };
      }
    },
    {
      method: "POST",
      path: "/api/ai/suggest",
      body: true,
      handler: async function (context) {
        const body = context.body || {};
        if (body.kind === "icon-name") return { ok: true, ...(await ai.suggestIconNames(body)) };
        if (body.kind === "translation") return { ok: true, ...(await ai.suggestTranslations(body)) };
        if (body.kind === "glossary") return { ok: true, ...(await ai.suggestGlossary(body)) };
        throw new UserError("BAD_KIND", "未知的建议类型：" + body.kind, "可用：icon-name / translation / glossary");
      }
    },
    {
      method: "POST",
      path: "/api/confirm",
      body: true,
      handler: function (context) {
        return { ok: true, ...confirm.commit(context.body || {}) };
      }
    },
    {
      /*
       * 看板：一次加多个页面，各自在自己的工作目录里跑，跑完合回主工程。
       * 状态一律由 board 自己跟运行管理器对表，界面只读快照。
       */
      method: "GET",
      path: "/api/board",
      handler: function () {
        return { ok: true, board: board.snapshot() };
      }
    },
    {
      method: "POST",
      path: "/api/board/add",
      body: true,
      handler: function (context) {
        return { ok: true, board: board.add(context.body || {}) };
      }
    },
    {
      method: "POST",
      path: "/api/board/start",
      body: true,
      handler: function (context) {
        return { ok: true, board: board.start(String((context.body || {}).id || "")) };
      }
    },
    {
      method: "POST",
      path: "/api/board/stop",
      body: true,
      handler: function (context) {
        return { ok: true, board: board.stop(String((context.body || {}).id || "")) };
      }
    },
    {
      method: "POST",
      path: "/api/board/remove",
      body: true,
      handler: async function (context) {
        return { ok: true, board: await board.remove(String((context.body || {}).id || "")) };
      }
    },
    {
      method: "POST",
      path: "/api/board/clear",
      body: true,
      handler: function (context) {
        return { ok: true, board: board.clear((context.body || {}).states) };
      }
    },
    {
      method: "POST",
      path: "/api/board/merge",
      body: true,
      handler: function (context) {
        const result = board.mergeOne(String((context.body || {}).id || ""));
        return { ok: true, board: result.board, task: result.task };
      }
    },
    {
      method: "POST",
      path: "/api/board/merge-all",
      body: true,
      handler: function (context) {
        return { ok: true, board: board.mergeAll(String((context.body || {}).projectRoot || "")) };
      }
    }
  ];
}

function errorPayload(error) {
  if (error && error.userFacing) {
    return { status: 400, body: { ok: false, error: { code: error.code, message: error.message, hint: error.hint || "" } } };
  }
  return {
    status: 500,
    body: { ok: false, error: { code: "INTERNAL", message: String(error && error.message ? error.message : error), hint: "" } }
  };
}

async function dispatch(routes, request, response, publicDir) {
  const url = new URL(request.url, "http://" + (request.headers.host || "127.0.0.1"));
  const route = routes.find((item) => item.method === request.method && item.path === url.pathname);

  if (route) {
    try {
      const body = route.body ? await readBody(request) : null;
      const payload = await route.handler({ request, response, url, body: body });
      if (payload !== undefined) sendJson(response, 200, payload);
    }
    catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const failure = errorPayload(error);
      sendJson(response, failure.status, failure.body);
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { ok: false, error: { code: "NO_ROUTE", message: "没有这个接口：" + url.pathname, hint: "" } });
    return;
  }
  if (request.method === "GET") {
    if (serveStatic(response, publicDir, url.pathname)) return;
    sendText(response, 404, "404");
    return;
  }
  sendText(response, 405, "405");
}

module.exports = { createRoutes, dispatch };
