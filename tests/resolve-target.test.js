#!/usr/bin/env node
"use strict";

// 链接解析 / 页面帧发现 / 控件定位 / 失败翻译：这些是「贴链接 → 算 ID」的前半段，纯逻辑。
// 跑法：node tests/resolve-target.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseLink,
  findNodesByLayerId,
  isPageLevelLink,
  describeCaptureFailure,
  discoverFrames
} = require("../lib/resolve-target.js");

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function caseParseLink() {
  const full = parseLink("https://mastergo.com/goto/AbC?page_id=4:0&layer_id=1872%3A60904&file=204689197363903&devMode=true");
  assert.deepStrictEqual(full, { fileId: "204689197363903", layerId: "1872:60904", pageId: "4:0" }, "三段都要解析出来，layer_id 要解码");

  assert.deepStrictEqual(parseLink("  1872:60904  "), { fileId: "", layerId: "1872:60904", pageId: "" }, "只贴 layer_id 也认");
  assert.deepStrictEqual(parseLink(""), { fileId: "", layerId: "", pageId: "" });
  assert.deepStrictEqual(parseLink("https://mastergo.com/goto/x?file=123"), { fileId: "123", layerId: "", pageId: "" });

  // 坏的百分号编码不能抛异常，要原样留着让人看到
  assert.strictEqual(parseLink("https://x?layer_id=%zz").layerId, "%zz");

  assert.strictEqual(isPageLevelLink({ layerId: "4:0", pageId: "4:0" }), true, "page_id 被当成 layer_id 就是页面链接");
  assert.strictEqual(isPageLevelLink({ layerId: "4:1", pageId: "4:0" }), false);
  assert.strictEqual(isPageLevelLink({ layerId: "", pageId: "4:0" }), false);
  assert.strictEqual(isPageLevelLink(null), false);
}

function caseFindNodesByLayerId() {
  const nodes = [
    { ref: "1:1/2:2/3:3", layerId: "3:3", name: "深层" },
    { ref: "1:1/3:3", layerId: "3:3", name: "浅层" },
    { ref: "1:1/9:9", layerId: "9:9", name: "别的" },
    { ref: "3:3", layerId: "3:3", name: "本身" }
  ];
  const hits = findNodesByLayerId(nodes, "3:3");
  assert.deepStrictEqual(hits.map((node) => node.name), ["本身", "浅层", "深层"], "同名按层级从浅到深排");
  assert.deepStrictEqual(findNodesByLayerId(nodes, ""), [], "空 layerId 直接返回空");
  assert.deepStrictEqual(findNodesByLayerId(null, "3:3"), [], "节点表为空也不炸");
  assert.deepStrictEqual(findNodesByLayerId([null, { ref: "1:1" }], "3:3"), [], "坏节点跳过");
}

function caseDescribeCaptureFailure() {
  const empty = describeCaptureFailure("error: dsl.nodes[] is empty", "1872:60904");
  assert.strictEqual(empty.code, "EMPTY_DSL");
  assert.match(empty.message, /1872:60904/);
  assert.match(empty.hint, /页面.*链接/);

  assert.strictEqual(describeCaptureFailure("invalid token mg_xxx", "1:1").code, "NEED_TOKEN");
  const other = describeCaptureFailure("boom", "1:1");
  assert.strictEqual(other.code, "CAPTURE_FAILED");
  assert.strictEqual(other.hint, "boom");
  assert.strictEqual(describeCaptureFailure(null, "1:1").code, "CAPTURE_FAILED");
  assert.ok(describeCaptureFailure("x".repeat(2000), "1:1").hint.length <= 800, "提示要做长度截断");
}

function caseDiscoverFrames() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-frames-"));
  try {
    // ① 登记表（含本地快照）
    write(path.join(root, "docs", "page-registry.json"), JSON.stringify({
      pages: [
        { target: "F3Align", designSource: { fileId: "111", layerId: "3:1", pageId: "3:0", designPageName: "对焦" } },
        { target: "NoSource" },
        { target: "F4Run", designSource: { fileId: "222", layerId: "4:1" } }
      ]
    }));
    write(path.join(root, "Generated", "dsl.snapshot.json"), "{}\n");

    // ② 运行登记表（只有 schemaVersion 前缀对才认）
    write(path.join(root, "Generated", "runs", "F3Align", "manifest.json"), JSON.stringify({
      schemaVersion: "mastergo-dsl-run/1", fileId: "111", layerId: "3:1", pageName: "对焦"
    }));
    write(path.join(root, "Generated", "runs", "F5Plain", "manifest.json"), JSON.stringify({
      schemaVersion: "mastergo-dsl-run/2", fileId: "555", layerId: "5:1"
    }));
    // 别的 manifest（schemaVersion 不匹配）不能当成页面帧
    write(path.join(root, "Generated", "runs", "F6Other", "manifest.json"), JSON.stringify({
      schemaVersion: "something-else", fileId: "666", layerId: "6:1"
    }));

    // ③ 坏 JSON 不能拖垮扫描
    write(path.join(root, "docs", "nested", "page-registry.json"), "{ not json");
    // ④ 跳过名单里的目录不进
    write(path.join(root, "node_modules", "x", "page-registry.json"), JSON.stringify({
      pages: [{ designSource: { fileId: "999", layerId: "9:9" } }]
    }));

    const frames = discoverFrames([root, path.join(root, "missing")]);
    const keys = frames.map((frame) => frame.fileId + "|" + frame.layerId).sort();
    assert.deepStrictEqual(keys, ["111|3:1", "222|4:1", "555|5:1"], "登记表与运行登记表都要收，坏 JSON 与 node_modules 里的不要");
    const fromRegistry = frames.find((frame) => frame.fileId === "111");
    assert.strictEqual(fromRegistry.from, "page-registry");
    assert.strictEqual(fromRegistry.name, "对焦");
    assert.ok(fromRegistry.snapshotPath.endsWith("dsl.snapshot.json"), "同目录存在快照时要带上路径");
    const fromManifest = frames.find((frame) => frame.fileId === "555");
    assert.strictEqual(fromManifest.from, "manifest");
    assert.strictEqual(fromManifest.snapshotPath, "");

    // 深度限制：maxDepth 0 时连根目录的文件都不看
    assert.deepStrictEqual(discoverFrames([root], { maxDepth: 0 }), []);
    // 同一个 frame 只登记一次
    assert.strictEqual(discoverFrames([root, root]).length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const cases = [
    ["链接解析与页面链接识别", caseParseLink],
    ["按 layer_id 找控件", caseFindNodesByLayerId],
    ["取数失败翻译成可读错误", caseDescribeCaptureFailure],
    ["工程里发现页面帧", caseDiscoverFrames]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("resolve-target.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
