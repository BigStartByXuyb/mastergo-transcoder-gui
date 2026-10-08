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
const { resolvePluginRoot, pluginHomes, PLUGIN_ENV_NAME } = require("../lib/plugin-root.js");

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
  // 插件地盘就这几处（纯计算）：写盘拦截与插件定位共用同一份判据。
  assert.deepStrictEqual(
    pluginHomes({ env: { CODEX_HOME: path.join(tmp, "codex") }, home: path.join(tmp, "home") }),
    [path.join(tmp, "codex", "plugins"), path.join(tmp, "home", ".claude", "plugins")]
  );
  assert.deepStrictEqual(
    pluginHomes({ env: { [PLUGIN_ENV_NAME]: path.join(tmp, "root") }, home: path.join(tmp, "home") }),
    [
      path.resolve(path.join(tmp, "root")),
      path.join(tmp, "home", ".codex", "plugins"),
      path.join(tmp, "home", ".claude", "plugins")
    ],
    "显式指定的那份排最前，没给 CODEX_HOME 就退回 ~/.codex"
  );
  // 自定插件根也要算「插件的地盘」：写盘防线读的是同一份，缺了它插件本体能被当成工程目录。
  assert.deepStrictEqual(
    pluginHomes({
      env: {},
      home: path.join(tmp, "home"),
      explicitDir: path.join(tmp, "arg")
    }),
    [
      path.resolve(path.join(tmp, "arg")),
      path.join(tmp, "home", ".codex", "plugins"),
      path.join(tmp, "home", ".claude", "plugins")
    ],
    "--plugin 指的那份也进保护清单"
  );
  assert.strictEqual(
    pluginHomes({
      env: { [PLUGIN_ENV_NAME]: path.join(tmp, "picked") },
      home: path.join(tmp, "home"),
      explicitDir: path.join(tmp, "picked")
    }).length,
    3,
    "两处指到同一个目录时只留一条"
  );

  assert.throws(
    () => resolvePluginRoot(tmp),
    /不是 mastergo-wpf-transcoder 插件根/,
    "--plugin 指到别的目录要直接说清楚，而不是回退到别处"
  );
  assert.throws(
    () => resolvePluginRoot({ installRoot: tmp }),
    /第一个参数是插件目录/,
    "把选项对象当第一个参数传要在这里说清楚，不落到 path.resolve 的底层 TypeError"
  );

  const previous = { codex: process.env.CODEX_HOME, root: process.env[PLUGIN_ENV_NAME], home: process.env.HOME, profile: process.env.USERPROFILE };
  try {
    process.env.CODEX_HOME = path.join(tmp, "codex");
    delete process.env[PLUGIN_ENV_NAME];
    process.env.HOME = path.join(tmp, "home");
    process.env.USERPROFILE = path.join(tmp, "home");
    assert.throws(
      () => resolvePluginRoot(),
      (error) => /找不到 mastergo-wpf-transcoder 插件/.test(error.message) && /已查找/.test(error.message),
      "一处都没有时要列出已查找的路径"
    );

    // 版本目录按数字段比：1.0.10 必须赢过 1.0.9
    const marker = path.join("skills", "mastergo-to-wpf", "SKILL.md");
    write(path.join(process.env.CODEX_HOME, "plugins", "cache", "bigstart-plugins", "mastergo-wpf-transcoder", "1.0.9", marker), "# 老版本\n");
    write(path.join(process.env.CODEX_HOME, "plugins", "cache", "bigstart-plugins", "mastergo-wpf-transcoder", "1.0.10", marker), "# 新版本\n");
    assert.match(resolvePluginRoot(), /1\.0\.10$/, "按数字段比较，取最高版本");

    // 环境变量指向已存在的插件根时优先于安装目录
    assert.match(resolvePluginRoot(path.join(process.env.CODEX_HOME, "plugins", "cache", "bigstart-plugins", "mastergo-wpf-transcoder", "1.0.9")), /1\.0\.9$/);
    process.env[PLUGIN_ENV_NAME] = path.join(process.env.CODEX_HOME, "plugins", "cache", "bigstart-plugins", "mastergo-wpf-transcoder", "1.0.9");
    assert.match(resolvePluginRoot(), /1\.0\.9$/, "环境变量指定目录优先（本机显式指定）");
  }
  finally {
    if (previous.codex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous.codex;
    if (previous.root === undefined) delete process.env[PLUGIN_ENV_NAME]; else process.env[PLUGIN_ENV_NAME] = previous.root;
    if (previous.home === undefined) delete process.env.HOME; else process.env.HOME = previous.home;
    if (previous.profile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previous.profile;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
