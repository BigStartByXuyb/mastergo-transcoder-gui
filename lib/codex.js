'use strict';

/*
 * Codex 引擎：本机检测 → 按需下载 → 版本指针 → 起进程。
 *
 * 目录（都在安装根下，属于用户状态，不随程序版本走）：
 *   agents/codex/versions/<版本>/  我们自己下载的那几份，可并存
 *   agents/codex/blobs/<sha256>    内容库（lib/bundle-store.js 那一份实现）
 *   agents/codex/current.json      用哪一份；版本号为空串表示用本机检测到的那个
 *   agents/codex/known.json        每个下载过的版本自检结果：verified / broken
 *   agents/codex/release.json      上一次拉到的发行版描述（离线也能显示「有新版」）
 *   agents/codex/home/             我们自己的 CODEX_HOME，与用户的 ~/.codex 隔离
 *
 * 谁在用：lib/routes.js 的 /api/codex/* 与 /api/agent/chat。
 * 边界：只管「用哪一份、起不起得来、参数怎么拼」；对话与写盘由插件自己的脚本负责。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');

const { UserError, toFailure } = require('./errors.js');
const { createBundleStore } = require('./bundle-store.js');
const { fetchBuffer, fetchJson } = require('./download.js');
const { fetchRelease } = require('./codex-release.js');
// PATH 怎么取、各平台可执行名怎么算：与运行时检测共用一处（不各写一份）。
const { pathDirs, platformNames } = require('./exe-path.js');
const { compareVersions } = require('./versions.js');
const { requireIdle } = require('./idle.js');
const { createDownloadTask } = require('./update-task.js');

// 厂商 key 只经环境变量进子进程；这个名字同时写进 -c model_providers.<id>.env_key。
const KEY_ENV = 'MASTERGO_CODEX_KEY';

// 写盘权限走提示词：Windows 上 Codex 的沙箱不放行只读命令，只能整体放开，只读因此是约定而非系统隔离。
const READ_ONLY_NOTE = '[只读] 不要创建、修改或删除任何文件；可以读文件、跑只读命令，然后回答。\n\n';

// 可写时的范围句：写盘只认这一次的工程目录，范围逐字写进提示词。
function writableNote(root) {
  return '[可写] 只允许在 ' + root + ' 之内创建、修改、删除文件；这个目录以外的一律不要动。\n\n';
}

// 目录比对按解析后的绝对路径做，大小写不敏感（Windows 上 D:\Ttt 与 D:\ttt 是同一个目录）。
function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

// child 是否落在 parent 之内（含本身）。只看路径字符串，不读盘：拦的是"目录归属"，不是"目录存在"。
function isInside(child, parent) {
  const outer = path.resolve(parent).toLowerCase();
  const inner = path.resolve(child).toLowerCase();
  return inner === outer || inner.startsWith(outer.endsWith(path.sep) ? outer : outer + path.sep);
}

// 默认钉死 + 记 verified 的那一版；换版要先在真机上验过。
const PINNED_VERSION = '0.159.0';
const EXE = 'codex.exe';
const ASSET_TIMEOUT_MS = 300000;
const PROBE_TIMEOUT_MS = 10000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  }
  catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function exists(file) {
  try {
    return fs.statSync(file).isFile();
  }
  catch {
    return false;
  }
}

function modifiedAt(file) {
  try {
    return fs.statSync(file).mtimeMs;
  }
  catch {
    return 0;
  }
}

function createCodex(options) {
  const opts = options || {};
  const home = path.resolve(opts.home);
  const agentsDir = path.join(home, 'agents', 'codex');
  const codexHome = path.join(agentsDir, 'home');
  const knownPath = path.join(agentsDir, 'known.json');
  const releasePath = path.join(agentsDir, 'release.json');

  const store = createBundleStore(agentsDir);
  const settings = opts.settings;
  const fetchImpl = opts.fetchImpl || fetch;
  const spawnImpl = opts.spawnImpl || spawn;
  const spawnSyncImpl = opts.spawnSyncImpl || spawnSync;
  const isBusy = opts.isBusy || function () { return ''; };
  const now = opts.now || function () { return new Date().toISOString(); };
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  /*
   * 插件地盘清单是必给的：它就是写盘防线的范围，缺了会在写盘时少拦一块而没人知道。
   * 装配处用 lib/plugin-root.js 的 createPluginHomes() 拼（与插件定位同一份来源）。
   * 清单函数不带参数：用哪份环境由装配处决定，不跟着这里的 opts.env 走。
   */
  const pluginHomesImpl = opts.pluginHomes;
  if (typeof pluginHomesImpl !== 'function') {
    throw new UserError('NO_PLUGIN_FENCE', '没有给插件地盘清单', '装配处要把 createPluginHomes() 的结果传进来，否则写盘防线会少拦自定插件根。');
  }

  let failure = null;
  let systemCache = null;

  function managedDir(version) {
    return store.versionDir(version);
  }

  function managedExe(version) {
    return path.join(managedDir(version), EXE);
  }

  function known() {
    return readJson(knownPath, {});
  }

  function stateOf(version) {
    const entry = known()[version] || {};
    if (entry.state === 'broken' || entry.state === 'verified') return entry.state;
    return version === PINNED_VERSION ? 'verified' : 'untested';
  }

  function managedVersions() {
    return store.listVersions()
      .filter(function (version) { return exists(managedExe(version)); })
      .sort(compareVersions);
  }

  function readRelease() {
    const cache = readJson(releasePath, null);
    return cache && cache.release && cache.release.files ? cache : null;
  }

  // 本机自己装的那份 Codex（客户端 / npm 全局包）：只检测，不动它。
  function probeVersion(exePath) {
    const isScript = /\.(cmd|bat)$/i.test(exePath);
    const result = spawnSyncImpl(
      isScript ? 'cmd' : exePath,
      isScript ? ['/c', exePath, '--version'] : ['--version'],
      { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, windowsHide: true }
    );
    if (result.error || result.status !== 0) return '';
    const hit = /([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/.exec(String(result.stdout || '') + String(result.stderr || ''));
    return hit ? hit[1] : '';
  }

  function systemCandidates() {
    if (systemCache) return systemCache;
    const found = [];
    const seen = new Set();

    function add(candidate) {
      const key = candidate.toLowerCase();
      if (seen.has(key) || !exists(candidate)) return;
      seen.add(key);
      const version = probeVersion(candidate);
      if (!version) return;
      found.push({ version: version, path: candidate });
    }

    if (platform === 'win32') {
      const binRoot = path.join(String(env.LOCALAPPDATA || ''), 'OpenAI', 'Codex', 'bin');
      let entries = [];
      try {
        entries = fs.readdirSync(binRoot, { withFileTypes: true });
      }
      catch {
        entries = [];
      }
      entries
        .filter(function (entry) { return entry.isDirectory(); })
        .map(function (entry) { return path.join(binRoot, entry.name, EXE); })
        .sort(function (a, b) { return modifiedAt(b) - modifiedAt(a); })
        .forEach(add);
      add(path.join(binRoot, EXE));
    }

    // PATH 怎么取、各平台叫什么名都走 lib/runtime.js 那一处（与运行时检测同一套规则）。
    for (const dir of pathDirs(env)) {
      for (const name of platformNames(['codex.exe', 'codex.cmd'], platform)) add(path.join(dir, name));
    }

    systemCache = found;
    return found;
  }

  /*
   * 现在该用哪一份：指针指向的下载版 → 指针明确指到本机那份就用本机的 → 没指针时
   * 下载过就优先用下载的（我们钉死的这一版），一份都没有才退回本机检测到的。
   * 指针写坏、目录被删都只会让这里退一步，不会让客户端起不来。
   */
  function active() {
    const pointer = store.readPointer();
    const version = String((pointer || {}).version || '');
    if (version && exists(managedExe(version))) {
      return { version: version, source: 'managed', path: managedExe(version), state: stateOf(version) };
    }
    if (pointer && !version) {
      const pinned = systemCandidates()[0];
      if (pinned) return { version: pinned.version, source: 'system', path: pinned.path, state: 'untested' };
    }
    const managed = managedVersions();
    if (managed.length) {
      const last = managed[managed.length - 1];
      return { version: last, source: 'managed', path: managedExe(last), state: stateOf(last) };
    }
    const system = systemCandidates()[0];
    if (system) return { version: system.version, source: 'system', path: system.path, state: 'untested' };
    return null;
  }

  // 本地这一版算不算下载好了：有对应清单就逐文件校验，没有清单只认主程序在不在。
  function staged(version, cache) {
    if (!exists(managedExe(version))) return false;
    const item = cache || readRelease();
    if (item && item.release.version === version) {
      return store.verifyDir(managedDir(version), item.release).length === 0;
    }
    return true;
  }

  function status() {
    const cache = readRelease();
    const current = active();
    const map = known();
    return {
      pinned: PINNED_VERSION,
      engine: current,
      versions: managedVersions().map(function (version) {
        return {
          version: version,
          path: managedDir(version),
          state: stateOf(version),
          note: String((map[version] || {}).note || ''),
          active: Boolean(current && current.source === 'managed' && current.version === version),
          ready: staged(version, cache)
        };
      }),
      system: systemCandidates().map(function (item) {
        return { version: item.version, path: item.path, active: Boolean(current && current.path === item.path) };
      }),
      isolated: { codexHome: codexHome, exists: fs.existsSync(codexHome), keyEnv: KEY_ENV },
      pointer: store.readPointer(),
      release: cache
        ? {
            version: cache.release.version,
            tag: cache.release.tag,
            checkedAt: String(cache.checkedAt || ''),
            missing: cache.release.missing || [],
            newer: compareVersions(cache.release.version, (current && current.version) || PINNED_VERSION) > 0
          }
        : null,
      busy: String(isBusy() || ''),
      error: failure,
      task: downloadTask.task()
    };
  }

  // 拉一次发行版描述。silent 用于启动时的后台检测：失败不落到界面上。
  async function check(options) {
    const o = options || {};
    try {
      const release = await fetchRelease({ fetchJson: fetchJson, fetchImpl: fetchImpl, tag: String(o.tag || '') });
      writeJson(releasePath, { release: release, checkedAt: now() });
      failure = null;
    }
    catch (error) {
      if (!o.silent) failure = toFailure(error);
    }
    return status();
  }

  /*
   * 远端给的是 .zst 压缩包，清单里记的是**解压后** exe 的哈希 —— 两头都校验：
   * 压缩包对不对发布页的摘要、解压出来的字节对不对清单。bundle-store 再校验后者。
   */
  function fetcher(release) {
    return async function (hash, rel) {
      const source = release.sources[rel];
      if (!source) throw new UserError('NO_SOURCE', '清单里没有这个文件的来源', rel);
      if (typeof zlib.zstdDecompressSync !== 'function') {
        throw new UserError('NO_ZSTD', '这个 Node 不支持 zstd 解压', '换 Node 22 以上再下载 Codex。');
      }
      const packed = await fetchBuffer(source.url, {
        fetchImpl: fetchImpl,
        attempts: 2,
        timeoutMs: ASSET_TIMEOUT_MS
      });
      if (store.sha256(packed) !== source.sha256) {
        throw new UserError('HASH_MISMATCH', '下载到的压缩包与发布页的哈希不符', source.asset);
      }
      return zlib.zstdDecompressSync(packed);
    };
  }

  // 下载完立刻自检一次：起得来记 verified，起不来记 broken，界面据此显示徽标。
  function selfCheck(version) {
    const printed = probeVersion(managedExe(version));
    const map = known();
    map[version] = printed
      ? { state: 'verified', note: printed, checkedAt: now() }
      : { state: 'broken', note: '下载完成后自检没跑起来', checkedAt: now() };
    writeJson(knownPath, map);
    return printed ? '自检通过：' + printed : '自检失败：这份 codex 起不来';
  }

  /*
   * 下载这一条：一次只跑一条、本地已有就早退、拼完才 rename —— 编排在 lib/update-task.js 一处，
   * 这里只给这条线自己特有的三样：本地那份算不算「已经有」、压缩包怎么取，下完自检那一下。
   */
  const downloadTask = createDownloadTask({
    store: store,
    fetchBlob: function (release, hash, rel) { return fetcher(release)(hash, rel); },
    // 「本地已经有这一版」认的是那一版目录逐文件对得上（有清单时）。
    skipIf: function (release) { return staged(release.version, readRelease()); },
    onSuccess: function (release) { selfCheck(release.version); }
  });

  function startDownload() {
    const cache = readRelease();
    if (!cache) throw new UserError('NO_RELEASE', '还没有检查过 Codex 版本', '先点「检查版本」。');
    const release = cache.release;
    failure = null;
    const started = downloadTask.start(release);
    return { started: started.started, version: started.version, note: started.reason, status: status() };
  }

  // 切到哪一份：版本号为空串 = 用本机检测到的那个。只写指针，正在跑的进程不受影响。
  function switchTo(version) {
    requireIdle(isBusy, '切 Codex 版本');
    const target = String(version == null ? '' : version);
    const current = active();

    if (target) {
      if (!exists(managedExe(target))) {
        throw new UserError('NO_STAGED', '本地没有 Codex ' + target, '先点「检查版本」，再点「下载」。');
      }
      if (current && current.source === 'managed' && current.version === target) {
        throw new UserError('SAME_VERSION', '已经在用 ' + target + ' 了', '');
      }
      const cache = readRelease();
      if (cache && cache.release.version === target) {
        const bad = store.verifyDir(managedDir(target), cache.release);
        if (bad.length) {
          throw new UserError('STAGED_BROKEN', '本地这份 Codex 和清单对不上', bad.slice(0, 5).join('、'));
        }
      }
    }
    else {
      if (!systemCandidates().length) {
        throw new UserError('NO_SYSTEM_CODEX', '本机没有检测到 Codex', '装一个 Codex 客户端，或下载一份放进客户端。');
      }
      if (current && current.source === 'system') {
        throw new UserError('SAME_VERSION', '已经在用本机那份 Codex 了', '');
      }
    }

    const previous = current && current.source === 'managed' ? current.version : '';
    store.writePointer({ version: target, previous: previous, switchedAt: now() });
    return { ok: true, version: target, previous: previous, status: status() };
  }

  // 回退 = 回到指针记着的上一份。只认指针，不做猜测。
  function rollback() {
    requireIdle(isBusy, '回退 Codex 版本');
    const pointer = store.readPointer() || {};
    const previous = String(pointer.previous || '');
    if (!previous || previous === String(pointer.version || '')) {
      throw new UserError('NO_ROLLBACK', '没有可回退的 Codex 版本', '回退只在刚切过版本之后可用。');
    }
    if (!exists(managedExe(previous))) {
      throw new UserError('NO_STAGED', '本地没有 Codex ' + previous, '重新下载这一版。');
    }
    store.writePointer({ version: previous, previous: '', switchedAt: now() });
    return { ok: true, version: previous, status: status() };
  }

  function appendConfig(args, key, value) {
    args.push('-c', key + '=' + value);
  }

  /*
   * 可写范围：只有「真实存在、不是盘根、不是本客户端自己目录、不是插件目录」的绝对路径才允许开写盘。
   * 插件目录是引擎本体，改坏它等于拆掉流水线；清单由装配处给（server.js 用 lib/plugin-root.js 的
   * createPluginHomes() 拼出与插件定位同一份来源，含 --plugin 与设置里选的那份）。
   * 出界的写没有系统沙箱兜底（Windows 上只读沙箱连只读命令都跑不了），所以这道判断加提示词里的范围句是唯一防线。
   */
  function writeScope(projectRoot) {
    const requested = String(projectRoot || '').trim();
    if (!requested) return { ok: false, reason: '没给工程目录' };
    if (!path.isAbsolute(requested)) return { ok: false, reason: '工程目录不是绝对路径' };
    const resolved = path.resolve(requested);
    if (resolved === path.parse(resolved).root) return { ok: false, reason: '工程目录不能是盘根' };
    if (resolved === home || resolved.startsWith(home + path.sep)) {
      return { ok: false, reason: '工程目录不能是本客户端自己的目录' };
    }
    for (const dir of pluginHomesImpl()) {
      if (isInside(resolved, dir)) return { ok: false, reason: '工程目录不能是插件目录' };
    }
    let stat = null;
    try {
      stat = fs.statSync(resolved);
    }
    catch {
      return { ok: false, reason: '工程目录不存在' };
    }
    if (!stat.isDirectory()) return { ok: false, reason: '工程目录不是一个目录' };
    return { ok: true, root: resolved, reason: '' };
  }

  /*
   * 一次提问要带的参数：厂商与模型全走 -c，不写 config.toml；key 只走环境变量。
   * stdout 是 JSONL（thread.started / item.completed / turn.completed），界面按事件渲染。
   */
  function execArgs(options) {
    const o = options || {};
    const prompt = String(o.prompt || '');
    if (!prompt.trim()) throw new UserError('NO_PROMPT', '还没有要发的内容', '');

    // 开写盘要同时满足：这一次的工程目录确实可写，且这一次明确确认过就是它。
    const scope = writeScope(o.projectRoot);
    if (o.write && !scope.ok) {
      throw new UserError('WRITE_SCOPE', '这次不能开写盘：' + scope.reason, '写盘只允许落在这次的工程目录里，先把工程目录填对。');
    }
    const confirmRoot = String(o.confirmRoot || '').trim();
    if (o.write && (!confirmRoot || !samePath(confirmRoot, scope.root))) {
      throw new UserError('WRITE_CONFIRM', '这次没有确认可写范围', '勾上「允许改工程文件」之后还要确认一遍这次要改的目录。');
    }

    const ai = settings.resolveAi();
    const id = /^[A-Za-z0-9_-]+$/.test(String(ai.provider || '')) ? String(ai.provider) : 'custom';
    const args = [];
    appendConfig(args, 'model_provider', id);
    appendConfig(args, 'model_providers.' + id + '.name', id);
    appendConfig(args, 'model_providers.' + id + '.base_url', ai.baseUrl);
    // 0.155 起 codex 只认 Responses 这一种线协议（chat 已移除）；兼容端点的 base_url 照旧。
    appendConfig(args, 'model_providers.' + id + '.wire_api', 'responses');
    appendConfig(args, 'model_providers.' + id + '.env_key', KEY_ENV);
    appendConfig(args, 'model', ai.model);

    // Windows 上 read-only / workspace-write 会把所有 shell 调用都拒掉（连 Get-Date 都跑不了），
    // 只有 danger-full-access 真能读能跑，所以要跑 agent 就只能是它。
    args.push('-s', 'danger-full-access');
    args.push('exec');
    if (o.resume) args.push('resume', String(o.resume));
    args.push('--json', '--skip-git-repo-check');
    // 图片走 -i（exec 与 resume 都认）：别的文件靠提示词里的路径，只有图片能直接给它看。
    for (const image of (Array.isArray(o.images) ? o.images : [])) {
      if (String(image || "").trim()) args.push('-i', String(image));
    }
    args.push((o.write ? writableNote(scope.root) : READ_ONLY_NOTE) + prompt);

    const env = {};
    env[KEY_ENV] = ai.apiKey;
    return { args: args, env: env };
  }

  /*
   * 起一次 codex 进程：目标是 active() 那份，环境里塞我们自己的 CODEX_HOME 与厂商 key。
   * 用户的 ~/.codex 与其他程序一概不动 —— 同一台机器上可以同时跑两套。
   */
  function run(args, options) {
    const o = options || {};
    const target = active();
    if (!target) throw new UserError('NO_CODEX', '还没有可用的 Codex', '到「设置」里下载一份，或装一个 Codex 客户端。');
    ensureDir(codexHome);

    // 工作目录默认是安装根；给了工程目录就必须真实存在，否则子进程会在起不来时报更难懂的话。
    const cwd = String(o.cwd || '');
    if (cwd && !fs.existsSync(cwd)) {
      throw new UserError('NO_CWD', '这个工程目录不存在', cwd);
    }

    const env = Object.assign({}, process.env, o.env || {}, {
      CODEX_HOME: codexHome,
      // 只留 error 级日志：warning 会混进 stderr，排错时看真正的报错。
      RUST_LOG: 'error'
    });
    const child = spawnImpl(target.path, args, {
      cwd: cwd || home,
      env: env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (o.onLine) {
      const pump = function (stream, name) {
        if (!stream) return;
        let buffer = '';
        stream.setEncoding('utf8');
        stream.on('data', function (chunk) {
          buffer += chunk;
          let at = buffer.indexOf('\n');
          while (at >= 0) {
            const line = buffer.slice(0, at);
            buffer = buffer.slice(at + 1);
            if (line.trim()) o.onLine(line, name);
            at = buffer.indexOf('\n');
          }
        });
        stream.on('end', function () {
          if (buffer.trim()) o.onLine(buffer, name);
        });
      };
      pump(child.stdout, 'stdout');
      pump(child.stderr, 'stderr');
    }
    if (o.onExit) child.on('exit', function (code) { o.onExit(code); });
    if (o.onError) child.on('error', function (error) { o.onError(error); });
    return child;
  }

  return {
    active: active,
    status: status,
    check: check,
    startDownload: startDownload,
    switchTo: switchTo,
    rollback: rollback,
    execArgs: execArgs,
    run: run
  };
}

module.exports = { createCodex };
