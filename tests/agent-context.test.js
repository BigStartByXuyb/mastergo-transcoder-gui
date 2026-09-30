#!/usr/bin/env node
"use strict";

// 提问前那段背景：代码库清单 + 附加文件 + 用户系统提示词。
// 跑法：node tests/agent-context.test.js

const assert = require("assert");

const { buildContext, imagePaths, pickTemplate } = require("../lib/agent-context.js");

function casePickTemplate() {
  const list = [{ id: "t1" }, { id: "t2" }];
  assert.strictEqual(pickTemplate(list, "t2").id, "t2", "点名的那份");
  assert.strictEqual(pickTemplate(list, "nope").id, "t1", "名字对不上就落回第一份");
  assert.strictEqual(pickTemplate(list, "").id, "t1", "没点名也是第一份");
  assert.strictEqual(pickTemplate([], "t1"), null, "一份都没有就是空");
  assert.strictEqual(pickTemplate(null, "t1"), null, "传空也不炸");
}

function caseEmpty() {
  assert.strictEqual(buildContext({}), "", "什么都没有就是空串，调用方不用判断");
  assert.strictEqual(buildContext({ systemPrompt: "   " }), "", "只有空白也不算");
  assert.deepStrictEqual(imagePaths([]), []);
}

function caseCodebases() {
  const text = buildContext({
    codebases: [
      { path: "D:\\MTSSD\\MaxWell.SSDPages", name: "MTSLG 页面工程", note: "页面 XML 与 Layout 注册都在这" },
      { path: "D:\\legacy", name: "", note: "", enabled: false }
    ]
  });
  assert.match(text, /\[可参考的代码库\]/);
  assert.match(text, /- D:\\MTSSD\\MaxWell\.SSDPages（MTSLG 页面工程）：页面 XML 与 Layout 注册都在这/);
  assert.doesNotMatch(text, /legacy/, "停用的不进上下文");
  assert.match(text, /需要时去这些目录里读文件/, "要说清它能去读");
}

function caseAttachments() {
  const text = buildContext({
    attachments: [
      { path: "C:\\u\\a.png", kind: "image" },
      { path: "C:\\u\\spec.txt", kind: "file" }
    ]
  });
  assert.match(text, /\[用户这次附上的东西\]/);
  assert.match(text, /图片（已经作为附件给你，直接看）：\n- C:\\u\\a\.png/);
  assert.match(text, /文件（需要时去读）：\n- C:\\u\\spec\.txt/);
  assert.deepStrictEqual(imagePaths([
    { path: "C:\\u\\a.png", kind: "image" },
    { path: "C:\\u\\spec.txt", kind: "file" }
  ]), ["C:\\u\\a.png"], "只有图片进 -i");
}

function caseOrder() {
  const text = buildContext({
    systemPrompt: "回答只用中文。",
    codebases: [{ path: "D:\\a", name: "库 A" }],
    attachments: [{ path: "D:\\b.png", kind: "image" }]
  });
  assert.ok(text.indexOf("代码库") < text.indexOf("附上"), "先交代库，再说附件");
  assert.ok(text.indexOf("附上") < text.indexOf("系统提示词"), "系统提示词放最后");
  assert.match(text, /\[用户设定的系统提示词\]\n回答只用中文。/);
  assert.ok(text.endsWith("\n\n"), "末尾留空行，接用户那句才不粘在一起");
}

try {
  const cases = [
    ["选模板", casePickTemplate],
    ["空输入", caseEmpty],
    ["代码库清单", caseCodebases],
    ["附加文件", caseAttachments],
    ["拼装顺序", caseOrder]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("agent-context.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
