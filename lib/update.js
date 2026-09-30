"use strict";

/*
 * 程序更新：远端清单 → 逐文件差分 → 只下不一致的内容 → 落 versions/<版本>/ → 切 current.json。
 *
 * 谁在用：lib/routes.js 的 /api/update/*（设置页的四个按钮）。
 * 远端长什么样（GitHub Releases，公开仓库，不需要自建服务端）：
 *   releases/latest/download/manifest.json   清单 {version, files:{路径: sha256}, releasedAt, minClientVersion, freshRunRequired}
 *   releases/download/v<版本>/<sha256>        文件按内容哈希命名，只改一个文件就只传/只下那一个
 * 边界：只管程序自身这一条版本线。Node / PowerShell 在关键路径上，坏了整个客户端起不来，不参与切换。
 * 切换只写指针，不抽走正在跑的目录：新版本由 launch.js 在下次启动时按指针进入。
 */

const fs = require("fs");
const path = require("path");

const { UserError, toFailure } = require("./errors.js");
const { buildManifest, diffManifests } = require("./app-manifest.js");
const { createBundleStore } = require("./bundle-store.js");
const { fetchBuffer, fetchJson } = require("./download.js");
const { notesOf, readChangelog } = require("./changelog.js");

const DEFAULT_OWNER = "BigStartByXuyb";
const DEFAULT_REPO = "mastergo-transcoder-gui";

const CACHE_DIR = "update-cache";
const MANIFEST_NAME = "manifest.json";
const MANIFEST_TIMEOUT_MS = 15000;
const MANIFEST_ATTEMPTS = 2;
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
  const owner = opts.owner || DEFAULT_OWNER;
  const repo = opts.repo || DEFAULT_REPO;
  const fetchImpl = opts.fetchImpl || fetch;
  const isBusy = opts.isBusy || function () { return ""; };
  const now = opts.now || function () { return new Date().toISOString(); };

  const store = createBundleStore(home);
  const cachePath = path.join(home, CACHE_DIR, MANIFEST_NAME);

  // 上一次动作的结果与下载进度：status() 每次读的都是这里。
  let failure = null;
  let task = { phase: "idle", done: 0, total: 0, downloaded: 0, error: null };
  let running = null;
  let watchTimer = null;
  /** 切换时被查出「与清单对不上」的那几份：重新下载之前，设置页与探活都不再说它可切换。 */
  const brokenStaged = new Set();

  function manifestUrl() {
    return "https://github.com/" + owner + "/" + repo + "/releases/latest/download/" + MANIFEST_NAME;
  }

  // 远端按内容寻址：同一个哈希在不同版本里也只存一份，客户端地址里带版本 tag 取回来即可。
  function blobUrl(hash, manifestVersion) {
    return "https://github.com/" + owner + "/" + repo + "/releases/download/v" + manifestVersion + "/" + hash;
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
    const payload = { checkedAt: now(), manifest: manifest, diff: diff };
    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
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
    const cache = readCache();
    const staged = stagedVersions();
    if (cache && staged.includes(cache.manifest.version) && isNewer(cache.manifest.version, version)) {
      if (stagedReachable(cache.manifest.version)) return cache.manifest.version;
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
      return { version: item, current: item === version, ready: stagedReachable(item) };
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
      repo: owner + "/" + repo
    };
  }

  /*
   * 拉远端清单。silent 用于启动时的后台自动检测：失败不落到界面上。
   * 检查成功就把清单与差分结果缓存下来，status() 之后离线也能显示「有新版/改了几个文件」。
   */
  async function check(options) {
    const silent = Boolean((options || {}).silent);
    try {
      const remote = await fetchJson(manifestUrl(), {
        fetchImpl: fetchImpl,
        attempts: MANIFEST_ATTEMPTS,
        timeoutMs: MANIFEST_TIMEOUT_MS
      });
      if (!remote || !remote.version || !remote.files || typeof remote.files !== "object") {
        throw new UserError("BAD_MANIFEST", "远端清单不是清单格式", manifestUrl());
      }
      const local = localManifest();
      // 本地同内容的文件直接进内容库：这就是「只下变了的」那一步。
      store.seedFrom(root, local, remote);
      writeCache(remote, diffManifests(local, remote));
      failure = null;
    }
    catch (error) {
      if (!silent) failure = toFailure(error);
    }
    return status();
  }

  /*
   * 下载缺失内容并拼出下一版。跑在后台：调用方立刻拿到 started，
   * 进度与结果都在 status().task 里，界面轮询 status 就行。
   */
  function startDownload() {
    if (running) throw new UserError("BUSY_DOWNLOAD", "已经在下载了", "等这一次下载结束。");
    const cache = readCache();
    if (!cache) throw new UserError("NO_MANIFEST", "还没有检查过更新", "先点「检查更新」。");
    const manifest = cache.manifest;
    const blocked = versionBlocked(manifest);
    if (blocked) {
      failure = toFailure(blocked);
      throw blocked;
    }
    if (!isNewer(manifest.version, version) && stagedReady(manifest.version)) {
      task = { phase: "done", done: 0, total: 0, downloaded: 0, error: null };
      return { started: false, version: manifest.version, reason: "本地已经有这一版", status: status() };
    }

    task = { phase: "downloading", done: 0, total: 0, downloaded: 0, error: null };
    failure = null;
    running = store
      .materialize(
        manifest,
        function (hash) {
          return fetchBuffer(blobUrl(hash, manifest.version), { fetchImpl: fetchImpl });
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
    const cache = readCache();
    if (cache && cache.manifest.version === target && dir === store.versionDir(target)) {
      const blocked = versionBlocked(cache.manifest);
      if (blocked) throw blocked;
      const bad = store.verifyDir(dir, cache.manifest);
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
    const cache = readCache();
    const ready = readyVersion();
    const blocked = cache ? versionBlocked(cache.manifest) : null;
    const available = cache
      ? {
          version: cache.manifest.version,
          releasedAt: String(cache.manifest.releasedAt || ""),
          minClientVersion: String(cache.manifest.minClientVersion || ""),
          freshRunRequired: cache.manifest.freshRunRequired !== false,
          changed: ((cache.diff || {}).changed || []).length,
          removed: ((cache.diff || {}).removed || []).length,
          total: ((cache.diff || {}).total || 0),
          blocked: blocked ? toFailure(blocked) : null,
          checkedAt: String(cache.checkedAt || ""),
          // 远端清单里带着它的更新内容（发布时从同一份 changelog.json 写进去）；
          // 清单里没有就留空，由设置页用本地 changelog 补 —— 探活那条路不该为此读文件。
          notes: Array.isArray(cache.manifest.notes) ? cache.manifest.notes.map(String) : []
        }
      : null;
    let state = "up_to_date";
    if (ready) state = "download_ready";
    else if (failure) state = "error";
    else if (available && isNewer(available.version, version)) state = "update_available";
    return { state: state, ready: ready, available: available };
  }

  /** 给 /api/health 用的精简快照：与 status() 同一份判据，只裁掉版本历史这些大件。 */
  function hint() {
    const snapshot = readState();
    return {
      state: snapshot.state,
      ready: snapshot.ready,
      availableVersion: snapshot.available ? snapshot.available.version : ""
    };
  }

  return {
    status: status,
    check: check,
    startDownload: startDownload,
    apply: apply,
    rollback: rollback,
    readyVersion: readyVersion,
    rollbackTarget: rollbackTarget,
    startWatch: startWatch,
    hint: hint
  };
}

module.exports = { createUpdate, compareVersions };
