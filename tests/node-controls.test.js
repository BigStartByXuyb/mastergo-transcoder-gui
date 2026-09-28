#!/usr/bin/env node
"use strict";

// 控件查询引擎的机械验证：造一个假插件根，走一遍编排。
// 覆盖：ID 取自插件公式、命中映射的节点才有控件代码、坐标沿父链累加、缺插件文件时报出缺哪一个。
// 跑法：node tests/node-controls.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { runNodeControls, missingPluginFiles } = require("../lib/node-controls.js");
const { extractXmlChunk } = require("../lib/xml-chunk.js");

const ROOT = "11:87707";
const CHILD = ROOT + "/11:69209";
const GRANDCHILD = CHILD + "/11:69210";

// 假插件的 ID 公式：只验证"客户端确实用了插件的实现"，不复制真公式。
const PAGE_NODE_ID = [
  "\"use strict\";",
  "exports.pageKeyOf = (snapshot) => String(snapshot.dsl.nodes[0].id);",
  "exports.derivePageNodeId = (pageKey, ref) => \"MX_STUB_\" + pageKey + \"_\" + ref;",
  ""
].join("\n");

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function snapshot() {
  return {
    schemaVersion: 1,
    fileId: "204689197363903",
    layerId: ROOT,
    pageName: "假页面",
    ui: "F2",
    dsl: {
      nodes: [{
        id: ROOT,
        name: "页面帧",
        type: "FRAME",
        layoutStyle: { relativeX: 0, relativeY: 0, width: 400, height: 300 },
        children: [{
          id: CHILD,
          name: "按钮",
          type: "INSTANCE",
          layoutStyle: { relativeX: 10, relativeY: 20, width: 100, height: 40 },
          text: [{ text: "确认" }],
          children: [{
            id: GRANDCHILD,
            name: "图标",
            type: "PATH",
            layoutStyle: { relativeX: 5, relativeY: 6, width: 16, height: 16 }
          }]
        }]
      }]
    }
  };
}

// 假插件：取数脚本落一份 getDsl；固化脚本落一份快照；mapping/发射脚本落固定内容。
function createStubPlugin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stub-plugin-"));
  const skill = path.join(root, "skills", "mastergo-to-wpf");
  const scripts = path.join(skill, "scripts");
  write(path.join(scripts, "lib", "page-node-id.js"), PAGE_NODE_ID);
  write(path.join(skill, "references", "adapters", "mtslg-iocontrol", "mtslg-iocontrol-map.json"), "{}\n");
  write(path.join(scripts, "core", "call-mastergo-mcp.js"), [
    "\"use strict\";",
    "const fs = require(\"fs\");",
    "const args = process.argv.slice(2);",
    "const at = (key) => args[args.indexOf(key) + 1];",
    "if (at(\"--tool\") !== \"getDsl\") process.exit(3);",
    "fs.writeFileSync(at(\"--out\"), JSON.stringify({ fileId: at(\"--fileId\"), layerId: at(\"--layerId\") }));",
    ""
  ].join("\n"));
  write(path.join(scripts, "core", "mastergo-dsl-pipeline.ps1"), [
    "param([string]$Action, [string]$InputFile, [string]$Out, [string]$FileId, [string]$LayerId, [string]$Ui)",
    "$args = @{ action = $Action; ui = $Ui; fileId = $FileId; layerId = $LayerId; input = $InputFile }",
    "Set-Content -LiteralPath (Join-Path $Out 'capture-args.json') -Encoding UTF8 -Value ($args | ConvertTo-Json -Depth 4)",
    "Copy-Item -LiteralPath $env:STUB_SNAPSHOT_SOURCE -Destination (Join-Path $Out 'dsl.snapshot.json') -Force",
    ""
  ].join("\n"));
  write(path.join(scripts, "core", "resolve-mastergo-visibility.js"), [
    "\"use strict\";",
    "const fs = require(\"fs\");",
    "const args = process.argv.slice(2);",
    "fs.writeFileSync(args[args.indexOf(\"--out\") + 1], JSON.stringify({ nodes: [] }));",
    ""
  ].join("\n"));
  write(path.join(scripts, "adapters", "mtslg-iocontrol", "gen-mtslg-mapping-from-dsl.js"), [
    "\"use strict\";",
    "const fs = require(\"fs\");",
    "const args = process.argv.slice(2);",
    "const out = args[args.indexOf(\"--out\") + 1];",
    "fs.writeFileSync(out, JSON.stringify({ nodes: [{",
    "  sourceRef: process.env.STUB_MAPPED_REF,",
    "  xmlId: \"MX_STUB_\" + process.env.STUB_PAGE_KEY + \"_\" + process.env.STUB_MAPPED_REF,",
    "  controlType: \"Button\",",
    "  attrs: { Style: \"Primary\", Value: \"确认\" }",
    "}] }));",
    ""
  ].join("\n"));
  write(path.join(scripts, "adapters", "mtslg-iocontrol", "gen-iocontrol-xml.js"), [
    "\"use strict\";",
    "const fs = require(\"fs\");",
    "const args = process.argv.slice(2);",
    "const out = args[args.indexOf(\"--out\") + 1];",
    "const id = \"MX_STUB_\" + process.env.STUB_PAGE_KEY + \"_\" + process.env.STUB_MAPPED_REF;",
    "fs.writeFileSync(out, [",
    "  '<IOContorl ID=\"MX_STUB_邻控件\" />',",
    "  '<IOContorl ID=\"' + id + '\" Value=\"确认\">',",
    "  '  <IOContorl ID=\"MX_STUB_子控件\" />',",
    "  '</IOContorl>',",
    "  '<IOContorl ID=\"MX_STUB_尾控件\" />',",
    "  ''",
    "].join(\"\\n\"));",
    ""
  ].join("\n"));
  return root;
}

