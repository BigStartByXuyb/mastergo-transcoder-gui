"use strict";

/*
 * 流水线运行管理。
 *
 * 一次「运行」（job）包含一个或两个「区间」（A / B / AB）：
 *   run-all.ps1 一次只走一条路线，所以 AB = 两次独立运行，互不覆盖。
 *
 * 进度不猜：解析 run-all.ps1 自己的输出
 *   "[NN] <标题> …"                  步骤开始
 *   "      ok  <秒>s  <备注>"        步骤成功
 *   "!! 步骤 NN(name) 失败：<原因>"   步骤失败
 *   "   修好后从这一步继续：<命令>"    失败后的续跑提示
 *
 * 同一个工程目录同一时刻只允许一个 job（两个 job 写同一份 Layout.xml / csproj 会丢更新），
 * 不同工程目录可以并行 —— 看板正是靠「一任务一份工作目录」拿到并行度的。
 */

const crypto = require("crypto");
const { spawn } = require("child_process");

const { UserError } = require("./errors.js");
const { getterOf } = require("./getter.js");
const { readPipelineSteps } = require("./plugin.js");
const { parseLink } = require("./resolve-target.js");
const { childEnv, requireNodeExe, requirePwshExe } = require("./runtime.js");
// token 怎么进子进程只有 lib/mcp-token.js 一处：这里不另写环境变量名。
const { withToken } = require("./mcp-token.js");

/*
 * 子进程写出来的终端色码：PowerShell 7 渲染错误框时会带 ANSI（`ESC[31;1m` 之类）。
 * 日志与失败原因都是给人看的，色码在这里剥掉；剥的只是控制序列，可见字符一个不动。
 */
const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(text) {
  return String(text || "").replace(ANSI_PATTERN, "");
}

const MAX_LOG_CHARS = 512 * 1024;
const MAX_TAIL_LINES = 60;
// 失败原因常常写在失败摘要后面的几行里；只留这么多字符，够判断类型就行。
const MAX_FAILURE_DETAIL = 4000;
// 只留最近这些 job：看板每 tick 都要按工程目录反查，列表太长纯属拖慢自己。
const MAX_JOBS = 60;

const RE_STEP_START = /^\[(\d{2})\]\s+(.*)$/;
const RE_STEP_OK = /^\s+ok\s+([\d.]+)s\s*(.*)$/;
const RE_STEP_FAIL = /^!!\s*步骤\s*(\d+)\(([^)]+)\)\s*失败：(.*)$/;
const RE_RESUME = /^\s+修好后从这一步继续：(.*)$/;
const RE_ROUTE = /^路线:\s*(\S+)/;

const MODE_LABEL = { "mtslg-iocontrol": "B", "mw-wpf": "A" };
const ROUTE_ORDER = ["mw-wpf", "mtslg-iocontrol"]; // AB = 先 A 后 B，与标签一致

// 滚动日志缓冲：超过上限就从头部丢弃，并让外部用绝对偏移量续读。
class LogBuffer {
  constructor(limit) {
    this.limit = limit;
    this.text = "";
    this.base = 0;
  }

  append(chunk) {
    this.text += chunk;
    if (this.text.length > this.limit) {
      const drop = this.text.length - this.limit;
      this.text = this.text.slice(drop);
      this.base += drop;
    }
  }

  since(from) {
    const requested = Number.isFinite(from) ? Math.max(0, from) : 0;
    const start = Math.max(0, requested - this.base);
    return {
      from: this.base + start,
      next: this.base + this.text.length,
      truncated: requested < this.base,
      text: this.text.slice(start)
    };
  }
}

function normalizeMode(value) {
  const raw = String(value || "B").trim().toUpperCase();
  if (raw === "A" || raw === "AB" || raw === "B") return raw;
  throw new UserError("BAD_MODE", "路线只能是 A / B / AB", "收到：" + value);
}

/*
 * 进入步骤之前就失败（输入校验、登记表解析…）时的取因：
 * run-all.ps1 抛错后 pwsh 会打印错误框（`Line |`、缩进的行号、`+ CategoryInfo` 之类），
 * 直接取最后一行会把这些框线当成原因（用户只看到"Line |"）。这里跳过框线，取真正的那句。
 */
