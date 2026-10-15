#!/usr/bin/env node
"use strict";

// 进入步骤之前就失败时的取因：pwsh 错误框不能当成原因，真正的那句要留下来。
// 跑法：node tests/run-failure.test.js

const assert = require("assert");

const { failureMessageFromTail } = require("../lib/run.js");

// 实测形状（插件 1.0.367 在缺 -Ui/-Target 时抛的那次）。
const preflight = [
  "Exception: D:\\plugin\\scripts\\entry\\run-all.ps1:449",
  "Line |",
  " 449 |      throw \"缺少区域前缀：命令行 -Ui、项目登记表 pages[].ui / derivation、Target（）都取不到。\"",
  "     |      ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
  "     | 缺少区域前缀：命令行 -Ui、项目登记表 pages[].ui / derivation、Target（）都取不到。它会写进快照 ui 字段并决定 UI/<区域>/View 输出目录，必须显式给出。",
  ""
];

assert.strictEqual(
  failureMessageFromTail(preflight),
  "缺少区域前缀：命令行 -Ui、项目登记表 pages[].ui / derivation、Target（）都取不到。它会写进快照 ui 字段并决定 UI/<区域>/View 输出目录，必须显式给出。",
  "预检失败必须取到真正的原因，而不是错误框第一行"
);

// 普通失败：最后一行就是原因。
assert.strictEqual(failureMessageFromTail(["step 3 started", "找不到图标台账"]), "找不到图标台账");

/*
 * 折行的错误框（实测：插件 1.0.369 的身份混搭守卫）。
 * 原因横跨三行，只取最后一行会剩下「designSource。」—— 界面上就成了一个看不懂的尾巴。
 */
const wrapped = [
  "Exception: D:\\plugin\\scripts\\entry\\run-all.ps1:430",
  "Line |",
  " 430 |          throw \"命令行同时给了 -Target '$cliTarget' 与 -LayerId '$cliLayerId'， …",
  "     |          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
  "     | 命令行同时给了 -Target 'F7MarkingLineFocusAdjust' 与 -LayerId '357:290731'，但项目登记表里两者不属于同一页（-Target",
  "     | 'F7MarkingLineFocusAdjust' 对应 layerId '357:290731'）：请确认要转换的页面——只给 -Target（让登记表补 layerId），或先按登记表登记本次页面的",
  "     | designSource。",
  ""
];
assert.strictEqual(
  failureMessageFromTail(wrapped),
  "命令行同时给了 -Target 'F7MarkingLineFocusAdjust' 与 -LayerId '357:290731'，但项目登记表里两者不属于同一页（-Target'F7MarkingLineFocusAdjust' 对应 layerId '357:290731'）：请确认要转换的页面——只给 -Target（让登记表补 layerId），或先按登记表登记本次页面的designSource。",
  "折行的原因要拼回一句，不能只留最后一行"
);

// 全是框线时给空串，由调用方兜底成「在进入步骤之前退出」。
assert.strictEqual(failureMessageFromTail(["Line |", "     |      ~~~", " 449 |  throw 'x'"]), "");
assert.strictEqual(failureMessageFromTail([]), "");
assert.strictEqual(failureMessageFromTail(null), "");

console.log("  ok  预检失败取因");
console.log("  ok  折行的原因拼回一句");
console.log("  ok  普通失败与兜底");
console.log("run-failure.test.js 全部通过");
