#!/usr/bin/env node
"use strict";

// 失败分支与边界：插件定位、步骤契约读取、查询引擎的入参校验。
// 正常路径在别的套件里；这里只打「出错时是不是 fail-closed，且给出的理由能不能照着修」。
// 跑法：node tests/edges.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { readPipelineSteps, resolvePwsh } = require("../lib/plugin.js");
// 这些用例要跑桩脚本（读步骤契约），需要一份 pwsh：测试机上那份显式允许使用 ——
// 就是产品里运行环境页那一行选的「用系统上那一份」，不是隐式回落。
require("../lib/runtime-policy.js").setSource(function () { return { node: true, pwsh: true }; });
const { resolvePluginRoot, pluginHomes } = require("../lib/plugin-root.js");

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

// 造一个只有 run-all.ps1 的插件根；body 决定它写出什么。
function makePlugin(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-edges-plugin-"));
  const runAll = path.join(root, "skills", "mastergo-to-wpf", "scripts", "entry", "run-all.ps1");
  fs.mkdirSync(path.dirname(runAll), { recursive: true });
  if (body !== null) fs.writeFileSync(runAll, body, "utf8");
  return { root, runAll };
}

function casePluginRootErrors() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gui-edges-home-"));
  // 插件地盘只有一处（纯计算）：客户端自带那一份所在的目录。写盘拦截与插件定位共用这一份判据。
  const installRoot = path.join(tmp, "app");
  assert.deepStrictEqual(
    pluginHomes({ installRoot: installRoot }),
    [path.join(installRoot, "plugins")],
    "安装根下的 plugins/ 就是插件地盘"
  );
  assert.deepStrictEqual(pluginHomes({}), [], "还没定安装根时给空清单（还没承认过任何插件地盘）");

  assert.throws(
    () => resolvePluginRoot({ installRoot: installRoot }),
    (error) => /找不到 mastergo-wpf-transcoder 插件/.test(error.message) && /已查找/.test(error.message),
    "一处都没有时要说清查过哪儿"
  );

  // 版本目录按数字段比：1.0.10 必须赢过 1.0.9
  const marker = path.join("skills", "mastergo-to-wpf", "SKILL.md");
  const plugins = path.join(installRoot, "plugins", "mastergo-wpf-transcoder");
  write(path.join(plugins, "1.0.9", marker), "# 老版本\n");
  write(path.join(plugins, "1.0.10", marker), "# 新版本\n");
  assert.match(resolvePluginRoot({ installRoot: installRoot }), /1\.0\.10$/, "按数字段比较，取最高版本");

  // 插件根直接摆在 plugins/<插件名>/（没分版本目录）也是插件根。
  const flatRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gui-edges-flat-"));
  const flatInstall = path.join(flatRoot, "app");
  write(path.join(flatInstall, "plugins", "mastergo-wpf-transcoder", marker), "# 就一份\n");
  assert.match(resolvePluginRoot({ installRoot: flatInstall }), /mastergo-wpf-transcoder$/, "没分版本目录时那一层就是插件根");

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(flatRoot, { recursive: true, force: true });
}

function caseStepContractFailures() {
  const missing = makePlugin(null);
  assert.throws(() => readPipelineSteps(missing.root), (error) => error.code === "NO_PIPELINE");
  /*
   * 跑插件用哪一份 pwsh 由 lib/runtime.js 定：要么是自带那份的绝对路径，要么是明说「没有」。
   * 这里钉的是「不会悄悄用 powershell 5.1」（5.1 的 GBK 会坏编码），不是某种具体写法。
   */
  const pwsh = resolvePwsh();
  assert.ok(pwsh === "" || /pwsh/i.test(pwsh), "要么给自带那份，要么明说没有：不回落 5.1");

  const broke = makePlugin("param([switch]$List)\nexit 3\n");
  assert.throws(() => readPipelineSteps(broke.root), (error) => error.code === "NO_STEPS", "脚本没写出手续文件要报 NO_STEPS");

  const badJson = makePlugin([
    "param([switch]$List, [string]$OutFile)",
    "Set-Content -LiteralPath $OutFile -Encoding UTF8 -Value 'not-json'",
    ""
  ].join("\n"));
  // 桩脚本写出的内容不合法：无论卡在「没有产出文件」还是「不是合法 JSON」，都必须 fail-closed。
  assert.throws(
    () => readPipelineSteps(badJson.root),
    (error) => ["STEPS_JSON", "NO_STEPS"].includes(error.code)
  );

  const empty = makePlugin([
    "param([switch]$List, [string]$OutFile)",
    "Set-Content -LiteralPath $OutFile -Encoding UTF8 -Value '[]'",
    ""
  ].join("\n"));
  assert.throws(() => readPipelineSteps(empty.root), (error) => ["STEPS_EMPTY", "NO_STEPS"].includes(error.code));

  const missingField = makePlugin([
    "param([switch]$List, [string]$OutFile)",
    "Set-Content -LiteralPath $OutFile -Encoding UTF8 -Value '[{\"Id\":1,\"Name\":\"fetch\",\"Title\":\"取数\",\"Inputs\":[\"x\"],\"Outputs\":[\"y\"],\"Failures\":[\"f\"]}]'",
    ""
  ].join("\n"));
  assert.throws(
    () => readPipelineSteps(missingField.root),
    (error) => ["STEPS_FIELD", "NO_STEPS"].includes(error.code),
    "缺 Recovery 字段要被拦下"
  );

  const emptyArrayField = makePlugin([
    "param([switch]$List, [string]$OutFile)",
    "Set-Content -LiteralPath $OutFile -Encoding UTF8 -Value '[{\"Id\":1,\"Name\":\"fetch\",\"Title\":\"取数\",\"Inputs\":[],\"Outputs\":[\"y\"],\"Failures\":[\"f\"],\"Recovery\":[\"r\"]}]'",
    ""
  ].join("\n"));
  assert.throws(
    () => readPipelineSteps(emptyArrayField.root),
    (error) => ["STEPS_FIELD", "NO_STEPS"].includes(error.code),
    "契约里的四个数组不能是空的"
  );

  // 编码坏了（U+FFFD）也要报出来，而不是把坏内容往下传。
  // 必须真写出替换字符的字节（EF BF BD）：写成普通字符串的话，这条用例根本没打到编码分支。
  const badEncoding = makePlugin([
    "param([switch]$List, [string]$OutFile)",
    "[System.IO.File]::WriteAllBytes($OutFile, [byte[]](0x5B, 0xEF, 0xBF, 0xBD, 0x5D))",
    ""
  ].join("\n"));
  assert.throws(
    () => readPipelineSteps(badEncoding.root),
    (error) => error.code === "STEPS_ENCODING",
    "UTF-8 替换字符必须被当成编码损坏拦下"
  );
}

