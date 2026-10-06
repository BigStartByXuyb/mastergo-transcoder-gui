"use strict";

/*
 * 插件那一半：客户端从自己的发布源取 mastergo-wpf-transcoder 插件，装进「客户端自带」那一处。
 *
 * 为什么要有：客户机上可能既没有 Codex 也没有 Claude，插件就没地方来。发布件里带一份插件清单
 * （plugin-manifest.json + 按 sha256 命名的文件，与客户端本体同一套协议），客户端按它下载、校验、落盘。
 * 「下载 → 校验 → 落目录」这一套复用 lib/bundle-store.js，与 Codex 那条线是同一个实现。
 *
 * 目录（都在安装根下，属于用户状态，不随程序版本走）：
 *   plugins/mastergo-wpf-transcoder/<插件版本>/     装好的插件树；插件定位按高版本取用
 *   plugins/mastergo-wpf-transcoder/blobs/<sha256>  内容库，各版本共用
 *   plugins/mastergo-wpf-transcoder/update-cache/   上次拉到的清单（离线也能显示「有新版」）
 *
 * 谁在用：lib/routes.js 的 /api/plugin/update/*；装完由装配处重新定位一次插件（onInstalled）。
 * 边界：只管「装到客户端自带的位置」。Codex / Claude 缓存里那几份归它们自己管，客户端不碰。
 * 没有版本指针：插件定位按最高版本现取，落盘即生效，不需要「切换」这一步 ——
 * 也正因为落盘就等于生效，有任务在跑时和「换一份插件」一样先拒绝。
 */

const fs = require("fs");
const path = require("path");

const { UserError, toFailure } = require("./errors.js");
const { createBundleStore } = require("./bundle-store.js");
const { fetchBuffer, fetchJson } = require("./download.js");
const { diffManifests, hashFiles, listFilesUnder } = require("./app-manifest.js");
const { pluginRootsUnder, pluginVersionOf, PLUGIN_NAME } = require("./plugin-root.js");
const { compareVersions } = require("./update.js");
const source = require("./source.js");

/*
 * 装到安装根的哪一处：插件定位里「客户端自带」那一条看的是 <安装根>/plugins（lib/plugin-root.js），
 * 版本目录落在它下面的同名插件目录里（plugins/mastergo-wpf-transcoder/<版本>/）。
 *
 * 内容库的目录名：版本目录直接放在插件目录自己那一层，
 * 插件定位按「同名目录下的版本子目录」认它；blobs 与缓存各占一层，不与插件树混在一起。
 */
const INSTALL_PARENT = "plugins";
const STORE_LAYOUT = { blobsDir: "blobs", versionsDir: "", pointerName: "" };
const CACHE_DIR = "update-cache";
const MANIFEST_TIMEOUT_MS = 15000;
const MANIFEST_ATTEMPTS = 2;

