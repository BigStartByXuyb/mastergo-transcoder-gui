#!/usr/bin/env node
"use strict";

// 从链接取设计页名：走插件取数脚本读 dsl.nodes[0].name；失败路径 fail-closed。
// 跑法：node tests/design-page-name.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { resolveDesignPageName } = require("../lib/design-page-name.js");

function pluginWith(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-name-plugin-"));
  if (body !== null) {
    const tool = path.join(root, "skills", "mastergo-to-wpf", "scripts", "core", "call-mastergo-mcp.js");
    fs.mkdirSync(path.dirname(tool), { recursive: true });
    fs.writeFileSync(tool, body, "utf8");
  }
  return root;
}

const stub = [
  "\"use strict\";",
  "const fs = require(\"fs\");",
  "const args = process.argv.slice(2);",
  "const at = (key) => args[args.indexOf(key) + 1];",
  "if (at(\"--tool\") !== \"getDsl\") process.exit(3);",
  "fs.writeFileSync(at(\"--out\"), JSON.stringify({ dsl: { nodes: [{ id: \"124:077162\", name: \"停止调整\", type: \"FRAME\" }] } }));",
  ""
].join("\n");

function caseSuccess() {
  const root = pluginWith(stub);
  const info = resolveDesignPageName({ pluginRoot: root, fileId: "181586559903927", layerId: "124:077162", token: "mg_test" });
  assert.strictEqual(info.pageName, "停止调整", "设计页名原样取回（中文）");
  assert.strictEqual(info.rootId, "124:077162");
  fs.rmSync(root, { recursive: true, force: true });
}

function caseFailures() {
  const missing = pluginWith(null);
  assert.throws(() => resolveDesignPageName({ pluginRoot: missing, fileId: "1", layerId: "1:1", token: "mg_test" }), /找不到取数脚本/);
  assert.throws(() => resolveDesignPageName({ pluginRoot: missing, fileId: "", layerId: "1:1", token: "mg_test" }), /缺 file=/);
  assert.throws(() => resolveDesignPageName({ pluginRoot: "", fileId: "1", layerId: "1:1" }), /还没有定位到插件目录/);
  // 缺 token 给可照做的提示（与控件查询同一口径），而不是丢给子进程拼一句含糊的退出码
  assert.throws(
    () => resolveDesignPageName({ pluginRoot: missing, fileId: "1", layerId: "1:1", token: "" }),
    (error) => error.code === "NEED_TOKEN" && /config\.toml/.test(error.hint)
  );

  const empty = pluginWith([
    "\"use strict\";",
    "const fs = require(\"fs\");",
    "const args = process.argv.slice(2);",
    "const at = (key) => args[args.indexOf(key) + 1];",
    "fs.writeFileSync(at(\"--out\"), JSON.stringify({ dsl: { nodes: [] } }));",
    ""
  ].join("\n"));
  assert.throws(() => resolveDesignPageName({ pluginRoot: empty, fileId: "1", layerId: "1:1", token: "mg_test" }), /没有 dsl\.nodes/);

  const boom = pluginWith("process.exit(9)\n");
  assert.throws(() => resolveDesignPageName({ pluginRoot: boom, fileId: "1", layerId: "1:1", token: "mg_test" }), /exit 9/);

  fs.rmSync(missing, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
  fs.rmSync(boom, { recursive: true, force: true });
}

function main() {
  const cases = [
    ["取回设计页名（中文原样）", caseSuccess],
    ["失败路径 fail-closed", caseFailures]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("design-page-name.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
