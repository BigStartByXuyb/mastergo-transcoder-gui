#!/usr/bin/env node
"use strict";

// 插件那一半：按发布件里的插件清单检查、差分、下载、落盘，装进客户端自带的那一处。
// 远端用假 fetch 顶替（GitHub Releases 的地址），全程不联网。
// 跑法：node tests/plugin-update.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { hashFiles, listFilesUnder } = require("../lib/app-manifest.js");
const { BUILDING_PREFIX } = require("../lib/bundle-store.js");
const { pluginRootsUnder } = require("../lib/plugin-root.js");
const { createPluginUpdate, STORE_LAYOUT } = require("../lib/plugin-update.js");
const source = require("../lib/source.js");
const { PLUGIN_MANIFEST_NAME, MANIFEST_NAME } = source;

const BASE = source.DEFAULT_BASE;
// 夹具里的相对路径一律用 / 拼（清单里的路径也是 / 分隔），免得平台差异混进用例。
const MARKER = "skills/mastergo-to-wpf/SKILL.md";

function makeTree(root, files) {
  for (const rel of Object.keys(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, files[rel], "utf8");
  }
  return root;
}

// 一份能被插件定位认出来的插件树：认根只看 SKILL.md，版本读插件自己的清单。
function makePlugin(root, version, extra) {
  const files = Object.assign({
    [MARKER]: "# 插件 " + version + "\n",
    ".claude-plugin/plugin.json": JSON.stringify({ version: version }),
    "lib/core.js": "同一份内容\n"
  }, extra || {});
  return makeTree(root, files);
}

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gui-plugin-update-"));
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

