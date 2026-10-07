#!/usr/bin/env node
"use strict";

// 发布源：三种形态各自拼出什么地址、坏配置怎么回落、私有源带什么头。
// 跑法：node tests/source.test.js

const assert = require("assert");

const source = require("../lib/source.js");

// 内置发布源只有 lib/source.js 一处（DEFAULT_BASE）：这里的期望值用它拼，不再各写一份字面量。
const GH = { kind: "github", base: source.DEFAULT_BASE };
const GL = { kind: "gitlab", base: "https://git.example.com/team/mastergo-transcoder-gui" };
const ST = { kind: "static", base: "http://10.0.0.9/updates" };

function caseGithub() {
  assert.strictEqual(
    source.manifestUrl(GH),
    source.DEFAULT_BASE + "/releases/latest/download/manifest.json"
  );
  assert.strictEqual(
    source.manifestUrlOf(GH, "0.6.30"),
    source.DEFAULT_BASE + "/releases/download/v0.6.30/manifest.json"
  );
  assert.strictEqual(
    source.blobUrl(GH, "0.6.30", "abc123"),
    source.DEFAULT_BASE + "/releases/download/v0.6.30/abc123"
  );
  // 插件那一半按同一套协议换清单名：地址只有文件名不同（最新那份，落在同一个 Release 上）。
  assert.strictEqual(source.MANIFEST_NAME, "manifest.json");
  assert.strictEqual(
    source.manifestUrl(GH, source.PLUGIN_MANIFEST_NAME),
    source.DEFAULT_BASE + "/releases/latest/download/plugin-manifest.json"
  );
}

function caseGitlab() {
  assert.strictEqual(
    source.manifestUrl(GL),
    "https://git.example.com/team/mastergo-transcoder-gui/-/releases/permalink/latest/downloads/manifest.json"
  );
  assert.strictEqual(
    source.manifestUrlOf(GL, "0.7.0"),
    "https://git.example.com/team/mastergo-transcoder-gui/-/packages/generic/mastergo-transcoder-gui/v0.7.0/manifest.json"
  );
  assert.strictEqual(
    source.blobUrl(GL, "0.7.0", "deadbeef"),
    "https://git.example.com/team/mastergo-transcoder-gui/-/packages/generic/mastergo-transcoder-gui/v0.7.0/deadbeef"
  );
  assert.deepStrictEqual(source.requestHeaders(GL, "glpat-xxx"), { "private-token": "glpat-xxx" });
}

function caseStatic() {
  assert.strictEqual(source.manifestUrl(ST), "http://10.0.0.9/updates/manifest.json");
  assert.strictEqual(source.manifestUrlOf(ST, "0.7.0"), "http://10.0.0.9/updates/v0.7.0/manifest.json");
  // 文件集中在 files/ 下：历史版本共用同一份，不重复占地方。
  assert.strictEqual(source.blobUrl(ST, "0.7.0", "deadbeef"), "http://10.0.0.9/updates/files/deadbeef");
  assert.deepStrictEqual(source.requestHeaders(ST, "secret"), { authorization: "Bearer secret" });
}

function caseNormalize() {
  // 末尾斜杠由这一处统一去掉，别让调用方各自处理。
  assert.deepStrictEqual(
    source.normalizeSource({ kind: "gitlab", base: "https://git.example.com/team/repo///" }),
    { kind: "gitlab", base: "https://git.example.com/team/repo" }
  );
  // 不认识的类型、空基址、非 http 的基址：一律回到内置的 GitHub 源，不去猜。
  const fallback = { kind: "github", base: source.DEFAULT_BASE };
  assert.deepStrictEqual(source.normalizeSource({ kind: "svn", base: "https://x/y" }), fallback);
  assert.deepStrictEqual(source.normalizeSource({ kind: "gitlab", base: "" }), fallback);
  assert.deepStrictEqual(source.normalizeSource({ kind: "gitlab", base: "file:///D:/x" }), fallback);
  assert.deepStrictEqual(source.normalizeSource(null), fallback);

  // parseSource：能用就给归一化的源，不能用给 null（不回落）—— 发布脚本与清单生成器用它。
  assert.deepStrictEqual(
    source.parseSource({ kind: "static", base: "http://10.0.0.9/updates///" }),
    { kind: "static", base: "http://10.0.0.9/updates" },
    "末尾斜杠由这一处统一去掉"
  );
  assert.strictEqual(source.parseSource({ kind: "svn", base: "https://x/y" }), null, "类型不认识＝不回落");
  assert.strictEqual(source.parseSource({ kind: "gitlab", base: "svn://x/y" }), null, "基址不合法＝不回落");
}

function caseHeaders() {
  assert.strictEqual(source.requestHeaders(GH, ""), null, "公开源不带头");
  assert.deepStrictEqual(source.requestHeaders(GH, "ghp_x"), { authorization: "Bearer ghp_x" });
}

function caseDescribe() {
  assert.deepStrictEqual(source.describeSource(GL), {
    kind: "gitlab",
    base: "https://git.example.com/team/mastergo-transcoder-gui",
    manifestUrl: source.manifestUrl(GL),
    // 界面下拉照 kinds 渲染：类型名单只有这一处，前端不另抄一份。
    kinds: source.KINDS
  });
  // 插件那一半的「去哪儿取清单」也由这一处拼：换清单名就换一整套地址。
  assert.strictEqual(
    source.describeSource(ST, source.PLUGIN_MANIFEST_NAME).manifestUrl,
    "http://10.0.0.9/updates/plugin-manifest.json"
  );
}

try {
  const cases = [
    ["GitHub 源的地址", caseGithub],
    ["GitLab 通用包", caseGitlab],
    ["静态目录", caseStatic],
    ["坏配置回落", caseNormalize],
    ["私有源的请求头", caseHeaders],
    ["给界面看的描述", caseDescribe]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("source.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
