"use strict";

const { sendJson, sendText, readBody, serveStatic } = require("./http.js");
const { readPipelineSteps } = require("./plugin.js");
const { UserError, toFailure } = require("./errors.js");
const { readPageRegistry } = require("./project-pages.js");
const { candidatesFor, writeRegistryEntry, uiPrefixOf } = require("./identity.js");
const { resolveDesignPageName } = require("./design-page-name.js");
const { parseLink } = require("./resolve-target.js");
const pageProgress = require("./page-progress.js");

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
  const update = deps.update;
  const codex = deps.codex;
  const token = deps.token || "";

  // 生成 Bundle 清单的那一步：口径在 lib/page-progress.js，与看板的续跑计划共用一份。
  function bundleManifestStep() {
    return pageProgress.bundleManifestStep(runs.contract() || []);
  }

  // 失败是不是「工程里已经有这一页」：判据用插件自己的原话，写在失败摘要或它后面的输出里。
  function existingPageFailure(failure) {
    const text = (failure && failure.message ? failure.message : "") + "\n" + (failure && failure.detail ? failure.detail : "");
    return text.includes("目标文件已存在") || text.includes("replace-existing");
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

  /*
   * 命名表写歪就先修好：旧下标（第 7 步「台账多出图标」）与重名资源名（第 7 步「图标资源名重复」）
   * 都在这张表上，不修的话续跑还是同一个错。清单按页面存放，插件自己推导 Target 的运行没有这几份文件。
   */
  function reconcileNaming(request) {
    if (!request || !request.target) return null;
    const naming = pending.inspect({ projectRoot: request.projectRoot, target: request.target }).icons;
    if (naming && naming.available && naming.needsRepair) {
      return pending.reconcileNaming({ projectRoot: request.projectRoot, target: request.target });
    }
    return null;
  }

  /*
   * 续跑默认带 -Overwrite：同一次转换继续跑，目标里那份产物本来就是它自己刚生成的，
   * 不带就会在 bundle 处再撞一次「目标文件已存在」，永远走不到头。
   * 但这碰了插件「默认不覆盖已有页面」的安全阀，所以调用方可以显式关掉（body.overwrite === false）。
   */
  function resumeOverwrite(body) {
    return body.overwrite === false ? false : true;
  }

  /*
   * 运行管理器里还有这次运行：取**第一条没跑完的路线**（它可能失败停在某一步，
   * 也可能压根没开始 —— AB 里 A 成功、B 还没轮到），参数与停点都从这次运行取。
   */
  function resumeLive(job, body) {
    const unfinished = job.runs.find((run) => run.state !== "done");
    if (!unfinished) throw new UserError("ALL_DONE", "这次运行已经跑完了", "没有需要继续的路线。");
    const request = job.request;
    // 「已有这一页」要回到生成 Bundle 清单的那一步重算，其余情况才从失败那一步续。
    const anchor = existingPageFailure(unfinished.failure) ? bundleManifestStep() : "";
    const resumeStep = anchor || (unfinished.failure ? unfinished.failure.stepName : "");
    const overwrite = resumeOverwrite(body);
    return {
      ok: true,
      mode: unfinished.label,
      resumedFrom: resumeStep || "起点",
      recomputedManifest: Boolean(anchor),
      reconciled: reconcileNaming(request),
      overwrite: overwrite,
      job: runs.start({
        projectRoot: request.projectRoot,
        target: request.target,
        fileId: request.fileId,
        layerId: request.layerId,
        ui: request.ui,
        mode: unfinished.label,
        overwrite: overwrite,
        allowEmptyLedger: request.allowEmptyLedger,
        progress: resumeStep
      })
    };
  }

  /*
   * 运行管理器里已经没有这次运行（客户端重启过，或旧 job 已被挤掉）：这次运行的状态
   * 只剩看板任务自己记的路线、输入、工作目录，加上磁盘上的插件登记表。
   */
  function resumeByTask(task, body) {
    const plan = board.planResume(task.id);
    if (plan.finished) throw new UserError("ALL_DONE", "这一页已经跑完了", "没有需要继续的步骤。");
    const overwrite = resumeOverwrite(body);
    const job = runs.start({
      projectRoot: plan.request.projectRoot,
      target: plan.request.target,
      fileId: plan.request.fileId,
      layerId: plan.request.layerId,
      ui: plan.request.ui,
      mode: plan.mode,
      origin: "board",
      overwrite: overwrite,
      allowEmptyLedger: plan.request.allowEmptyLedger === true,
      progress: plan.step
    });
    return {
      ok: true,
      mode: plan.mode,
      resumedFrom: plan.step || "起点",
      recomputedManifest: plan.recomputedManifest,
      reconciled: reconcileNaming(plan.request),
      overwrite: overwrite,
      job: job
    };
  }

  /*
   * 「继续」认看板任务 id，不认 jobId。运行管理器里还有这次运行就按它续（路线与停点最准）；
   * 客户端重启过、旧 job 被挤掉了，就按任务自己记的路线与磁盘登记表重建。
   * 两条分支起来的新运行都在这里挂回那一行：行上的状态、日志与合并都跟着新运行走，
   * 否则同一个按钮会因旧 job 还在不在内存里而给出两种结果。
   */
  function resumeTask(taskId, body) {
    const task = board.byId(taskId);
    if (!task) throw new UserError("NO_TASK", "看板上没有这个任务", "刷新看板后从对应那一行点「继续」。");
    const job = task.jobId ? runs.status(task.jobId) : null;
    const result = job ? resumeLive(job, body) : resumeByTask(task, body);
    board.attach(task.id, result.job);
    return result;
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
       * 两个入口：运行管理器里还有这次运行就按它续；进程重启过、旧 job 没了就把这次运行
       * 从看板任务与磁盘登记表重建出来续 —— 界面上点的是同一个「继续」，不该因为重启就变成死路。
       */
      method: "POST",
      path: "/api/run/resume",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        return resumeTask(String(body.taskId || ""), body);
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
        const parsed = parseLink(body.link || "");
        const info = candidatesFor({
          projectRoot: body.projectRoot || "",
          pageName: body.pageName || "",
          fileId: String(body.fileId || parsed.fileId || ""),
          layerId: String(body.layerId || parsed.layerId || "")
        });
        if (explicitUi) {
          info.uiCandidates = [{ ui: explicitUi, count: 0, basis: "你指定的区域" }];
          info.candidates = info.candidates.filter((item) => item.ui === explicitUi);
          // 人已经明确给了区域，就不存在"区域不明确"这回事：别再用 ambiguous 拦住自动补。
          info.ambiguous = false;
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
        const parsed = parseLink(body.link || "");
        const written = writeRegistryEntry({
          projectRoot: body.projectRoot || "",
          target: body.target || "",
          ui: body.ui || "",
          fileId: String(body.fileId || parsed.fileId || ""),
          layerId: String(body.layerId || parsed.layerId || ""),
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
      /*
       * 待确认的写入与续跑。来源运行分两种：看板任务按 taskId 取任务自己的 jobId 与工作目录
       * （运行管理器里那次运行没了也能按任务重建），非看板的条目（流水线直跑、任务已移除）
       * 用它自带的 runId。
       */
      method: "POST",
      path: "/api/confirm",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        const task = board.byId(String(body.taskId || ""));
        const result = confirm.commit(
          Object.assign({}, body, task ? {
            runId: task.jobId,
            request: {
              projectRoot: task.workDir,
              target: task.request.target,
              fileId: task.request.fileId,
              layerId: task.request.layerId,
              ui: task.request.ui,
              mode: task.request.mode,
              origin: "board"
            }
          } : {})
        );
        // 续跑起来的是看板任务：新运行要挂回那一行，否则行上还指着已经不在的那次运行。
        if (task && result.job) board.attach(task.id, result.job);
        return { ok: true, ...result };
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
      path: "/api/board/clear-area",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        return { ok: true, board: board.clearArea(String(body.projectRoot || ""), String(body.ui || "")) };
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
    },
    {
      /*
       * 冲突处的逐文件裁决：记下这个文件取哪一份，选择完成后再点合并。
       * pick：mine（以本任务为准）/ main（保留主工程）/ clear（撤销选择）。
       */
      method: "POST",
      path: "/api/board/resolve",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        const result = board.resolveConflict(
          String(body.id || ""),
          String(body.path || ""),
          String(body.pick || "")
        );
        return { ok: true, board: result.board, task: result.task };
      }
    },
    {
      /*
       * 程序更新的四态：up_to_date / update_available / download_ready / error。
       * status 不联网；check 才拉远端清单（失败落在 status.error，界面照常渲染）。
       */
      method: "GET",
      path: "/api/update/status",
      handler: function () {
        return { ok: true, status: update.status() };
      }
    },
    {
      method: "POST",
      path: "/api/update/check",
      body: true,
      handler: async function () {
        return { ok: true, status: await update.check() };
      }
    },
    {
      /* 下载跑在后台：这里立刻回，进度与结果都在 status().task 里。 */
      method: "POST",
      path: "/api/update/download",
      body: true,
      handler: function () {
        const started = update.startDownload();
        return { ok: true, started: started.started, version: started.version, note: started.reason || "", status: started.status };
      }
    },
    {
      /* 切到某个版本：只写 current.json，下次启动生效。有任务在跑时后端直接拒。 */
      method: "POST",
      path: "/api/update/apply",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        return update.apply(String(body.version || ""));
      }
    },
    {
      method: "POST",
      path: "/api/update/rollback",
      body: true,
      handler: function () {
        return update.rollback();
      }
    },
    {
      /*
       * Codex 引擎这一条线：哪一份在用、有哪些版本、能不能下载/切换。
       * status 不联网；check 才拉发行版描述（失败也回 200，原因在 status.error 里）。
       */
      method: "GET",
      path: "/api/codex/status",
      handler: function () {
        return { ok: true, status: codex.status() };
      }
    },
    {
      method: "POST",
      path: "/api/codex/check",
      body: true,
      handler: async function () {
        return { ok: true, status: await codex.check() };
      }
    },
    {
      /* 下载跑在后台：这里立刻回，进度与结果都在 status().task 里。 */
      method: "POST",
      path: "/api/codex/download",
      body: true,
      handler: function () {
        const started = codex.startDownload();
        return { ok: true, started: started.started, version: started.version, note: started.note || "", status: started.status };
      }
    },
    {
      /* 切版本：版本号为空串 = 用本机检测到的那个。有任务在跑时后端直接拒。 */
      method: "POST",
      path: "/api/codex/switch",
      body: true,
      handler: function (context) {
        return codex.switchTo(String((context.body || {}).version || ""));
      }
    },
    {
      method: "POST",
      path: "/api/codex/rollback",
      body: true,
      handler: function () {
        return codex.rollback();
      }
    },
    {
      /*
       * 对话：一次提问就是一次 codex exec，stdout 的 JSONL 原样按行转给界面。
       * 这里自己写响应，所以返回 undefined（dispatch 只在拿到对象时才回 JSON）。
       */
      method: "POST",
      path: "/api/agent/chat",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        const prepared = codex.execArgs({
          prompt: String(body.prompt || ""),
          resume: String(body.resume || ""),
          // 写盘要两处都同意：设置里开着开关，这一次也勾了。
          write: body.write === true && settings.read().agent.allowWrite
        });
        streamAgentChat(context, codex, prepared, String(body.projectRoot || ""));
        return undefined;
      }
    }
  ];
}

