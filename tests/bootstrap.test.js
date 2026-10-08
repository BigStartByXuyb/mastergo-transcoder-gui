#!/usr/bin/env node
"use strict";

// 安装根那份「壳」的对齐：生效那一份是 versions/<版本>/ 时，把它的壳铺回安装根；
// 一样的不动、不同一个安装根下 versions/<版本>/ 的副本不碰、整组要么都成要么都不动。
// 跑法：node tests/bootstrap.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { SUPERVISOR_FILES, COMPAT_FILES, syncSupervisor } = require("../lib/bootstrap.js");

const ROOT = path.join(__dirname, "..");
const OLD_SHELL = { "launch.js": "// 旧壳（没有 childArgs）\n", "lib/launch.js": "// 旧的选版\n" };

function write(root, rel, text) {
  const file = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");
}

/* 安装根：老壳（还没有 lib/log.js）。 */
function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-bootstrap-"));
  for (const rel of Object.keys(OLD_SHELL)) write(home, rel, OLD_SHELL[rel]);
  return home;
}

function versionDir(home, version, files) {
  const dir = path.join(home, "versions", version);
  for (const rel of Object.keys(files)) write(dir, rel, files[rel]);
  return dir;
}

/* 生效那一份里的壳：三份都是新的。 */
const NEW_SHELL = {
  "launch.js": "// 新壳（带 childArgs）\n",
  "lib/launch.js": "// 新的选版\n",
  "lib/log.js": "// 新的日志\n"
};

/* 临时件与备份件都不该留在安装根上（名字按 lib/atomic-write.js 与 lib/bootstrap.js 的约定）。 */
function leftovers(home) {
  const out = [];
  const walk = function (dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "versions") walk(full);
        continue;
      }
      if (entry.name.endsWith(".tmp") || entry.name.endsWith(".old")) out.push(full);
    }
  };
  walk(home);
  return out;
}

// 一、三份都不一样（lib/log.js 是安装根原来没有的）→ 全铺过去；铺完不留临时件与备份件。
const home = sandbox();
const dir = versionDir(home, "9.9.9", NEW_SHELL);
const first = syncSupervisor({ home: home, from: dir });
assert.deepStrictEqual(
  first.updated,
  SUPERVISOR_FILES.concat(COMPAT_FILES),
  "壳自己的两份都铺过去，安装根原来没有的那份共享件也补上"
);
assert.deepStrictEqual(first.missing, []);
assert.strictEqual(first.failure, "");
for (const name of SUPERVISOR_FILES) assert.strictEqual(read(home, name), NEW_SHELL[name], "安装根的 " + name + " 变成生效那一版的");
assert.deepStrictEqual(leftovers(home), [], "铺完不留临时件与备份件");

// 二、内容一样 → 不动（别每次启动都重写一遍）。
const second = syncSupervisor({ home: home, from: dir });
assert.deepStrictEqual(second.updated, [], "一样就不动");
assert.deepStrictEqual(second.same, SUPERVISOR_FILES, "三份都算「本来就一样」");

/*
 * 二之二、共享件（lib/log.js）只补不缺：安装根**已经有**它时永远不动 ——
 * 那份是服务与「备用版本」在用的，换掉就成了跨版本混用。
 */
const shared = sandbox();
write(shared, "lib/log.js", OLD_SHELL["lib/launch.js"]);
const sharedDir = versionDir(shared, "9.9.9", NEW_SHELL);
const sharedResult = syncSupervisor({ home: shared, from: sharedDir });
assert.deepStrictEqual(sharedResult.updated, SUPERVISOR_FILES, "只换壳自己那两份");
assert.strictEqual(read(shared, "lib/log.js"), OLD_SHELL["lib/launch.js"], "安装根已有的 log.js 不动");

// 三、生效那一份里没有壳（很老的版本目录）：跳过，不算失败，也不动安装根。
const bare = versionDir(home, "0.1.0", { "server.js": "// 老的版本，没有壳\n" });
const third = syncSupervisor({ home: home, from: bare });
assert.deepStrictEqual(third.missing, SUPERVISOR_FILES, "源里没有就跳过");
assert.strictEqual(third.failure, "");
assert.strictEqual(read(home, "launch.js"), NEW_SHELL["launch.js"], "跳过时不动安装根那份");

