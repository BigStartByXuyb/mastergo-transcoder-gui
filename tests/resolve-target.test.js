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
// 档位只有一份（lib/ansi.js）：用例按档位断言，不写死数字。
const { DETAIL_LIMITS } = require("../lib/ansi.js");
// token 的环境变量名只有一处（lib/mcp-token.js）：夹具照它拼。
const { TOKEN_ENV_KEY } = require("../lib/mcp-token.js");

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

  // 「插件没拿到 token」那句（会教你环境变量 / -ConfigPath 怎么给）换成客户端说法。
  const missing = describeCaptureFailure("Exception: 缺少 MasterGo token：设置环境变量 " + TOKEN_ENV_KEY, "1:1");
  assert.strictEqual(missing.code, "NEED_TOKEN");
  assert.match(missing.hint, /设置 → MasterGo token/);
  assert.ok(missing.hint.indexOf("ConfigPath") < 0, "不复述命令行用法");
  // 引擎自己那句「这份不行」是另一个问题：原样给人看，不套用上面那句。
  const rejected = describeCaptureFailure("invalid token mg_xxx：MasterGo 说这份不认", "1:1");
  assert.strictEqual(rejected.code, "CAPTURE_FAILED");
  assert.match(rejected.hint, /invalid token/);
  const other = describeCaptureFailure("boom", "1:1");
  assert.strictEqual(other.code, "CAPTURE_FAILED");
  assert.strictEqual(other.hint, "boom");
  assert.strictEqual(describeCaptureFailure(null, "1:1").code, "CAPTURE_FAILED");
  // 判据看全文，给人看的 hint 才掐长度（档位在 lib/ansi.js）：标记在最前面也认得出。
  assert.ok(describeCaptureFailure("dsl.nodes[] is empty" + "\n" + "过程".repeat(2000), "1:1").code === "EMPTY_DSL",
    "标记在很前面也要认出来");
  // 档位调整时这条不该误红：断言的是「按档位掐」，不是某个具体数字。
  assert.strictEqual(describeCaptureFailure("x".repeat(2000), "1:1").hint.length, DETAIL_LIMITS.hint, "hint 按档位掐长度");
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
    // F3Align 目录里也有一份快照：这样无论两个来源谁先被扫到，111 的快照路径都必须非空
    write(path.join(root, "Generated", "runs", "F3Align", "dsl.snapshot.json"), "{}\n");
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
    // 目录遍历顺序在各平台不保证：只断言「两种来源都被认出来」，不绑定谁先谁后。
    const sources = [...new Set(frames.map((frame) => frame.from))].sort();
    assert.deepStrictEqual(sources, ["manifest", "page-registry"]);
    assert.strictEqual(frames.find((frame) => frame.fileId === "111").name, "对焦", "页面名来自登记表或运行登记表");
    assert.ok(
      frames.find((frame) => frame.fileId === "111").snapshotPath.endsWith("dsl.snapshot.json"),
      "旁边有快照的页面帧要带上快照路径（与扫描顺序无关）"
    );
    assert.strictEqual(
      frames.find((frame) => frame.fileId === "555").snapshotPath,
      "",
      "旁边没有快照的页面帧留空"
    );

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
