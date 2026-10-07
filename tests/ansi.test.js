"use strict";

// 子进程输出里的终端色码：一处剥干净，流式也要扛得住色码被切在两个 chunk 之间。
// 跑法：node tests/ansi.test.js

const assert = require("assert");

const {
  stripText, createStripper, childOutputDetail, isDecorationLine, isUnderlineLine, DETAIL_LIMITS
} = require("../lib/ansi.js");

/*
 * 两条正则（完整序列 / 没写完的前缀）必须覆盖同一套控制序列：只改一处就会让流式那条漏出残渣。
 * 这里的判据是「按任意位置切开都一样」—— 每个前缀都得被攥住，拼回去一个字都不留。
 */
const SEQUENCES = [
  "\u001b[0m",
  "\u001b[31;1m",
  "\u001b[?25l",
  "\u001b[1;2H",
  "\u001b]0;标题\u0007",
  "\u001b]8;;https://x\u001b\\",
  "\u001b(B",
  "\u001bc"
];

function casePatternsCoverSameSequences() {
  for (const seq of SEQUENCES) {
    assert.strictEqual(stripText(seq), "", "整条要剥干净：" + JSON.stringify(seq));
    for (let cut = 1; cut < seq.length; cut += 1) {
      const push = createStripper();
      const out = push(seq.slice(0, cut)) + push(seq.slice(cut));
      assert.strictEqual(out, "", "在 " + cut + " 处切开也不许留残渣：" + JSON.stringify(seq));
    }
    // 序列后面跟着正文时，正文一个都不能少。
    const push = createStripper();
    assert.strictEqual(push(seq) + push("正文"), "正文");
  }
}

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
  // 掐长度留末尾（原因在后半段），整段不超过限制就原样。
  assert.strictEqual(childOutputDetail({ stdout: "0123456789" }, 4), "6789");
}

// 装饰行判据只有一处：流水线取因与这里的掐长度共用它（两种下划线形态都要认）。
function caseDecorationLines() {
  for (const line of ["Line |", "     |      ~~~~", "~~~~", " 286 |      throw \"x\"", "At line:1 char:1",
    "+ CategoryInfo          : OperationStopped", "FullyQualifiedErrorId : RuntimeException",
    "CategoryInfo          : OperationStopped: (:) [], RuntimeException",
    "FullyQualifiedErrorId : RuntimeException",
    "    at Module.load (node:internal/x.js:1:1)", "Node.js v24.14.0", "        ^"]) {
    assert.ok(isDecorationLine(line), "要认得出来：" + JSON.stringify(line));
  }
  for (const line of ["缺少 MasterGo token：设置环境变量", "     | 这才是原因", "过程日志 12", ""]) {
    assert.ok(!isDecorationLine(line), "别把正文当装饰行：" + JSON.stringify(line));
  }
  assert.ok(!isDecorationLine(null), "空值不是装饰行");
  // 分隔线：两种形态都认（取因那边靠它定位），正文不算。
  assert.ok(isUnderlineLine("     |      ~~~~") && isUnderlineLine("~~~~"), "两种下划线都算");
  assert.ok(!isUnderlineLine("     | 这才是原因") && !isUnderlineLine("~ 混着文字"), "正文不算分隔线");
  /*
   * 头行是装饰行（取因不能报它），但不是框线：摘录要留着它 ——
   * 管道里「Exception: 缺少 MasterGo token…MASTERGO_MCP_TOKEN…」整行就是原因。
   * 摘录的口径只经 childOutputDetail 断言（isFrameLine 不外露）。
   */
  assert.ok(isDecorationLine("Exception: D:\\plugin\\run-all.ps1:286"), "取因时不算原因");
  assert.strictEqual(
    childOutputDetail({ stderr: "Exception: 缺少 MasterGo token" }, 100),
    "Exception: 缺少 MasterGo token",
    "摘录时头行留着"
  );
  const longBox = [
    Array.from({ length: 60 }, (_, i) => "过程日志 " + i + " ：" + "x".repeat(30)).join("\n"),
    "Exception: 缺少 MasterGo token：设置环境变量 MASTERGO_MCP_TOKEN，或用 -ConfigPath / CODEX_CONFIG"
  ].join("\n");
  const kept = childOutputDetail({ stderr: longBox }, 200);
  assert.ok(kept.includes("MASTERGO_MCP_TOKEN"), "超长时也要留住带标记的那行：" + JSON.stringify(kept));
  // 长度档位只有一份：三档都在 lib/ansi.js 里。
  assert.deepStrictEqual(Object.keys(DETAIL_LIMITS).sort(), ["hint", "layout", "step"]);
}

