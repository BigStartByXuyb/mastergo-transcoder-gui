#!/usr/bin/env node
"use strict";

// 下载层：重试、4xx 不重试、重试耗尽、JSON 解析失败。
// 跑法：node tests/download.test.js

const assert = require("assert");

const { fetchBuffer, fetchJson } = require("../lib/download.js");

function ok(text) {
  const buffer = Buffer.from(text, "utf8");
  return {
    ok: true,
    status: 200,
    arrayBuffer: async function () {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  };
}

function status(code) {
  return { ok: false, status: code };
}

async function main() {
  const oneShot = await fetchBuffer("https://x/y", { fetchImpl: async function () { return ok("hi"); }, backoffMs: 1 });
  assert.strictEqual(oneShot.toString("utf8"), "hi");

  // 前两次断线、第三次成功：默认三次尝试内要自己缓过来。
  let calls = 0;
  const flaky = await fetchBuffer("https://x/y", {
    fetchImpl: async function () {
      calls += 1;
      if (calls < 3) throw new Error("ECONNRESET");
      return ok("recovered");
    },
    backoffMs: 1
  });
  assert.strictEqual(flaky.toString("utf8"), "recovered");
  assert.strictEqual(calls, 3);

  // 404 是永久的：只请求一次，错误码原样带给用户。
  let four = 0;
  await assert.rejects(
    fetchBuffer("https://x/missing", {
      fetchImpl: async function () { four += 1; return status(404); },
      backoffMs: 1
    }),
    function (error) {
      assert.strictEqual(error.code, "HTTP_404");
      return true;
    }
  );
  assert.strictEqual(four, 1, "4xx 不重试");

  // 一直断线：尝试次数用满之后报 DOWNLOAD_FAILED，并带上最后一次的原文。
  let attempts = 0;
  await assert.rejects(
    fetchBuffer("https://x/y", {
      fetchImpl: async function () { attempts += 1; throw new Error("socket hang up"); },
      attempts: 2,
      backoffMs: 1
    }),
    function (error) {
      assert.strictEqual(error.code, "DOWNLOAD_FAILED");
      assert.match(error.hint, /socket hang up/);
      return true;
    }
  );
  assert.strictEqual(attempts, 2);

  const parsed = await fetchJson("https://x/m.json", { fetchImpl: async function () { return ok("{\"a\":1}"); }, backoffMs: 1 });
  assert.deepStrictEqual(parsed, { a: 1 });

  await assert.rejects(
    fetchJson("https://x/m.json", { fetchImpl: async function () { return ok("<html>"); }, backoffMs: 1 }),
    function (error) {
      assert.strictEqual(error.code, "BAD_JSON");
      return true;
    }
  );

  process.stdout.write("download ok\n");
}

main();
