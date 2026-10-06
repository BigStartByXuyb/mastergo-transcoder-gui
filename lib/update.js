"use strict";

/*
 * 程序更新：远端清单 → 逐文件差分 → 只下不一致的内容 → 落 versions/<版本>/ → 切 current.json。
 *
 * 谁在用：lib/routes.js 的 /api/update/*（设置页的四个按钮）。
 * 远端长什么样、从哪儿取，由「发布源」决定（见 lib/source.js）：GitHub Releases / GitLab 通用包 / 任意静态目录，
 * 三种都能提供「一份清单 + 按 sha256 命名的文件」，所以客户端只有这一套实现。
 * 清单 {version, files:{路径: sha256}, releasedAt, minClientVersion, freshRunRequired}；
 * 文件按内容哈希命名 —— 只改一个文件就只传/只下一次。
 * 边界：只管程序自身这一条版本线。Node / PowerShell 在关键路径上，坏了整个客户端起不来，不参与切换。
 * 切换只写指针，不抽走正在跑的目录：新版本由 launch.js 在下次启动时按指针进入。
 */

const fs = require("fs");
const path = require("path");

const { UserError, toFailure } = require("./errors.js");
const { buildManifest, diffManifests } = require("./app-manifest.js");
const { createBundleStore } = require("./bundle-store.js");
const { fetchBuffer } = require("./download.js");
const { createManifestFetch, createManifestCache, CACHE_DIR } = require("./manifest-fetch.js");
const { notesOf, readChangelog } = require("./changelog.js");
const source = require("./source.js");

// 清单名属于发布协议：名字只在 lib/source.js 定义一处（插件那一半用另一份名字，从同一处取）。
const MANIFEST_NAME = source.MANIFEST_NAME;
/** 后台复查间隔：启动时查一次，之后按这个间隔再查，界面上的「有新版」标注靠它保持新鲜。 */
const RECHECK_MS = 10 * 60 * 1000;