// 假远端：latest 那一份插件清单 + 按 sha256 命名的文件；没传上去的哈希回 404。
function remote(pluginRoot, version, extra) {
  const manifest = Object.assign({
    name: "mastergo-wpf-transcoder",
    version: version,
    tag: "v" + version,
    releasedAt: "2026-10-06T00:00:00.000Z",
    files: hashFiles(pluginRoot, listFilesUnder(pluginRoot))
  }, extra || {});
  const byHash = new Map();
  for (const rel of Object.keys(manifest.files)) {
    byHash.set(manifest.files[rel], fs.readFileSync(path.join(pluginRoot, rel)));
  }
  const urls = [];
  let corruptHash = "";
  return {
    manifest: manifest,
    urls: urls,
    // 让远端对这一份内容回错东西：清单里写的哈希与拿到的字节对不上。
    corrupt: function (rel) { corruptHash = manifest.files[rel]; },
    fetchImpl: async function (url, init) {
      urls.push({ url: url, headers: (init && init.headers) || null });
      if (url === BASE + "/releases/latest/download/" + PLUGIN_MANIFEST_NAME) return ok(JSON.stringify(manifest));
      const hit = new RegExp("^" + BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/releases/latest/download/([0-9a-f]{64})$").exec(url);
      if (hit) {
        if (hit[1] === corruptHash) return ok("坏内容");
        const buffer = byHash.get(hit[1]);
        return buffer ? ok(buffer.toString("utf8")) : { ok: false, status: 404 };
      }
      return { ok: false, status: 404 };
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

function installDir(home) {
  return path.join(home, "plugins", "mastergo-wpf-transcoder");
}

async function main() {
  assert.strictEqual(PLUGIN_MANIFEST_NAME, "plugin-manifest.json", "插件清单名与发布侧共用一处定义");
  assert.notStrictEqual(PLUGIN_MANIFEST_NAME, MANIFEST_NAME, "插件与客户端本体各一份清单名");

  // ---- 一、客户机上什么都没有：查一次 → 装一份 → 立刻可用 ----
  {
    const home = sandbox();
    const remoteTree = makePlugin(path.join(sandbox(), "remote"), "1.0.2");
    const server = remote(remoteTree, "1.0.2");
    const installed = [];
    const update = createPluginUpdate({
      home: home,
      pluginSource: { kind: "github", base: BASE },
      fetchImpl: server.fetchImpl,
      onInstalled: function (manifest) { installed.push(manifest.version); }
    });

    const initial = update.status();
    assert.strictEqual(initial.state, "unchecked", "没查过远端就是「没查过」，不说「是最新」");
    assert.deepStrictEqual(initial.local, { dir: "", version: "" }, "一份都没有时本地是空");
    assert.strictEqual(initial.available, null, "没查过就没有远端信息");
    assert.strictEqual(initial.error, null);

    const checked = await update.check();
    assert.strictEqual(checked.state, "update_available", "远端有一版、本地没有，就是有新版");
    assert.strictEqual(checked.available.version, "1.0.2");
    assert.strictEqual(checked.available.tag, "v1.0.2");
    assert.strictEqual(checked.available.changed, Object.keys(server.manifest.files).length, "本地没有文件时全部算改动");
    assert.strictEqual(checked.error, null);

    const started = update.install();
    assert.strictEqual(started.started, true);
    // 同一时刻只跑一条：还没装完就再点，会被拒。
    assert.throws(function () { update.install(); }, /已经在装插件了/);
    const done = await settle(update);
    assert.strictEqual(done.task.phase, "done");
    assert.strictEqual(done.task.downloaded, Object.keys(server.manifest.files).length, "全部内容都要下");
    assert.ok(fs.existsSync(path.join(installDir(home), "1.0.2", MARKER)), "插件树落在自带位置的版本目录下");
    assert.strictEqual(fs.readFileSync(path.join(installDir(home), "1.0.2", "lib", "core.js"), "utf8"), "同一份内容\n");
    assert.deepStrictEqual(installed, ["1.0.2"], "装完要做那一下（装配处用它重新定位插件）");
    assert.strictEqual(update.status().local.version, "1.0.2", "装完本地就是这一版");
    assert.strictEqual(update.status().state, "up_to_date", "本地与远端一致就是最新");

    // 已经有这一版：不再下一次。
    const again = update.install();
    assert.strictEqual(again.started, false);
    assert.strictEqual(again.note, "本地已经有这一版");
    assert.strictEqual(again.status.task.downloaded, 0, "第二次一份都不下");
  }

  // ---- 二、本地已有一版：只下变了的，装完按最高版本取用 ----
  {
    const home = sandbox();
    const localTree = makePlugin(path.join(installDir(home), "1.0.1"), "1.0.1", {
      "lib/shared.js": "两边一模一样\n"
    });
    // 新一版里 core.js 变了、SKILL.md 与 plugin.json 跟着版本走，另加一个新文件。
    const remoteTree = makePlugin(path.join(sandbox(), "remote"), "1.0.2", {
      "lib/core.js": "改过的内容\n",
      "lib/extra.js": "新增的文件\n",
      "lib/shared.js": "两边一模一样\n"
    });
    const server = remote(remoteTree, "1.0.2");
    const update = createPluginUpdate({ home: home, pluginSource: { kind: "github", base: BASE }, fetchImpl: server.fetchImpl });

    const before = update.status();
    assert.strictEqual(before.local.version, "1.0.1");
    assert.strictEqual(before.local.dir, localTree);

    const checked = await update.check();
    // SKILL.md 与 plugin.json 的内容都带版本号，所以一共动了 4 个文件（另加 extra.js）。
    assert.strictEqual(checked.available.changed, 4, "只算内容不一样的");
    assert.strictEqual(checked.available.total, Object.keys(server.manifest.files).length);
    assert.strictEqual(checked.available.removed, 0);

    // 本地已有的同内容文件进内容库：下载数少于总文件数。
    const urlsBefore = server.urls.length;
    update.install();
    const done = await settle(update);
    assert.strictEqual(done.task.phase, "done");
    assert.strictEqual(done.task.downloaded, 4, "只下变了的这几份内容");
    const blobCalls = server.urls.slice(urlsBefore).filter(function (item) {
      return !item.url.endsWith("/" + PLUGIN_MANIFEST_NAME);
    });
    assert.strictEqual(blobCalls.length, 4, "同内容的那一份不进下载（本地那份直接收进内容库）");
    assert.ok(server.urls.length > urlsBefore, "确实去远端取过");
    assert.strictEqual(update.status().local.version, "1.0.2", "插件定位按最高版本取：装完就是新的那一份");
    assert.strictEqual(update.status().local.dir, path.join(installDir(home), "1.0.2"));
  }

  // ---- 三、远端给的内容与清单对不上：当场失败，不留半份 ----
  {
    const home = sandbox();
    const remoteTree = makePlugin(path.join(sandbox(), "remote"), "2.0.0");
    const server = remote(remoteTree, "2.0.0");
    // 其中一份内容远端回的字节与清单对不上：坏包必须被拒。
    server.corrupt("lib/core.js");
    const update = createPluginUpdate({ home: home, pluginSource: { kind: "github", base: BASE }, fetchImpl: server.fetchImpl });
    await update.check();
    update.install();
    const done = await settle(update);
    assert.strictEqual(done.task.phase, "error");
    assert.strictEqual(done.task.error.code, "HASH_MISMATCH");
    assert.strictEqual(fs.existsSync(path.join(installDir(home), "2.0.0")), false, "拼不出来就不留半份");
    assert.strictEqual(done.state, "update_available", "没装成，仍然是「有新版」");
  }

  // ---- 四、没检查过就点安装 / 远端没有插件清单 ----
  {
    const home = sandbox();
    const update = createPluginUpdate({
      home: home,
      pluginSource: { kind: "github", base: BASE },
      fetchImpl: async function () { return { ok: false, status: 404 }; }
    });
    assert.throws(function () { update.install(); }, /还没有检查过插件版本/);

    // 静默检查失败不落到界面上（启动时那一次）；非静默才记下来，并带上取清单的地址。
    const silent = await update.check({ silent: true });
    assert.strictEqual(silent.error, null);
    const loud = await update.check();
    assert.strictEqual(loud.state, "error");
    assert.strictEqual(loud.error.code, "HTTP_404");
    assert.ok(loud.error.hint.endsWith(PLUGIN_MANIFEST_NAME), "失败原因里带上清单地址");
  }

  // ---- 五、清单不是清单格式 ----
  {
    const home = sandbox();
    const update = createPluginUpdate({
      home: home,
      pluginSource: { kind: "github", base: BASE },
      fetchImpl: async function () { return ok(JSON.stringify({ version: "1.0.0" })); }
    });
    const checked = await update.check();
    assert.strictEqual(checked.error.code, "BAD_MANIFEST");
  }

  // ---- 六、有任务在跑：装就等于生效，所以和「换一份插件」一样先拒绝 ----
  {
    const home = sandbox();
    const remoteTree = makePlugin(path.join(sandbox(), "remote"), "3.0.0");
    const server = remote(remoteTree, "3.0.0");
    const update = createPluginUpdate({
      home: home,
      pluginSource: { kind: "github", base: BASE },
      fetchImpl: server.fetchImpl,
      isBusy: function () { return "1 次流水线正在跑"; }
    });
    await update.check();
    assert.throws(function () { update.install(); }, /有任务在跑/);
    assert.strictEqual(fs.existsSync(path.join(installDir(home), "3.0.0")), false, "被挡住时一份都不下");
  }

  // ---- 七、静态源 + 私有源：地址按协议拼、带 token、有没有 token 走廉价判断 ----
  {
    const home = sandbox();
    const remoteTree = makePlugin(path.join(sandbox(), "remote"), "1.0.5");
    const files = hashFiles(remoteTree, listFilesUnder(remoteTree));
    const byHash = new Map();
    for (const rel of Object.keys(files)) byHash.set(files[rel], fs.readFileSync(path.join(remoteTree, rel)));
    const seen = [];
    const update = createPluginUpdate({
      home: home,
      pluginSource: { kind: "static", base: "http://10.0.0.9/updates" },
      token: "secret",
      fetchImpl: async function (url, init) {
        seen.push({ url: url, headers: (init && init.headers) || null });
        if (url === "http://10.0.0.9/updates/" + PLUGIN_MANIFEST_NAME) {
          return ok(JSON.stringify({ version: "1.0.5", files: files }));
        }
        const hit = /^http:\/\/10\.0\.0\.9\/updates\/files\/([0-9a-f]{64})$/.exec(url);
        if (hit) return ok(byHash.get(hit[1]).toString("utf8"));
        return { ok: false, status: 404 };
      }
    });
    await update.check();
    assert.strictEqual(seen[0].url, "http://10.0.0.9/updates/" + PLUGIN_MANIFEST_NAME, "静态源取根目录那一份清单");
    assert.deepStrictEqual(seen[0].headers, { authorization: "Bearer secret" }, "私有源带凭据");
    update.install();
    const done = await settle(update);
    assert.strictEqual(done.task.phase, "done");
    assert.ok(seen.some(function (item) { return item.url.startsWith("http://10.0.0.9/updates/files/"); }));
    assert.strictEqual(update.status().local.version, "1.0.5");
  }

  /*
   * ---- 八、正在拼的那份落在插件定位扫不到的地方 ----
   *
   * 插件定位认的是「插件目录下的版本子目录」（有 skills/mastergo-to-wpf/SKILL.md 就算一份），
   * 所以半成品绝不能出现在那一层：进程中途退出留下的残骸会被当成一份插件用。
   * 这里直接摆一份残骸，验它不在定位能看见的范围内；路径按安装器自己的两个常量拼
   * （buildDir 与 .building- 前缀），它们改名时这份用例跟着一起变，不会各说各话。
   */
  {
    const home = sandbox();
    const leftover = makePlugin(
      path.join(installDir(home), STORE_LAYOUT.buildDir, BUILDING_PREFIX + "5.0.0-1"),
      "5.0.0"
    );
    const update = createPluginUpdate({ home: home, pluginSource: { kind: "github", base: BASE }, fetchImpl: async function () { throw new Error("不该联网"); } });
    assert.ok(fs.existsSync(path.join(leftover, MARKER)), "残骸确实是一棵像样的插件树");
    assert.deepStrictEqual(pluginRootsUnder(path.join(home, "plugins")), [], "插件定位一份都看不到");
    assert.strictEqual(update.status().local.version, "", "半成品不算本地那一份");
  }

  /*
   * 插件有自己的版本线：装配处没注入源时按插件仓库取（不是客户端仓库那份默认），
   * 并且和程序更新一样带一个后台复查（startWatch）—— 两条线的节拍都在 lib/manifest-fetch.js 一处。
   */
  {
    const update = createPluginUpdate({ home: sandbox(), fetchImpl: async function () { throw new Error("不该联网"); } });
    assert.strictEqual(
      update.status().source.base,
      source.PLUGIN_DEFAULT_BASE,
      "没注入源＝插件仓库（插件那条线的默认，不是客户端仓库）"
    );
    assert.strictEqual(update.status().source.manifestUrl, source.PLUGIN_DEFAULT_BASE + "/releases/latest/download/" + PLUGIN_MANIFEST_NAME);
    assert.strictEqual(typeof update.startWatch, "function", "插件线也要能起后台复查");
  }

  /*
   * 源换过之后，旧源那份缓存不算数：否则换了源（插件改成它自己的仓库）还会照旧显示
   * 「已是最新」—— 那不是现在这个源的结论。判据在 lib/manifest-fetch.js 的缓存一处，两条版本线共用。
   */
  {
    const home = sandbox();
    const remoteTree = makePlugin(path.join(sandbox(), "remote"), "1.0.9");
    const first = createPluginUpdate({
      home: home,
      pluginSource: { kind: "github", base: BASE },
      fetchImpl: remote(remoteTree, "1.0.9").fetchImpl
    });
    await first.check();
    assert.strictEqual(first.status().state, "update_available", "先按 A 源查一次，缓存里有 A 的结论");

    const other = createPluginUpdate({
      home: home,
      pluginSource: { kind: "static", base: "http://10.0.0.9/updates" },
      fetchImpl: async function () { throw new Error("不该联网"); }
    });
    assert.strictEqual(other.status().state, "unchecked", "换了源＝这个源还没问过");
    assert.strictEqual(other.status().available, null, "不拿别的源的结论顶");

    const back = createPluginUpdate({
      home: home,
      pluginSource: { kind: "github", base: BASE },
      fetchImpl: async function () { throw new Error("不该联网"); }
    });
    assert.strictEqual(back.status().state, "update_available", "换回同一个源，缓存照用（离线也说得出上次的结果）");
  }

  /*
   * 有没有 token：装配处（server.js）注入了那份廉价判断（只看设置里记的标记，不解密），
   * 状态就该读它 —— 注入的那份被问到、取值链那份不被碰（轮询路径不解密）。
   */
  {
    const home = sandbox();
    const asked = [];
    const update = createPluginUpdate({
      home: home,
      pluginSource: { kind: "github", base: BASE },
      fetchImpl: async function () { throw new Error("不该联网"); },
      token: function () { asked.push("token"); return "mg_secret"; },
      hasToken: function () { asked.push("hasToken"); return true; }
    });
    assert.strictEqual(update.status().hasToken, true);
    assert.deepStrictEqual(asked, ["hasToken"], "读状态只问注入的那份廉价判断");
  }

  console.log("plugin-update: 全部通过");
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
