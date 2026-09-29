"use strict";

// 任务看板：一屏同时跑多个页面转码，各自在自己的工作目录里跑，跑完合回主工程。
//
// 并发规则：同时占额度的任务不超过 limits.limit。同一主工程上的多个任务可以同时跑 ——
// 每个任务写的是自己的 workdir，主工程只被合并阶段逐个写入，所以不会互相覆盖。
//
// 状态机：
//   queued → preparing → running → ready → merging → merged
//                          ↑↓ waiting        ↘ conflict
//                        failed / stopped
//
// 状态不猜：每个 tick 都去问运行管理器「这个工作目录上最近那次运行现在什么状态」，
// 所以从「待确认」页续跑、从流水线页手动停掉，看板都会跟着变。

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");
const { logicalCores, parallelism } = require("./concurrency.js");
const pageProgress = require("./page-progress.js");
const workdir = require("./workdir.js");
const mergeModule = require("./merge.js");
const { parseLink } = require("./resolve-target.js");

const TICK_MS = 1000;
// 一个任务最多自动补几次输入：补完还停就说明模型给不出可用结果，交回给人。
const AUTO_FILL_LIMIT = 4;

const STATE_LABEL = {
  queued: "排队中",
  preparing: "建工作目录",
  running: "运行中",
  waiting: "待确认",
  ready: "待合并",
  merging: "合并中",
  merged: "已合并",
  conflict: "合并冲突",
  failed: "失败",
  stopped: "已停止"
};

// 占并发额度的状态：只有真正在跑（或在建目录、或在合并）才算。
const OCCUPYING = new Set(["preparing", "running", "merging"]);
// 需要持续跟运行管理器对表的状态。
const LIVE = new Set(["preparing", "running", "waiting", "ready", "merging"]);

function pad(value) {
  return String(value).padStart(2, "0");
}

function stepLogPath(workDir, failure) {
  if (!failure || !failure.stepName) return "";
  return workdir.absolute(
    workDir,
    workdir.runProductRel("_work", "steps", pad(failure.stepId) + "-" + failure.stepName + ".log")
  );
}

function normalizeMode(value, fallback) {
  const raw = String(value || fallback || "B").trim().toUpperCase();
  if (raw === "A" || raw === "B" || raw === "AB") return raw;
  throw new UserError("BAD_MODE", "路线只能是 A / B / AB", "收到：" + value);
}

// 看板上的 A / B / AB 对应插件自己的路线名。AB 先 A 后 B，最后一次写 Layout.xml 的是 B，
// 所以 AB 按 B 的写法表重新注册（Layout 发射本来就是两条路线共用的实现）。
const PIPELINE_MODE = { A: "mw-wpf", B: "mtslg-iocontrol", AB: "mtslg-iocontrol" };

