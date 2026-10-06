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
const { fetchBuffer } = require("./download.js");
const { diffManifests, hashFiles, listFilesUnder } = require("./app-manifest.js");
const { createManifestFetch, createManifestCache, CACHE_DIR } = require("./manifest-fetch.js");
const { pluginRootsUnder, pluginVersionOf, PLUGIN_NAME } = require("./plugin-root.js");
const { compareVersions } = require("./update.js");
const source = require("./source.js");

/*
 * 装到安装根的哪一处：插件定位里「客户端自带」那一条看的是 <安装根>/plugins（lib/plugin-root.js），
 * 版本目录落在它下面的同名插件目录里（plugins/mastergo-wpf-transcoder/<版本>/）。
 *
 * 内容库的目录名：版本目录直接放在插件目录自己那一层（插件定位按「同名目录下的版本子目录」认它）；
 * blobs 与缓存各占一层，不与插件树混在一起；正在拼的那份落在 .partial\ 下 —— 插件定位扫的是这一层，
 * 半成品绝不能出现在它能看见的地方（拼完才改名成 <版本>\）。
 */
const INSTALL_PARENT = "plugins";
const STORE_LAYOUT = { blobsDir: "blobs", versionsDir: "", pointerName: "", buildDir: ".partial" };

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
  // 清单缓存与程序更新共用同一份实现（落在插件自己那一层目录下）。
  const cache = createManifestCache({
    dir: path.join(installRoot, CACHE_DIR),
    name: source.PLUGIN_MANIFEST_NAME,
    now: now
  });

  // 取清单那一套（源 / 凭据 / 地址 / 重试）与程序更新共用一处实现，只是清单名换成插件那份。
  const manifestFetch = createManifestFetch({
    manifestName: source.PLUGIN_MANIFEST_NAME,
    fetchImpl: fetchImpl,
    source: opts.source,
    token: opts.token
  });
  let failure = null;
  let task = { phase: "idle", done: 0, total: 0, downloaded: 0, error: null };
  let running = null;

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

  /*
   * 三态只有这一处算法：本地已装到最新 / 远端有新的 / 出错。
   * 「正在装」不在状态里 —— 那是 task.phase 的事，界面照它出进度条。
   */
  function readState() {
    const cached = cache.read();
    const mine = local();
    const available = cached
      ? {
          version: cached.manifest.version,
          tag: String(cached.manifest.tag || ""),
          releasedAt: String(cached.manifest.releasedAt || ""),
          changed: ((cached.diff || {}).changed || []).length,
          removed: ((cached.diff || {}).removed || []).length,
          total: ((cached.diff || {}).total || 0),
          checkedAt: String(cached.checkedAt || "")
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
      /**
       * 客户端自带的那一份（装了哪几版、此刻用哪一份，由插件页的来源表说 —— 那是插件定位那份判据）。
       * 这里只说「本地这一份是哪个版本、在哪个目录」。
       */
      local: snapshot.local,
      available: snapshot.available,
      error: failure,
      task: task
    };
  }

  /*
   * 拉一次插件清单。silent 用于启动时的后台检测：失败不落到界面上。
   * 成功就把清单与差分结果缓存下来，status() 之后离线也能显示「有新版 / 改了几个文件」。
   */
  async function check(options) {
    const silent = Boolean((options || {}).silent);
    try {
      const remote = await manifestFetch.fetchManifest();
      const mine = local();
      const localManifest = manifestOf(mine.dir, mine.version);
      // 本地已有的同内容文件直接进内容库：换版本时只下变了的那些。
      if (mine.dir) store.seedFrom(mine.dir, localManifest, remote);
      cache.write(remote, diffManifests(localManifest, remote));
      failure = null;
    }
    catch (error) {
      if (!silent) failure = toFailure(error);
    }
    return status();
  }

  /*
   * 装之前的三道门禁：有任务在跑（装完就是生效，和「换一份插件」同一条规矩）、已经在装、还没检查过。
   * 过了就给出要装的那份清单。
   */
  function installableManifest() {
    const busy = String(isBusy() || "");
    if (busy) throw new UserError("RUNNING_TASKS", "有任务在跑，先等它结束", busy);
    if (running) throw new UserError("BUSY_INSTALL", "已经在装插件了", "等这一次装完。");
    const cached = cache.read();
    if (!cached) throw new UserError("NO_MANIFEST", "还没有检查过插件版本", "先点「检查更新」。");
    return cached.manifest;
  }

  // 缺的那几份内容按内容寻址取回；同一份内容各版本共用，地址里不用带版本。
  function fetchBlob(hash) {
    return fetchBuffer(source.blobUrl(manifestFetch.currentSource(), "", hash), {
      fetchImpl: fetchImpl,
      headers: manifestFetch.headers()
    });
  }

  // 进度往 status().task 上写：下完了还差拼装那一步，阶段跟着换。
  function reportProgress(progress) {
    task.done = progress.done;
    task.total = progress.total;
    task.downloaded = progress.downloaded;
    task.phase = progress.done >= progress.total ? "materializing" : "downloading";
  }

  // 落盘跑在后台：拼完把这一份重新定位一次（落盘即生效），失败把原因留在 task 上。
  function startMaterialize(manifest) {
    running = store
      .materialize(manifest, fetchBlob, reportProgress)
      .then(function (result) {
        task = { phase: "done", done: task.done, total: task.total, downloaded: result.downloaded, error: null };
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
  }

  /*
   * 装最新那一版。跑在后台：调用方立刻拿到 started，进度与结果都在 status().task 里，界面轮询 status 就行。
   */
  function install() {
    const manifest = installableManifest();
    // 本地这一版逐文件对得上就直接说「已经有」：判据与拼版本时那道校验是同一份（store.hasVersion）。
    if (store.hasVersion(manifest.version, manifest)) {
      task = { phase: "done", done: 0, total: 0, downloaded: 0, error: null };
      return { started: false, version: manifest.version, note: "本地已经有这一版", status: status() };
    }

    task = { phase: "downloading", done: 0, total: 0, downloaded: 0, error: null };
    failure = null;
    startMaterialize(manifest);
    return { started: true, version: manifest.version, note: "", status: status() };
  }

  return { status: status, check: check, install: install };
}

module.exports = { createPluginUpdate };
