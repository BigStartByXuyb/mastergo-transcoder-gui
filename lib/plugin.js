"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { UserError } = require("./errors.js");
const { missingPluginFiles } = require("./node-controls.js");
const { resolvePwshExe, childEnv } = require("./runtime.js");
const { resolvePluginRoot, pluginSources, pluginVersionOf } = require("./plugin-root.js");

const SKILL_REL = path.join("skills", "mastergo-to-wpf");
// 控件查询的编排在客户端这边（插件不再分发查 ID 工具链），口径仍然全部取插件的实现。
const ENGINE_REL = path.join("lib", "node-controls.js");
const RUN_ALL_REL = path.join(SKILL_REL, "scripts", "entry", "run-all.ps1");

// 步骤契约的字段，与插件 scripts/lib/pipeline-steps.js 保持一致：
// 七个字段都要在，其中四个必须是非空字符串数组。
const CONTRACT_FIELDS = ["Id", "Name", "Title", "Inputs", "Outputs", "Failures", "Recovery"];
const NON_EMPTY_ARRAY_FIELDS = ["Inputs", "Outputs", "Failures", "Recovery"];

function readPluginInfo(pluginRoot) {
  const engine = path.resolve(__dirname, "..", ENGINE_REL);
  const runAll = path.join(pluginRoot, RUN_ALL_REL);
  return {
    root: pluginRoot,
    version: pluginVersionOf(pluginRoot),
    engine: engine,
    engineExists: fs.existsSync(engine),
    queryMissing: missingPluginFiles(pluginRoot),
    runAll: runAll,
    runAllExists: fs.existsSync(runAll),
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
    return pluginSources({
      explicitDir: explicitDir,
      chosenRoot: chosenRoot(),
      installRoot: installRoot,
      env: env,
      home: home
    }).map(function (item) {
      return Object.assign({}, item, { active: Boolean(item.pluginRoot) && item.pluginRoot === info.root });
    });
  }

  load();

  return {
    current: function () { return info; },
    /* 找不到插件时这里的原话：逐条列出已查找的路径和各自有没有。 */
    failure: function () { return failure; },
    /* 装配时给的那一份环境变量 MASTERGO_PLUGIN_ROOT（没给就是空串）：界面显示与实际判据共用它。 */
    environment: function () { return String(env.MASTERGO_PLUGIN_ROOT || ""); },
    sources: sources,
    reload: load,
    /* 换一份：先记进设置再重新定位；空串＝回到「按顺序自动」。 */
    choose: function (dir) {
      if (settings) settings.write({ pluginRoot: String(dir || "").trim() });
      return load();
    }
  };
}

// 读插件的步骤契约。
// 必须走 -OutFile：pwsh 的 stdout 过控制台代码页（本机 GBK），中文会被替换成 U+FFFD，
// 文件是确定编码。出现替换字符一律当作读取失败，不把坏内容往下传。
function readPipelineSteps(pluginRoot, options) {
  const settings = options || {};
  const timeoutMs = settings.timeoutMs || 60000;
  const info = readPluginInfo(pluginRoot);
  if (!info.runAllExists) {
    throw new UserError(
      "NO_PIPELINE",
      "插件里找不到 run-all.ps1",
      "期望路径：" + info.runAll + "；确认插件版本包含流水线入口。"
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtslg-steps-"));
  const outFile = path.join(tmpDir, "steps.json");
  try {
    const result = spawnSync(info.pwsh, ["-NoProfile", "-File", info.runAll, "-List", "-Format", "json", "-OutFile", outFile], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: childEnv()
    });
    if (result.error) {
      throw new UserError("NO_PWSH", "调不起 pwsh：" + result.error.message, "需要 PowerShell 7（pwsh），5.1 会因编码问题出错。");
    }
    if (!fs.existsSync(outFile)) {
      const detail = String(result.stderr || result.stdout || "").trim().slice(0, 800);
      // 把退出码一起报出来：偶发失败时能一眼看出是 pwsh 自己挂了还是脚本没写文件。
      throw new UserError(
        "NO_STEPS",
        "流水线没有产出步骤契约（pwsh 退出码 " + String(result.status) + "）",
        detail || "run-all.ps1 -List 未写出文件。"
      );
    }
    const raw = fs.readFileSync(outFile, "utf8").replace(/^\uFEFF/, "");
    if (raw.includes("\uFFFD")) {
      throw new UserError("STEPS_ENCODING", "步骤契约出现替换字符（编码损坏）", "说明没有走 -OutFile 文件通道。");
    }
    let steps;
    try {
      steps = JSON.parse(raw);
    }
    catch (error) {
      throw new UserError("STEPS_JSON", "步骤契约不是合法 JSON", error.message);
    }
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
  finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { readPluginInfo, readPipelineSteps, createPluginRuntime, resolvePwsh: resolvePwshExe };