function createBoard(deps) {
  const runs = deps.runs;
  const pending = deps.pending;
  const autoFill = deps.autoFill || null;
  const layoutRegistrar = deps.layout || null;
  const artifacts = deps.artifacts || null;
  const home = deps.home;

  const storePath = path.join(home, "board.json");
  const workRoot = path.join(home, "work");

  let tasks = load();
  let timer = null;
  let merging = false;
  const mergeQueue = [];

  function load() {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    }
    catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    // 进程重启时正在跑的任务不可能还在跑：标成已停止，不假装它还活着。
    // 「待确认」不在此列 —— 它的输入清单本来就在磁盘上，重启后照样能接着填。
    const interrupted = new Set(["preparing", "running", "merging"]);
    return parsed.map(function (task) {
      if (interrupted.has(task.state)) {
        task.state = "stopped";
        task.error = "客户端重启，这个任务已中断";
      }
      if (task.state === "waiting") {
        // 停在语义停点的任务重启后还有救：输入清单在磁盘上，重新给一次自动补输入的机会。
        task.autoFillCount = 0;
        task.rearmAutoFill = true;
      }
      // 冲突清单里的 resolvable 由合并阶段判定，界面只读不猜：读盘时把它补成布尔，
      // 缺字段的记录按「可裁决」算，否则界面拿到 undefined 会把一条本来能选的冲突显示成不能处理。
      if (task.merge && Array.isArray(task.merge.conflicts)) {
        for (const conflict of task.merge.conflicts) {
          if (typeof conflict.resolvable !== "boolean") conflict.resolvable = true;
        }
      }
      return task;
    });
  }

  function save() {
    try {
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(tasks, null, 2) + "\n", "utf8");
    }
    catch {
      // 落盘失败不影响本次运行；下次启动会从上一份快照恢复。
    }
  }

  function get(id) {
    const task = tasks.find(function (item) { return item.id === id; });
    if (!task) throw new UserError("NO_TASK", "看板上没有这个任务", "刷新页面看当前看板。");
    return task;
  }

  function occupying() {
    return tasks.filter(function (task) { return OCCUPYING.has(task.state); });
  }

  function progressOf(task) {
    const job = task.jobId ? runs.status(task.jobId) : null;
    const registered = stepsOf(task);
    // 运行管理器里没有这次运行（客户端重启过）时，插件登记表还在：进度照样给得出来。
    if (!job && registered.length === 0) return null;
    const lines = (job ? job.runs : []).map(function (run) {
      const steps = Object.values(run.steps);
      const done = steps.filter(function (step) { return step.state === "ok" || step.state === "skipped"; }).length;
      const current = steps.find(function (step) { return step.state === "running"; });
      return {
        label: run.label,
        state: run.state,
        done: done,
        total: steps.length,
        currentTitle: current ? current.title : ""
      };
    });
    /*
     * 进度按**插件运行登记表**算，不按本次运行的实时步骤：
     * - 停在某一步（-StopAfter）时，后面的步骤在本次运行里是「跳过」，按实时状态算会显示成跑完了；
     * - 从第 9 步续跑时，前 8 步在本次运行里也是「跳过」，按实时状态算又只剩 4/12。
     * 登记表是「这一页推进到哪儿」的唯一记录（续跑接着写同一份），所以它是进度的口径。
     */
    const contractTotal = (runs.contract() || []).length;
    const fallbackDone = lines.reduce(function (sum, line) { return sum + line.done; }, 0);
    const fallbackTotal = lines.reduce(function (sum, line) { return sum + line.total; }, 0);
    const done = registered.length > 0
      ? registered.filter(function (step) { return step.status === "ok"; }).length
      : fallbackDone;
    const total = contractTotal > 0 ? contractTotal : fallbackTotal;
    const running = lines.find(function (line) { return line.currentTitle; });
    return {
      done: done,
      total: total,
      currentTitle: running ? running.currentTitle : "",
      runs: lines
    };
  }

  function publicTask(task) {
    return {
      id: task.id,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      state: task.state,
      stateLabel: STATE_LABEL[task.state] || task.state,
      request: task.request,
      jobId: task.jobId || "",
      workDir: task.workDir,
      autoMerge: task.autoMerge,
      progress: progressOf(task),
      steps: stepsOf(task),
      aiFills: task.aiFills || [],
      failure: task.failure || null,
      merge: task.merge || null,
      resolutions: task.resolutions || {},
      error: task.error || ""
    };
  }

  function snapshot() {
    // 每次回看板都对一次表：运行管理器里已经没有这次运行（客户端重启过，或旧 job 被挤掉）时，
    // 行上的状态与停点按磁盘上的登记表重算，免得点「继续」才发现这次运行早不见了。
    for (const task of tasks) reconcileTask(task);
    const logical = logicalCores();
    return {
      workRoot: workRoot,
      limits: { logical: logical, limit: parallelism(logical) },
      running: occupying().length,
      tasks: tasks.map(publicTask)
    };
  }

  // ---------- 调度 ----------

  function pump() {
    for (const task of tasks) {
      if (task.state !== "queued") continue;
      if (occupying().length >= parallelism(logicalCores())) break;
      void launch(task);
    }
    ensureTimer();
  }

  function canLaunchNow() {
    return occupying().length < parallelism(logicalCores());
  }

  async function launch(task) {
    task.state = "preparing";
    task.error = "";
    task.updatedAt = new Date().toISOString();
    save();
    try {
      const created = await workdir.create({
        projectRoot: task.request.projectRoot,
        taskId: task.id,
        workRoot: workRoot
      });
      task.workDir = created.dir;
      task.baseDir = created.baseDir;
      const job = runs.start({
        projectRoot: created.dir,
        target: task.request.target,
        layerId: task.request.layerId,
        fileId: task.request.fileId,
        ui: task.request.ui,
        mode: task.request.mode,
        origin: "board",
        stopAfter: task.request.stopAfter,
        overwrite: task.request.overwrite === true,
        allowEmptyLedger: task.request.allowEmptyLedger === true
      });
      task.jobId = job.id;
      task.state = "running";
      task.updatedAt = new Date().toISOString();
    }
    catch (error) {
      task.state = "failed";
      task.error = String(error && error.message ? error.message : error);
      task.updatedAt = new Date().toISOString();
    }
    save();
    ensureTimer();
  }

  // 契约里写着「这一步吃人/AI 写的输入文件」—— 失败在这类步骤上就是停点，不是错误。
  // 判据来自插件自己的步骤契约（Inputs），不是我们猜步骤名。
  const HUMAN_INPUT_FILES = ["icon-naming.json", "lang-translations.json", "lang-glossary.json"];

  let humanInputCache = null;

  function humanInputStepNames() {
    if (humanInputCache) return humanInputCache;
    const names = new Set();
    for (const step of runs.contract() || []) {
      const inputs = Array.isArray(step.Inputs) ? step.Inputs : [];
      if (inputs.some(function (item) {
        return HUMAN_INPUT_FILES.some(function (name) { return String(item).indexOf(name) >= 0; });
      })) {
        names.add(step.Name);
      }
    }
    // 契约还没读到（这个进程还没起过运行）就先不标，下次再算。
    if (names.size > 0) humanInputCache = names;
    return names;
  }

  // 任务的流程视图：步骤来自插件自己的运行登记表（续跑会接着写同一份），
  // 所以这里是「这一页跨多次运行」的合并结果；人/AI 输入的步骤按步骤契约标出来。
  function stepsOf(task) {
    if (!artifacts || !task.workDir || !task.request.target) return [];
    let info = null;
    try {
      info = artifacts.read({ projectRoot: task.workDir, target: task.request.target });
    }
    catch {
      return [];
    }
    if (!info || !info.available) return [];
    const human = humanInputStepNames();
    const fills = task.aiFills || [];
    return info.steps.map(function (step) {
      return {
        id: step.id,
        name: step.name,
        status: step.status,
        seconds: step.seconds,
        note: step.note,
        humanInput: human.has(step.name),
        aiFill: fills.find(function (fill) { return fill.stepName === step.name; }) || null
      };
    });
  }

  // 没写 Target 时插件按设计稿推导；跑起来之后从登记表把真实 Target 认回来 ——
  // 后面的待确认、步骤列表、合并都要用它。
  function adoptTarget(task) {
    if (task.request.target || !task.workDir) return;
    let names = [];
    try {
      names = fs.readdirSync(workdir.absolute(task.workDir, workdir.runProductRel("runs")), { withFileTypes: true })
        .filter(function (entry) { return entry.isDirectory(); })
        .map(function (entry) { return entry.name; });
    }
    catch {
      return;
    }
    if (names.length !== 1) return;
    task.request.target = names[0];
    save();
  }

  function contractWantsHumanInput(failure) {
    const inputs = failure && failure.contract && Array.isArray(failure.contract.Inputs) ? failure.contract.Inputs : [];
    return inputs.some(function (item) {
      const text = String(item);
      return HUMAN_INPUT_FILES.some(function (name) { return text.indexOf(name) >= 0; });
    });
  }

  /*
   * 停点是不是「等语义输入」：先看插件自己的产物（待命名清单 / 待译清单 / 写歪的命名表），
   * 读不出来就退回步骤契约（例如还没给 Target、清单读不到，但那一步本来就是等输入的）。
   * 第 7 步拒绝的两种形态都算：旧下标（台账多出图标）与重名资源名（图标资源名重复）。
   */
  function isSemanticStop(task) {
    try {
      const info = pending.inspect({ projectRoot: task.workDir, target: task.request.target });
      const icons = info.icons && info.icons.available && (info.icons.needsNaming || info.icons.needsRepair);
      const texts = info.translations && (info.translations.needsTranslation || info.translations.needsGlossary);
      if (icons || texts) return true;
    }
    catch {
      // 落到契约判据
    }
    return contractWantsHumanInput(task.failure);
  }

  function syncTask(task) {
    const job = (task.jobId ? runs.status(task.jobId) : null) || runs.latestFor(task.workDir);
    if (!job) return false;
    adoptTarget(task);
    const before = task.state;

    if (job.state === "running" || job.state === "stopping") {
      task.state = "running";
      // 续跑起来之后，上一次停点留下的那段信息就不该再挂在行上。
      task.failure = null;
    }
    else if (job.state === "done") {
      task.state = task.state === "merging" || task.state === "conflict" ? task.state : "ready";
      task.failure = null;
    }
    else if (job.state === "failed") {
      const run = job.runs.find(function (item) { return item.failure; }) || job.runs[0];
      const failure = run.failure || null;
      task.failure = failure
        ? {
            kind: "",
            stepName: failure.stepName,
            title: failure.contract ? failure.contract.Title : "",
            message: failure.message,
            logPath: stepLogPath(task.workDir, failure)
          }
        : { kind: "error", stepName: "", title: "", message: job.error || "流水线失败", logPath: "" };
      task.state = isSemanticStop(task) ? "waiting" : "failed";
      task.failure.kind = task.state === "waiting" ? "semantic" : "error";
    }
    else if (job.state === "stopped") {
      task.state = "stopped";
    }

    if (before !== task.state) {
      task.updatedAt = new Date().toISOString();
      if (task.state === "ready" && task.autoMerge) queueMerge(task.id);
      if (task.state === "waiting") void autoFillWaiting(task);
      save();
      return true;
    }
    return false;
  }

  /*
   * 跟磁盘对表：运行管理器里已经没有这次运行（客户端重启过，或旧 job 已被挤掉）时，
   * 插件运行登记表就是这一页推进到哪儿的唯一记录。
   *   步骤跑满且全 ok → 这一页已经产出来了，任务回到「待合并」；
   *   有一步没跑成 → 把行上的停点换成登记表里那一步，再按停点性质区分「失败」与「待确认」。
   * 只在运行管理器给不出状态时用：有 job 时一律以 job 为准，那是实时事实。
   */
  function reconcileTask(task) {
    if (task.state !== "failed" && task.state !== "stopped") return false;
    const registered = stepsOf(task);
    if (registered.length === 0) return false;
    const failed = registered.find(function (step) { return step.status === "failed"; });
    const complete = pageProgress.isComplete(registered, (runs.contract() || []).length);
    // 没跑完也没有失败记录（上一次是被人停掉的）：维持原状，人停的就是停的。
    if (!complete && !failed) return false;

    const before = task.state;
    if (complete) {
      task.state = "ready";
      task.failure = null;
      task.error = "";
    }
    else {
      const contract = (runs.contract() || []).find(function (step) { return step.Name === failed.name; });
      task.state = isSemanticStop(task) ? "waiting" : "failed";
      task.failure = {
        kind: task.state === "waiting" ? "semantic" : "error",
        stepName: failed.name,
        title: contract ? contract.Title : "",
        message: failed.note || "这一步没有通过",
        logPath: stepLogPath(task.workDir, { stepId: failed.id, stepName: failed.name })
      };
      // 与「启动时本来就停在待确认」同一个处理：重新给一次自动补输入的机会。
      task.rearmAutoFill = true;
    }
    task.updatedAt = new Date().toISOString();
    save();
    if (before !== task.state && task.state === "ready" && task.autoMerge) queueMerge(task.id);
    return true;
  }

  // 停在语义停点、自动化层级是 auto 时，让模型补输入并续跑。
  // 每个任务最多自动补 AUTO_FILL_LIMIT 次：补完还停就说明模型给不出可用结果，交回给人。
  async function autoFillWaiting(task) {
    if (!autoFill) return;
    if ((task.autoFillCount || 0) >= AUTO_FILL_LIMIT) {
      task.error = "自动补输入已到上限，需要人工填写";
      save();
      return;
    }
    task.autoFillCount = (task.autoFillCount || 0) + 1;
    save();
    const stop = task.failure
      ? { stepName: task.failure.stepName, stepTitle: task.failure.title }
      : { stepName: "", stepTitle: "" };
    try {
      const result = await autoFill.fill({
        projectRoot: task.workDir,
        target: task.request.target,
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
      });
      if (!result.ok) {
        // 清单里没有可补的东西不是错误：停在停点上等人来看，别在行上喊"失败"。
        if (!result.empty) task.error = result.reason || "自动补输入失败";
        save();
        return;
      }
      // 续跑成功后运行管理器会给出新的 job：记下来，下一 tick 就跟到新运行上。
      if (result.job) task.jobId = result.job.id;
      // 记下「这一步是 AI 补的、补了什么」：流程里要按步骤显示出来，不靠弹错误。
      // 补的内容记在**消费它的那一步**上（就是续跑锚点，与 confirm 的规则同一份），
      // 停在哪一步另记一笔 —— 两者常常不是同一步（例如停在第 11 步门禁，补的是第 9 步的译文）。
      const anchor = result.job && result.job.request ? String(result.job.request.progress || "") : "";
      task.aiFills = (task.aiFills || []).concat([{
        at: new Date().toISOString(),
        stepName: anchor || stop.stepName,
        stepTitle: stop.stepTitle,
        stoppedAt: stop.stepName,
        filled: result.filled || []
      }]).slice(-8);
      task.error = "";
      save();
      ensureTimer();
    }
    catch (error) {
      task.error = String(error && error.message ? error.message : error);
      save();
    }
  }

  function tick() {
    let alive = false;
    for (const task of tasks) {
      if (!LIVE.has(task.state)) continue;
      alive = true;
      syncTask(task);
      if (task.state === "waiting" && task.rearmAutoFill) {
        task.rearmAutoFill = false;
        void autoFillWaiting(task);
      }
    }
    pump();
    if (!alive && mergeQueue.length === 0 && !merging) stopTimer();
  }

  function ensureTimer() {
    if (timer) return;
    if (!tasks.some(function (task) { return LIVE.has(task.state); }) && mergeQueue.length === 0) return;
    timer = setInterval(tick, TICK_MS);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  // ---------- 合并 ----------

  function queueMerge(id) {
    const task = get(id);
    if (task.state !== "ready" && task.state !== "conflict") {
      throw new UserError("NOT_READY", "这个任务还没有可合并的产物", "当前状态：" + (STATE_LABEL[task.state] || task.state));
    }
    if (!mergeQueue.includes(id)) mergeQueue.push(id);
    void drainMerges();
    ensureTimer();
  }

  async function drainMerges() {
    if (merging) return;
    merging = true;
    try {
      while (mergeQueue.length > 0) {
        const id = mergeQueue.shift();
        const task = tasks.find(function (item) { return item.id === id; });
        if (!task) continue;
        // 主工程上还有流水线在跑就不合：合并是在主工程上做读-改-写，必须等它静下来。
        const busy = runs.latestFor(task.request.projectRoot);
        if (busy && busy.state === "running") {
          task.error = "主工程上还有一次运行在跑，等它结束再合并";
          save();
          continue;
        }
        await runMerge(task);
      }
    }
    finally {
      merging = false;
    }
  }

  async function runMerge(task) {
    task.state = "merging";
    task.updatedAt = new Date().toISOString();
    save();
    try {
      const manifest = await workdir.readManifest(task.id, workRoot);
      if (!manifest) throw new Error("找不到这个任务的工作目录基线清单，无法判定哪些文件是本次产出的");
      const report = await mergeModule.merge({
        projectRoot: task.request.projectRoot,
        workDir: task.workDir,
        baseDir: task.baseDir,
        manifest: manifest,
        target: task.request.target,
        mode: PIPELINE_MODE[task.request.mode] || "mtslg-iocontrol",
        layout: layoutRegistrar,
        resolutions: task.resolutions || {}
      });
      task.merge = {
        at: new Date().toISOString(),
        applied: report.applied,
        skipped: report.skipped,
        notes: report.notes,
        conflicts: report.conflicts
      };
      task.state = report.conflicts.length > 0 ? "conflict" : "merged";
      // 合并成功就把选择清掉：下一次冲突是另一批文件，旧选择不能顺手生效。
      if (task.state === "merged") task.resolutions = {};
      task.error = "";
    }
    catch (error) {
      task.state = "conflict";
      task.error = String(error && error.message ? error.message : error);
    }
    task.updatedAt = new Date().toISOString();
    save();
  }

  // ---------- 对外操作 ----------

  function add(payload) {
    const projectRoot = String(payload.projectRoot || "").trim();
    if (!projectRoot) throw new UserError("NEED_PROJECT", "请先填工程目录", "任务要在工程目录上跑，必填。");
    if (!fs.existsSync(projectRoot)) throw new UserError("NO_PROJECT", "工程目录不存在：" + projectRoot, "确认路径后再加任务。");
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) throw new UserError("NO_ITEMS", "没有要加入的页面", "一行一个链接，至少一行。");

    const mode = normalizeMode(payload.mode, "B");
    const created = [];
    for (const item of items) {
      const link = String(item.link || "").trim();
      if (!link) continue;
      const parsed = parseLink(link);
      if (!parsed.fileId || !parsed.layerId) {
        throw new UserError("BAD_LINK", "链接里没有 file / layer_id：" + link, "在 MasterGo 里选中页面帧后复制链接。");
      }
      const task = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: "queued",
        request: {
          mode: normalizeMode(item.mode, mode),
          link: link,
          target: String(item.target || "").trim(),
          ui: String(item.ui || payload.ui || "").trim(),
          projectRoot: projectRoot,
          fileId: String(item.fileId || parsed.fileId),
          layerId: String(item.layerId || parsed.layerId),
          overwrite: payload.overwrite === true,
          allowEmptyLedger: payload.allowEmptyLedger === true,
          // 停在某一步（插件 -StopAfter）：先出待命名清单、再回来跑后半段。
          stopAfter: String(item.stopAfter || payload.stopAfter || "").trim()
        },
        workDir: "",
        baseDir: "",
        jobId: "",
        autoMerge: payload.autoMerge !== false,
        failure: null,
        merge: null,
        // 人在冲突处做过的选择（相对路径 → mine / main）：合并开始前记上，合并成功后清空。
        resolutions: {},
        error: ""
      };
      tasks.push(task);
      created.push(task.id);
    }
    if (created.length === 0) throw new UserError("NO_ITEMS", "没有解析出可用链接", "");
    save();
    return { board: snapshot(), created: created };
  }

  function start(id) {
    if (id) {
      const task = get(id);
      if (task.state !== "queued") {
        throw new UserError("NOT_QUEUED", "只有排队中的任务可以启动", "当前状态：" + (STATE_LABEL[task.state] || task.state));
      }
      // 额度不够就先留在队列里，tick 会在有空位时接着起 —— 不硬闯并发上限。
      if (canLaunchNow()) void launch(task);
    }
    else {
      pump();
    }
    save();
    ensureTimer();
    return snapshot();
  }

  function stop(id) {
    const task = get(id);
    if (task.jobId) {
      try {
        runs.stop(task.jobId);
      }
      catch {
        // 已经不在跑了，按状态同步兜底
      }
    }
    task.state = "stopped";
    task.updatedAt = new Date().toISOString();
    save();
    return snapshot();
  }

  /*
   * 把一次从看板任务发起的续跑挂回任务上。
   * 运行管理器不认识看板任务：不挂的话，行上的状态、日志、合并都还停在旧的那次运行上。
   */
  function attach(id, job) {
    const task = get(id);
    task.jobId = job.id;
    task.state = "running";
    task.failure = null;
    task.error = "";
    task.updatedAt = new Date().toISOString();
    save();
    ensureTimer();
    return snapshot();
  }

  // 任务对外的画像：续跑与待确认提交只用得到这些 —— 任务自己记的路线、工作目录与那次运行。
  function taskRef(task) {
    return {
      id: task.id,
      state: task.state,
      workDir: task.workDir,
      jobId: task.jobId || "",
      request: task.request
    };
  }

  /*
   * 按任务 id 取。续跑一律认 id 不认 jobId：jobId 每次续跑都会被换掉（AI 补输入、挂回新运行），
   * 拿它当钥匙，界面上那次陈旧的点击就会变成「找不到这次运行」。
   */
  function byId(id) {
    const wanted = String(id || "").trim();
    if (!wanted) return null;
    const task = tasks.find(function (item) { return item.id === wanted; });
    return task ? taskRef(task) : null;
  }

  /*
   * 续跑计划：运行管理器里已经没有这次运行（客户端重启过，或旧 job 已被挤掉）时，
   * 从看板任务自己记的路线、输入与工作目录，加上磁盘上的登记表，算出还能不能续、从哪一步续。
   * 工程目录用任务自己的工作目录 —— 原次运行就是在那儿跑的，产物也在那儿。
   */
  function planResume(id) {
    const task = get(id);
    const contract = runs.contract() || [];
    if (pageProgress.isComplete(stepsOf(task), contract.length)) {
      return { finished: true, mode: task.request.mode, step: "" };
    }
    const next = pageProgress.resumeStepOf(stepsOf(task));
    const step = next ? String(next.name) : "";
    return {
      finished: false,
      mode: task.request.mode,
      step: step,
      // 目标里已经有这一页时，只有回到 bundle 那一步重算清单，-Overwrite 才写得进去。
      recomputedManifest: step !== "" && step === pageProgress.bundleManifestStep(contract),
      request: {
        projectRoot: task.workDir,
        target: task.request.target,
        fileId: task.request.fileId,
        layerId: task.request.layerId,
        ui: task.request.ui,
        mode: task.request.mode,
        allowEmptyLedger: task.request.allowEmptyLedger === true,
        origin: "board"
      }
    };
  }

  async function remove(id) {
    const task = get(id);
    if (OCCUPYING.has(task.state)) {
      throw new UserError("BUSY_TASK", "这个任务还在跑，先停掉再移除", "");
    }
    tasks = tasks.filter(function (item) { return item.id !== id; });
    save();
    // 没合并过的工作目录一律留着：那里面是还没搬进主工程的产物。
    if (task.state === "merged") {
      try {
        await workdir.remove(task.id, workRoot);
      }
      catch {
        // 清不掉不影响看板
      }
    }
    return snapshot();
  }

  function clear(states) {
    const wanted = Array.isArray(states) && states.length > 0 ? new Set(states) : new Set(["merged"]);
    tasks = tasks.filter(function (task) {
      return !(wanted.has(task.state) && !OCCUPYING.has(task.state));
    });
    save();
    pump();
    ensureTimer();
    return snapshot();
  }

  /*
   * 清空一个「工程 + 区域」下的任务：侧边栏区域行上的那个动作。
   * 有一条还在跑就整体拒绝（不静默跳过），否则用户会以为清干净了、实则还剩一条占着位子。
   * 只动任务列表，不碰工程自己的 docs/page-registry.json。
   */
  function clearArea(projectRoot, ui) {
    const root = String(projectRoot || "").trim();
    const area = String(ui || "");
    if (!root) throw new UserError("NEED_PROJECT", "缺少工程目录", "");
    const mine = tasks.filter(function (task) {
      return String(task.request.projectRoot || "").trim() === root && String(task.request.ui || "") === area;
    });
    const busy = mine.filter(function (task) { return OCCUPYING.has(task.state); });
    if (busy.length > 0) {
      throw new UserError("BUSY_TASK", "这个区域还有 " + busy.length + " 条任务在跑", "先停掉它们再清空。");
    }
    const ids = new Set(mine.map(function (task) { return task.id; }));
    tasks = tasks.filter(function (task) { return !ids.has(task.id); });
    save();
    pump();
    ensureTimer();
    return snapshot();
  }

  function mergeOne(id) {
    const task = get(id);
    queueMerge(id);
    return { board: snapshot(), task: publicTask(task) };
  }

  /*
   * 冲突处的人工裁决：记下「这个文件取哪一份」，等下次合并时按选择落地。
   * 只认当前冲突清单里列出来的路径 —— 界面上看得见的才能选，接口不接受清单外的文件。
   * 只记录不合并：一单冲突往往要连着决定好几个文件，选择完成后再走 mergeOne。
   */
  function resolveConflict(id, rel, pick) {
    const task = get(id);
    if (task.state !== "conflict") {
      throw new UserError("NOT_CONFLICT", "这个任务当前没有待裁决的冲突", "当前状态：" + (STATE_LABEL[task.state] || task.state));
    }
    const wanted = String(rel || "").trim();
    const list = task.merge && Array.isArray(task.merge.conflicts) ? task.merge.conflicts : [];
    const hit = list.find(function (item) { return item.path === wanted; });
    if (!hit) {
      throw new UserError("NO_CONFLICT_FILE", "这次冲突里没有这个文件：" + wanted, "刷新看板，按列出来的文件选。");
    }
    if (pick !== "mine" && pick !== "main" && pick !== "clear") {
      throw new UserError("BAD_PICK", "只能选以本任务为准、保留主工程，或者撤销选择", "收到：" + pick);
    }
    if (pick !== "clear" && hit.resolvable === false) {
      throw new UserError("NOT_RESOLVABLE", "这个文件不能按人工选择处理", hit.reason);
    }
    task.resolutions = task.resolutions || {};
    if (pick === "clear") delete task.resolutions[wanted];
    else task.resolutions[wanted] = pick;
    task.updatedAt = new Date().toISOString();
    save();
    return { board: snapshot(), task: publicTask(task) };
  }

  function mergeAll(projectRoot) {
    const wanted = String(projectRoot || "").trim();
    for (const task of tasks) {
      if (task.state !== "ready") continue;
      if (wanted && task.request.projectRoot !== wanted) continue;
      if (!mergeQueue.includes(task.id)) mergeQueue.push(task.id);
    }
    void drainMerges();
    ensureTimer();
    return snapshot();
  }

  // 客户端起来时，看板上可能还有没合并完的任务：接着把它们跟完。
  ensureTimer();

  return {
    snapshot: snapshot,
    add: add,
    start: start,
    stop: stop,
    attach: attach,
    byId: byId,
    planResume: planResume,
    remove: remove,
    clear: clear,
    clearArea: clearArea,
    mergeOne: mergeOne,
    resolveConflict: resolveConflict,
    mergeAll: mergeAll,
    workRoot: workRoot
  };
}

module.exports = { createBoard };
