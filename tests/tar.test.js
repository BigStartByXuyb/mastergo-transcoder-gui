#!/usr/bin/env node
"use strict";

// 可复现打包：同样的内容必须打出同样的字节，否则内容寻址的更新每次都要白下一遍这个包。
// 跑法：node tests/tar.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { packDir } = require("../lib/tar.js");

// 长路径要能装进 ustar（name 100 / prefix 155），这里超 100 字节，逼它走 prefix 拆分。
const DEEP = "a".repeat(70) + "/" + "b".repeat(70);

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-tar-"));
  const write = (rel, text) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, "utf8");
  };
  write("index.js", "index");
  write("lib/helper.js", "helper");
  write("lib/internal/secret.js", "内部实现，不该进包");
  write("src/index.ts", "源文件，不该进包");
  write(DEEP + "/deep.js", "deep");
  return root;
}

function main() {
  const root = makeTree();
  // 排除项按「相对 root 的路径」比：顶层 src 与嵌套的 lib/internal 都要整棵排掉。
  const options = { prefix: "openai", exclude: ["src", "lib/internal"] };
  const first = packDir(root, options);
  const second = packDir(root, options);

  assert.ok(first.equals(second), "同样的内容两次打包必须一模一样");
  assert.deepStrictEqual(Array.from(first.subarray(4, 8)), [0, 0, 0, 0], "gzip 头里不写打包时间");
  assert.strictEqual(first[9], 3, "gzip 头的 OS 字节写死成 Unix：不然 Windows 与 Linux 打出来不一样");

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "gui-tar-out-"));
  const archive = path.join(out, "openai.tgz");
  fs.writeFileSync(archive, first);
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", out], { encoding: "utf8" });
  assert.strictEqual(extracted.status, 0, "系统 tar 要能解开：" + String(extracted.stderr || ""));

  const read = (rel) => fs.readFileSync(path.join(out, "openai", rel), "utf8");
  assert.strictEqual(read("index.js"), "index");
  assert.strictEqual(read("lib/helper.js"), "helper");
  assert.strictEqual(read(DEEP + "/deep.js"), "deep", "长路径要原样落回来");
  assert.strictEqual(fs.existsSync(path.join(out, "openai", "src")), false, "src 被排除");
  assert.strictEqual(fs.existsSync(path.join(out, "openai", "lib", "internal")), false, "嵌套路径被排除");

  for (const dir of [root, out]) fs.rmSync(dir, { recursive: true, force: true });
  console.log("tar.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