function createPluginUpdate(options) {
  const opts = options || {};
  const home = path.resolve(opts.home);
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || function () { return new Date().toISOString(); };
  const isBusy = opts.isBusy || function () { return ""; };
  // 装完要做的那一下（装配处用它重新定位插件）：落盘即生效靠这里，本模块不认识「谁在用插件」。
  const onInstalled = typeof opts.onInstalled === "function" ? opts.onInstalled : function () {};

  const installParent = path.join(home, INSTALL_PARENT);
  const installRoot = path.join(installParent, PLUGIN_NAME);
  const store = createBundleStore(installRoot, STORE_LAYOUT);
  const cachePath = path.join(installRoot, CACHE_DIR, source.PLUGIN_MANIFEST_NAME);

  // 源与 token 都现取：设置里改完不重启客户端也要按新的走（与程序更新同一口径）。
  const sourceOf = typeof opts.source === "function" ? opts.source : function () { return opts.source || null; };
  const tokenOf = typeof opts.token === "function" ? opts.token : function () { return opts.token || ""; };
  /*
   * 有没有 token 与 token 的值分开问：值要走 DPAPI 解密（同步起 PowerShell），而 status() 会被
   * 前端轮询 —— 轮询路径上只做廉价的存在性判断（与程序更新那条线同一口径）。
   */
  const hasTokenOf = typeof opts.hasToken === "function"
    ? opts.hasToken
    : function () { return Boolean(String(tokenOf() || "").trim()); };

  let failure = null;
  let task = { phase: "idle", done: 0, total: 0, downloaded: 0, error: null };
  let running = null;

  function currentSource() {
    return source.normalizeSource(sourceOf());
  }

  function sourceHeaders() {
    return source.requestHeaders(currentSource(), tokenOf());
  }

  // 最新那份插件清单：插件发布件与客户端本体挂在同一个 Release 上，地址只有清单名不同。
  function manifestUrl() {
    return source.manifestUrl(currentSource(), source.PLUGIN_MANIFEST_NAME);
  }

  /*
   * 本机已装的那几份：判据就是插件定位那一份（pluginRootsUnder —— 它自己与它下面的同名版本目录），
   * 高版本在前。少一处判据，就少一处会与定位对不上的地方。
   */
  function installed() {
    return pluginRootsUnder(installParent)
      .map(function (dir) { return { dir: dir, version: pluginVersionOf(dir) }; })
      .filter(function (item) { return Boolean(item.version); });
  }

  // 客户端自带的那一份＝已装的几份里版本最高的；一份都没有时目录与版本都是空串。
  function local() {
    const list = installed();
    return list.length ? { dir: list[0].dir, version: list[0].version } : { dir: "", version: "" };
  }

  /* 本地树的清单：插件树的每一个文件都算（与发布侧打包那一份同一套扫法）。 */
  function manifestOf(dir, version) {
    if (!dir) return { version: String(version || ""), files: {} };
    return { version: String(version || ""), files: hashFiles(dir, listFilesUnder(dir)) };
  }

  function readCache() {
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      return parsed && parsed.manifest && parsed.manifest.files ? parsed : null;
    }
    catch {
      return null;
    }
  }

  function writeCache(manifest, diff) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ checkedAt: now(), manifest: manifest, diff: diff }, null, 2) + "\n", "utf8");
  }

  /*
   * 三态只有这一处算法：本地已装到最新 / 远端有新的 / 出错。
   * 「正在装」不在状态里 —— 那是 task.phase 的事，界面照它出进度条。
   */
  function readState() {
    const cache = readCache();
    const mine = local();
    const available = cache
      ? {
          version: cache.manifest.version,
          tag: String(cache.manifest.tag || ""),
          releasedAt: String(cache.manifest.releasedAt || ""),
          changed: ((cache.diff || {}).changed || []).length,
          removed: ((cache.diff || {}).removed || []).length,
          total: ((cache.diff || {}).total || 0),
          checkedAt: String(cache.checkedAt || "")
        }
      : null;
    let state = "up_to_date";
    if (failure) state = "error";
    else if (available && compareVersions(available.version, mine.version || "0") > 0) state = "update_available";
    return { state: state, local: mine, available: available };
  }

  function status() {
    const snapshot = readState();
    return {
      state: snapshot.state,
      /** 客户端自带的那一份；此刻生效的可能是别的来源，那由插件页的来源表说。 */
      local: snapshot.local,
      /** 这一处已装的几份（高版本在前），供界面列出可切换的版本。 */
      installed: installed(),
      available: snapshot.available,
      error: failure,
      task: task,
      // 现在会去哪个地址取插件清单：设置页照实显示，不让用户自己拼。
      source: source.describeSource(currentSource(), source.PLUGIN_MANIFEST_NAME),
      hasToken: Boolean(hasTokenOf())
    };
  }

  /*
   * 拉一次插件清单。silent 用于启动时的后台检测：失败不落到界面上。
   * 成功就把清单与差分结果缓存下来，status() 之后离线也能显示「有新版 / 改了几个文件」。
   */
  async function check(options) {
    const silent = Boolean((options || {}).silent);
    try {
      const remote = await fetchJson(manifestUrl(), {
        fetchImpl: fetchImpl,
        attempts: MANIFEST_ATTEMPTS,
        timeoutMs: MANIFEST_TIMEOUT_MS,
        headers: sourceHeaders()
      });
      if (!remote || !remote.version || !remote.files || typeof remote.files !== "object") {
        throw new UserError("BAD_MANIFEST", "远端插件清单不是清单格式", manifestUrl());
      }
      const mine = local();
      const localManifest = manifestOf(mine.dir, mine.version);
      // 本地已有的同内容文件直接进内容库：换版本时只下变了的那些。
      if (mine.dir) store.seedFrom(mine.dir, localManifest, remote);
      writeCache(remote, diffManifests(localManifest, remote));
      failure = null;
    }
    catch (error) {
      if (!silent) failure = toFailure(error);
    }
    return status();
  }

  /*
   * 装最新那一版。跑在后台：调用方立刻拿到 started，进度与结果都在 status().task 里，界面轮询 status 就行。
   * 同一时刻只跑一条；落盘即生效（onInstalled 里重新定位一次插件）。
   */
  function install() {
    // 装完就是生效（定位按最高版本现取）：与「换一份插件」同一道门禁，跑着的时候先不换。
    const busy = String(isBusy() || "");
    if (busy) throw new UserError("RUNNING_TASKS", "有任务在跑，先等它结束", busy);
    if (running) throw new UserError("BUSY_INSTALL", "已经在装插件了", "等这一次装完。");
    const cache = readCache();
    if (!cache) throw new UserError("NO_MANIFEST", "还没有检查过插件版本", "先点「检查更新」。");
    const manifest = cache.manifest;
    // 本地这一版逐文件对得上就直接说「已经有」：判据与拼版本时那道校验是同一份（store.verifyDir）。
    const target = store.versionDir(manifest.version);
    if (fs.existsSync(target) && store.verifyDir(target, manifest).length === 0) {
      task = { phase: "done", done: 0, total: 0, downloaded: 0, error: null };
      return { started: false, version: manifest.version, note: "本地已经有这一版", status: status() };
    }

    task = { phase: "downloading", done: 0, total: 0, downloaded: 0, error: null };
    failure = null;
    running = store
      .materialize(
        manifest,
        function (hash) {
          return fetchBuffer(source.blobUrl(currentSource(), "", hash), {
            fetchImpl: fetchImpl,
            headers: sourceHeaders()
          });
        },
        function (progress) {
          task.done = progress.done;
          task.total = progress.total;
          task.downloaded = progress.downloaded;
          task.phase = progress.done >= progress.total ? "materializing" : "downloading";
        }
      )
      .then(function (result) {
        task = { phase: "done", done: task.done, total: task.total, downloaded: result.downloaded, error: null };
        // 插件定位按最高版本现取：装完重新定位一次，这一份立刻可用。
        onInstalled(manifest);
        return { downloaded: result.downloaded };
      })
      .catch(function (error) {
        task = {
          phase: "error",
          done: task.done,
          total: task.total,
          downloaded: task.downloaded,
          error: toFailure(error)
        };
      })
      .finally(function () {
        running = null;
      });
    return { started: true, version: manifest.version, note: "", status: status() };
  }

  return { status: status, check: check, install: install };
}

module.exports = { createPluginUpdate };