function optionsFor(pluginRoot, workDir, extra) {
  return Object.assign({
    pluginRoot: pluginRoot,
    workDir: workDir,
    outPath: path.join(workDir, "node-controls.json"),
    ui: "F2",
    pwsh: "pwsh",
    quiet: true
  }, extra);
}

function caseSnapshotMode(fx) {
  process.env.STUB_PAGE_KEY = ROOT;
  process.env.STUB_MAPPED_REF = CHILD;
  const workDir = path.join(fx.root, "snapshot-run");
  fs.mkdirSync(workDir, { recursive: true });
  const snapshotPath = path.join(workDir, "dsl.snapshot.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot()), "utf8");

  const payload = runNodeControls(optionsFor(fx.plugin, workDir, { snapshot: snapshotPath }));
  assert.strictEqual(payload.pageKey, ROOT, "页面键取快照根节点 id");
  assert.strictEqual(payload.source, "snapshot");
  assert.deepStrictEqual(payload.nodes.map((node) => node.ref), [ROOT, CHILD, GRANDCHILD], "遍历顺序是深度优先");
  assert.strictEqual(payload.nodes[1].id, "MX_STUB_" + ROOT + "_" + CHILD, "ID 由插件公式派生");
  assert.strictEqual(payload.nodes[1].layerId, "11:69209", "layerId 取 ref 末段");
  assert.strictEqual(payload.nodes[1].text, "确认", "文本槽位拼成字符串");
  assert.strictEqual(payload.nodes[1].pageAbsX, 10, "子节点坐标 = 父链累加");
  assert.strictEqual(payload.nodes[2].pageAbsY, 26, "孙节点坐标 = 父链累加");
  assert.strictEqual(payload.nodes[0].xml, "", "未命中映射的节点没有控件代码");
  assert.strictEqual(payload.nodes[1].controlType, "Button");
  assert.strictEqual(payload.nodes[1].template, "Button / Primary");
  assert.ok(payload.nodes[1].xml.startsWith("<IOContorl ID=\"MX_STUB_" + ROOT + "_" + CHILD + "\""), "命中映射的节点带自身片段");
  assert.ok(payload.nodes[1].xml.includes("MX_STUB_子控件"), "带子节点时取整棵子树");
  assert.ok(!payload.nodes[1].xml.includes("MX_STUB_尾控件"), "不吞相邻控件");
  assert.strictEqual(payload.snapshot, snapshotPath);
}

function caseLinkMode(fx) {
  process.env.STUB_PAGE_KEY = ROOT;
  process.env.STUB_MAPPED_REF = CHILD;
  const workDir = path.join(fx.root, "link-run");
  fs.mkdirSync(workDir, { recursive: true });
  const template = path.join(workDir, "template.snapshot.json");
  fs.writeFileSync(template, JSON.stringify(snapshot()), "utf8");
  process.env.STUB_SNAPSHOT_SOURCE = template;
  const payload = runNodeControls(optionsFor(fx.plugin, workDir, {
    fileId: "204689197363903",
    layerId: ROOT
  }));
  assert.strictEqual(payload.source, "mastergo");
  const captured = JSON.parse(fs.readFileSync(path.join(workDir, "getDsl.json"), "utf8"));
  assert.strictEqual(captured.fileId, "204689197363903", "取数脚本拿到 fileId");
  assert.strictEqual(captured.layerId, ROOT, "取数脚本拿到 layerId");
  const captureArgs = JSON.parse(fs.readFileSync(path.join(workDir, "capture-args.json"), "utf8"));
  assert.strictEqual(captureArgs.action, "Capture");
  assert.strictEqual(captureArgs.ui, "F2", "固化脚本拿到区域前缀");
  assert.strictEqual(captureArgs.fileId, "204689197363903");
  assert.strictEqual(payload.nodes.length, 3, "链接模式同样产出全部节点");
}

// 单控件片段：自闭合只取一行，带子节点取整棵子树。
function caseXmlChunk() {
  const xml = [
    "<IOContorl ID=\"A\" />",
    "<IOContorl ID=\"B\">",
    "  <IOContorl ID=\"C\" />",
    "</IOContorl>",
    "<IOContorl ID=\"D\" />",
    ""
  ].join("\n");
  assert.strictEqual(extractXmlChunk(xml, "A"), "<IOContorl ID=\"A\" />");
  assert.strictEqual(extractXmlChunk(xml, "B"), "<IOContorl ID=\"B\">\n  <IOContorl ID=\"C\" />\n</IOContorl>");
  assert.strictEqual(extractXmlChunk(xml, "C"), "<IOContorl ID=\"C\" />");
  assert.strictEqual(extractXmlChunk(xml, "没有这个"), "");
  assert.strictEqual(extractXmlChunk("", "A"), "");
}

function caseMissingPluginFiles(fx) {
  const empty = path.join(fx.root, "empty-plugin");
  fs.mkdirSync(empty, { recursive: true });
  const missing = missingPluginFiles(empty);
  assert.ok(missing.includes("pageNodeId"), "缺 ID 公式要报出来");
  assert.ok(missing.includes("capture"), "缺固化脚本要报出来");
  assert.throws(function () {
    runNodeControls(optionsFor(empty, path.join(fx.root, "missing-run"), { fileId: "1", layerId: ROOT }));
  }, /插件里缺少查询所需文件/);
}

async function main() {
  const fx = { root: fs.mkdtempSync(path.join(os.tmpdir(), "node-controls-test-")) };
  fx.plugin = createStubPlugin();
  const cases = [
    ["快照模式", caseSnapshotMode],
    ["链接模式", caseLinkMode],
    ["单控件片段", caseXmlChunk],
    ["缺插件文件", caseMissingPluginFiles]
  ];
  try {
    for (const [name, run] of cases) {
      await run(fx);
      console.log("  ok  " + name);
    }
    console.log("node-controls.test.js 全部通过");
  }
  finally {
    delete process.env.STUB_PAGE_KEY;
    delete process.env.STUB_MAPPED_REF;
    delete process.env.STUB_SNAPSHOT_SOURCE;
    fs.rmSync(fx.root, { recursive: true, force: true });
    fs.rmSync(fx.plugin, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