// 版本号只按数字段比（1.10.0 > 1.9.0）；段数不齐时短的补 0。
function compareVersions(a, b) {
  const left = String(a || "").split(".");
  const right = String(b || "").split(".");
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const x = Number(left[index] || 0);
    const y = Number(right[index] || 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return String(a || "").localeCompare(String(b || ""));
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function isNewer(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

function createUpdate(options) {
  const opts = options || {};
  const home = path.resolve(opts.home);
  const root = path.resolve(opts.root || home);
  const version = String(opts.version || "0.0.0");
  const fetchImpl = opts.fetchImpl || fetch;
  const isBusy = opts.isBusy || function () { return ""; };
  const now = opts.now || function () { return new Date().toISOString(); };
  // 取清单那一套（源 / 凭据 / 地址 / 重试）与插件那一半共用一处实现。
  const manifestFetch = createManifestFetch({
    manifestName: MANIFEST_NAME,
    fetchImpl: fetchImpl,
    source: opts.source,
    token: opts.token
  });
  /*
   * 有没有 token 与 token 的值分开问：值要走 DPAPI 解密（同步起 PowerShell），
   * 而 status() 被前端每 15 秒（下载中每 1.5 秒）轮询一次 —— 轮询路径上只做廉价的文件存在性判断。
   */
  const hasTokenOf = typeof opts.hasToken === "function"
    ? opts.hasToken
    : function () { return Boolean(String(manifestFetch.token() || "").trim()); };

  const store = createBundleStore(home);
  // 清单缓存（上一次拉到的清单与差分）与插件那一半共用同一份实现。
  const cache = createManifestCache({ dir: path.join(home, CACHE_DIR), name: MANIFEST_NAME, now: now });

  // 上一次动作的结果与下载进度：status() 每次读的都是这里。
  let failure = null;
  let task = { phase: "idle", done: 0, total: 0, downloaded: 0, error: null };
  let running = null;
  let watchTimer = null;
  /**
   * 切换时被查出「与清单对不上」的那几份：本次运行里设置页与探活都不再说它可切换，
   * 免得用户反复点同一条报错。重新下载成功即摘掉；重启客户端也会清空 ——
   * 真正的门禁是切换前的逐文件校验，这里只是别让人白点。
   */
  const brokenStaged = new Set();

  /** 某一版的清单地址：历史版本按自己的 tag 取，这样任意旧版也能下回来。 */
  function manifestUrlOf(version) {
    return source.manifestUrlOf(manifestFetch.currentSource(), version);
  }

  // 远端按内容寻址：同一个哈希在不同版本里也只存一份，地址里带版本取回来即可。
  function blobUrl(hash, manifestVersion) {
    return source.blobUrl(manifestFetch.currentSource(), manifestVersion, hash);
  }

  const sourceHeaders = manifestFetch.headers;

  /*
   * 每一版自己的清单都要留下来：切换前的逐文件校验按目标那一版的清单做，
   * 只留「最新版那份」的话，历史版本切换时就无从校验（这正是这一版修的问题）。
   */
  function versionManifestPath(version) {
    return path.join(home, CACHE_DIR, "manifests", String(version) + ".json");
  }

  function readVersionManifest(version) {
    try {
      const parsed = JSON.parse(fs.readFileSync(versionManifestPath(version), "utf8"));
      return parsed && parsed.files ? parsed : null;
    }
    catch {
      return null;
    }
  }

  function writeVersionManifest(manifest) {
    try {
      const file = versionManifestPath(manifest.version);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    }
    catch {
      // 留不下清单不影响这一版能不能跑；下次切换前按缓存那份兜底。
    }
  }

  // 本地这份运行树自己算一遍清单：差分比的就是它和远端清单。
  function localManifest() {
    return buildManifest(root, version);
  }

  // 安装根自己那一份（首次运行用的引导副本）的版本号：指针指回它就叫回退。
  function bootstrapVersion() {
    try {
      return String(JSON.parse(fs.readFileSync(path.join(home, "package.json"), "utf8")).version || "");
    }
    catch {
      return "";
    }
  }

  // 本地能切的目标 = 安装根自己这一份 + versions/ 里各一份。
  function stagedVersions() {
    const out = [];
    const bootstrap = bootstrapVersion();
    if (bootstrap && fs.existsSync(path.join(home, "server.js"))) out.push(bootstrap);
    for (const item of store.listVersions()) {
      if (out.indexOf(item) < 0 && fs.existsSync(path.join(store.versionDir(item), "server.js"))) out.push(item);
    }
    return out;
  }

  function dirOf(target) {
    if (fs.existsSync(path.join(store.versionDir(target), "server.js"))) return store.versionDir(target);
    if (bootstrapVersion() === target && fs.existsSync(path.join(home, "server.js"))) return home;
    return "";
  }

  /*
   * 本地某一份算不算「可以切过去」：找得到那一份的目录（versions/<版本> 或安装根自己那份），
   * 而且没有被发现「与清单对不上」。判据只有这一处 —— 设置页与探活都读它。
   *
   * 这里故意不做整树哈希：探活每 5 秒问一次，读整棵树是白烧 IO；
   * 半成品不会冒充成品（下载是拼完校验过才 rename 成正式目录，.building-* 从不被认），
   * 真正切换前 apply() 会按清单逐文件校验，对不上就把这一版记进 brokenStaged，之后两边都不再说它可切换。
   */
  function stagedReachable(item) {
    return !brokenStaged.has(item) && Boolean(dirOf(item));
  }

  // 已经下载完、可以切过去的那一份：优先缓存清单里那一版，否则取本地比当前新的最高版本。
  function readyVersion() {
    const cached = cache.read();
    const staged = stagedVersions();
    if (cached && staged.includes(cached.manifest.version) && isNewer(cached.manifest.version, version)) {
      if (stagedReachable(cached.manifest.version)) return cached.manifest.version;
    }
    const candidates = staged.filter(function (item) { return isNewer(item, version); }).sort(compareVersions);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      if (stagedReachable(candidates[index])) return candidates[index];
    }
    return "";
  }

  /*
   * 回退目标 = 指针自己记着的「切之前是哪一版」，且那一版在本地还找得到。
   * 只认指针，不做猜测：切回去之后指针里没有上一版了，回退按钮就自然没有目标
   * （要换到别的版本走下面那份本地版本列表）。
   */
  function rollbackTarget() {
    const pointer = store.readPointer() || {};
    const previous = String(pointer.previous || "");
    if (!previous || previous === String(pointer.version || "")) return "";
    return dirOf(previous) ? previous : "";
  }

  // 外壳太旧就不给切：清单里的 minClientVersion 是硬下限。
  function versionBlocked(manifest) {
    const min = String((manifest && manifest.minClientVersion) || "");
    if (!min || compareVersions(version, min) >= 0) return null;
    return new UserError(
      "CLIENT_TOO_OLD",
      "v" + manifest.version + " 要求客户端至少 v" + min,
      "先用安装包把客户端升到 v" + min + "，再走这里更新。"
    );
  }

  function status() {
    const snapshot = readState();
    const staged = stagedVersions().map(function (item) {
      const known = readVersionManifest(item);
      return {
        version: item,
        current: item === version,
        ready: stagedReachable(item),
        // 这一版要不要新开一次运行：清单里写着就说，没留清单的（很老的版本）说 null。
        freshRunRequired: known ? known.freshRunRequired !== false : null
      };
    });
    return {
      state: snapshot.state,
      current: version,
      currentNotes: notesOf(root, version),
      /** 这一份运行树自带的版本历史：界面按版本号在这里找「改了什么」。 */
      history: readChangelog(root),
      root: root,
      pointer: store.readPointer(),
      busy: String(isBusy() || ""),
      staged: staged,
      ready: snapshot.ready,
      rollback: rollbackTarget(),
      // 设置页要显示「这一版改了什么」：清单里没写就按本地 changelog 补上（探活那条路不做这一步）。
      available: snapshot.available
        ? Object.assign({}, snapshot.available, {
            notes: snapshot.available.notes.length
              ? snapshot.available.notes
              : notesOf(root, snapshot.available.version)
          })
        : null,
      error: failure,
      task: task,
      // 现在会去哪个地址取清单，以及有没有带 creds：设置页把这一份照实显示出来。
      source: manifestFetch.describe(),
      hasToken: Boolean(hasTokenOf())
    };
  }

  /*
   * 拉远端清单。silent 用于启动时的后台自动检测：失败不落到界面上。
   * 检查成功就把清单与差分结果缓存下来，status() 之后离线也能显示「有新版/改了几个文件」。
   */
  async function check(options) {
    const silent = Boolean((options || {}).silent);
    try {
      const remote = await manifestFetch.fetchManifest();
      const local = localManifest();
      // 本地同内容的文件直接进内容库：这就是「只下变了的」那一步。
      store.seedFrom(root, local, remote);
      cache.write(remote, diffManifests(local, remote));
      // 某一版的清单也留一份：切换前按目标那一版校验。
      writeVersionManifest(remote);
      failure = null;
    }
    catch (error) {
      if (!silent) failure = toFailure(error);
    }
    return status();
  }

  /*
   * 下载某一版（新版与历史版本都走这里）：按那一版的 tag 取它自己的清单，
   * 再走同一条 materialize（同内容只传一次、拼完校验过才 rename 成正式目录）。
   * 跑在后台：调用方立刻拿到 started，进度与结果都在 status().task 里，界面轮询 status 就行。
   */
  async function stage(targetVersion) {
    const wanted = String(targetVersion || "").trim();
    if (!wanted) throw new UserError("NO_VERSION", "没说是哪一版", "从版本列表里点某一行的「下载这一版」。");
    let manifest = null;
    try {
      manifest = await manifestFetch.fetchFrom(manifestUrlOf(wanted));
    }
    catch (error) {
      throw new UserError("NO_REMOTE_VERSION", "远端没有 v" + wanted + " 这一版", toFailure(error).message);
    }
    if (!manifest || !manifest.files || String(manifest.version || "") !== wanted) {
      throw new UserError("BAD_MANIFEST", "远端 v" + wanted + " 的清单不是清单格式", manifestUrlOf(wanted));
    }
    return downloadManifest(manifest);
  }

  /*
   * 下载一份给定的清单。两个入口（下最新版 / 下某一版）都走这里：
   * 一次只跑一条下载、本地已有就早退、拼完才 rename 成正式目录 —— 判据只有这一处。
   */
  function downloadManifest(manifest) {
    if (running) throw new UserError("BUSY_DOWNLOAD", "已经在下载了", "等这一次下载结束。");
    const blocked = versionBlocked(manifest);
    if (blocked) {
      failure = toFailure(blocked);
      throw blocked;
    }
    if (stagedReachable(manifest.version)) {
      task = { phase: "done", done: 0, total: 0, downloaded: 0, error: null };
      return { started: false, version: manifest.version, reason: "本地已经有这一版", status: status() };
    }
    task = { phase: "downloading", done: 0, total: 0, downloaded: 0, error: null };
    failure = null;
    running = store
      .materialize(
        manifest,
        function (hash) {
          return fetchBuffer(blobUrl(hash, manifest.version), { fetchImpl: fetchImpl, headers: sourceHeaders() });
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
        // 重下一份成功就把「坏了」的记号摘掉：这一版又可以切了。
        brokenStaged.delete(manifest.version);
        // 这一版自己的清单留下来：切换前按它校验（历史版本也一样）。
        writeVersionManifest(manifest);
        return result;
      })
      .catch(function (error) {
        task = { phase: "error", done: task.done, total: task.total, downloaded: task.downloaded, error: toFailure(error) };
      })
      .finally(function () {
        running = null;
      });
    return { started: true, version: manifest.version, status: status() };
  }

  function requireIdle() {
    const busy = String(isBusy() || "");
    if (busy) throw new UserError("RUNNING_TASKS", "有任务在跑，先等它结束", busy);
  }

  // 切版本：只写指针。运行中的进程不被抽文件，新版本下次启动生效。
  function apply(targetVersion) {
    requireIdle();
    const target = String(targetVersion || readyVersion() || "");
    if (!target) throw new UserError("NO_VERSION", "本地还没有下载好的新版本", "先点「检查更新」，再点「下载」。");
    if (target === version) throw new UserError("SAME_VERSION", "已经运行在 v" + version + " 上", "");
    const dir = dirOf(target);
    if (!dir) {
      throw new UserError("NO_STAGED", "本地没有 v" + target, "先点「下载」把这一版拉下来。");
    }
    /*
     * 切换前按目标那一版自己的清单逐文件校验：历史版本也有（下载时留下的那份清单）。
     * 留不下清单（很老的版本、没下载过清单）就退回最新版缓存那一份，仍不做无清单的盲切。
     */
    const cached = cache.read();
    const known = readVersionManifest(target) || (cached && cached.manifest) || null;
    if (known && known.version === target) {
      const blocked = versionBlocked(known);
      if (blocked) throw blocked;
      const bad = store.verifyDir(dir, known);
      if (bad.length) {
        // 记下来：这一份在重新下载之前不算可切换，设置页与探活两边一致。
        brokenStaged.add(target);
        throw new UserError("STAGED_BROKEN", "本地这份 v" + target + " 和清单对不上", bad.slice(0, 5).join("、"));
      }
    }
    store.writePointer({ version: target, previous: version, switchedAt: now() });
    return { ok: true, version: target, previous: version, restartRequired: true, status: status() };
  }

  function rollback() {
    requireIdle();
    const target = rollbackTarget();
    if (!target) throw new UserError("NO_ROLLBACK", "没有可回退的版本", "回退只在刚切过版本之后可用；换别的版本用版本列表。");
    store.writePointer({ version: target, previous: "", switchedAt: now() });
    return { ok: true, version: target, restartRequired: true, status: status() };
  }

  /*
   * 常驻复查：启动时已经查过一次，之后按间隔再查（正在下载时跳过，别和下载抢缓存）。
   * 只拉一份清单，失败不出声；界面上的「有新版」标注读的就是这次结果。
   */
  function startWatch() {
    if (watchTimer) return;
    watchTimer = setInterval(function () {
      if (running) return;
      void check({ silent: true });
    }, RECHECK_MS);
    if (typeof watchTimer.unref === "function") watchTimer.unref();
  }

  /*
   * 四态与「可以切哪一版」只有这一处算法：设置页的 status() 与探活的 hint() 都从它派生，判据不会分叉。
   */
  function readState() {
    const cached = cache.read();
    const ready = readyVersion();
    // 已经下载好的那一版要不要新开一次运行：清单里写着，切过去之前要在确认弹窗里说清楚。
    const readyManifest = ready ? readVersionManifest(ready) : null;
    const blocked = cached ? versionBlocked(cached.manifest) : null;
    const available = cached
      ? {
          version: cached.manifest.version,
          releasedAt: String(cached.manifest.releasedAt || ""),
          minClientVersion: String(cached.manifest.minClientVersion || ""),
          freshRunRequired: cached.manifest.freshRunRequired !== false,
          changed: ((cached.diff || {}).changed || []).length,
          removed: ((cached.diff || {}).removed || []).length,
          total: ((cached.diff || {}).total || 0),
          blocked: blocked ? toFailure(blocked) : null,
          checkedAt: String(cached.checkedAt || ""),
          // 远端清单里带着它的更新内容（发布时从同一份 changelog.json 写进去）；
          // 清单里没有就留空，由设置页用本地 changelog 补 —— 探活那条路不该为此读文件。
          notes: Array.isArray(cached.manifest.notes) ? cached.manifest.notes.map(String) : []
        }
      : null;
    let state = "up_to_date";
    if (ready) state = "download_ready";
    else if (failure) state = "error";
    else if (available && isNewer(available.version, version)) state = "update_available";
    return {
      state: state,
      ready: ready,
      available: available,
      stagedFreshRunRequired: readyManifest ? readyManifest.freshRunRequired !== false : null
    };
  }

  /** 给 /api/health 用的精简快照：与 status() 同一份判据，只裁掉版本历史这些大件。 */
  function hint() {
    const snapshot = readState();
    return {
      state: snapshot.state,
      current: version,
      ready: snapshot.ready,
      // 有任务在跑时不能换版本：顶栏那条入口也要能提前挡住（后端同样会拒）。
      busy: String(isBusy() || ""),
      availableVersion: snapshot.available ? snapshot.available.version : "",
      stagedFreshRunRequired: snapshot.stagedFreshRunRequired
    };
  }

  return {
    status: status,
    check: check,
    stage: stage,
    apply: apply,
    rollback: rollback,
    readyVersion: readyVersion,
    rollbackTarget: rollbackTarget,
    startWatch: startWatch,
    hint: hint
  };
}

module.exports = { createUpdate, compareVersions };
