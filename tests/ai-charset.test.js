#!/usr/bin/env node
"use strict";

// 模型那一层交给 SDK 之前的响应解码：按响应自己声明的字符集解成 UTF-8，别的原样透传。
// 跑法：node tests/ai-charset.test.js

const assert = require("assert");

const { fetchDecodedCharset } = require("../lib/ai.js");

function gbkResponse(body, contentType) {
  // 这几个字节是 GBK 的「模型」/「无效」，用来确认走的不是 UTF-8 解码。
  const bytes = Buffer.from(body, "latin1");
  return new Response(bytes, { status: 401, statusText: "Unauthorized", headers: { "content-type": contentType } });
}

async function main() {
  const original = global.fetch;
  try {
    // 声明 GBK 的错误体：解出来的中文要能直接读，不再是一个个替换字符。
    global.fetch = async () => gbkResponse("\u00c4\u00a3\u00d0\u00cd\u00ce\u00de\u00d0\u00a7", "application/json; charset=gbk");
    const decoded = await fetchDecodedCharset("https://example.com/v1/chat/completions", {});
    assert.strictEqual(decoded.status, 401, "状态码要原样带过来");
    assert.strictEqual((await decoded.text()).includes("模型"), true, "GBK 正文要解成中文");
    assert.match(decoded.headers.get("content-type"), /charset=utf-8/i, "解完要声明成 UTF-8");

    // 声明 UTF-8（或压根不声明）的响应原样返回：一个对象都不换，别给正常路径添负担。
    const plain = new Response("{\"error\":\"正常\"}", { status: 200, headers: { "content-type": "application/json" } });
    global.fetch = async () => plain;
    assert.strictEqual(await fetchDecodedCharset("https://example.com", {}), plain, "UTF-8 / 无声明：原样透传");

    const utf8 = new Response("{\"error\":\"正常\"}", { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    global.fetch = async () => utf8;
    assert.strictEqual(await fetchDecodedCharset("https://example.com", {}), utf8, "声明 UTF-8：原样透传");

    // 认不出的字符集：按 UTF-8 显示，不当场抛错（宁可显示得难看，也别让报错变成另一个报错）。
    global.fetch = async () => new Response("plain text", { status: 500, headers: { "content-type": "text/plain; charset=x-unknown-9" } });
    const unknown = await fetchDecodedCharset("https://example.com", {});
    assert.strictEqual(await unknown.text(), "plain text");
    assert.strictEqual(unknown.status, 500);
  }
  finally {
    global.fetch = original;
  }

  console.log("ai-charset.test.js 全部通过");
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
