#!/usr/bin/env node
"use strict";

// 对话附件：安全落盘、子目录保住、重名不覆盖、只认自己落下的路径。
// 跑法：node tests/uploads.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createUploads, kindOf, safeRelative } = require("../lib/uploads.js");

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gui-upload-"));
}

function caseRelative() {
  assert.strictEqual(safeRelative("a/b.txt"), "a/b.txt");
  assert.strictEqual(safeRelative("D:\\shot\\p 1.png"), "shot/p 1.png", "去掉盘符，正斜杠归一");
  assert.strictEqual(safeRelative("/x/y.txt"), "x/y.txt");
  assert.strictEqual(safeRelative("a//b/./c.txt"), "a/b/c.txt");
  assert.strictEqual(safeRelative("bad:name?.txt"), "bad_name_.txt", "Windows 不吃这些字符");
  assert.throws(() => safeRelative("../../secret.txt"), /路径不合法/);
  assert.throws(() => safeRelative(""), /没有名字/);
}

function caseKind() {
  assert.strictEqual(kindOf("a.png"), "image");
  assert.strictEqual(kindOf("A.JPEG"), "image");
  assert.strictEqual(kindOf("a.txt"), "file");
  assert.strictEqual(kindOf("noext"), "file");
}

function caseSave() {
  const home = tempHome();
  const uploads = createUploads(home);
  const saved = uploads.saveBatch([
    { name: "shot.png", base64: Buffer.from("PNG").toString("base64") },
    { name: "a.txt", relativePath: "src/deep/a.txt", base64: Buffer.from("hello").toString("base64") },
    { name: "a.txt", relativePath: "src/deep/a.txt", base64: Buffer.from("again").toString("base64") }
  ]);
  assert.strictEqual(saved.length, 3);
  assert.strictEqual(saved[0].kind, "image");
  assert.strictEqual(saved[1].kind, "file");
  assert.strictEqual(saved[1].name, "a.txt");
  assert.ok(saved[1].path.includes(path.join("src", "deep")), "选文件夹带的子目录要保住");
  assert.strictEqual(fs.readFileSync(saved[1].path, "utf8"), "hello");
  assert.notStrictEqual(saved[1].path, saved[2].path, "同一批重名不许互相覆盖");
  assert.strictEqual(fs.readFileSync(saved[1].path, "utf8"), "hello", "后一个不许改到前一个");
  assert.strictEqual(fs.readFileSync(saved[2].path, "utf8"), "again");
  fs.rmSync(home, { recursive: true, force: true });
}

function caseBelongs() {
  const home = tempHome();
  const uploads = createUploads(home);
  const saved = uploads.saveBatch([{ name: "a.txt", base64: Buffer.from("x").toString("base64") }]);
  assert.strictEqual(uploads.belongs(saved[0].path), true);
  assert.strictEqual(uploads.belongs(path.join(home, "local.json")), false, "别处的一律不认");
  assert.strictEqual(uploads.belongs(path.join(home, "chats", "uploads")), true);
  assert.strictEqual(uploads.belongs(path.join(home, "chats", "uploads-other", "a.txt")), false, "前缀相同但不是它");
  assert.strictEqual(uploads.belongs(""), false);
  fs.rmSync(home, { recursive: true, force: true });
}

function caseLimits() {
  const home = tempHome();
  const uploads = createUploads(home);
  assert.throws(() => uploads.saveBatch([]), /没有要上传的文件/);
  assert.throws(() => uploads.saveBatch([{ name: "empty.txt", base64: "" }]), /文件是空的/);
  assert.throws(
    () => uploads.saveBatch([{ name: "big.bin", base64: Buffer.alloc(26 * 1024 * 1024).toString("base64") }]),
    /超过 25 MB/
  );
  fs.rmSync(home, { recursive: true, force: true });
}

try {
  const cases = [
    ["相对路径", caseRelative],
    ["类型判定", caseKind],
    ["落盘与重名", caseSave],
    ["只认自己的目录", caseBelongs],
    ["大小限制", caseLimits]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("uploads.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