const PS_ERROR_FRAME = [
  /^Line \|$/,
  /^At line:/,
  /^\s*\+/,
  /^CategoryInfo/,
  /^FullyQualifiedErrorId/,
  /^Exception:/
];

/*
 * 错误框里那一段真正的原因。
 *
 * pwsh 把 throw 的文案按控制台宽度折行，每一行都以竖线开头（`| 文案`），
 * 分隔线（`| ~~~~`）在文案之前。只取最后一行会把「……登记本次页面的 designSource。」这种
 * 尾巴当成原因（实测：1.0.369 的身份混搭守卫报的就是这条，界面上只看到「designSource。」）。
 * 所以从最后一条分隔线往下，把连续的竖线行拼回一句。
 */
function errorBoxMessage(lines) {
  let underline = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^\|\s*~+$/.test(String(lines[index] || "").trim())) {
      underline = index;
      break;
    }
  }
  if (underline < 0) return "";

  const parts = [];
  for (let index = underline + 1; index < lines.length; index += 1) {
    const matched = /^\|\s?(.*)$/.exec(String(lines[index] || "").trim());
    if (!matched) break;
    const text = matched[1].trim();
    if (!text || /^~+$/.test(text)) continue;
    if (PS_ERROR_FRAME.some((pattern) => pattern.test(text))) continue;
    parts.push(text);
  }
  return parts.join("");
}

function failureMessageFromTail(tail) {
  const lines = Array.isArray(tail) ? tail : [];
  const boxed = errorBoxMessage(lines);
  if (boxed) return boxed;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let line = String(lines[index] || "").trim();
    if (!line) continue;
    // pwsh 错误框把原因写在竖线后面（`| 缺少区域前缀：…`）：先剥掉竖线再看内容。
    line = line.replace(/^\|\s*/, "").trim();
    if (!line) continue;
    if (/^~+$/.test(line)) continue;
    if (PS_ERROR_FRAME.some((pattern) => pattern.test(line))) continue;
    if (/^\d+ \|/.test(line)) continue;
    return line;
  }
  return "";
}

