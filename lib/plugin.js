"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { UserError } = require("./errors.js");

const SKILL_REL = path.join("skills", "mastergo-to-wpf");
const ENGINE_REL = path.join(SKILL_REL, "scripts", "resolve-node-control.js");
const RUN_ALL_REL = path.join(SKILL_REL, "scripts", "entry", "run-all.ps1");

// 步骤契约的字段，与插件 scripts/lib/pipeline-steps.js 保持一致：
// 七个字段都要在，其中四个必须是非空字符串数组。
const CONTRACT_FIELDS = ["Id", "Name", "Title", "Inputs", "Outputs", "Failures", "Recovery"];
const NON_EMPTY_ARRAY_FIELDS = ["Inputs", "Outputs", "Failures", "Recovery"];

function resolvePwsh() {
  if (process.env.MASTERGO_PWSH) return process.env.MASTERGO_PWSH;
  const bundled = path.resolve(__dirname, "..", "runtime", "pwsh", "pwsh.exe");
  return fs.existsSync(bundled) ? bundled : "pwsh";
}

function readPluginVersion(pluginRoot) {
  for (const id of [".claude-plugin", ".codex-plugin"]) {
    const file = path.join(pluginRoot, id, "plugin.json");
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && parsed.version) return String(parsed.version);
    }
    catch {
      // 没有这个清单就试下一个
    }
  }
  return "";
}

function readPluginInfo(pluginRoot) {
  const engine = path.join(pluginRoot, ENGINE_REL);
  const runAll = path.join(pluginRoot, RUN_ALL_REL);
  return {
    root: pluginRoot,
    version: readPluginVersion(pluginRoot),
    engine: engine,
    engineExists: fs.existsSync(engine),
    runAll: runAll,
    runAllExists: fs.existsSync(runAll),
    pwsh: resolvePwsh()
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
      maxBuffer: 32 * 1024 * 1024
    });
    if (result.error) {
      throw new UserError("NO_PWSH", "调不起 pwsh：" + result.error.message, "需要 PowerShell 7（pwsh），5.1 会因编码问题出错。");
    }
    if (!fs.existsSync(outFile)) {
      const detail = String(result.stderr || result.stdout || "").trim().slice(0, 800);
      throw new UserError("NO_STEPS", "流水线没有产出步骤契约", detail || "run-all.ps1 -List 未写出手续文件。");
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

module.exports = { readPluginInfo, readPipelineSteps, resolvePwsh, ENGINE_REL, RUN_ALL_REL };
