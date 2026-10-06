"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { UserError } = require("./errors.js");
const { missingPluginFiles } = require("./node-controls.js");
const { resolveNodeExe, resolvePwshExe, childEnv } = require("./runtime.js");
const { resolvePluginRoot, activePluginSource, pluginVersionOf } = require("./plugin-root.js");
const { runPwshJson } = require("./pwsh.js");

const SKILL_REL = path.join("skills", "mastergo-to-wpf");
// 控件查询的编排在客户端这边（插件不再分发查 ID 工具链），口径仍然全部取插件的实现。
const ENGINE_REL = path.join("lib", "node-controls.js");
const RUN_ALL_REL = path.join(SKILL_REL, "scripts", "entry", "run-all.ps1");

// 步骤契约的字段，与插件 scripts/lib/pipeline-steps.js 保持一致：
// 七个字段都要在，其中四个必须是非空字符串数组。
const CONTRACT_FIELDS = ["Id", "Name", "Title", "Inputs", "Outputs", "Failures", "Recovery"];
const NON_EMPTY_ARRAY_FIELDS = ["Inputs", "Outputs", "Failures", "Recovery"];

/* 流水线入口在哪：路径拼法与存在性只有这一处（插件信息与读步骤契约都从这里取）。 */
function runAllEntry(pluginRoot) {
  const runAll = path.join(pluginRoot, RUN_ALL_REL);
  return { path: runAll, exists: fs.existsSync(runAll) };
}

function readPluginInfo(pluginRoot) {
  const engine = path.resolve(__dirname, "..", ENGINE_REL);
  const entry = runAllEntry(pluginRoot);
  return {
    root: pluginRoot,
    version: pluginVersionOf(pluginRoot),
    engine: engine,
    engineExists: fs.existsSync(engine),
    queryMissing: missingPluginFiles(pluginRoot),
    runAll: entry.path,
    runAllExists: entry.exists,
    node: resolveNodeExe(),
    pwsh: resolvePwshExe()
  };
}

/*
 * 插件来源运行时：找哪一份、现在用的是哪一份、换一份之后立刻生效。
 *
 * 客户端不自带引擎，插件可能落在 Codex / Claude Code 的缓存里，也可能在用户自己的目录。
 * 「都查过哪些路径」与「此刻生效的是哪一份」只有这一处：界面列出的是它，跑流水线的也是它。
 * info 是同一个对象被原地更新 —— runs / pending / mapping / routes 拿的都是它，改选后不用重建。
 */
function createPluginRuntime(options) {
  const opts = options || {};
  const explicitDir = opts.explicitDir || "";
  const installRoot = opts.installRoot || "";
  const settings = opts.settings || null;
  // 查哪些地方、各条判据用哪一份环境：装配时给一次，四处判断都跟着它走。
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();

  const info = readPluginInfo("");
  let failure = "";

  // 设置里选的那一份；空串＝按顺序自动。
  function chosenRoot() {
    if (!settings) return "";
    try {
      return String(settings.read().pluginRoot || "");
    }
    catch {
      return "";
    }
  }

  function load() {
    try {
      Object.assign(info, readPluginInfo(resolvePluginRoot(explicitDir, {
        chosenRoot: chosenRoot(),
        installRoot: installRoot,
        env: env,
        home: home
      })));
      failure = "";
    }
    catch (error) {
      // 一处都没有时客户端照常起来：界面上要把「查过哪些路径」摆出来，人才知道去哪儿装。
      Object.assign(info, readPluginInfo(""));
      failure = String(error && error.message ? error.message : error);
    }
    return info;
  }

  function sources() {
    /*
     * 标「正在用」用的是定位那一条判据（activePluginSource），不在这里另推一遍顺序。
     * 两条来源可能指到同一个插件根（例如设置里选的正好就是 Codex 缓存那一处），
     * 那种时候也只标在真正被取用的那一条上，界面上不会并排两个。
     */
    const scope = activePluginSource({
      explicitDir: explicitDir,
      chosenRoot: chosenRoot(),
      installRoot: installRoot,
      env: env,
      home: home
    });
    return scope.list.map(function (item) {
      return Object.assign({}, item, { active: Boolean(scope.active && item.id === scope.active.id) });
    });
  }

  load();

  return {
    current: function () { return info; },
    /* 找不到插件时这里的原话：逐条列出已查找的路径和各自有没有。 */
    failure: function () { return failure; },
    /* 设置里选的那一份（空串＝按顺序自动）：写盘防线要拦它，读的就该是这里这一份。 */
    chosen: chosenRoot,
    sources: sources,
    reload: load,
    /* 换一份：先记进设置再重新定位；空串＝回到「按顺序自动」。 */
    choose: function (dir) {
      if (settings) settings.write({ pluginRoot: String(dir || "").trim() });
      return load();
    }
  };
}

