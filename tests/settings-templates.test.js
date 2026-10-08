#!/usr/bin/env node
"use strict";

// 参考源：默认有一份、旧版平铺字段能迁过来、默认参考源 id 跟着实际存在的那份走。
// 跑法：node tests/settings-templates.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSettings } = require("../lib/settings.js");
// 内置发布源只有 lib/source.js 一处（DEFAULT_BASE）：默认值与回落都按它断言，不各写一份字面量。
const sourceDefaults = require("../lib/source.js");

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

// 发布源：默认是内置的 GitHub 仓库；手输一份就按那份走；坏配置回落默认而不是拼出怪地址。
function caseSource() {
  const home = tempHome(null);
  const settings = createSettings(home);
  const initial = settings.read().source;
  assert.strictEqual(initial.kind, "github");
  assert.strictEqual(initial.base, sourceDefaults.DEFAULT_BASE);
  assert.strictEqual(initial.hasToken, false);
  // 插件那条线有自己的默认：没配发布源 → 插件仓库（不是客户端仓库那份默认）。
  assert.strictEqual(settings.pluginSource().base, sourceDefaults.PLUGIN_DEFAULT_BASE, "没配＝插件仓库");

  const saved = settings.write({
    source: { kind: "gitlab", base: "https://git.example.com/team/repo/", token: "glpat-x" }
  }).source;
  assert.strictEqual(saved.kind, "gitlab");
  assert.strictEqual(saved.base, "https://git.example.com/team/repo", "末尾斜杠由 source.js 统一去掉");
  assert.strictEqual(saved.hasToken, true);
  assert.strictEqual(settings.pluginSource().base, "https://git.example.com/team/repo", "配了公司源，插件线也跟着它");
  assert.strictEqual(settings.readSourceToken(), "glpat-x", "token 解出来给更新模块用");

  // 不认识的类型 / 空基址：回落内置默认，不保留半份配置。
  const broken = settings.write({ source: { kind: "svn", base: "https://x/y" } }).source;
  assert.strictEqual(broken.kind, "github");
  assert.strictEqual(broken.base, sourceDefaults.DEFAULT_BASE);
  assert.strictEqual(settings.pluginSource().base, sourceDefaults.PLUGIN_DEFAULT_BASE, "坏配置＝没配，插件线回它自己的默认");

  settings.write({ source: { kind: "static", base: "http://10.0.0.9/updates", clearToken: true } }).source;
  assert.strictEqual(settings.read().source.hasToken, false, "清掉 token 后不再算有");
  assert.strictEqual(settings.readSourceToken(), "");
  assert.strictEqual(settings.pluginSource().base, "http://10.0.0.9/updates", "内网静态目录：两条线都从那里取");

  // 配回客户端官方仓库（没换源）时，插件仍回它自己的默认 —— 那个仓库里没有插件发布件。
  settings.write({ source: { kind: "github", base: sourceDefaults.DEFAULT_BASE } });
  assert.strictEqual(
    settings.pluginSource().base,
    sourceDefaults.PLUGIN_DEFAULT_BASE,
    "配的就是客户端官方仓库＝没换源"
  );
  fs.rmSync(home, { recursive: true, force: true });
}

// 运行时的安装包来源：默认空＝官方地址；填了就是镜像基址（末尾斜杠去掉）；填共享盘那种取不到的写法当没填。
function caseRuntimeMirror() {
  const home = tempHome(null);
  const settings = createSettings(home);
  assert.strictEqual(settings.read().runtime.mirror, "", "默认走官方地址");
  assert.deepStrictEqual(settings.read().runtime.system, { node: false, pwsh: false }, "默认两份都不用系统上那份");

  const saved = settings.write({ runtime: { system: { node: true, pwsh: false }, mirror: "http://10.0.0.9/runtime/" } }).runtime;
  assert.strictEqual(saved.mirror, "http://10.0.0.9/runtime", "末尾斜杠由这一处统一去掉");
  assert.deepStrictEqual(saved.system, { node: true, pwsh: false }, "两份运行时各记各的");

  // 三个入口各写各的：只动其中一项时，其它必须留着（谁后写都不该清空对方）。
  const onlyMirror = settings.write({ runtime: { mirror: "http://10.0.0.9/other" } }).runtime;
  assert.strictEqual(onlyMirror.mirror, "http://10.0.0.9/other");
  assert.deepStrictEqual(onlyMirror.system, { node: true, pwsh: false }, "只改镜像，不该动两份的来源");
  const onlyPwsh = settings.write({ runtime: { system: { pwsh: true } } }).runtime;
  assert.deepStrictEqual(onlyPwsh.system, { node: true, pwsh: true }, "只动 pwsh，node 那份要留着");
  assert.strictEqual(onlyPwsh.mirror, "http://10.0.0.9/other", "只动来源，不该把镜像清空");

  // 共享盘那种写法客户端取不了（fetch 只认 http/https）：当没填，回落官方地址。
  const bad = settings.write({ runtime: { system: { node: false, pwsh: false }, mirror: "\\\\server\\share\\runtime" } }).runtime;
  assert.strictEqual(bad.mirror, "", "非法基址一律当没填");
  assert.deepStrictEqual(bad.system, { node: false, pwsh: false });
  fs.rmSync(home, { recursive: true, force: true });
}

try {
  const cases = [
    ["新机器", caseFresh],
    ["旧配置迁移", caseLegacy],
    ["默认参考源", caseActive],
    ["发布源", caseSource],
    ["运行时安装包来源", caseRuntimeMirror]
  ];
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
