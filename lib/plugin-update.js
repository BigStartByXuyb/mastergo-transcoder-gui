"use strict";

/*
 * 插件那一半：客户端按**插件那条版本线自己的发布源**取 mastergo-wpf-transcoder 插件，
 * 装进「客户端自带」那一处。
 *
 * 为什么要有：客户机上可能既没有 Codex 也没有 Claude，插件就没地方来。发布件里带一份插件清单
 * （plugin-manifest.json + 按 sha256 命名的文件，与客户端本体同一套协议）挂在插件仓库自己的 Release 上，
 * 客户端按它下载、校验、落盘 —— 不再跟着客户端的发布件走。
 * 「下载 → 校验 → 落目录」这一套复用 lib/bundle-store.js，与 Codex 那条线是同一个实现。
 *
 * 目录（都在安装根下，属于用户状态，不随程序版本走）：
 *   plugins/mastergo-wpf-transcoder/<插件版本>/     装好的插件树；插件定位按高版本取用
 *   plugins/mastergo-wpf-transcoder/blobs/<sha256>  内容库，各版本共用
 *   plugins/mastergo-wpf-transcoder/update-cache/   上次拉到的清单（离线也能显示「有新版」）
 *
 * 谁在用：lib/routes.js 的 /api/plugin/update/*；装完由装配处重新定位一次插件（onInstalled）。
 * 边界：只管「装到客户端自带的位置」。Codex / Claude 缓存里那几份归它们自己管，客户端不碰。
 * 没有版本指针：插件定位按最高版本现取，装完不用再「切换」——但自带那一份排在查找顺序最后，
 * 有 Codex / Claude 缓存时仍是那几份在生效（要用自带这份，在插件页点那一行的「用这份」）。
 * 也正因为装完就可能换掉生效的那一份，有任务在跑时和「换一份插件」一样先拒绝。
 */

const path = require("path");

const { UserError, toFailure } = require("./errors.js");
const { createBundleStore } = require("./bundle-store.js");
const { fetchBuffer } = require("./download.js");
const { hashFiles, listFilesUnder } = require("./app-manifest.js");
const { createManifestFetch, createManifestCache, summarizeCache, CACHE_DIR } = require("./manifest-fetch.js");
const { createRecheck } = require("./recheck.js");
const { syncManifest, createDownloadTask } = require("./update-task.js");
const { pluginRootsUnder, pluginVersionOf, PLUGIN_NAME, INSTALL_PARENT_NAME } = require("./plugin-root.js");
const { isNewer } = require("./versions.js");
const { requireIdle } = require("./idle.js");
const source = require("./source.js");

/*
 * 装到安装根的哪一处：插件定位里「客户端自带」那一条看的就是这个子目录（lib/plugin-root.js 的
 * INSTALL_PARENT_NAME），版本目录落在它下面的同名插件目录里（plugins/mastergo-wpf-transcoder/<版本>/）。
 *
 * 内容库的目录名：版本目录直接放在插件目录自己那一层（插件定位按「同名目录下的版本子目录」认它）；
 * blobs 与缓存各占一层，不与插件树混在一起；正在拼的那份落在 .partial\ 下 —— 插件定位扫的是这一层，
 * 半成品绝不能出现在它能看见的地方（拼完才改名成 <版本>\）。
 */
const STORE_LAYOUT = { blobsDir: "blobs", versionsDir: "", pointerName: "", buildDir: ".partial" };

