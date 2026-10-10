"use strict";

/*
 * HTTP 路由：把 /api/* 分发到各能力模块，并在入口做编排判据（续跑从哪一步起、命名表要不要先修、
 * 「工程里已有这一页」算不算失败这类）—— 取数、运行、更新这些实现都在各自的 lib/ 模块里。
 */

const fs = require("fs");
const path = require("path");

const { sendJson, sendText, readBody, serveStatic, contentTypeOf, MAX_BODY_BYTES } = require("./http.js");
const { readPipelineSteps } = require("./plugin.js");
const { PLUGIN_NAME, PLUGIN_ENV_NAME } = require("./plugin-root.js");
const { RESTART_CODE } = require("./launch.js");
const { UserError, toFailure } = require("./errors.js");
const { getterOf } = require("./getter.js");
const { requireIdle } = require("./idle.js");
const { readPageRegistry } = require("./project-pages.js");
const { candidatesFor, writeRegistryEntry, uiPrefixOf } = require("./identity.js");
const { resolveDesignPageName } = require("./design-page-name.js");
const { parseLink } = require("./resolve-target.js");
const { SOURCE_LABELS } = require("./mcp-token.js");
const { buildContext, imagePaths, pickTemplate } = require("./agent-context.js");
const { pickFolder } = require("./pick-folder.js");
const { openFolder } = require("./system-open.js");
const { kindOf, MAX_BODY_BYTES: UPLOAD_BODY_BYTES } = require("./uploads.js");
const designImage = require("./design-image.js");
const layoutGroups = require("./layout-groups.js");
const pageProgress = require("./page-progress.js");