function caseNodeControlsCli() {
  const cli = path.join(__dirname, "..", "lib", "node-controls.js");
  const run = (args) => spawnSync(process.execPath, [cli].concat(args), { encoding: "utf8" });

  const unknown = run(["--bogus", "x"]);
  assert.strictEqual(unknown.status, 2);
  assert.match(unknown.stderr, /无法识别的参数/);

  const missingValue = run(["--out"]);
  assert.strictEqual(missingValue.status, 2);
  assert.match(missingValue.stderr, /缺少取值/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gui-edges-controls-"));
  const emptyPlugin = path.join(tmp, "plugin");
  fs.mkdirSync(emptyPlugin, { recursive: true });
  const noFiles = run(["--plugin", emptyPlugin, "--out", path.join(tmp, "out.json"), "--work-dir", path.join(tmp, "work"), "--file-id", "1", "--layer-id", "1:1"]);
  assert.strictEqual(noFiles.status, 2);
  assert.match(noFiles.stderr, /插件里缺少查询所需文件/);

  /*
   * 快照不是 JSON：要报「不是合法 JSON」，而不是抛栈。
   * 这里必须给一个**完整**的桩插件——只造空目录的话，程序会先停在「插件缺件」，
   * 根本走不到 JSON 校验，断言看着通过其实没打到目标分支。
   */
  const fullPlugin = path.join(tmp, "full-plugin");
  const skill = path.join(fullPlugin, "skills", "mastergo-to-wpf");
  for (const rel of [
    "scripts/core/call-mastergo-mcp.js",
    "scripts/core/mastergo-dsl-pipeline.ps1",
    "scripts/core/resolve-mastergo-visibility.js",
    "scripts/adapters/mtslg-iocontrol/gen-mtslg-mapping-from-dsl.js",
    "scripts/adapters/mtslg-iocontrol/gen-iocontrol-xml.js",
    "references/adapters/mtslg-iocontrol/mtslg-iocontrol-map.json"
  ]) {
    write(path.join(skill, rel), "stub\n");
  }
  write(path.join(skill, "scripts", "lib", "page-node-id.js"), [
    "\"use strict\";",
    "exports.pageKeyOf = (snapshot) => String(snapshot.dsl.nodes[0].id);",
    "exports.derivePageNodeId = (pageKey, ref) => \"MX_\" + ref;",
    ""
  ].join("\n"));

  const badSnapshot = path.join(tmp, "snapshot.json");
  fs.writeFileSync(badSnapshot, "not json", "utf8");
  const bad = run(["--plugin", fullPlugin, "--out", path.join(tmp, "out.json"), "--work-dir", path.join(tmp, "work"), "--snapshot", badSnapshot]);
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /不是合法 JSON/, "坏快照要报 JSON 解析失败，而不是别的错");

  // 插件根不完整时，先报「缺哪些文件」（早于「用法」检查：缺件是更根本的失败）
  const usage = run(["--plugin", emptyPlugin, "--out", path.join(tmp, "out.json"), "--work-dir", path.join(tmp, "work")]);
  assert.strictEqual(usage.status, 2);
  assert.match(usage.stderr, /插件里缺少查询所需文件/);
  fs.rmSync(tmp, { recursive: true, force: true });
}

function main() {
  const cases = [
    ["插件定位的失败路径与版本比较", casePluginRootErrors],
    ["步骤契约读取的失败路径", caseStepContractFailures],
    ["查询引擎的命令行校验", caseNodeControlsCli]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("edges.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
