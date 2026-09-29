"use strict";

const { sendJson, sendText, readBody, serveStatic } = require("./http.js");
const { readPipelineSteps } = require("./plugin.js");
const { UserError } = require("./errors.js");
const { readPageRegistry } = require("./project-pages.js");
const { candidatesFor, writeRegistryEntry, uiPrefixOf } = require("./identity.js");
const { resolveDesignPageName } = require("./design-page-name.js");
const { parseLink } = require("./resolve-target.js");

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
  const mapping = deps.mapping;
  const token = deps.token || "";

  /*
   * 生成 Bundle 清单的那一步（契约里 Outputs 写着 <Target>.bundle.json）。
   *
   * 为什么续跑要用它：operation=replace-existing（「确认要替换已有页面」）是那一步写进清单的
   * （run-all.ps1 里 -Overwrite 就是喂给那一步的 --replace-existing）。从 bundle 接着跑，
   * 清单还是旧的、没有 replace-existing，插件会直接拒绝：
   *   "--overwrite 仅允许用于用户明确确认的已有页面替换；请在 manifest 中设置 operation=replace-existing"
   * 所以遇到「目标文件已存在」这类失败，必须回到这一步重算，而不是从失败那一步续。
   */
  let manifestStepName = null;
  function bundleManifestStep() {
    if (manifestStepName !== null) return manifestStepName;
    try {
      const steps = readPipelineSteps(plugin.root);
      const hit = steps.find((step) =>
        (step.Outputs || []).some((item) => String(item).includes(".bundle.json")));
      manifestStepName = hit ? hit.Name : "";
    }
    catch {
      manifestStepName = "";
    }
    return manifestStepName;
  }

  // 失败是不是「工程里已经有这一页」：判据用插件自己的原话，写在失败摘要或它后面的输出里。
  function existingPageFailure(failure) {
    const text = (failure && failure.message ? failure.message : "") + "\n" + (failure && failure.detail ? failure.detail : "");
    return text.includes("目标文件已存在") || text.includes("replace-existing");
  }

  // 「台账多出图标」= 命名表里留着插件当前不认的下标（换了设计稿/图层沿用同一 Target 的典型症状）。
  // 裁回候选清单再续跑，而不是让人去手工改那个 JSON。
  function staleNaming(failure) {
    const text = (failure && failure.message ? failure.message : "") + "\n" + (failure && failure.detail ? failure.detail : "");
    return text.includes("台账多出图标");
  }

  function pluginSummary() {
    return {
      root: plugin.root,
      version: plugin.version,
      engine: plugin.engine,
      engineExists: plugin.engineExists,
      queryMissing: plugin.queryMissing,
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
        const request = job.request;
        /*
         * 续跑默认带 -Overwrite：同一次转换继续跑，目标里那份产物本来就是它自己刚生成的，
         * 不带就会在 bundle 处再撞一次「目标文件已存在」，永远走不到头。
         * 但这碰了插件「默认不覆盖已有页面」的安全阀，所以调用方可以显式关掉（body.overwrite === false）。
         */
        const overwrite = body.overwrite === false ? false : true;
        const failedStep = pending.failure ? pending.failure.stepName : "";
        // 「已有这一页」要回到生成 Bundle 清单的那一步重算，其余情况才从失败那一步续。
        const anchor = existingPageFailure(pending.failure) ? bundleManifestStep() : "";
        const resumeStep = anchor || failedStep;
        // 命名表留着旧下标就先裁干净：那是第 7 步拒绝的直接原因，不裁的话续跑还是同一个错。
        let reconciled = null;
        if (pending.failure && staleNaming(pending.failure)) {
          reconciled = pending.reconcileNaming({ projectRoot: request.projectRoot, target: request.target });
        }
        return {
          ok: true,
          mode: pending.label,
          resumedFrom: resumeStep || "起点",
          recomputedManifest: Boolean(anchor),
          reconciled: reconciled,
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
            progress: resumeStep
          })
        };
      }
    },
    {
      method: "GET",
      path: "/api/run/status",
      handler: function (context) {
        const job = runs.status(context.url.searchParams.get("runId") || "");
        /*
         * 另外给一份「页面级」的步骤：取自插件的运行登记表，续跑会接着写同一份。
         * 界面要的是这一页的流水线走到哪儿了，而不是这一次运行从第几步开始 ——
         * 从第 9 步续跑的那一次，前 8 步在本次运行里是「跳过」，按它算进度会显示成 4/12。
         */
        let steps = [];
        const projectRoot = job && job.request ? job.request.projectRoot : "";
        const target = job && job.request ? job.request.target : "";
        if (projectRoot && target) {
          try {
            const info = artifacts.read({ projectRoot: projectRoot, target: target });
            if (info && info.available) steps = info.steps;
          }
          catch {
            /* 读不到就回落到实时步骤 */
          }
        }
        return { ok: true, job: job, steps: steps };
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
      path: "/api/project/pages",
      handler: function (context) {
        return {
          ok: true,
          pages: readPageRegistry(context.url.searchParams.get("projectRoot") || "")
        };
      }
    },
    {
      method: "GET",
      // 区域前缀规则的唯一实现在后端，界面只显示这里的结论；这条只看 Target，跟工程目录无关。
      path: "/api/identity/prefix",
      handler: function (context) {
        const target = context.url.searchParams.get("target") || "";
        return { ok: true, previewUi: target ? uiPrefixOf(target) : "" };
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
      // 映射表只读视图：内容来自插件自己的加载器，界面不另算一份。
      method: "GET",
      path: "/api/mapping",
      handler: function () {
        return { ok: true, mapping: mapping.read() };
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
      path: "/api/design/page-name",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        const parsed = parseLink(body.link || "");
        const fileId = String(body.fileId || parsed.fileId || "");
        const layerId = String(body.layerId || parsed.layerId || "");
        const info = resolveDesignPageName({ pluginRoot: plugin.root, fileId: fileId, layerId: layerId, token: token });
        return { ok: true, pageName: info.pageName, rootId: info.rootId };
      }
    },
    {
      method: "POST",
      path: "/api/identity/candidates",
      body: true,
      handler: async function (context) {
        const body = context.body || {};
        // 调用方显式给区域（例如已知这一页属于 F1）时，就用它当唯一区域候选：
        // 区域是项目事实，人可以给；给过之后这条会写进登记表，下次就自动沿用了。
        const explicitUi = String(body.ui || "").trim();
        const info = candidatesFor({ projectRoot: body.projectRoot || "", pageName: body.pageName || "" });
        if (explicitUi) {
          info.uiCandidates = [{ ui: explicitUi, count: 0, basis: "你指定的区域" }];
          info.candidates = info.candidates.filter((item) => item.ui === explicitUi);
        }
        if (info.uiCandidates.length === 0 || body.useAi === false) {
          return { ok: true, ...info, ai: { used: false, items: [] } };
        }
        // 模型只出候选（语义名 + 区域 + 拼好的 Target），不写盘。
        const items = await ai.suggestIdentity({
          pageName: body.pageName || "",
          uiCandidates: info.uiCandidates,
          existingTargets: info.registry.pages.map((page) => page.target)
        });
        return { ok: true, ...info, ai: { used: true, items: items.items } };
      }
    },
    {
      method: "POST",
      path: "/api/identity/apply",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        const written = writeRegistryEntry({
          projectRoot: body.projectRoot || "",
          target: body.target || "",
          ui: body.ui || "",
          fileId: body.fileId || "",
          layerId: body.layerId || "",
          designPageName: body.designPageName || ""
        });
        return { ok: true, registryPath: written.registryPath, entry: written.entry, replaced: written.replaced };
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
        const result = board.add(context.body || {});
        return { ok: true, board: result.board, created: result.created };
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
