#!/usr/bin/env node
"use strict";

// 对话存档：建、改名、删、一轮的起止与行追加，以及重启后还能读回来。
// 跑法：node tests/chat.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createChats, titleFrom } = require("../lib/chat.js");

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gui-chat-"));
}

function caseTitle() {
  assert.strictEqual(titleFrom("  第一行  \n第二行"), "第一行");
  assert.strictEqual(titleFrom(""), "新对话");
  assert.strictEqual(titleFrom("x".repeat(50)).length, 41, "超长截到 40 字再加省略号");
}

function caseLifecycle() {
  const home = tempHome();
  const chats = createChats({ home: home });
  assert.deepStrictEqual(chats.list(), []);

  const created = chats.create({});
  assert.strictEqual(chats.list().length, 1);
  assert.strictEqual(chats.list()[0].title, "新对话");

  // 第一次提问把标题定下来，并追加这一轮。
  const started = chats.beginTurn(created.id, "看一下 F1 到哪一步了");
  assert.strictEqual(started.title, "看一下 F1 到哪一步了");
  chats.appendLine(started.turn, "stdout", '{"type":"turn.started"}');
  chats.appendLine(started.turn, "stderr", "warn");
  chats.endTurn(created.id, started.turn, 0);

  const loaded = chats.get(created.id);
  assert.strictEqual(loaded.turns.length, 1);
  assert.strictEqual(loaded.turns[0].prompt, "看一下 F1 到哪一步了");
  assert.deepStrictEqual(loaded.turns[0].lines, [
    { stream: "stdout", line: '{"type":"turn.started"}' },
    { stream: "stderr", line: "warn" }
  ]);
  assert.strictEqual(loaded.turns[0].exitCode, 0);

  // 原标题只由第一句定；后面的提问不动它。
  chats.beginTurn(created.id, "再问一句");
  assert.strictEqual(chats.get(created.id).title, "看一下 F1 到哪一步了");

  chats.remove(created.id);
  assert.deepStrictEqual(chats.list(), []);
  fs.rmSync(home, { recursive: true, force: true });
}

// 同一轮里断开连接与进程退出会先后到，先到的那个算数，退出码不能被后来的 null 抹掉。
function caseEndTurnOnce() {
  const home = tempHome();
  const chats = createChats({ home: home });
  const created = chats.create({});
  const started = chats.beginTurn(created.id, "q");
  chats.endTurn(created.id, started.turn, 0);
  chats.endTurn(created.id, started.turn, null);
  assert.strictEqual(chats.get(created.id).turns[0].exitCode, 0);
  fs.rmSync(home, { recursive: true, force: true });
}

function casePersist() {
  const home = tempHome();
  const first = createChats({ home: home });
  const created = first.create({ title: "手写的标题" });
  const started = first.beginTurn(created.id, "q");
  first.endTurn(created.id, started.turn, 1);

  // 新开一份实例 = 客户端重启：内容要还在，顺序按最近更新在前。
  const second = createChats({ home: home });
  const list = second.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].title, "手写的标题");
  assert.strictEqual(list[0].turnCount, 1);
  assert.strictEqual(second.get(list[0].id).turns[0].exitCode, 1);
  fs.rmSync(home, { recursive: true, force: true });
}

function caseMissing() {
  const home = tempHome();
  const chats = createChats({ home: home });
  assert.throws(() => chats.get("nope"), /找不到这个对话/);
  assert.throws(() => chats.remove("nope"), /找不到这个对话/);
  assert.deepStrictEqual(chats.create({}).title, "新对话");
  fs.rmSync(home, { recursive: true, force: true });
}

try {
  const cases = [
    ["标题", caseTitle],
    ["一轮的生命周期", caseLifecycle],
    ["收尾只认第一次", caseEndTurnOnce],
    ["重启后还在", casePersist],
    ["找不到就报错", caseMissing]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("chat.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
