#!/usr/bin/env node
"use strict";

// 参考源：默认有一份、旧版平铺字段能迁过来、默认参考源 id 跟着实际存在的那份走。
// 跑法：node tests/settings-templates.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSettings } = require("../lib/settings.js");

function tempHome(body) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-templates-"));
  if (body) fs.writeFileSync(path.join(home, "local.json"), JSON.stringify(body), "utf8");
  return home;
}

function caseFresh() {
  const home = tempHome(null);
  const read = createSettings(home).read();
  assert.strictEqual(read.templates.length, 1, "新机器也有一份空参考源，界面不会出现空列表");
  assert.strictEqual(read.templates[0].name, "默认");
  assert.deepStrictEqual(read.templates[0].codebases, []);
  assert.strictEqual(read.activeTemplateId, read.templates[0].id);
  fs.rmSync(home, { recursive: true, force: true });
}

function caseLegacy() {
  const home = tempHome({
    agent: { allowWrite: true, systemPrompt: "旧提示词" },
    codebases: [{ path: "D:\\old", name: "旧库" }]
  });
  const settings = createSettings(home);
  const read = settings.read();
  assert.strictEqual(read.templates.length, 1, "旧的两个平铺字段合成一份参考源");
  assert.strictEqual(read.templates[0].systemPrompt, "旧提示词");
  assert.strictEqual(read.templates[0].codebases[0].path, "D:\\old");
  assert.strictEqual(read.agent.allowWrite, true, "写盘开关不受影响");
  // 存一次以后，平铺字段就该消失，只剩参考源。
  settings.write({ templates: read.templates });
  const raw = JSON.parse(fs.readFileSync(path.join(home, "local.json"), "utf8"));
  assert.strictEqual(raw.codebases, undefined);
  assert.strictEqual(raw.agent.systemPrompt, undefined);
  assert.strictEqual(raw.agent.allowWrite, true);
  fs.rmSync(home, { recursive: true, force: true });
}

function caseActive() {
  const home = tempHome(null);
  const settings = createSettings(home);
  settings.write({
    templates: [
      { id: "t1", name: "A", systemPrompt: "p1", codebases: [] },
      { id: "t2", name: "B", systemPrompt: "p2", codebases: [{ path: "D:\\x" }] }
    ],
    activeTemplateId: "t2"
  });
  assert.strictEqual(settings.read().activeTemplateId, "t2");
  // 指向一个不存在的参考源时落回第一份，不留悬空指针。
  settings.write({ templates: settings.read().templates, activeTemplateId: "nope" });
  assert.strictEqual(settings.read().activeTemplateId, "t1");
  // 名字空、代码库缺字段都要能兜住。
  settings.write({ templates: [{ id: "t9", name: "  ", codebases: [{ path: "" }, { path: "D:\\ok" }] }] });
  const only = settings.read().templates[0];
  assert.strictEqual(only.name, "未命名参考源");
  assert.deepStrictEqual(only.codebases.map(function (item) { return item.path; }), ["D:\\ok"], "没路径的条目丢掉");
  fs.rmSync(home, { recursive: true, force: true });
}

try {
  const cases = [["新机器", caseFresh], ["旧配置迁移", caseLegacy], ["默认参考源", caseActive]];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("settings-templates.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
