#!/usr/bin/env node
"use strict";

// 内容寻址落盘层：按哈希存、缺什么下什么、拼版本、校验不过就重拼、指针原子替换。
// 跑法：node tests/bundle-store.test.js

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBundleStore, POINTER_NAME } = require("../lib/bundle-store.js");

function sha(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function manifestOf(version, files) {
  const out = {};
  for (const rel of Object.keys(files)) out[rel] = sha(files[rel]);
  return { version: version, files: out };
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-bundle-"));
  const store = createBundleStore(home);
  const contents = {
    "server.js": "server 0.2.0",
    "lib/a.js": "a",
    "lib/b.js": "b",
    "public/index.html": "a"
  };
  const manifest = manifestOf("0.2.0", contents);

  // 存进去的内容按哈希校验：对不上直接拒，不让坏字节冒充好字节。
  assert.strictEqual(store.putBlob(sha("a"), Buffer.from("a")), true, "第一次写入");
  assert.strictEqual(store.putBlob(sha("a"), Buffer.from("a")), false, "同一份内容不重复写");
  assert.throws(function () { store.putBlob(sha("a"), Buffer.from("b")); }, /与清单不符/);
  assert.strictEqual(store.readBlob(sha("a")).toString("utf8"), "a");

  // 同一份内容被两个路径引用时只算一次，且带上第一处出现的路径（public/index.html 与 lib/a.js 同内容）。
  const fresh = createBundleStore(path.join(home, "fresh"));
  assert.deepStrictEqual(
    fresh.missingBlobs(manifest).map(function (item) { return item.rel; }),
    ["lib/a.js", "lib/b.js", "server.js"],
    "重复内容只算一份，rel 取字典序里第一处"
  );

  const missing = store.missingBlobs(manifest);
  assert.deepStrictEqual(
    missing.map(function (item) { return item.rel; }),
    ["lib/b.js", "server.js"],
    "已经存在的内容不再下"
  );

  const progress = [];
  const fetched = [];
  const result = await store.downloadMissing(
    manifest,
    async function (hash, rel) {
      fetched.push(rel);
      return Buffer.from(contents[rel], "utf8");
    },
    function (item) { progress.push(item.done + "/" + item.total); }
  );
  assert.strictEqual(result.total, 2, "缺两份内容");
  assert.strictEqual(result.downloaded, 2);
  assert.strictEqual(fetched.length, 2);
  assert.deepStrictEqual(progress, ["1/2", "2/2"]);
  assert.strictEqual(store.missingBlobs(manifest).length, 0, "下完就什么都不缺了");

  const built = await store.materialize(manifest, async function () {
    throw new Error("不该再下东西");
  });
  assert.strictEqual(built.reused, false);
  assert.strictEqual(built.downloaded, 0, "内容都在 blobs 里，只做本地拼装");
  assert.strictEqual(fs.readFileSync(path.join(built.dir, "lib", "a.js"), "utf8"), "a");
  assert.deepStrictEqual(store.verifyDir(built.dir, manifest), []);

  const again = await store.materialize(manifest, async function () { throw new Error("不该再下东西"); });
  assert.strictEqual(again.reused, true, "已经拼好且校验通过就直接复用");

  // 版本目录被改坏：校验能看出来，重拼会覆盖成正确内容。
  fs.writeFileSync(path.join(built.dir, "lib", "b.js"), "被人改过", "utf8");
  assert.deepStrictEqual(store.verifyDir(built.dir, manifest), ["lib/b.js"]);
  const rebuilt = await store.materialize(manifest, async function () { throw new Error("不该再下东西"); });
  assert.strictEqual(rebuilt.reused, false);
  assert.deepStrictEqual(store.verifyDir(rebuilt.dir, manifest), []);

  // 半成品目录不冒充成品：.building-* 不算版本。
  fs.mkdirSync(path.join(store.versionsDir, ".building-0.9.0-1"), { recursive: true });
  assert.deepStrictEqual(store.listVersions(), ["0.2.0"]);

  assert.strictEqual(store.readPointer(), null, "还没有指针");
  store.writePointer({ version: "0.2.0", previous: "0.1.0" });
  assert.deepStrictEqual(store.readPointer(), { version: "0.2.0", previous: "0.1.0" });
  assert.strictEqual(fs.existsSync(path.join(home, POINTER_NAME)), true);
  fs.writeFileSync(store.pointerPath, "不是 json", "utf8");
  assert.strictEqual(store.readPointer(), null, "指针读坏了当没有，别让界面炸");

  const verifier = createBundleStore(path.join(home, "second"));
  assert.deepStrictEqual(verifier.listVersions(), [], "还没下载过就是空");

  /*
   * 第二条内容库（插件那一半）：三段目录名可以换，且可以没有版本指针。
   * 版本目录直接落在自己的根下 —— 插件定位就是按「同名目录下的版本子目录」认的。
   */
  const nested = createBundleStore(path.join(home, "plugins", "mastergo-wpf-transcoder"), {
    blobsDir: "blobs",
    versionsDir: "",
    pointerName: ""
  });
  const placed = await nested.materialize(manifest, async function (hash, rel) {
    return Buffer.from(contents[rel], "utf8");
  });
  assert.strictEqual(placed.dir, path.join(home, "plugins", "mastergo-wpf-transcoder", "0.2.0"), "版本目录就在这一层");
  assert.strictEqual(fs.existsSync(path.join(home, "plugins", "mastergo-wpf-transcoder", "blobs", manifest.files["lib/a.js"])), true);
  assert.strictEqual(nested.readPointer(), null, "没有指针这一说");
  assert.throws(function () { nested.writePointer({ version: "0.2.0" }); }, /没有版本指针/);

  fs.rmSync(home, { recursive: true, force: true });
  process.stdout.write("bundle-store ok\n");
}

main();
