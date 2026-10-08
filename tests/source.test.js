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

/*
 * 插件那条线的源是**自己那一项设置**：没配＝插件自己的仓库（它有自己的版本线），
 * 配了＝用配的那个（内网可以两份清单放同一个基址）；坏配置一律回到插件仓库，不半换。
 */
function casePluginSource() {
  assert.strictEqual(source.pluginSourceOf(null).base, source.PLUGIN_DEFAULT_BASE, "没配＝插件仓库");
  assert.strictEqual(
    source.pluginSourceOf({ kind: "static", base: "http://10.0.0.8/plugin-updates" }).base,
    "http://10.0.0.8/plugin-updates",
    "配了内网静态目录就跟着它"
  );
  assert.strictEqual(
    source.pluginSourceOf({ kind: "nonsense", base: "http://10.0.0.8/plugin-updates" }).base,
    source.PLUGIN_DEFAULT_BASE,
    "类型认不出来就整体不用它"
  );
  // 两条线的默认基址不是同一个：插件那条按插件仓库取。
  assert.notStrictEqual(source.PLUGIN_DEFAULT_BASE, source.DEFAULT_BASE, "两条线各回各的官方仓库");

  // 拼地址那几个入口也接受「坏配置回落哪份默认」：不传＝客户端那份（老调用方照旧），插件那条传它自己的。
  assert.strictEqual(
    source.manifestUrl(null, source.PLUGIN_MANIFEST_NAME, source.pluginSourceOf),
    source.PLUGIN_DEFAULT_BASE + "/releases/latest/download/" + source.PLUGIN_MANIFEST_NAME,
    "插件那条线按插件仓库回落"
  );
  assert.strictEqual(
    source.manifestUrl(null),
    source.DEFAULT_BASE + "/releases/latest/download/" + source.MANIFEST_NAME,
    "不传 normalize 还是客户端那份默认（老调用方不变）"
  );
}

try {
  const cases = [
    ["GitHub 源的地址", caseGithub],
    ["GitLab 通用包", caseGitlab],
    ["静态目录", caseStatic],
    ["坏配置回落", caseNormalize],
    ["私有源的请求头", caseHeaders],
    ["给界面看的描述", caseDescribe],
    ["插件那条线的源", casePluginSource]
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