function createPluginUpdate(options) {
  const opts = options || {};
  const home = path.resolve(opts.home);
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || function () { return new Date().toISOString(); };
  const isBusy = opts.isBusy || function () { return ""; };
  // 装完要做的那一下（装配处用它重新定位插件）：本模块不认识「谁在用插件」，只喊这一声。
  const onInstalled = typeof opts.onInstalled === "function" ? opts.onInstalled : function () {};
  /*
   * 插件这条线自己的源：**装配处必给**（server.js 注入 settings.sourceOf("pluginSource")，默认＝插件仓库）。
   * 这里不再自带一份回落 —— 同一件事有两个答案时，装配处漏注入会被静默顶替（用户存进 local.json 的
   * 私有源不生效，却照样能查更新），排查成本高；缺了就直接说。
   */
  if (typeof opts.pluginSource === "undefined") {
    throw new Error("createPluginUpdate 要给 pluginSource：插件这条线从哪儿取清单");
  }
  const pluginSource = opts.pluginSource;
  /*
   * 插件这条线：设置字段名（界面按它存）与归一（坏配置／空值回落插件仓库那份默认，
   * 不是客户端仓库那份）—— 只在这里取一次，下面取缓存、取清单几处都用这一条。
   */
  const line = source.lineOf("pluginSource");

  const installParent = path.join(home, INSTALL_PARENT_NAME);
  const installRoot = path.join(installParent, PLUGIN_NAME);
  const store = createBundleStore(installRoot, STORE_LAYOUT);
  // 清单缓存与程序更新共用同一份实现（落在插件自己那一层目录下）；记着这份结果来自哪个源。
  const cache = createManifestCache({
    dir: path.join(installRoot, CACHE_DIR),
    manifestName: source.PLUGIN_MANIFEST_NAME,
    source: pluginSource,
    // 缓存判断「这份结果来自哪个源」时用同一条线的归一，才不会与取清单那边对不上。
    line: line,
    now: now
  });

  // 取清单那一套（源 / 凭据 / 地址 / 重试）与程序更新共用一处实现，只是清单名换成插件那份。
  const manifestFetch = createManifestFetch({
    manifestName: source.PLUGIN_MANIFEST_NAME,
    fetchImpl: fetchImpl,
    /*
     * 插件自己的版本线：源由装配处给（见 server.js）—— 显式配过发布源就跟它走，
     * 没配就按插件仓库，不再跟客户端发布件（那一条见 lib/source.js 的 pluginSourceOf）。
     */
    source: pluginSource,
    // 这条线（字段名 + 坏配置回哪份默认）：与程序更新那一半同一个形状，各给各的那一条。
    line: line,
    token: opts.token,
    // 与程序更新同一份：装配处注入廉价的「设置里记的那个标记」，状态轮询路径上不解密。
    hasToken: opts.hasToken
  });
  // 上一次动作的结果：status() 读这里。下载进度与阶段在下面的 downloadTask 里。
  let failure = null;

  /*
   * 本机已装的那几份：判据就是插件定位那一份（pluginRootsUnder —— 它自己与它下面的同名版本目录），
   * 高版本在前。少一处判据，就少一处会与定位对不上的地方 —— 所以这里不再按「读不读得出版本」过滤：
   * 定位认它是一份插件就算装了，版本号读不出来就留空串（界面照实说「读不出版本」）。
   */
  function installed() {
    return pluginRootsUnder(installParent).map(function (dir) {
      return { dir: dir, version: pluginVersionOf(dir) };
    });
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
   * 四态只有这一处算法：没查过（没缓存）/ 远端有新的 / 本地已是最新 / 出错。
   * 「没查过」是单独一态：没有它，界面只能拿「本地已是最新」去表示「离线首启还没问过远端」。
   * 「正在装」不在状态里 —— 那是 task.phase 的事，界面照它出进度条。
   */
  function readState() {
    const cached = cache.read();
    const mine = local();
    const summary = summarizeCache(cached);
    // 插件那一半只有版本号与「差几个文件」用得上，其余摘要字段照旧留在里面（同一份来源，不各算一份）。
    const available = summary ? Object.assign({}, summary, { tag: String(cached.manifest.tag || "") }) : null;
    let state = "unchecked";
    if (failure) state = "error";
    else if (available && isNewer(available.version, mine.version || "0")) state = "update_available";
    else if (available) state = "up_to_date";
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
      // 有任务在跑时不能装（装完就可能换掉生效的那一份）：界面据此提前提示并禁用。
      busy: String(isBusy() || ""),
      task: downloadTask.task(),
      /*
       * 这一份插件从哪儿取（含这一项设置叫什么、有没有凭据）：插件自己那一项设置，
       * 没配＝插件仓库，拼法与程序更新同用 lib/source.js。插件页把这一份照实显示出来 ——
       * 「GitHub / GitLab / 静态目录在哪儿配」不能只有程序更新那一半看得见。
       */
      ...manifestFetch.describe()
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
      // 本地同内容的文件直接进内容库、清单与差分写进缓存（两步都在共用的 syncManifest 里）。
      syncManifest({
        store: store,
        cache: cache,
        remote: remote,
        localManifest: function () {
          const mine = local();
          return { dir: mine.dir, manifest: manifestOf(mine.dir, mine.version) };
        }
      });
      failure = null;
    }
    catch (error) {
      if (!silent) failure = toFailure(error);
    }
    return status();
  }

  /*
   * 装之前的两道门禁：有任务在跑（装完就可能换掉生效的那一份，与「换一份插件」同一条规矩）、还没检查过。
   * 「已经在装」在下面 update-task 的「一次只跑一条」里挡。过了就给出要装的那份清单。
   */
  function installableManifest() {
    requireIdle(isBusy, "装插件");
    const cached = cache.read();
    if (!cached) throw new UserError("NO_MANIFEST", "还没有检查过插件版本", "先点「检查更新」。");
    return cached.manifest;
  }

  /*
   * 安装就是这一条下载：一次只跑一条、本地对得上就早退、拼完才 rename —— 编排在 lib/update-task.js
   * 一处，这里只给这条线自己特有的三样：本地那份算不算「已经有」、内容从哪取、装完要收什么尾。
   */
  const downloadTask = createDownloadTask({
    store: store,
    /*
     * 按**这份清单自己的版本**取文件：GitHub / GitLab 的资产挂在那一版下面，不带版本会落到「最新那一版」——
     * 缓存里的清单比最新 Release 旧时（发布件刚更新、还没复查），哈希在新那一版里没有，就成了 404。
     * 静态源那套把文件集中在 files/ 下、与版本无关（lib/source.js 的 blobUrl 认这个差别）。
     */
    fetchBlob: function (manifest, hash) {
      return fetchBuffer(manifestFetch.fileUrl(manifest.version, hash), {
        fetchImpl: fetchImpl,
        headers: manifestFetch.headers()
      });
    },
    // 「本地已经有这一版」认的是那一版目录逐文件对得上（判据与拼版本时同一份）。
    skipIf: function (manifest) { return store.hasVersion(manifest.version, manifest); },
    // 插件定位按最高版本现取：装完重新定位一次，这一份立刻可用。
    onSuccess: function (manifest) { onInstalled(manifest); },
    busyError: new UserError("BUSY_INSTALL", "已经在装插件了", "等这一次装完。")
  });

  /*
   * 装最新那一版。跑在后台：调用方立刻拿到 started，进度与结果都在 status().task 里，界面轮询 status 就行。
   */
  function install() {
    const manifest = installableManifest();
    failure = null;
    const started = downloadTask.start(manifest);
    return { started: started.started, version: started.version, note: started.reason, status: status() };
  }

  // 后台复查与程序更新共用同一处（lib/recheck.js 的 createRecheck）。
  const startWatch = createRecheck({
    isBusy: function () { return downloadTask.running(); },
    check: function () { return check({ silent: true }); }
  });

  return { status: status, check: check, install: install, startWatch: startWatch };
}

// STORE_LAYOUT 也导出：用例按它摆「半成品残骸」，改名时用例跟着一起变（不再照抄字符串）。
module.exports = { createPluginUpdate, STORE_LAYOUT };
