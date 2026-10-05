#!/usr/bin/env node
"use strict";

// 发布源：三种形态各自拼出什么地址、坏配置怎么回落、私有源带什么头。
// 跑法：node tests/source.test.js

const assert = require("assert");

const source = require("../lib/source.js");

const GH = { kind: "github", base: "https://github.com/BigStartByXuyb/mastergo-transcoder-gui" };
const GL = { kind: "gitlab", base: "https://git.example.com/team/mastergo-transcoder-gui" };
const ST = { kind: "static", base: "http://10.0.0.9/updates" };

function caseGithub() {
  assert.strictEqual(
    source.manifestUrl(GH),
    "https://github.com/BigStartByXuyb/mastergo-transcoder-gui/releases/latest/download/manifest.json"
  );
  assert.strictEqual(
    source.manifestUrlOf(GH, "0.6.30"),
    "https://github.com/BigStartByXuyb/mastergo-transcoder-gui/releases/download/v0.6.30/manifest.json"
  );
  assert.strictEqual(
    source.blobUrl(GH, "0.6.30", "abc123"),
    "https://github.com/BigStartByXuyb/mastergo-transcoder-gui/releases/download/v0.6.30/abc123"
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
}

function caseHeaders() {
  assert.strictEqual(source.requestHeaders(GH, ""), null, "公开源不带头");
  assert.deepStrictEqual(source.requestHeaders(GH, "ghp_x"), { authorization: "Bearer ghp_x" });
}

function caseDescribe() {
  assert.deepStrictEqual(source.describeSource(GL), {
    kind: "gitlab",
    base: "https://git.example.com/team/mastergo-transcoder-gui",
    manifestUrl: source.manifestUrl(GL)
  });
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
