#!/usr/bin/env node
"use strict";

/*
 * 发布产物的暂存与上传（客户端与插件共用那一份）：
 *   - 文件按内容哈希落盘、同内容只留一份；清单写两份（根目录 + v<版本>/）；
 *   - 上传顺序是「全部文件 → 最后清单」，已存在 release 时只补资产，不存在时才创建。
 *
 * 跑法：node tests/release-assets.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { stageAssets, uploadRelease } = require("../scripts/lib/release-assets.js");

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mgtg-release-"));
  try {
    const root = path.join(base, "tree");
    fs.mkdirSync(path.join(root, "skills"), { recursive: true });
    fs.writeFileSync(path.join(root, "a.txt"), "一样的\n");
    fs.writeFileSync(path.join(root, "b.txt"), "一样的\n");
    fs.writeFileSync(path.join(root, "skills", "c.txt"), "不一样\n");
    const manifest = {
      version: "9.9.9",
      files: {
        "a.txt": sha256("一样的\n"),
        "b.txt": sha256("一样的\n"),
        "skills/c.txt": sha256("不一样\n")
      }
    };

    const outDir = path.join(base, "out");
    const staged = stageAssets({ root: root, manifest: manifest, outDir: outDir, manifestName: "plugin-manifest.json" });
    assert.strictEqual(staged.fileCount, 3, "清单里有三个文件");
    assert.strictEqual(staged.uniqueCount, 2, "同内容只留一份");
    assert.strictEqual(staged.blobPaths.length, 2);
    assert.ok(fs.existsSync(staged.manifestPath), "根目录要有清单");
    assert.ok(fs.existsSync(path.join(outDir, "v9.9.9", "plugin-manifest.json")), "历史版本目录也要有一份");
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(staged.manifestPath, "utf8")).files,
      manifest.files,
      "清单内容原样写出"
    );

    // 上传顺序：文件在前、清单最后；已存在 release 时不重复创建。
    const calls = [];
    uploadRelease({
      tag: "v9.9.9",
      blobPaths: staged.blobPaths,
      manifestPath: staged.manifestPath,
      notes: "这是说明",
      releaseExists: function () { return true; },
      run: function (command, args) { calls.push([command].concat(args)); }
    });
    assert.strictEqual(calls.length, 2, "已存在 release 时只有两次调用（传文件 + 传清单）");
    assert.deepStrictEqual(calls[0].slice(0, 4), ["gh", "release", "upload", "v9.9.9"]);
    assert.deepStrictEqual(calls[0].slice(4, 4 + staged.blobPaths.length), staged.blobPaths, "先传全部文件");
    assert.deepStrictEqual(calls[1], ["gh", "release", "upload", "v9.9.9", staged.manifestPath, "--clobber"], "清单最后传");

    const created = [];
    uploadRelease({
      tag: "v9.9.9",
      blobPaths: staged.blobPaths,
      manifestPath: staged.manifestPath,
      notes: "这是说明",
      releaseExists: function () { return false; },
      run: function (command, args) { created.push([command].concat(args)); }
    });
    assert.deepStrictEqual(created[0].slice(0, 6), ["gh", "release", "create", "v9.9.9", "--title", "v9.9.9"], "没有 release 时先创建");
    assert.ok(created[0].indexOf("--notes") > 0, "创建时带上说明");
    assert.deepStrictEqual(created[1], ["gh", "release", "upload", "v9.9.9", staged.manifestPath, "--clobber"], "创建之后仍然最后传清单");

    console.log("release-assets.test.js 全部通过");
  }
  finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