/*
 * 把一次 codex 进程的 stdout/stderr 按行写成 NDJSON：每行一条 {ok, stream, line}，
 * 结尾一条 {ok, exit}。用 NDJSON 而不是 SSE —— 前端读的就是同一个 fetch 流，不需要额外解析器。
 */
function streamAgentChat(context, codex, prepared, projectRoot) {
  const engine = codex.active();
  if (!engine) {
    throw new UserError("NO_CODEX", "还没有可用的 Codex", "到「设置」里下载一份，或装一个 Codex 客户端。");
  }
  const response = context.response;
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store"
  });
  const send = function (payload) {
    if (!response.writableEnded) response.write(JSON.stringify(payload) + "\n");
  };
  send({ ok: true, engine: { version: engine.version, source: engine.source, state: engine.state } });

  let child = null;
  // 界面关掉对话框就不再让它往下跑：进程跟着请求一起结束。
  context.request.on("close", function () {
    if (child) child.kill();
  });
  try {
    child = codex.run(prepared.args, {
      env: prepared.env,
      cwd: projectRoot,
      onLine: function (line, name) {
        send({ ok: true, stream: name, line: line });
      },
      onExit: function (code) {
        send({ ok: true, exit: code });
        if (!response.writableEnded) response.end();
      },
      onError: function (error) {
        send({ ok: false, error: toFailure(error) });
        if (!response.writableEnded) response.end();
      }
    });
  }
  catch (error) {
    // 头已经发出去了，错误只能当一条事件流事件告诉界面。
    send({ ok: false, error: toFailure(error) });
    response.end();
  }
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
