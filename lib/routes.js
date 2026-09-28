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
        const job = runs.status((context.body || {}).runId || "");
        if (!job) throw new UserError("NO_JOB", "找不到这次运行", "刷新页面看当前运行状态。");
        const pending = job.runs.find((run) => run.state !== "done");
        if (!pending) throw new UserError("ALL_DONE", "这次运行已经跑完了", "没有需要继续的路线。");
        const stepName = pending.failure ? pending.failure.stepName : "";
        const request = job.request;
        return {
          ok: true,
          mode: pending.label,
          resumedFrom: stepName || "起点",
          job: runs.start({
            projectRoot: request.projectRoot,
            target: request.target,
            fileId: request.fileId,
            layerId: request.layerId,
            ui: request.ui,
            mode: pending.label,
            overwrite: request.overwrite,
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
      method: "POST",
      path: "/api/ai/suggest",
      body: true,
      handler: async function (context) {
        const body = context.body || {};
        if (body.kind === "icon-name") return { ok: true, ...(await ai.suggestIconNames(body)) };
        if (body.kind === "translation") return { ok: true, ...(await ai.suggestTranslations(body)) };
        throw new UserError("BAD_KIND", "未知的建议类型：" + body.kind, "可用：icon-name / translation");
      }
    },
    {
      method: "POST",
      path: "/api/confirm",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        const written = [];
        let wroteNaming = false;
        let wroteTranslations = false;
        // 空命名表不写：插件的 build-icon-ledger 会因为「命名表为空」直接报错，
        // 它要求的做法是显式声明 -AllowEmptyLedger，而不是喂一张空表。
        if (Array.isArray(body.naming) && body.naming.length > 0) {
          written.push(pending.writeNaming({ projectRoot: body.projectRoot, target: body.target, items: body.naming }));
          wroteNaming = true;
        }
        if (body.translations && typeof body.translations === "object" && Object.keys(body.translations).length > 0) {
          written.push(pending.writeTranslations({ projectRoot: body.projectRoot, target: body.target, map: body.translations }));
          wroteTranslations = true;
        }
        // 空台账这条路要求命名表文件不存在（见 pending.clearNaming 的说明）。
        if (body.allowEmptyLedger === true) {
          pending.clearNaming({ projectRoot: body.projectRoot, target: body.target });
        }
        if (written.length === 0 && body.allowEmptyLedger !== true) {
          throw new UserError("NOTHING_TO_WRITE", "没有要提交的内容", "至少提交命名表、译文清单，或勾选「按空台账继续」。");
        }
        if (body.resume === false) return { ok: true, written: written, job: null };

        // 从上一轮运行继承参数，并从它实际失败的那一步续跑 —— 用数据，不写死步骤名。
        const job = runs.status(body.runId || "");
        const failedRun = job ? job.runs.find((run) => run.failure) : null;
        /*
         * 续跑要回到「刚写入的文件所喂的第一步」，而不是上次失败的那一步。
         * 例：在第 11 步门禁因为临时语言键失败、回头补全译文后，必须从第 9 步 inputs 重算，
         * 只续 gates 会拿旧的 Bundle 清单再报一次同样的错。
         * 步骤名与顺序都取自这次运行自己的步骤表，不写死编号。
         */
        const stepEntry = function (name) {
          if (!job) return null;
          for (const run of job.runs) {
            const hit = Object.values(run.steps).find((step) => step.name === name);
            if (hit) return hit;
          }
          return null;
        };
        const anchors = [];
        // 命名表与「空台账声明」都影响第 7 步 ledger；译文影响第 9 步 inputs。
        if (wroteNaming || body.allowEmptyLedger === true) anchors.push(stepEntry("ledger"));
        if (wroteTranslations) anchors.push(stepEntry("inputs")); // 译文   → 第 9 步 inputs
        const earliest = anchors.filter(Boolean).sort((left, right) => left.id - right.id)[0];
        const resumeStep = (earliest && earliest.name) || (failedRun && failedRun.failure.stepName) || "";
        if (!job || !resumeStep) {
          return { ok: true, written: written, job: null, note: "已写入；没有可续跑的上一次运行（" + (job ? "上次没有失败步骤" : "找不到上次运行") + "）" };
        }
        const request = job.request;
        return {
          ok: true,
          written: written,
          job: runs.start({
            projectRoot: body.projectRoot || request.projectRoot,
            target: body.target || request.target,
            fileId: request.fileId,
            layerId: request.layerId,
            ui: request.ui,
            mode: request.mode,
            overwrite: request.overwrite,
            progress: resumeStep,
            allowEmptyLedger: body.allowEmptyLedger === true
          })
        };
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
