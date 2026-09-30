#!/usr/bin/env node
"use strict";

// 更新器：四态流转、差分只下变化的内容、切换与回退、有任务在跑时拒绝、外壳下限。
// 远端用假 fetch 顶替（GitHub Releases 的两种地址），全程不联网。
// 跑法：node tests/update.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildManifest } = require("../lib/app-manifest.js");
const { createUpdate, compareVersions } = require("../lib/update.js");

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-update-"));
  for (const rel of Object.keys(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, files[rel], "utf8");
  }
  return root;
}

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

// 假远端：清单一份，文件按 sha256 命名；发布前没传上去的哈希回 404。
function remote(root, version, extra) {
  const manifest = Object.assign(buildManifest(root, version), extra || {});
  const byHash = new Map();
  for (const rel of Object.keys(manifest.files)) {
    byHash.set(manifest.files[rel], fs.readFileSync(path.join(root, rel)));
  }
  const urls = [];
  return {
    manifest: manifest,
    urls: urls,
    fetchImpl: async function (url) {
      urls.push(url);
      // 每个 release 都带自己的 manifest.json：latest 那个是同一份内容。
      if (url.endsWith("/releases/latest/download/manifest.json") || url.endsWith("/releases/download/v" + version + "/manifest.json")) {
        return ok(JSON.stringify(manifest));
      }
      const hit = /\/releases\/download\/v([^/]+)\/([0-9a-f]{64})$/.exec(url);
      if (hit) {
        const buffer = byHash.get(hit[2]);
        if (buffer) return ok(buffer.toString("utf8"));
        return { ok: false, status: 404 };
      }
      return { ok: false, status: 500 };
    }
  };
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function settle(update) {
  for (let index = 0; index < 200; index += 1) {
    const phase = update.status().task.phase;
    if (phase !== "downloading" && phase !== "materializing") return update.status();
    await sleep(5);
  }
  throw new Error("下载没有收敛");
}

async function main() {
  assert.strictEqual(compareVersions("0.10.0", "0.9.0"), 1, "按数字段比，不是字符串比");
  assert.strictEqual(compareVersions("1.0", "1.0.0"), 0);
  assert.strictEqual(compareVersions("0.1.0", "0.2.0"), -1);
  assert.strictEqual(compareVersions("dev", "1.0.0") < 0 || compareVersions("dev", "1.0.0") > 0, true, "非数字段有兜底");

  const home = makeTree({
    "server.js": "server 0.1.0",
    "launch.js": "launch",
    "package.json": "{\"version\":\"0.1.0\"}",
    "lib/a.js": "a",
    "public/index.html": "html"
  });
  const next = makeTree({
    "server.js": "server 0.2.0 改过",
    "launch.js": "launch",
    "package.json": "{\"version\":\"0.2.0\"}",
    "lib/a.js": "a",
    "lib/b.js": "b 新增",
    "public/index.html": "html 改过"
  });

  let busy = "";
  const server = remote(next, "0.2.0");
  const update = createUpdate({ root: home, home: home, version: "0.1.0", fetchImpl: server.fetchImpl, isBusy: function () { return busy; } });

  const initial = update.status();
  assert.strictEqual(initial.state, "up_to_date", "没查过又没缓存就是最新");
  assert.deepStrictEqual(initial.staged.map(function (item) { return item.version; }), ["0.1.0"], "安装根自己这一份算本地的一份");
  assert.strictEqual(initial.rollback, "", "只有一份时没有可回退的");

  const checked = await update.check();
  assert.strictEqual(checked.state, "update_available");
  assert.strictEqual(checked.available.version, "0.2.0");
  assert.strictEqual(checked.available.changed, 4, "改过的 server/package/public 与新增的 lib/b.js");
  assert.strictEqual(checked.available.removed, 0);
  assert.strictEqual(checked.available.freshRunRequired, true, "默认要求新开一次运行");

  // 界面上那个全局标注读的是这份精简快照：要有状态、当前版本、可切版本与目标版本，但不带版本历史。
  const hinted = update.hint();
  assert.deepStrictEqual(hinted, {
    state: "update_available",
    ready: "",
    availableVersion: "0.2.0"
  });

  // 下载：只下缺的内容，落进 versions/0.2.0，进度一路报上来。
  const started = await update.stage("0.2.0");
  assert.strictEqual(started.started, true);
  // 同一时刻只跑一条下载：还没拼完就再点，会被拒。
  await assert.rejects(function () { return update.stage("0.2.0"); }, /已经在下载了/);
  const done = await settle(update);
  assert.strictEqual(done.state, "download_ready");
  assert.strictEqual(done.ready, "0.2.0");
  assert.strictEqual(done.task.downloaded, 4, "四份新内容，lib/a.js 与上一版同内容就不用下");
  assert.strictEqual(fs.readFileSync(path.join(home, "versions", "0.2.0", "lib", "b.js"), "utf8"), "b 新增");
  assert.strictEqual(fs.existsSync(path.join(home, "versions", "0.2.0", "lib", "a.js")), true);

  // 有任务在跑：不许切。
  busy = "1 次流水线正在跑";
  assert.throws(function () { update.apply(); }, /有任务在跑/);
  assert.strictEqual(update.status().busy, "1 次流水线正在跑");
  busy = "";

  const applied = update.apply();
  assert.strictEqual(applied.version, "0.2.0");
  assert.strictEqual(applied.restartRequired, true);
  const pointer = JSON.parse(fs.readFileSync(path.join(home, "current.json"), "utf8"));
  assert.deepStrictEqual({ version: pointer.version, previous: pointer.previous }, { version: "0.2.0", previous: "0.1.0" });
  assert.strictEqual(update.status().rollback, "0.1.0", "回退目标就是刚才那一版");

  const back = update.rollback();
  assert.strictEqual(back.version, "0.1.0");
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(home, "current.json"), "utf8")).version, "0.1.0");
  assert.strictEqual(update.status().rollback, "", "切回去之后没有可再回退的目标");

  assert.throws(function () { update.apply("0.1.0"); }, /已经运行在/);
  assert.throws(function () { update.rollback(); }, /没有可回退的版本/);

  // 本地这一版的字节被改过：切换时按清单校验能看出来，不许切过去；
  // 被看出来之后，设置页与探活都不再说它可切换（免得点来点去都是同一条报错）。
  fs.writeFileSync(path.join(home, "versions", "0.2.0", "server.js"), "被人改过", "utf8");
  assert.throws(function () { update.apply("0.2.0"); }, /和清单对不上/);
  const broken = update.status();
  assert.strictEqual(broken.ready, "", "对不上就不算可切换");
  assert.strictEqual(broken.state, "update_available", "退回「有新版本待下载」");
  assert.strictEqual(update.hint().state, "update_available", "探活快照说同一句话");

  // 重新下一份就恢复「可切换」：坏掉的记号要跟着下载成功一起摘掉。
  const again = await update.stage("0.2.0");
  assert.strictEqual(again.started, true, "坏了的那一份可以重下");
  const repaired = await settle(update);
  assert.strictEqual(repaired.ready, "0.2.0", "重下之后又可切换");
  assert.strictEqual(repaired.state, "download_ready");
  assert.strictEqual(update.hint().state, "download_ready");

  // 本地已经是最新时不重复下载：这条分支不能因为判据改名而断掉。
  const alreadyNew = createUpdate({ root: next, home: next, version: "0.2.0", fetchImpl: server.fetchImpl });
  await alreadyNew.check();
  const noop = await alreadyNew.stage("0.2.0");
  assert.strictEqual(noop.started, false);
  assert.strictEqual(noop.reason, "本地已经有这一版");

  /*
   * 历史版本也要能补回本机：清单按那一版的 tag 取（不是 latest），下完就能切过去 ——
   * 更新页里「历史版本」那几行的「下载」按钮走的就是这条。
   */
  const older = makeTree({
    "server.js": "server 0.0.9",
    "launch.js": "launch",
    "package.json": "{\"version\":\"0.0.9\"}",
    "lib/a.js": "a",
    "public/index.html": "html"
  });
  const olderRemote = remote(older, "0.0.9");
  const olderHome = makeTree({
    "server.js": "server 0.2.0",
    "launch.js": "launch",
    "package.json": "{\"version\":\"0.2.0\"}",
    "lib/a.js": "a",
    "public/index.html": "html"
  });
  const stageUpdate = createUpdate({
    root: olderHome,
    home: olderHome,
    version: "0.2.0",
    fetchImpl: async function (url) {
      // 假远端只发了 0.0.9 这一版：清单按 tag 取，内容按哈希取。
      if (url.endsWith("/releases/download/v0.0.9/manifest.json")) return ok(JSON.stringify(olderRemote.manifest));
      const hit = /\/releases\/download\/v([^/]+)\/([0-9a-f]{64})$/.exec(url);
      if (hit && hit[1] === "0.0.9") {
        const rel = Object.keys(olderRemote.manifest.files).find(function (name) {
          return olderRemote.manifest.files[name] === hit[2];
        });
        if (rel) return ok(fs.readFileSync(path.join(older, rel), "utf8"));
      }
      return { ok: false, status: 404 };
    }
  });
  const staged = await stageUpdate.stage("0.0.9");
  assert.strictEqual(staged.started, true, "历史版本可以下回来");
  const stagedDone = await settle(stageUpdate);
  assert.strictEqual(stagedDone.ready, "", "它比当前版本旧，不算「有新版可切」");
  const stagedRow = stagedDone.staged.find(function (item) { return item.version === "0.0.9"; });
  assert.ok(stagedRow && stagedRow.ready, "下完之后本机就有这一份，可以切过去");
  // 历史版本切换前也要按它自己的清单逐文件校验（清单是 stage 下载时留下的那一份）。
  fs.writeFileSync(path.join(olderHome, "versions", "0.0.9", "lib", "a.js"), "被人改过", "utf8");
  assert.throws(function () { stageUpdate.apply("0.0.9"); }, /和清单对不上/, "历史版本也要校验");
  fs.writeFileSync(path.join(olderHome, "versions", "0.0.9", "lib", "a.js"), "a", "utf8");
  assert.strictEqual(stageUpdate.apply("0.0.9").version, "0.0.9", "能切到历史版本");
  await assert.rejects(function () { return stageUpdate.stage("9.9.9"); }, /远端没有 v9.9.9/);

  // 外壳下限：清单要求比当前更高的客户端外壳时，下载与切换都拒。
  const gated = remote(next, "0.2.1", { minClientVersion: "9.9.9" });
  const gatedHome = makeTree({ "server.js": "旧客户端", "package.json": "{\"version\":\"0.1.0\"}" });
  const gatedUpdate = createUpdate({ root: gatedHome, home: gatedHome, version: "0.1.0", fetchImpl: gated.fetchImpl });
  const gatedStatus = await gatedUpdate.check();
  assert.strictEqual(gatedStatus.state, "update_available");
  assert.strictEqual(gatedStatus.available.blocked.code, "CLIENT_TOO_OLD");
  await assert.rejects(function () { return gatedUpdate.stage("0.2.1"); }, /要求客户端至少/);
  assert.strictEqual(gatedUpdate.status().state, "error", "拒绝之后界面要显示原因");

  // 远端没有这一版就下不了 / 没下过就点切换。
  const blank = makeTree({ "server.js": "空白", "package.json": "{\"version\":\"0.1.0\"}" });
  const blankUpdate = createUpdate({ root: blank, home: blank, version: "0.1.0", fetchImpl: server.fetchImpl });
  await assert.rejects(function () { return blankUpdate.stage("9.9.9"); }, /远端没有 v9.9.9/);
  assert.throws(function () { blankUpdate.apply(); }, /还没有下载好的新版本/);

  // 联网失败：显式检查报 error，启动时的静默检查不打扰。
  const offline = createUpdate({
    root: blank,
    home: blank,
    version: "0.1.0",
    fetchImpl: async function () { throw new Error("getaddrinfo ENOTFOUND"); }
  });
  const failed = await offline.check();
  assert.strictEqual(failed.state, "error");
  assert.strictEqual(failed.error.code, "DOWNLOAD_FAILED");
  assert.match(failed.error.hint, /ENOTFOUND/);
  const silent = await offline.check({ silent: true });
  assert.strictEqual(silent.state, "error", "已经记下的错误不因为一次静默检查就消失");

  /*
   * 新版本就住在安装根那一份里（界面上的「本地这一份」）：装了新版、又切回旧版之后，
   * 新版没有 versions/<版本> 目录，但它本来就跑得起来 —— 这一份必须仍然算「可切换」。
   * 曾经的错法：拿 versions/<版本> 去校验，校验不通过就当没下载，切换按钮不出现。
   */
  const rootNewer = makeTree({
    "server.js": "server 0.2.0",
    "launch.js": "launch",
    "package.json": "{\"version\":\"0.2.0\"}",
    "lib/a.js": "a",
    "public/index.html": "html"
  });
  const runningOld = path.join(rootNewer, "versions", "0.1.0");
  for (const rel of ["server.js", "launch.js", "package.json", "lib/a.js", "public/index.html"]) {
    const abs = path.join(runningOld, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, rel === "package.json" ? "{\"version\":\"0.1.0\"}" : "old", "utf8");
  }
  const rootServer = remote(rootNewer, "0.2.0");
  const rootUpdate = createUpdate({
    root: rootNewer,
    home: rootNewer,
    version: "0.1.0",
    fetchImpl: rootServer.fetchImpl
  });
  await rootUpdate.check();
  const rootStatus = rootUpdate.status();
  const rootRow = rootStatus.staged.find(function (item) { return item.version === "0.2.0"; });
  assert.ok(rootRow, "安装根那一份要出现在本地版本里");
  assert.strictEqual(rootRow.ready, true, "安装根那一份与清单一致就是可切换");
  assert.strictEqual(rootStatus.ready, "0.2.0", "可以切过去");
  // 顶上那个红点读的是探活快照：它必须与设置页说同一句话，否则会把「可切换」说成「有新版」。
  assert.strictEqual(rootUpdate.hint().state, "download_ready", "探活快照也要认安装根那一份");
  assert.strictEqual(rootUpdate.hint().ready, "0.2.0");

  // 安装根那一份（就是「本地这一版」）同样要按清单校验：被改过就不许切过去。
  fs.writeFileSync(path.join(rootNewer, "lib", "a.js"), "被人改过", "utf8");
  assert.throws(function () { rootUpdate.apply("0.2.0"); }, /和清单对不上/, "安装根那一份也要校验");
  fs.writeFileSync(path.join(rootNewer, "lib", "a.js"), "a", "utf8");

  const switched = rootUpdate.apply("0.2.0");
  assert.strictEqual(switched.version, "0.2.0");

  /*
   * 监督进程按指针把新的那一份拉起来之后（同一份 home，跑的是 0.2.0）：
   * 它既不该说「有新版」，也不该说「可切换到 0.2.0」——那是自己正在跑的版本，点下去只会得到 SAME_VERSION。
   */
  const restarted = createUpdate({ root: rootNewer, home: rootNewer, version: "0.2.0", fetchImpl: rootServer.fetchImpl });
  assert.strictEqual(restarted.status().state, "up_to_date", "重启后设置页不再说可切换");
  assert.strictEqual(restarted.hint().state, "up_to_date", "探活快照同样不再说可切换");
  assert.strictEqual(restarted.hint().ready, "");

  for (const dir of [home, next, gatedHome, blank, rootNewer]) fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write("update ok\n");
}

main();
