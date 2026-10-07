"use strict";

// 子进程输出里的终端色码：一处剥干净，流式也要扛得住色码被切在两个 chunk 之间。
// 跑法：node tests/ansi.test.js

const assert = require("assert");

const { stripText, createStripper, childOutputDetail } = require("../lib/ansi.js");

function caseStripText() {
  assert.strictEqual(stripText(""), "");
  assert.strictEqual(stripText(null), "");
  assert.strictEqual(stripText("普通中文"), "普通中文");
  assert.strictEqual(stripText("\u001b[31;1m红字\u001b[0m"), "红字");
  // CSI 带中间字节、问号参数；OSC 两种收尾（BEL / ST）；双字节转义。
  assert.strictEqual(stripText("\u001b[?25l\u001b[1;2H光标"), "光标");
  assert.strictEqual(stripText("\u001b]0;标题\u0007正文"), "正文");
  assert.strictEqual(stripText("\u001b]8;;https://x\u001b\\链接"), "链接");
  assert.strictEqual(stripText("\u001b(B纯文本"), "纯文本");
}

function caseStripperWholeChunk() {
  const push = createStripper();
  assert.strictEqual(push("\u001b[31;1m缺少 MasterGo token\u001b[0m\n"), "缺少 MasterGo token\n");
}

/*
 * 管道按到达分片，色码会被切开：只按 chunk 正则剥的话，后半截 `[31;1m` 会当可见文字留下来 ——
 * 客户机上看到的就是这种残渣。切开的两半都必须吃掉，可见文字一个不丢、顺序不变。
 */
function caseStripperAcrossChunks() {
  const push = createStripper();
  let out = "";
  out += push("     | \u001b");
  out += push("[31;1m缺少 token");
  out += push("\u001b[");
  out += push("0m");
  assert.strictEqual(out, "     | 缺少 token");

  // 尾巴攥住的那一小段不许漏出来（它是控制序列的一半，不是正文）。
  const split = createStripper();
  assert.strictEqual(split("甲\u001b[31"), "甲");
  assert.strictEqual(split(";1m\u001b[0m乙"), "乙");
}

// OSC（窗口标题那类）没收尾就当场吃掉的话，下一个 chunk 开头的 BEL 会当可见字符漏出来。
function caseStripperOscAcrossChunks() {
  const push = createStripper();
  assert.strictEqual(push("前\u001b]0;标题"), "前");
  assert.strictEqual(push("\u0007后"), "后");
  const st = createStripper();
  assert.strictEqual(st("前\u001b]0;标题\u001b"), "前");
  assert.strictEqual(st("\\后"), "后");
}

function caseChildOutputDetail() {
  assert.strictEqual(childOutputDetail({ stderr: "\u001b[31m炸了\u001b[0m\n" }, 100), "炸了");
  // stderr 只剩色码时落到 stdout，别把空串当原因。
  assert.strictEqual(childOutputDetail({ stderr: "\u001b[0m", stdout: " 出参 " }, 100), "出参");
  // stderr 只剩空白（一个换行）也一样：不能把 stdout 那句真话挡掉。
  assert.strictEqual(childOutputDetail({ stderr: "\n", stdout: "真话" }, 100), "真话");
  assert.strictEqual(childOutputDetail({ error: new Error("ENOENT") }, 100), "Error: ENOENT");
  assert.strictEqual(childOutputDetail(null, 100), "");
  // 超长时留下的永远是末尾：子进程的报错写在输出的最后。
  assert.strictEqual(childOutputDetail({ stdout: "0123456789" }, 4), "6789");
}

const cases = [
  ["一次剥掉完整控制序列", caseStripText],
  ["整块到达", caseStripperWholeChunk],
  ["跨 chunk 切开", caseStripperAcrossChunks],
  ["跨 chunk 的 OSC", caseStripperOscAcrossChunks],
  ["失败片段", caseChildOutputDetail]
];

for (const [name, run] of cases) {
  run();
  console.log("  ok  " + name);
}
console.log("ansi.test.js 全部通过");
