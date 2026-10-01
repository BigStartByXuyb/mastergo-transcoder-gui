#!/usr/bin/env node
"use strict";

// 启动选版：指针指到完整的那一份就用它，指空/指坏/指向残缺目录都退回安装根自己这一份。
// 跑法：node tests/launch.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { resolveLaunch, pluginEnvDecision } = require("../lib/launch.js");

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-launch-"));
  fs.writeFileSync(path.join(home, "server.js"), "// root copy\n", "utf8");
  return home;
}

function stageVersion(home, version) {
  const dir = path.join(home, "versions", version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "server.js"), "// " + version + "\n", "utf8");
  return dir;
}

function point(home, pointer) {
  fs.writeFileSync(path.join(home, "current.json"), JSON.stringify(pointer, null, 2) + "\n", "utf8");
}

const home = makeHome();
const empty = resolveLaunch(home);
assert.strictEqual(empty.dir, home, "没有指针就用安装根自己这一份");
assert.strictEqual(empty.fromPointer, false);

const dir = stageVersion(home, "0.4.0");
point(home, { version: "0.4.0", previous: "0.3.0" });
const staged = resolveLaunch(home);
assert.strictEqual(staged.dir, dir, "指针指到哪一份就用哪一份");
assert.strictEqual(staged.version, "0.4.0");
assert.strictEqual(staged.fromPointer, true);

point(home, { version: "9.9.9" });
assert.strictEqual(resolveLaunch(home).dir, home, "指针指向不存在的版本就退回安装根");

fs.rmSync(path.join(dir, "server.js"));
point(home, { version: "0.4.0" });
assert.strictEqual(resolveLaunch(home).dir, home, "版本目录残了就退回安装根");

fs.writeFileSync(path.join(home, "current.json"), "{ 坏掉的 json", "utf8");
assert.strictEqual(resolveLaunch(home).dir, home, "指针读不出来就退回安装根");

fs.rmSync(home, { recursive: true, force: true });

// ---- 起子进程时怎么对待「插件根」那个环境变量 ----
const P = "D:" + "\\plugin";
const Q = "D:" + "\\other";

// 界面上没改过它：一律沿用继承来的那份（连注册表都不读）。
assert.deepStrictEqual(pluginEnvDecision(P, null, ""), { action: "keep", value: "", seen: "" });

// 改了：新的一份要用新值，并记住「这是注册表来的」。
assert.deepStrictEqual(
  pluginEnvDecision(P, { user: Q, machine: "", failure: "" }, ""),
  { action: "set", value: Q, seen: Q },
  "注册表里改了值就用新值"
);
// 与继承来的一样：不动。
assert.deepStrictEqual(
  pluginEnvDecision(Q, { user: Q, machine: "", failure: "" }, Q),
  { action: "keep", value: "", seen: Q },
  "与继承来的一样就不动"
);
// 用户级没设、机器级有：用机器级那一份。
assert.deepStrictEqual(
  pluginEnvDecision("", { user: "", machine: Q, failure: "" }, ""),
  { action: "set", value: Q, seen: Q },
  "机器级也算"
);
// 刚被清掉、继承来的正是上次从注册表读到的那份：连着删掉，否则「清除」不生效。
assert.deepStrictEqual(
  pluginEnvDecision(P, { user: "", machine: "", failure: "" }, P),
  { action: "remove", value: "", seen: "" },
  "清掉的那份要从子进程环境里也删掉"
);
// 继承来的是命令行临时设的（没在注册表见过）：注册表空着也不动它。
assert.deepStrictEqual(
  pluginEnvDecision(P, { user: "", machine: "", failure: "" }, ""),
  { action: "keep", value: "", seen: "" },
  "命令行临时设的那份不受影响"
);
// 注册表读不出来（例如没有 pwsh）：别动，宁可保持原样也别把用户设置抹掉。
assert.deepStrictEqual(
  pluginEnvDecision(P, { user: "", machine: "", failure: "起不来" }, P),
  { action: "keep", value: "", seen: P },
  "读不出来就别动"
);

process.stdout.write("launch ok\n");