// 路由表：每条 = 一个方法 + 一个路径 + 一个 handler。
// handler 返回对象则自动以 200 JSON 回；`body: true` 表示先解析 JSON 请求体。
function createRoutes(deps) {
  const resolver = deps.resolver;
  const plugin = deps.plugin;
  const pluginRuntime = deps.pluginRuntime;
  // 有任务在跑时不能换插件：跑在路上的那一次可能正按当前这份读步骤契约。
  const isBusy = deps.isBusy;
  const version = deps.version;
  // 安装根：暂存件落在它下面的 work/staged/（运行目录，不随程序版本走）。
  const installRoot = deps.installRoot || "";
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
  const pluginUpdate = deps.pluginUpdate;
  const codex = deps.codex;
  const runtime = deps.runtime;
  const chats = deps.chats;
  const uploads = deps.uploads;
  // 有没有监督进程：有才能「切完自己换一份重跑」，界面据此决定要不要提示重启。
  const supervised = deps.supervised === true;
  // token 可能是值，也可能是取值函数：设置里改完不重启客户端也要能按新值走。
  const tokenOf = getterOf(deps.token);
  const tokenSource = deps.tokenSource || null;

  /*
   * 设置的对外视图。MasterGo token 实际生效的那一份可能不是本机保存的
   * （命令行与环境变量优先级更高），只有装配层知道，所以在出口补上来源。
   */
  function settingsView() {
    const payload = settings.read();
    const source = tokenSource && typeof tokenSource.source === "function" ? tokenSource.source() : "";
    // 标签由 lib/mcp-token.js 一处给出：界面只渲染，不自己再抄一份中文。
    const sourceLabel = SOURCE_LABELS[source] || "";
    payload.mastergo = Object.assign({}, payload.mastergo, { source: source, sourceLabel: sourceLabel });
    return payload;
  }

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
      runAllExists: plugin.runAllExists,
      // 一处都没找到时这里的原话：逐条列出查过的位置和各自有没有（七档，见 lib/plugin-root.js）。
      failure: pluginRuntime.failure()
    };
  }

  /* 插件来源清单：插件在哪、是哪一版、此刻在不在用。 */
  function pluginSourcesView() {
    return {
      plugin: pluginSummary(),
      sources: pluginRuntime.sources(),
      override: settings.read().pluginOverride
    };
  }

  /* 没有插件就直说，别让下游拿「文件不存在」当答案。 */
  function requirePlugin() {
    if (plugin.root) return;
    throw new UserError(
      "NO_PLUGIN",
      pluginRuntime.failure() || "找不到 " + PLUGIN_NAME + " 插件",
      "到「设置 → 更新 → 插件（流水线）」里装一份，或用 --plugin <插件目录> / 环境变量 " + PLUGIN_ENV_NAME + " 指定。"
    );
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
      /* 对话列表：侧边栏只要标题与来源，正文不在这里回。 */
      method: "GET",
      path: "/api/agent/threads",
      handler: function () {
        return { ok: true, conversations: chats.list() };
      }
    },
    {
      /* 附件上传：界面把文件读成 base64 传上来，落进安装根的 chats/uploads/<批次>/。 */
      method: "POST",
      path: "/api/agent/upload",
      body: true,
      bodyLimit: UPLOAD_BODY_BYTES,
      handler: function (context) {
        const body = context.body || {};
        return { ok: true, files: uploads.saveBatch(body.files) };
      }
    },
    {
      /*
       * 作业A 的设计稿位图：这一页「读图」那条开关的输入。
       * 读状态（图在不在、尺寸对不对、分组表在不在）与存一张图都在这一对接口上 —— 口径在 lib/design-image.js。
       */
      method: "GET",
      path: "/api/design-image",
      handler: function (context) {
        return {
          ok: true,
          image: designImage.read({
            projectRoot: context.url.searchParams.get("projectRoot") || "",
            target: context.url.searchParams.get("target") || ""
          })
        };
      }
    },
    {
      method: "POST",
      path: "/api/design-image",
      body: true,
      bodyLimit: designImage.MAX_BODY_BYTES,
      handler: function (context) {
        return { ok: true, image: designImage.save(context.body || {}) };
      }
    },
    {
      /*
       * 新建任务时先选好的设计稿位图：先按「工程目录 + 页面」暂存，等流水线跑到「取数 + 固化快照」
       * 之后由看板轮询那一侧核对尺寸再落地（口径在 lib/design-image.js 的 stage / installStaged）。
       */
      method: "POST",
      path: "/api/design-image/stage",
      body: true,
      bodyLimit: designImage.MAX_BODY_BYTES,
      handler: function (context) {
        const body = context.body || {};
        return {
          ok: true,
          staged: designImage.stage({
            home: installRoot,
            projectRoot: body.projectRoot,
            target: body.target,
            data: body.data
          })
        };
      }
    },
    {
      /*
       * 作业A 的布局确认：读控件清单 + 分组表（给布局确认界面渲染）。
       * 写入只有 /api/confirm 一条路（分组表与命名表/译文同级，写回后从 layout 续跑）。
       */
      method: "GET",
      path: "/api/layout-groups",
      handler: function (context) {
        return {
          ok: true,
          layout: Object.assign(
            layoutGroups.inspect({
              projectRoot: context.url.searchParams.get("projectRoot") || "",
              target: context.url.searchParams.get("target") || ""
            }),
            /*
             * 「自动通过」是全局开关，但它和这一页的布局确认处境一起读：面板一次取回，
             * 不必另取一遍 /api/settings（取设置失败也不该把布局读数一起带失败）。
             */
            { autoPass: settings.read().layoutAutoPass }
          )
        };
      }
    },
    {
      /* 选文件夹：给「代码库」那页的「浏览…」用；取消或打不开都回空路径，界面退回落手填。 */
      method: "POST",
      path: "/api/system/pick-folder",
      body: true,
      handler: async function () {
        return await pickFolder();
      }
    },
    {
      /* 在文件管理器里打开一个目录（插件页某一行的「打开目录」）。 */
      method: "POST",
      path: "/api/system/open-folder",
      body: true,
      handler: async function (context) {
        return await openFolder(String((context.body || {}).path || ""));
      }
    },
    {
      /* 看附件：只认自己落下的那些路径（缩略图、点开预览都靠它）。 */
      method: "GET",
      path: "/api/agent/file",
      handler: function (context) {
        const target = context.url.searchParams.get("path") || "";
        if (!uploads.belongs(target)) {
          throw new UserError("BAD_PATH", "只能看对话里的附件", "别的文件请到工程目录里打开。");
        }
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
          throw new UserError("NO_FILE", "这个附件不在了", "可能已经被清掉，重新传一次。");
        }
        context.response.writeHead(200, {
          "content-type": contentTypeOf(target),
          "cache-control": "no-store"
        });
        fs.createReadStream(target).pipe(context.response);
        return undefined;
      }
    },
    {
      method: "GET",
      path: "/api/agent/threads/get",
      handler: function (context) {
        return { ok: true, conversation: chats.get(context.url.searchParams.get("id") || "") };
      }
    },
    {
      /* 新建一条空对话：界面点「新建对话」时先有位置，第一次提问再取标题。 */
      method: "POST",
      path: "/api/agent/threads/new",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        const conversation = chats.create({ title: body.title, projectRoot: body.projectRoot });
        return { ok: true, conversation: chats.get(conversation.id), conversations: chats.list() };
      }
    },
    {
      method: "POST",
      path: "/api/agent/threads/remove",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        chats.remove(String(body.id || ""));
        return { ok: true, conversations: chats.list() };
      }
    },
    {
      method: "GET",
      path: "/api/health",
      handler: function () {
        return {
          ok: true,
          version: version,
          supervised: supervised,
          plugin: pluginSummary(),
          frames: resolver.framesOfAllFiles(),
          // 全局「有新版」标注读这份精简快照：不起网、不带版本历史。
          update: update.hint()
        };
      }
    },
    {
      /*
       * 换一份重跑：先把响应回干净，再让本进程按监督进程约定的退出码退出 ——
       * launch.js 收到这个码就按 current.json 重新起一份，界面因此不用人再去重启。
       * 入参：无（界面按这一页的惯例发一个空 JSON 体，所以照样声明 body: true）。
       */
      method: "POST",
      path: "/api/client/restart",
      body: true,
      handler: function (context) {
        if (!supervised) {
          throw new UserError(
            "NO_SUPERVISOR",
            "这一份不是从客户端窗口起的",
            "重新打开一次客户端（双击 start.cmd 或 mastergo-transcoder.exe）再切版本；不重开也行，下次启动生效。"
          );
        }
        /*
         * 没有第二道「起这一份的窗口还在不在」的护栏：实测（WMI 起的监督进程也一样）父进程一没，
         * server.js 跟着没，孤儿状态在发布形态下造不出来，加了就是一道永远为真的门禁。
         * 真到那一步，界面这边也没了 —— 能做的只有把话说在客户端窗口与提示文案里。
         */
        // 重启会把正在跑的流水线/看板任务一起带走：有任务在跑就先挡住（与切版本、换插件同一道门禁）。
        requireIdle(isBusy, "重启客户端");
        context.response.once("finish", function () {
          setTimeout(function () { process.exit(RESTART_CODE); }, 50);
        });
        return { ok: true, restarting: true };
      }
    },
    {
      method: "GET",
      path: "/api/plugin",
      handler: function () {
        requirePlugin();
        // 步骤清单不写死在 GUI：插件改了流程，这里跟着变。
        const steps = readPipelineSteps(plugin.root);
        return { ok: true, plugin: pluginSummary(), steps: steps };
      }
    },
    {
      method: "GET",
      path: "/api/plugin/sources",
      handler: function () {
        return Object.assign({ ok: true }, pluginSourcesView());
      }
    },
    {
      /* 手动切换插件来源：body.override 是来源 id，空串 = 回到自动查找顺序。 */
      method: "POST",
      path: "/api/plugin/override",
      body: true,
      handler: function (context) {
        requireIdle(isBusy, "切换插件来源");
        const body = context.body || {};
        settings.write({ pluginOverride: String(body.override || "") });
        pluginRuntime.reload();
        return Object.assign({ ok: true }, pluginSourcesView());
      }
    },
    {
      /*
       * 客户端自带的那一份插件：装到哪儿、装的是哪一版、远端有没有新的。
       * status 不联网；check 才拉插件清单（失败落在 status.error，界面照常渲染）。
       */
      method: "GET",
      path: "/api/plugin/update/status",
      handler: function () {
        return { ok: true, status: pluginUpdate.status() };
      }
    },
    {
      method: "POST",
      path: "/api/plugin/update/check",
      body: true,
      handler: async function () {
        return { ok: true, status: await pluginUpdate.check() };
      }
    },
    {
      /* 装最新那一版：跑在后台，进度与结果都在 status().task 里；装完立刻可用（定位按最高版本现取）。 */
      method: "POST",
      path: "/api/plugin/update/install",
      body: true,
      handler: function () {
        const started = pluginUpdate.install();
        return { ok: true, started: started.started, version: started.version, note: started.note || "", status: started.status };
      }
    },
    {
      method: "POST",
      path: "/api/resolve",
      body: true,
      handler: function (context) {
        requirePlugin();
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
        requirePlugin();
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
        return { ok: true, settings: settingsView() };
      }
    },
    {
      method: "POST",
      path: "/api/settings",
      body: true,
      handler: function (context) {
        settings.write(context.body || {});
        return { ok: true, settings: settingsView() };
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
        requirePlugin();
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
        requirePlugin();
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
        requirePlugin();
        const body = context.body || {};
        const parsed = parseLink(body.link || "");
        const fileId = String(body.fileId || parsed.fileId || "");
        const layerId = String(body.layerId || parsed.layerId || "");
        const info = resolveDesignPageName({ pluginRoot: plugin.root, fileId: fileId, layerId: layerId, token: tokenOf() });
        return { ok: true, pageName: info.pageName, rootId: info.rootId };
      }
    },
    {
      method: "POST",
      path: "/api/identity/candidates",
      body: true,
      handler: async function (context) {
        const body = context.body || {};
        const parsed = parseLink(body.link || "");
        // 人显式给了区域（例如已知这一页属于 F1）就按那个区域算候选、不拦：判定在后端这一份实现里。
        const info = candidatesFor({
          projectRoot: body.projectRoot || "",
          pageName: body.pageName || "",
          fileId: String(body.fileId || parsed.fileId || ""),
          layerId: String(body.layerId || parsed.layerId || ""),
          explicitUi: body.ui || ""
        });
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
        if (body.kind === "layout-groups") return { ok: true, ...(await ai.suggestLayoutGroups(body)) };
        throw new UserError("BAD_KIND", "未知的建议类型：" + body.kind, "可用：icon-name / translation / glossary / layout-groups");
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
        requirePlugin();
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
        requirePlugin();
        const result = board.add(context.body || {});
        return { ok: true, board: result.board, created: result.created };
      }
    },
    {
      method: "POST",
      path: "/api/board/start",
      body: true,
      handler: function (context) {
        requirePlugin();
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
       * 程序更新的五态：unchecked / up_to_date / update_available / download_ready / error。
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
      /*
       * 下某一版（含历史版本）：清单按那一版的 tag 取，之后同一条下载/校验/落盘流程。
       * 更新页里「历史版本」那几行就靠它变成「可切换」。
       */
      method: "POST",
      path: "/api/update/stage",
      body: true,
      handler: async function (context) {
        const started = await update.stage(String((context.body || {}).version || ""));
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
       * 运行时这一条线：客户端自带的 Node 与 PowerShell 7 在不在、能不能用、要不要重下。
       * 两份都在关键路径上，所以没有切换，只有「下载 / 修复」；claude 只检测。
       */
      method: "GET",
      path: "/api/runtime/status",
      handler: function () {
        return { ok: true, status: runtime.status() };
      }
    },
    {
      /* 下载跑在后台：这里立刻回，进度与结果都在 status().task 里。 */
      method: "POST",
      path: "/api/runtime/download",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        const started = runtime.startDownload(String(body.tool || ""));
        return { ok: true, started: started.started, tool: started.tool, note: started.note || "", status: started.status };
      }
    },
    {
      /* 看一眼某个安装包来源下这两个文件在不在：设置里那个框是给内网填的，别让人干等「下载失败」。 */
      method: "POST",
      path: "/api/runtime/probe",
      body: true,
      handler: async function (context) {
        const body = context.body || {};
        const base = String(body.base || "").trim() || settings.read().runtime.mirror;
        return { ok: true, base: base, results: await runtime.probeSource(base) };
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
        // 没有指定对话就现开一条：提问即建档，界面不必先调一次新建。
        const conversation = body.conversationId
          ? chats.get(String(body.conversationId))
          : chats.create({});
        // 附件只认我们自己落盘的那些路径：界面报什么路径都不能直接信。
        const attached = (Array.isArray(body.attachments) ? body.attachments : [])
          .filter(function (item) {
            return item && uploads.belongs(item.path);
          })
          .map(function (item) {
            // 类型与名字都在这里重算：路径过了 belongs 也不能信界面报上来的 kind。
            const file = String(item.path);
            return { path: file, name: path.basename(file), kind: kindOf(file) };
          });
        const current = settings.read();
        // 这次用哪份参考源：界面选的 → 这条对话上次用的 → 设置里的默认那份。
        const wanted = String(body.templateId || conversation.templateId || current.activeTemplateId || "");
        const template = pickTemplate(current.templates, wanted);
        const prompt = buildContext({
          systemPrompt: template ? template.systemPrompt : "",
          codebases: template ? template.codebases : [],
          attachments: attached
        }) + String(body.prompt || "");
        const prepared = codex.execArgs({
          prompt: prompt,
          images: imagePaths(attached),
          resume: String(body.resume || ""),
          projectRoot: String(body.projectRoot || ""),
          // 写盘要三处都同意：设置里开着开关、这一次勾了、这一次也确认过是哪个目录。
          write: body.write === true && current.agent.allowWrite,
          confirmRoot: String(body.writeConfirm || "")
        });
        streamAgentChat(context, codex, prepared, String(body.projectRoot || ""), {
          chats: chats,
          conversationId: conversation.id,
          prompt: String(body.prompt || ""),
          templateId: template ? template.id : ""
        });
        return undefined;
      }
    }
  ];
}

