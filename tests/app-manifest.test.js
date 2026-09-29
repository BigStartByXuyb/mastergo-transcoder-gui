#!/usr/bin/env node
"use strict";

// 运行树清单：只认运行期文件、逐文件哈希、差分、越界路径拒绝。
// 跑法：node tests/app-manifest.test.js

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { listRuntimeFiles, buildManifest, diffManifests, safeJoin, sha256File, toPosix } = require("../lib/app-manifest.js");

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-manifest-"));
  for (const rel of Object.keys(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, files[rel], "utf8");
  }
  return root;
}

function sha(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

const root = makeTree({
  "server.js": "server",
  "launch.js": "launch",
  "package.json": "{}",
  "start.cmd": "cmd",
  "lib/a.js": "a",
  "lib/deep/b.js": "b",
  "public/index.html": "html",
  "ui/src/App.tsx": "前端源码不进运行树",
  "tests/foo.test.js": "测试不进运行树",
  "docs/ui-verification.md": "文档不进运行树",
  "node_modules/openai/index.js": "依赖不进运行树",
  "scripts/publish.js": "发布工具不进运行树",
  "local.json": "用户状态不进运行树"
});

const listed = listRuntimeFiles(root);
assert.deepStrictEqual(
  listed,
  [
    "launch.js",
    "lib/a.js",
    "lib/deep/b.js",
    "package.json",
    "public/index.html",
    "server.js",
    "start.cmd"
  ],
  "只有运行期文件进清单，且按路径排序"
);

const manifest = buildManifest(root, "0.2.0");
assert.strictEqual(manifest.version, "0.2.0");
assert.strictEqual(manifest.files["lib/a.js"], sha("a"), "哈希按文件内容算");
assert.strictEqual(sha256File(path.join(root, "lib", "deep", "b.js")), sha("b"));
assert.strictEqual(manifest.files["lib/deep/b.js"].length, 64);

// 差分：改一个、本地少一个远端多的（changed）、远端已经删掉的（removed）。
const remote = makeTree({ "lib/a.js": "a2", "lib/c.js": "c", "server.js": "server" });
const remoteManifest = buildManifest(remote, "0.3.0");
const diff = diffManifests(manifest, remoteManifest);
assert.deepStrictEqual(diff.changed.sort(), ["lib/a.js", "lib/c.js"], "内容不同与本地没有的都算要下");
assert.deepStrictEqual(diff.removed, [
  "launch.js",
  "lib/deep/b.js",
  "package.json",
  "public/index.html",
  "start.cmd"
].sort(), "远端没有的本地文件算要删的");
assert.strictEqual(diff.total, 3, "total 是远端文件数");

assert.deepStrictEqual(diffManifests(null, null), { changed: [], removed: [], total: 0 }, "空清单不炸");

// 路径越界一律拒绝：清单是远端给的，不能让它指到运行目录外面去。
assert.strictEqual(safeJoin(root, "lib/a.js"), path.join(root, "lib", "a.js"));
assert.throws(function () { safeJoin(root, "../outside.js"); }, /运行目录外/);
assert.throws(function () { safeJoin(root, path.join("lib", "..", "..", "x.js")); }, /运行目录外/);
assert.strictEqual(toPosix("a/b"), "a/b");

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(remote, { recursive: true, force: true });
process.stdout.write("app-manifest ok\n");