// 读插件的步骤契约。跑 pwsh 与读结果的那套口径在 lib/pwsh.js（同一份也给环境变量那页用），
// 这里只把它的失败分档翻成步骤契约自己的错误码。
function readPipelineSteps(pluginRoot, options) {
  const settings = options || {};
  const timeoutMs = settings.timeoutMs || 60000;
  /*
   * 这里只要两样：入口在哪、在不在。整份插件信息（含运行时解析）不在这条路上取 ——
   * 调用方已经定好 pwsh 时再解析一遍等于白算一次，还会留下第二个「运行时从哪来」的入口。
   */
  const entry = runAllEntry(pluginRoot);
  if (!entry.exists) {
    throw new UserError(
      "NO_PIPELINE",
      "插件里找不到 run-all.ps1",
      "期望路径：" + entry.path + "；确认插件版本包含流水线入口。"
    );
  }

  const got = runPwshJson({
    label: "流水线",
    args: ["-File", entry.path, "-List", "-Format", "json"],
    /*
     * 调用方已经定好运行时（跑流水线那条路会在 start() 里解析一次）就用它 ——
     * 校验过的与真跑的是同一份；没人给就现解析（插件页单独读步骤契约时是这样）。
     */
    pwsh: settings.pwsh || resolvePwshExe(),
    timeoutMs: timeoutMs,
    tmpPrefix: "mtslg-steps-",
    env: childEnv()
  });
  if (got.reason === "spawn") {
    throw new UserError("NO_PWSH", got.failure, "需要 PowerShell 7（pwsh），5.1 会因编码问题出错。");
  }
  if (got.reason === "missing") {
    // 把退出码一起报出来：偶发失败时能一眼看出是 pwsh 自己挂了还是脚本没写文件。
    throw new UserError("NO_STEPS", got.failure, "run-all.ps1 -List 未写出文件。");
  }
  if (got.reason === "encoding") {
    throw new UserError("STEPS_ENCODING", got.failure, "说明没有走 -OutFile 文件通道。");
  }
  if (got.reason === "json") {
    throw new UserError("STEPS_JSON", "步骤契约不是合法 JSON", got.failure);
  }
  const steps = got.value;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new UserError("STEPS_EMPTY", "步骤契约是空的", "");
  }
  for (const step of steps) {
    for (const field of CONTRACT_FIELDS) {
      if (step[field] === undefined || step[field] === null) {
        throw new UserError("STEPS_FIELD", "步骤 " + (step.Name || step.Id) + " 缺少契约字段 " + field, "");
      }
    }
    for (const field of NON_EMPTY_ARRAY_FIELDS) {
      if (!Array.isArray(step[field]) || step[field].length === 0) {
        throw new UserError("STEPS_FIELD", "步骤 " + step.Name + " 的 " + field + " 必须是非空数组", "");
      }
    }
  }
  return steps;
}

module.exports = { readPluginInfo, readPipelineSteps, createPluginRuntime, resolvePwsh: resolvePwshExe };
