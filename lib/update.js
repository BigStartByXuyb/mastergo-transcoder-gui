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
const { buildManifest } = require("./app-manifest.js");
const { createBundleStore } = require("./bundle-store.js");
// 壳文件那两份（跟着生效版本走，见下面的 apply）：名单只有一处（lib/bootstrap.js）。
const { SUPERVISOR_FILES } = require("./bootstrap.js");
const { fetchBuffer } = require("./download.js");
const { createManifestFetch, createManifestCache, summarizeCache, CACHE_DIR } = require("./manifest-fetch.js");
const { createRecheck } = require("./recheck.js");
const { syncManifest, createDownloadTask } = require("./update-task.js");
// 容错读 JSON 只有一处（lib/workdir.js）：这一条线读「正在切换」那一笔也走它。
const { readJsonIfExists } = require("./workdir.js");
const { compareVersions, isNewer } = require("./versions.js");
const { requireIdle } = require("./idle.js");
const { readChangelog, notesOfEntries, missingForEveryVersion } = require("./changelog.js");
const source = require("./source.js");

// 清单名属于发布协议：名字只在 lib/source.js 定义一处（插件那一半用另一份名字，从同一处取）。
const MANIFEST_NAME = source.MANIFEST_NAME;
function createUpdate(options) {
  const opts = options || {};
  /*
   * 源由装配处必给（server.js 注入设置里那一项）—— 与插件那条线同一条规矩：
   * 缺了直接说，不在模块里自带一份会静默顶替装配结果的回落。
   */
  if (typeof opts.source === "undefined") {
    throw new Error("createUpdate 要给 source：程序更新这条线从哪儿取清单");
  }
  // 这条线自己的身份：设置字段名（界面按它存）与坏配置回落哪份默认 —— 只在这里取一次。
  const line = source.lineOf("source");
  const home = path.resolve(opts.home);
  const root = path.resolve(opts.root || home);
  /*
   * 「正在切换」那一笔（见 apply）：写在这里、启动时清掉。
   * 进程起来 = 上一次切换已经落地（或客户端被手动重开过），这一笔就不该再拦人。
   */
  const switchingPath = path.join(home, "switching.json");
  try {
    fs.rmSync(switchingPath, { force: true });
  }
  catch {
    // 清不掉不影响判断：readSwitching 会按时间窗判它是不是过期。
  }
  /* 这一笔只在切完前有效：30 秒还没切完（卡住、或那台机器慢）就当它过期，别把人永久挡住。 */
  const SWITCHING_WINDOW_MS = 30000;
  /*
   * 互斥只对「会重启的形态」有意义：被监督拉起时（客户端那个窗口）写指针之后这一份会退出、
   * 监督进程按新指针再拉一份；直接 node server.js 起的没有这一步，写指针就是全部动作，
   * 这时既不该记这一笔，也不该拦下一个人再切。
   * 这一事实由装配处给（server.js 判一次，routes 与这条线读同一份）—— 这里不自己读环境变量重推一遍。
   */
  const supervised = opts.supervised === true;

  function readSwitching() {
    const doc = readJsonIfExists(switchingPath);
    if (!doc || !doc.target || !doc.at) return null;
    const at = Date.parse(doc.at);
    if (!Number.isFinite(at) || Date.now() - at > SWITCHING_WINDOW_MS) return null;
    return { target: String(doc.target), at: doc.at };
  }

  function writeSwitching(target) {
    if (!supervised) return;
    try {
      fs.writeFileSync(switchingPath, JSON.stringify({ target: target, at: new Date().toISOString() }) + "\n", "utf8");
    }
    catch {
      // 记不下这一笔时照样切：互斥是防「同一个停点被切两次」，不是切换的前置条件。
    }
  }

  /*
   * 互斥的两半都只有这一处：走 apply 与 rollback 两条路。
   * 「拦」在校验之前（另一个目标在切就直接拒，什么也不改）；「记」在写指针之前
   *（校验没过就抛出，那一笔不该留下 —— 否则被拒一次，几分钟内都切不了别版）。
   */
  function guardSwitching(target) {
    const switching = readSwitching();
    if (!switching) return;
    /* 同一个目标：等价于重试（那一次没切成功），放行。 */
    if (switching.target === target) return;
    /*
     * 「有没有落地」看的是**正在跑的那一版**，不是指针：指针在退出之前就写好了，拿它判会恒早退
     *（这正是上一版互斥形同不存在的原因，语义审计判了 BLOCK）。新进程起来时会把这一笔清掉，
     * 这里这一条只是兜底。
     */
    if (String(version) === switching.target) return;
    throw new UserError(
      "SWITCHING",
      "正在切到 v" + switching.target + "（" + switching.at + "）",
      "等它起来（界面会自己回来）再点；确实要改切另一版，等这次切完再点。"
    );
  }
  const version = String(opts.version || "0.0.0");
  const fetchImpl = opts.fetchImpl || fetch;
  const isBusy = opts.isBusy || function () { return ""; };
  const now = opts.now || function () { return new Date().toISOString(); };
  // 取清单那一套（源 / 凭据 / 地址 / 重试）与插件那一半共用一处实现。
  const manifestFetch = createManifestFetch({
    manifestName: MANIFEST_NAME,
    fetchImpl: fetchImpl,
    source: opts.source,
    // 这条线（字段名 + 坏配置回哪份默认）：与插件那一半同一个形状，各给各的那一条。
    line: line,
    token: opts.token,
    // 有没有 token 与取值分开：装配处注入廉价的「设置里记的那个标记」，轮询路径上不解密。
    hasToken: opts.hasToken
  });

  const store = createBundleStore(home);
  // 清单缓存（上一次拉到的清单与差分）与插件那一半共用同一份实现；记着这份结果来自哪个源。
  const cache = createManifestCache({
    dir: path.join(home, CACHE_DIR),
    manifestName: MANIFEST_NAME,
    source: opts.source,
    line: line,
    now: now
  });

  // 上一次动作的结果：status() 每次读的都是这里。下载进度与阶段在下面的 downloadTask 里。
  let failure = null;
  /**
   * 切换时被查出「与清单对不上」的那几份：本次运行里设置页与探活都不再说它可切换，
   * 免得用户反复点同一条报错。重新下载成功即摘掉；重启客户端也会清空 ——
   * 真正的门禁是切换前的逐文件校验，这里只是别让人白点。
   */
  const brokenStaged = new Set();

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

  /*
   * 某一版的清单从哪儿来：下载这一版时留下的那份，或最近一次检查缓存里的那份（都没有就没有）。
   * 切换前的校验与「安装根那一份像不像这一版」都从这里取，不再各读各的。
   */
  function manifestOf(target) {
    const cached = cache.read();
    const known = readVersionManifest(target) || (cached && cached.manifest) || null;
    return known && known.version === target ? known : null;
  }

  /*
   * 这一份与清单对不上的文件（清单里没有的、读不出来的都算）。判据只有这一处：
   * 切换前校验与安装根那一份的核验共用它。
   *
   * 安装根那一份不看壳文件那两份：`launch.js` / `lib/launch.js` 按设计跟着「当前生效的那一版」走
   * （lib/bootstrap.js 每次启动会把安装根的壳对齐到正在跑的那一版），所以它天然可能与这一版清单里的
   * 那两份不同 —— 那是设计如此，不是这一份坏了。版本目录里的副本照旧全量校验。
   */
  function mismatchedFiles(dir, manifest) {
    return store.verifyDir(dir, manifest).filter(function (name) {
      return !(dir === home && SUPERVISOR_FILES.indexOf(name) >= 0);
    });
  }

  /*
   * 安装根那一份（「本地这一份」）算不算它自己声称的那一版：版本号对得上不算数，得真的像那一版
   * —— 开发树、手工改过的树、装了一半的树都可能只有版本号是对的（发布件里那份 `mastergo-transcoder.exe`
   * 是 CI 现编的，本地这一份是本机工具链编的，字节本来就不同，见 .gitignore）。
   *
   * 核一次要读整棵树，而探活每 5 秒问一次，所以结论缓存；下载成功、写完指针、检查拿到新清单时清掉重核。
   * 没有清单可核（从没检查过 / 离线）时按原来那样认它：可移动安装离线回到自己那一份这条路不能断。
   */
  const installRootVerdict = new Map();
  function installRootIsVersion(item) {
    const known = manifestOf(item);
    if (!known) return true;
    if (installRootVerdict.has(item)) return installRootVerdict.get(item);
    const ok = mismatchedFiles(home, known).length === 0;
    installRootVerdict.set(item, ok);
    return ok;
  }

  /*
   * 写指针：只有这一处（切换与回退都走它）。指针一变，安装根那一份与「正在跑的是哪一版」的关系就变，
   * 核过的结论跟着作废 —— 作废点跟着写指针走，就不会再漏一条路。
   */
  function writePointer(next) {
    store.writePointer(next);
    installRootVerdict.clear();
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
    // 清单可能变了（重新发布过同一版）：按它核过的结论跟着作废。
    installRootVerdict.clear();
  }

  // 本地这一份：目录、版本、清单（差分比的就是它和远端清单）。
  function localState() {
    return { dir: root, version: version, manifest: buildManifest(root, version) };
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
   * 版本目录不做整树哈希：那是下载时按清单核过才 rename 成正式目录的（.building-* 从不被认），
   * 再读一遍是白烧 IO。安装根那一份没有这道保证（它是一棵树，可能被改过、可能是开发树、
   * 也可能装了一半），所以那里要按清单核一次 —— 结论缓存，理由见 installRootIsVersion。
   */
  function stagedReachable(item) {
    if (brokenStaged.has(item)) return false;
    const dir = dirOf(item);
    if (!dir) return false;
    return dir === home ? installRootIsVersion(item) : true;
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
    const changelog = readChangelog(root);
    // 回退「缺哪些能力」一趟算好（每个版本一份），界面只渲染。
    const missingByVersion = missingForEveryVersion(changelog, version);
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
      currentNotes: notesOfEntries(changelog, version),
      /** 这一份运行树自带的版本历史：界面按版本号在这里找「改了什么」。 */
      history: changelog.map(function (entry) {
        // 界面只要「改了什么 + 回退缺什么」；features / drops 是算缺什么用的中间料，不往外发。
        return {
          version: entry.version,
          date: entry.date,
          notes: entry.notes,
          missingFromCurrent: missingByVersion.get(entry.version) || []
        };
      }),
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
              : notesOfEntries(changelog, snapshot.available.version)
          })
        : null,
      error: failure,
      task: downloadTask.task(),
      // 现在会去哪个地址取清单、这项设置叫什么、有没有带 creds：设置页把这一份照实显示出来。
      ...manifestFetch.describe()
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
      // 本地同内容的文件直接进内容库、清单与差分写进缓存（两步都在共用的 syncManifest 里）。
      syncManifest({ store: store, cache: cache, remote: remote, localManifest: localState });
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
      manifest = await manifestFetch.fetchFrom(manifestFetch.manifestUrlOf(wanted));
    }
    catch (error) {
      // 「这一版远端没有」与「这一版的清单取到了但不是清单」分开说：前者换一版，后者要去查发布件。
      const reason = toFailure(error);
      if (reason.code !== "HTTP_404") throw error;
      throw new UserError("NO_REMOTE_VERSION", "远端没有 v" + wanted + " 这一版", reason.message);
    }
    // 形状由 fetchFrom 保证；这里只认「取到的清单是不是要的那一版」。
    if (String(manifest.version || "") !== wanted) {
      throw new UserError("BAD_MANIFEST", "远端 v" + wanted + " 的清单指的是别的版本", manifestFetch.manifestUrlOf(wanted));
    }
    return downloadManifest(manifest);
  }

  /*
   * 下载一份给定的清单。两个入口（下最新版 / 下某一版）都走这里：
   * 一次只跑一条下载、本地已有就早退、拼完才 rename 成正式目录 —— 判据只有这一处。
   */
  function downloadManifest(manifest) {
    const blocked = versionBlocked(manifest);
    if (blocked) {
      failure = toFailure(blocked);
      throw blocked;
    }
    failure = null;
    const started = downloadTask.start(manifest);
    return { started: started.started, version: started.version, reason: started.reason, status: status() };
  }

  /*
   * 下载这一条：一次只跑一条、本地已有就早退、拼完才 rename —— 编排在 lib/update-task.js 一处，
   * 这里只给这条线自己特有的三样：本地那份算不算「已经有」、内容从哪取、下完要收什么尾。
   */
  const downloadTask = createDownloadTask({
    store: store,
    fetchBlob: function (manifest, hash) {
      // 远端按内容寻址：同一个哈希在不同版本里也只存一份，地址里带版本取回来即可（拼法在取清单那一套里）。
      return fetchBuffer(manifestFetch.fileUrl(manifest.version, hash), { fetchImpl: fetchImpl, headers: sourceHeaders() });
    },
    // 「本地已经有这一版」认的是「本机能切到那一版」（可能在安装根自己这一份里）。
    skipIf: function (manifest) { return stagedReachable(manifest.version); },
    onSuccess: function (manifest) {
      // 重下一份成功就把「坏了」的记号摘掉：这一版又可以切了。
      brokenStaged.delete(manifest.version);
      // 这一版自己的清单留下来：切换前按它校验（历史版本也一样）。
      writeVersionManifest(manifest);
    }
  });

  // 切版本：只写指针。运行中的进程不被抽文件，新版本下次启动生效。
  function apply(targetVersion) {
    requireIdle(isBusy, "切版本");
    const target = String(targetVersion || readyVersion() || "");
    if (!target) throw new UserError("NO_VERSION", "本地还没有下载好的新版本", "先点「检查更新」，再点「下载」。");
    if (target === version) throw new UserError("SAME_VERSION", "已经运行在 v" + version + " 上", "");
    /*
     * 切换互斥见下面的 guardSwitching：「正在切到 vX」时不再接受另一个目标的切换。
     */
    guardSwitching(target);
    const dir = dirOf(target);
    if (!dir) {
      throw new UserError("NO_STAGED", "本地没有 v" + target, "先点「下载」把这一版拉下来。");
    }
    /*
     * 切换前按目标那一版自己的清单逐文件校验：历史版本也有（下载时留下的那份清单）。
     * 留不下清单（很老的版本、没下载过清单）就退回最新版缓存那一份，仍不做无清单的盲切。
     */
    const known = manifestOf(target);
    if (known) {
      const blocked = versionBlocked(known);
      if (blocked) throw blocked;
      const bad = mismatchedFiles(dir, known);
      if (bad.length) {
        // 记下来：这一份在重新下载之前不算可切换，设置页与探活两边一致。
        brokenStaged.add(target);
        throw new UserError("STAGED_BROKEN", "本地这份 v" + target + " 和清单对不上", bad.slice(0, 5).join("、"));
      }
    }
    // 校验都过了、真的要切了，才记这一笔（被拒的切换不该留下「正在切换」）。
    writeSwitching(target);
    writePointer({ version: target, previous: version, switchedAt: now() });
    return { ok: true, version: target, previous: version, restartRequired: true, status: status() };
  }

  function rollback() {
    requireIdle(isBusy, "回退版本");
    const target = rollbackTarget();
    if (!target) throw new UserError("NO_ROLLBACK", "没有可回退的版本", "回退只在刚切过版本之后可用；换别的版本用版本列表。");
    // 回退也是切换，与版本列表那条路同一道互斥（不然两边同时点一样会来回重启）。
    guardSwitching(target);
    writeSwitching(target);
    writePointer({ version: target, previous: "", switchedAt: now() });
    return { ok: true, version: target, restartRequired: true, status: status() };
  }

  /*
   * 常驻复查：启动时已经查过一次，之后按间隔再查（正在下载时跳过，别和下载抢缓存）。
   * 只拉一份清单，失败不出声；界面上的「有新版」标注读的就是这次结果。
   */
  // 后台复查与插件那条线共用同一处（lib/recheck.js 的 createRecheck）。
  const startWatch = createRecheck({
    isBusy: function () { return downloadTask.running(); },
    check: function () { return check({ silent: true }); }
  });

  /*
   * 五态与「可以切哪一版」只有这一处算法：设置页的 status() 与探活的 hint() 都从它派生，判据不会分叉。
   */
  function readState() {
    const cached = cache.read();
    const ready = readyVersion();
    // 已经下载好的那一版要不要新开一次运行：清单里写着，切过去之前要在确认弹窗里说清楚。
    const readyManifest = ready ? readVersionManifest(ready) : null;
    const blocked = cached ? versionBlocked(cached.manifest) : null;
    const summary = summarizeCache(cached);
    const available = summary
      ? Object.assign({}, summary, {
          minClientVersion: String(cached.manifest.minClientVersion || ""),
          freshRunRequired: cached.manifest.freshRunRequired !== false,
          blocked: blocked ? toFailure(blocked) : null,
          // 远端清单里带着它的更新内容（发布时从同一份 changelog.json 写进去）；
          // 清单里没有就留空，由设置页用本地 changelog 补 —— 探活那条路不该为此读文件。
          notes: Array.isArray(cached.manifest.notes) ? cached.manifest.notes.map(String) : []
        })
      : null;
    /*
     * 五态只有这一处算法：没查过（没缓存）/ 本地已下好待切换 / 出错 / 远端有新的 / 本地已是最新。
     * 「没查过」必须单独一态：换发布源之后缓存按源失效（lib/manifest-fetch.js），没有它，界面只能拿
     * 「已是最新」去表示「新源一次都还没问过」—— 插件那条线（lib/plugin-update.js 同一条判据）说「还没检查过」，
     * 两条线对同一机制不能有相反说法。
     */
    let state = "unchecked";
    if (ready) state = "download_ready";
    else if (failure) state = "error";
    else if (available && isNewer(available.version, version)) state = "update_available";
    else if (available) state = "up_to_date";
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

module.exports = { createUpdate };