/*
 * 超长时先丢装饰行再留末尾：两个格式的原因都不在末尾那一头。
 * 实测过：3.6KB 的 Node 输出直接截尾只剩 `at …` 栈帧和版本行，真正那句 `Error: …` 被挤掉。
 */
function caseLongOutputKeepsTheReason() {
  const noise = Array.from({ length: 40 }, (_, i) => "过程日志 " + i + " ：" + "x".repeat(30)).join("\n");
  const nodeLike = [
    noise,
    "D:\\plugin\\scripts\\core\\call-mastergo-mcp.js:12",
    "        throw new Error(\"取数失败\")",
    "        ^",
    "Error: 这条路才是真正的原因：读不到插件文件",
    "    at Module._compile (node:internal/modules/cjs/loader:1943:10)",
    "    at Module.load (node:internal/modules/cjs/loader:1533:32)",
    "Node.js v24.14.0"
  ].join("\n");
  const nodeDetail = childOutputDetail({ stderr: nodeLike }, 200);
  assert.ok(nodeDetail.includes("这条路才是真正的原因"), "Node 输出的原因要留住：" + JSON.stringify(nodeDetail));
  assert.ok(nodeDetail.indexOf("at Module") < 0, "栈帧是装饰行，丢掉");
  assert.ok(nodeDetail.indexOf("Node.js v") < 0, "版本行也是装饰行");

  const pwshLike = [
    noise,
    "Exception: D:\\plugin\\run-all.ps1:286",
    "Line |",
    " 286 |      throw \"缺少 MasterGo token\"",
    "     |      ~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    "     | 缺少 MasterGo token：设置环境变量 MASTERGO_MCP_TOKEN",
    "+ CategoryInfo          : OperationStopped: (:) [], RuntimeException",
    "+ FullyQualifiedErrorId : RuntimeException"
  ].join("\n");
  const pwshDetail = childOutputDetail({ stderr: pwshLike }, 200);
  assert.ok(pwshDetail.includes("MASTERGO_MCP_TOKEN"), "pwsh 错误框的原因要留住：" + JSON.stringify(pwshDetail));
  assert.ok(pwshDetail.indexOf("CategoryInfo") < 0, "框线丢掉");
  assert.ok(pwshDetail.indexOf("~~~~") < 0, "竖线开头的那种下划线也要丢掉");

  // 整段都是装饰行时不能给一个空提示。
  const onlyFrames = Array.from({ length: 60 }, () => "    at Module.load (node:internal/x.js:1:1)").join("\n");
  assert.ok(childOutputDetail({ stderr: onlyFrames }, 60).length > 0, "丢完没内容就回退原文");
}

const cases = [
  ["一次剥掉完整控制序列", caseStripText],
  ["整块到达", caseStripperWholeChunk],
  ["跨 chunk 切开", caseStripperAcrossChunks],
  ["跨 chunk 的 OSC", caseStripperOscAcrossChunks],
  ["两条正则覆盖同一套序列", casePatternsCoverSameSequences],
  ["失败片段", caseChildOutputDetail],
  ["装饰行判据", caseDecorationLines],
  ["超长输出留住原因", caseLongOutputKeepsTheReason]
];

for (const [name, run] of cases) {
  run();
  console.log("  ok  " + name);
}
console.log("ansi.test.js 全部通过");