// 四、生效那份就是安装根自己（没有指针）：同一个目录，没什么可对齐的。
assert.deepStrictEqual(syncSupervisor({ home: home, from: home }).updated, [], "没有指针时不动");

// 五、不在 versions/<版本>/ 下的目录（别处的副本、安装根里的别的子目录）：一律不碰。
const other = fs.mkdtempSync(path.join(os.tmpdir(), "gui-bootstrap-other-"));
write(other, "launch.js", "// 别处的壳\n");
assert.deepStrictEqual(syncSupervisor({ home: home, from: other }).updated, [], "别处的副本不铺");
write(home, "public/blobs/launch.js", "// 安装根里别的子目录\n");
assert.deepStrictEqual(
  syncSupervisor({ home: home, from: path.join(home, "public", "blobs") }).updated,
  [],
  "安装根里别的子目录也不当壳的来源"
);
assert.strictEqual(read(home, "launch.js"), NEW_SHELL["launch.js"], "安装根那份没被动过");

// 六、临时件写不出来（安装根里 lib 是个文件）：安装根一点没动，报出是哪一份。
const blocked = sandbox();
const blockedDir = versionDir(blocked, "9.9.9", NEW_SHELL);
fs.rmSync(path.join(blocked, "lib"), { recursive: true, force: true });
fs.writeFileSync(path.join(blocked, "lib"), "// lib 的位置被一个文件占了\n", "utf8");
const blockedResult = syncSupervisor({ home: blocked, from: blockedDir });
assert.match(blockedResult.failure, /lib\/launch\.js/, "写不出临时件要说清是哪一份");
assert.deepStrictEqual(blockedResult.updated, [], "一点没动");
assert.strictEqual(read(blocked, "launch.js"), OLD_SHELL["launch.js"], "launch.js 没被换掉");
assert.deepStrictEqual(leftovers(blocked), [], "临时件清掉了");

/*
 * 七、落位中途失败（第二份的备份位置被一个非空目录占着，改名过不去）：
 * 已经换过的第一份要按备份还原 —— 不能留「新 launch.js + 旧 lib/launch.js」的混版。
 */
const midway = sandbox();
const midwayDir = versionDir(midway, "9.9.9", NEW_SHELL);
fs.mkdirSync(path.join(midway, "lib", "launch.js.old"));
fs.writeFileSync(path.join(midway, "lib", "launch.js.old", "占位"), "x", "utf8");
const midwayResult = syncSupervisor({ home: midway, from: midwayDir });
assert.match(midwayResult.failure, /lib\/launch\.js/, "失败那一份要说出来");
assert.deepStrictEqual(midwayResult.updated, [], "整组没成，就不算铺过");
assert.strictEqual(read(midway, "launch.js"), OLD_SHELL["launch.js"], "先换掉的那份已还原");
assert.strictEqual(read(midway, "lib/launch.js"), OLD_SHELL["lib/launch.js"], "失败那份保持原样");

for (const dir of [home, shared, other, blocked, midway]) fs.rmSync(dir, { recursive: true, force: true });

/*
 * 清单要跟壳的实际依赖一致：把壳各份源码里的字面量相对 require 全找出来，每一份都必须在
 * SUPERVISOR_FILES 里 —— 将来壳多 require 一份，这里就红。
 * 覆盖范围：require("./x") 这种写法（单双引号都认）；require(variable) 这类动态拼法覆盖不到。
 */
function relativeRequires(rel) {
  const text = fs.readFileSync(path.join(ROOT, ...rel.split("/")), "utf8");
  const out = [];
  const pattern = new RegExp("require\\(\\s*['\"](\\./[^'\"]+)['\"]\\s*\\)", "g");
  let match = pattern.exec(text);
  while (match) {
    out.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), match[1])));
    match = pattern.exec(text);
  }
  return out;
}

for (const name of SUPERVISOR_FILES.concat(COMPAT_FILES)) {
  for (const required of relativeRequires(name)) {
    assert.ok(
      SUPERVISOR_FILES.concat(COMPAT_FILES).includes(required),
      name + " require 的 " + required + " 要在壳的清单里"
    );
  }
}
assert.ok(SUPERVISOR_FILES.includes("launch.js"), "壳从 launch.js 起算");

process.stdout.write("bootstrap ok\n");