/*
 * 把一次 codex 进程的 stdout/stderr 按行写成 NDJSON：每行一条 {ok, stream, line}，
 * 结尾一条 {ok, exit}。用 NDJSON 而不是 SSE —— 前端读的就是同一个 fetch 流，不需要额外解析器。
 */
function streamAgentChat(context, codex, prepared, projectRoot, record) {
  const engine = codex.active();
  if (!engine) {
    throw new UserError("NO_CODEX", "还没有可用的 Codex", "到「设置」里下载一份，或装一个 Codex 客户端。");
  }
  // 存档与流并行：界面拿到的每一行都先落进这条对话，重开页面就还在。
  const started = record.chats.beginTurn(record.conversationId, record.prompt);
  const turn = started.turn;
  record.chats.stamp(record.conversationId, {
    agent: "Codex v" + engine.version + "（" + engine.source + "）",
    projectRoot: projectRoot,
    templateId: record.templateId
  });
  const response = context.response;
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store"
  });
  const send = function (payload) {
    if (!response.writableEnded) response.write(JSON.stringify(payload) + "\n");
  };
  send({ ok: true, conversation: { id: record.conversationId, title: started.title } });
  send({ ok: true, engine: { version: engine.version, source: engine.source, state: engine.state } });

  let child = null;
  // 界面关掉对话框、点「停下」，都表现为响应这一侧的连接断开。
  // 不能听 request 的 close：请求体读完它就发了，那时子进程还没起，真正的断开反而等不到。
  response.on("close", function () {
    if (!response.writableEnded && child) child.kill();
    record.chats.endTurn(record.conversationId, turn, null);
  });
  try {
    child = codex.run(prepared.args, {
      env: prepared.env,
      cwd: projectRoot,
      onLine: function (line, name) {
        record.chats.appendLine(turn, name, line);
        send({ ok: true, stream: name, line: line });
      },
      onExit: function (code) {
        record.chats.endTurn(record.conversationId, turn, code);
        send({ ok: true, exit: code });
        if (!response.writableEnded) response.end();
      },
      onError: function (error) {
        record.chats.endTurn(record.conversationId, turn, null);
        send({ ok: false, error: toFailure(error) });
        if (!response.writableEnded) response.end();
      }
    });
  }
  catch (error) {
    // 头已经发出去了，错误只能当一条事件流事件告诉界面。
    record.chats.endTurn(record.conversationId, turn, null);
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
      const body = route.body ? await readBody(request, route.bodyLimit || MAX_BODY_BYTES) : null;
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