function createRunManager(deps) {
  const plugin = deps.plugin;
  // 子进程启动可注入：测试用假 child 驱动整条状态机，不必真的起 pwsh。
  const spawnChild = deps.spawn || spawn;
  /*
   * MasterGo token 每次现取（取值链只在 lib/mcp-token.js 一处）。
   * 插件脚本自己只认环境变量 MASTERGO_MCP_TOKEN（其余靠它的 config.toml 兜底），所以解析出来的
   * 这一份必须交给子进程 —— 只在「设置」里填过、没设环境变量的机器，否则第一步就报「缺少 MasterGo token」。
   */
  const tokenOf = getterOf(deps.token);

  const jobs = [];
  // 步骤契约按需读取：插件改了流程，下一次运行就用新的。
  let stepContract = [];

  function publicJob(job) {
    return {
      id: job.id,
      createdAt: job.createdAt,
      state: job.state,
      request: job.request,
      plan: job.plan.map((item) => item.label),
      runs: job.runs.map((run) => ({
        mode: run.mode,
        label: run.label,
        state: run.state,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        exitCode: run.exitCode,
        currentStep: run.currentStep,
        steps: run.steps,
        failure: run.failure,
        command: run.command
      })),
      log: { base: job.log.base, next: job.log.base + job.log.text.length },
      error: job.error
    };
  }

  function makeSteps() {
    const steps = {};
    for (const step of stepContract) {
      steps[step.Id] = { id: step.Id, name: step.Name, title: step.Title, state: "pending", seconds: null, note: "" };
    }
    return steps;
  }

  function consumeLine(run, line) {
    if (line.trim()) {
      run.tail.push(line);
      if (run.tail.length > MAX_TAIL_LINES) run.tail.shift();
    }

    // 失败行的摘要只有一行（例如「bundle 失败（exit=1）。日志: …」），真正的原因在它后面的几行里
    // （「目标文件已存在，未覆盖: …」「Layout.xml 已存在相同 Target」这类）。把尾巴也收下来，
    // 界面才判断得出该给人什么选择，不用去猜步骤名。
    if (run.failure && String(run.failure.detail || "").length < MAX_FAILURE_DETAIL) {
      run.failure.detail = String(run.failure.detail || "") + line + "\n";
    }

    const route = RE_ROUTE.exec(line);
    if (route && !run.routeFromOutput) run.routeFromOutput = route[1];

    const started = RE_STEP_START.exec(line);
    if (started) {
      const id = Number(started[1]);
      const entry = run.steps[id];
      if (entry) {
        entry.state = "running";
        entry.title = started[2].replace(/\s*…\s*$/, "").trim() || entry.title;
        run.currentStep = id;
      }
      return;
    }

    const done = RE_STEP_OK.exec(line);
    if (done && run.currentStep) {
      const entry = run.steps[run.currentStep];
      if (entry) {
        entry.state = "ok";
        entry.seconds = Number(done[1]);
        entry.note = done[2].trim();
      }
      return;
    }

    const failed = RE_STEP_FAIL.exec(line);
    if (failed) {
      const id = Number(failed[1]);
      const entry = run.steps[id];
      if (entry) entry.state = "failed";
      run.currentStep = id;
      run.failure = {
        stepId: id,
        stepName: failed[2],
        message: failed[3].trim(),
        resume: "",
        detail: line + "\n",
        contract: stepContract.find((step) => step.Id === id) ?? null
      };
      return;
    }

    const resume = RE_RESUME.exec(line);
    if (resume && run.failure) run.failure.resume = resume[1].trim();
  }

  // PowerShell 单引号字符串：内部的单引号翻倍。
  function psQuote(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
  }

  // 用 -Command 而不是 -File：需要在调用前把控制台输出编码固定成 UTF-8。
  // 本机控制台代码页是 GBK，直接读它的输出会把中文读成乱码。
  function buildArgs(request, mode) {
    const parts = ["&", psQuote(plugin.runAll), "-ProjectRoot", psQuote(request.projectRoot), "-Mode", psQuote(mode)];
    if (request.fileId) parts.push("-FileId", psQuote(request.fileId));
    if (request.layerId) parts.push("-LayerId", psQuote(request.layerId));
    if (request.target) parts.push("-Target", psQuote(request.target));
    if (request.ui) parts.push("-Ui", psQuote(request.ui));
    if (request.stopAfter) parts.push("-StopAfter", psQuote(request.stopAfter));
    if (request.progress) parts.push("-Progress", psQuote(request.progress));
    if (request.overwrite) parts.push("-Overwrite");
    // 本页确实没有图标槽位时，插件要求显式声明，而不是写一份空命名表。
    if (request.allowEmptyLedger) parts.push("-AllowEmptyLedger");
    const script =
      "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); " + parts.join(" ") + "; exit $LASTEXITCODE";
    return ["-NoProfile", "-Command", script];
  }

  function startRun(job, index) {
    return new Promise((resolve) => {
      const run = job.runs[index];
      const args = buildArgs(job.request, run.mode);
      /*
       * 跑插件用哪两份运行时：start() 解析好的那一份（同一份既校验、也真用），
       * 交给 childEnv 放进子进程 PATH —— 插件脚本里写的是 bare `node` / `pwsh`。
       */
      const { node, pwsh } = job.runtime;
      run.command = [pwsh].concat(args).join(" ");
      run.state = "running";
      run.startedAt = new Date().toISOString();
      job.log.append("\n===== 路线 " + run.label + "（" + run.mode + "）=====\n");
      job.log.append("$ " + run.command + "\n\n");

      // 插件脚本自己调 bare `node` / 读环境变量里的 token：两样都从这一处交给子进程。
      const child = spawnChild(pwsh, args, {
        windowsHide: true,
        env: childEnv(withToken(null, tokenOf()), undefined, { node, pwsh })
      });
      run.child = child;

      let pending = "";
      function feed(chunk) {
        // 日志按到达就落地（没换行的进度行也要看得见）；色码在这里剥一次，行解析用剥好的那份。
        const text = stripAnsi(chunk.toString("utf8"));
        job.log.append(text);
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) consumeLine(run, line);
      }

      child.stdout.on("data", feed);
      child.stderr.on("data", feed);
      child.on("error", (error) => {
        run.state = "failed";
        run.endedAt = new Date().toISOString();
        run.failure = run.failure ?? {
          stepId: 0,
          stepName: "",
          message: "调不起 pwsh：" + error.message,
          resume: "",
          detail: "",
          contract: null
        };
        resolve();
      });
      child.on("close", (code) => {
        // 末尾没换行的那一行：日志里已经有了（上面按到达追加），这里只补一次行解析。
        if (pending) consumeLine(run, pending);
        run.child = null;
        run.endedAt = new Date().toISOString();
        run.exitCode = code;
        if (run.state === "stopped") {
          resolve();
          return;
        }
        if (code === 0) {
          run.state = "done";
          for (const entry of Object.values(run.steps)) {
            if (entry.state === "running") entry.state = "ok";
            if (entry.state === "pending") entry.state = "skipped";
          }
        }
        else {
          run.state = "failed";
          for (const entry of Object.values(run.steps)) {
            if (entry.state === "running") entry.state = "failed";
          }
          // 在步骤循环之前就失败（输入校验、登记表解析等）不会有 "!! 步骤" 行，
          // 这时把最后一行非空输出当原因，别让界面只显示一个"失败"。
          if (!run.failure) {
            const reason = failureMessageFromTail(run.tail);
            run.failure = {
              stepId: 0,
              stepName: "",
              message: reason || "流水线在进入步骤之前退出（exit " + code + "）",
              resume: "",
              detail: run.tail.join("\n"),
              contract: null
            };
          }
        }
        resolve();
      });
    });
  }

  async function execute(job) {
    for (let index = 0; index < job.runs.length; index += 1) {
      if (job.state === "stopping") break;
      await startRun(job, index);
      if (job.runs[index].state !== "done") break;
    }
    if (job.state === "stopping") job.state = "stopped";
    else job.state = job.runs.every((run) => run.state === "done") ? "done" : "failed";
    job.endedAt = new Date().toISOString();
  }

  function start(request) {
    if (!plugin.runAllExists) {
      throw new UserError("NO_PIPELINE", "插件里找不到 run-all.ps1", "期望路径：" + plugin.runAll);
    }
    const projectRoot = String(request.projectRoot || "").trim();
    if (!projectRoot) {
      throw new UserError("NEED_PROJECT", "请先填工程目录", "流水线要把产物写进工程目录，必填。");
    }
    const busy = jobs.find((job) =>
      job.request.projectRoot === projectRoot && (job.state === "running" || job.state === "stopping"));
    if (busy) {
      throw new UserError("BUSY", "这个工程目录上已经有一次运行在跑", "等它跑完，或先停掉它（" + busy.id + "）。");
    }
    /*
     * 运行时在这里定下来（与「没填工程目录」同一类，开跑前的检查）：
     * 解析一次，随 job 传给 startRun —— 校验过的和子进程实际用的必须是同一份；
     * 也避免在 startRun 的 Promise 里抛（rejection 没人接，用户什么都看不到）。
     */
    const runtime = { node: plugin.node || requireNodeExe(), pwsh: plugin.pwsh || requirePwshExe() };

    const mode = normalizeMode(request.mode);
    const modes = mode === "AB" ? ROUTE_ORDER : [mode === "A" ? "mw-wpf" : "mtslg-iocontrol"];
    // 链接与显式字段二选一：链接走插件同一份解析实现，避免界面自己拆 URL。
    const fromLink = request.link ? parseLink(String(request.link)) : { fileId: "", layerId: "" };
    const fileId = String(request.fileId || fromLink.fileId || "").trim();
    const layerId = String(request.layerId || fromLink.layerId || "").trim();
    stepContract = readPipelineSteps(plugin.root, { pwsh: runtime.pwsh });
    const job = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      state: "running",
      request: {
        projectRoot: projectRoot,
        target: String(request.target || "").trim(),
        layerId: layerId,
        fileId: fileId,
        ui: String(request.ui || "").trim(),
        mode: mode,
        // 谁发起的这次运行。看板任务有自己的工作目录与进度，不能串到「流水线」页上去。
        origin: request.origin === "board" ? "board" : "pipeline",
        stopAfter: String(request.stopAfter || "").trim(),
        progress: String(request.progress || "").trim(),
        overwrite: Boolean(request.overwrite),
        allowEmptyLedger: Boolean(request.allowEmptyLedger)
      },
      plan: modes.map((item) => ({ mode: item, label: MODE_LABEL[item] ?? item })),
      runtime: runtime,
      runs: modes.map((item) => ({
        mode: item,
        label: MODE_LABEL[item] ?? item,
        state: "pending",
        startedAt: "",
        endedAt: "",
        exitCode: null,
        currentStep: 0,
        steps: makeSteps(),
        failure: null,
        tail: [],
        command: "",
        child: null
      })),
      log: new LogBuffer(MAX_LOG_CHARS),
      error: ""
    };

    jobs.push(job);
    if (jobs.length > MAX_JOBS) jobs.splice(0, jobs.length - MAX_JOBS);
    void execute(job);
    return publicJob(job);
  }

  // 当前 job：只认「流水线」页发起的运行 —— 优先给正在跑的那一个（后启动的优先），
  // 都跑完了就给最后一个。看板任务的进度在它自己那一行上，不走这里。
  function current() {
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      if (jobs[index].request.origin === "board") continue;
      if (jobs[index].state === "running" || jobs[index].state === "stopping") return jobs[index];
    }
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      if (jobs[index].request.origin !== "board") return jobs[index];
    }
    return null;
  }

  // 某个工程目录上最近的一次运行。看板用它跟任务状态对表（含从别处发起的续跑）。
  function latestFor(projectRoot) {
    const wanted = String(projectRoot || "").trim();
    if (!wanted) return null;
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      if (jobs[index].request.projectRoot === wanted) return publicJob(jobs[index]);
    }
    return null;
  }

  // 已知运行的轻量列表：按「工程目录 + Target」去重，保留最近一次。
  // 待确认队列靠它列出「哪些页面可能还缺输入」，不关心日志与步骤细节。
  function list() {
    const seen = new Set();
    const out = [];
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      const job = jobs[index];
      const key = job.request.projectRoot + "\u0000" + job.request.target;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: job.id,
        projectRoot: job.request.projectRoot,
        target: job.request.target,
        mode: job.request.mode,
        ui: job.request.ui,
        state: job.state,
        createdAt: job.createdAt,
        endedAt: job.endedAt || ""
      });
    }
    return out;
  }

  // 步骤契约：进程里缓存一份，第一次要（start 或看板算进度）时读。
  // 看板用它判断哪些步骤吃人/AI 写的输入、进度分母是多少，免得每次轮询都起一个 pwsh。
  function contract() {
    if (stepContract.length === 0) {
      try {
        // 与 start() 同一份运行时：插件快照里解析好的那份（空串时 readPipelineSteps 自己再说缺）。
        stepContract = readPipelineSteps(plugin.root, { pwsh: plugin.pwsh });
      }
      catch {
        /* 读不出来就先空着：契约是插件的，缺它只影响界面上的标题与分母 */
      }
    }
    return stepContract;
  }

  function get(id) {
    return jobs.find((job) => job.id === id) ?? null;
  }

  function status(id) {
    const job = id ? get(id) : current();
    if (!job) return null;
    return publicJob(job);
  }

  function log(id, from) {
    const job = id ? get(id) : current();
    if (!job) throw new UserError("NO_JOB", "没有这次运行", "");
    return job.log.since(from);
  }

  function stop(id) {
    const job = id ? get(id) : current();
    if (!job) throw new UserError("NO_JOB", "没有正在跑的运行", "");
    if (job.state !== "running") return publicJob(job);
    job.state = "stopping";
    for (const run of job.runs) {
      if (run.child) {
        run.state = "stopped";
        try {
          run.child.kill("SIGTERM");
        }
        catch {
          /* 已经退出 */
        }
      }
    }
    return publicJob(job);
  }

  return {
    start,
    status,
    log,
    stop,
    current: current,
    latestFor: latestFor,
    list: list,
    contract: contract
  };
}

module.exports = { createRunManager, normalizeMode, failureMessageFromTail };
