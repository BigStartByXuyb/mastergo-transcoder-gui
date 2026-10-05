"use strict";

/*
 * 运行时：Node.js 与 PowerShell 7 各钉死一份放进安装根的 runtime/，不用系统上那一份。
 *
 * 谁在用：
 *   lib/plugin.js  读步骤契约、跑插件脚本用哪一份 pwsh
 *   lib/run.js     跑流水线时给子进程的 PATH（插件脚本自己调 bare `node`）
 *   lib/routes.js  /api/runtime/*（设置页的运行时卡片）
 *   start.cmd      起服务用哪一份 node
 *
 * 目录（安装根下；用户状态，不随程序版本走，也不进程序更新清单）：
 *   runtime/node/<版本>/    解压出来的 Node（按版本各占一个目录，旧的留着）
 *   runtime/node/current    指向当前生效那一版的目录链接（start.cmd 用这个稳定入口）
 *   runtime/node/current.json 当前生效的是哪一版（谁装进来、什么时候、哪份包）
 *   runtime/pwsh/<版本>/    同上，PowerShell 7
 *   runtime/blobs/<sha256>  安装包按内容存一份，重装不用再下
 *
 * 边界：只认 Windows x64。下载 → 校验 → 解压 → 自检四步；claude 只检测，不代下载。
 * 两份都在关键路径上，坏了整个客户端起不来；版本目录并存是为了「换版本不丢旧的那份」，
 * 但界面不提供切换（跑哪一版由钉死表说了算，最上面那个版本就是目标版本）。
 * 系统上那份默认不用：要用得显式打开开关（见 lib/runtime-policy.js）。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { UserError, toFailure } = require("./errors.js");
const { createBundleStore } = require("./bundle-store.js");
const { fetchBuffer } = require("./download.js");
const runtimePolicy = require("./runtime-policy.js");

const PROBE_TIMEOUT_MS = 20000;
const ASSET_TIMEOUT_MS = 900000;
const UNPACK_TIMEOUT_MS = 600000;
const DOWNLOAD_ATTEMPTS = 2;
const POINTER_NAME = "current.json";
const LINK_NAME = "current";

// 两份钉死的运行时：版本、安装包地址、包自己的 sha256（都取自官方发布的校验清单）。
const TOOLS = {
  node: {
    label: "Node.js",
    version: "24.21.0",
    url: "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",
    sha256: "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541",
    strip: 1,
    exe: "node.exe",
    probe: ["-v"]
  },
  pwsh: {
    label: "PowerShell 7",
    version: "7.6.6",
    url: "https://github.com/PowerShell/PowerShell/releases/download/v7.6.6/PowerShell-7.6.6-win-x64.zip",
    sha256: "02fe458be20493fbdf43f61ea20610b811ee6c738ab1676c61b9cfcd1a33c860",
    strip: 0,
    exe: "pwsh.exe",
    probe: ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]
  }
};
// claude 只检测：它的许可证不是标准的，不代下载。
const CLAUDE_CANDIDATES = [
  ["APPDATA", "npm", "claude.cmd"],
  ["LOCALAPPDATA", "Programs", "claude", "claude.exe"],
  ["USERPROFILE", ".local", "bin", "claude.exe"]
];

function installRoot() {
  return process.env.MASTERGO_HOME || path.resolve(__dirname, "..");
}

function runtimeRoot(home) {
  return path.join(path.resolve(home || installRoot()), "runtime");
}

function toolDir(home, tool) {
  return path.join(runtimeRoot(home), tool);
}

function versionDir(home, tool, version) {
  return path.join(toolDir(home, tool), String(version));
}

function pointerPath(home, tool) {
  return path.join(toolDir(home, tool), POINTER_NAME);
}

// start.cmd / 启动器用的稳定入口：这一条链接指向当前生效的那一版（批处理读不了 JSON）。
function linkPath(home, tool) {
  return path.join(toolDir(home, tool), LINK_NAME);
}

function readPointer(home, tool) {
  try {
    const parsed = JSON.parse(fs.readFileSync(pointerPath(home, tool), "utf8"));
    const version = String((parsed && parsed.version) || "");
    if (!version) return null;
    return {
      version: version,
      installedAt: String(parsed.installedAt || ""),
      sha256: String(parsed.sha256 || "")
    };
  }
  catch {
    return null;
  }
}

function writePointer(home, tool, spec, probe) {
  ensureDir(toolDir(home, tool));
  fs.writeFileSync(pointerPath(home, tool), JSON.stringify({
    version: spec.version,
    sha256: spec.sha256,
    installedAt: new Date().toISOString(),
    verified: probe.version
  }, null, 2) + "\n", "utf8");
}

function compareVersionsDesc(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (b[index] || 0) - (a[index] || 0);
    if (diff) return diff;
  }
  return 0;
}

/* 这一份工具在本机装过哪些版本（只认真的带着可执行文件的那几个目录）。 */
function listVersions(home, tool, exe) {
  try {
    return fs.readdirSync(toolDir(home, tool), { withFileTypes: true })
      .filter(function (entry) { return entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== LINK_NAME; })
      .map(function (entry) { return entry.name; })
      .filter(function (version) { return fs.existsSync(path.join(versionDir(home, tool, version), exe)); })
      .sort(compareVersionsDesc);
  }
  catch {
    return [];
  }
}

/* 当前生效的那一版：先看指针，指针不在就看装过的最高一版。 */
function activeVersion(home, tool, exe) {
  const pointer = readPointer(home, tool);
  if (pointer && fs.existsSync(path.join(versionDir(home, tool, pointer.version), exe))) return pointer.version;
  const versions = listVersions(home, tool, exe);
  return versions[0] || "";
}

/*
 * 我们自己那份程序的路径。
 * 版本目录里找不到时看一眼旧布局（0.6.34 及以前把解压结果直接放在 runtime/<tool>/ 下）——
 * 没整理过的机器上还能直接用，不用为了一个目录改版重下 100 兆。
 */
function bundledExe(tool, home, table) {
  const spec = (table || TOOLS)[tool];
  if (!spec) return "";
  const version = activeVersion(home, tool, spec.exe);
  if (version) return path.join(versionDir(home, tool, version), spec.exe);
  const legacy = path.join(toolDir(home, tool), spec.exe);
  return fs.existsSync(legacy) ? legacy : "";
}

function hasBundled(tool, home, table) {
  return Boolean(bundledExe(tool, home, table));
}

/*
 * 起服务用哪一份 node：自带优先。
 * 默认不用系统那一份；设置里显式允许后，才轮到当前进程这一份（它就是系统/启动时用的那个 node）。
 * 都没有就返回空串，由调用方给出「去哪儿补」的话。
 */
function resolveNodeExe(home) {
  const ours = bundledExe("node", home);
  if (ours) return ours;
  return runtimePolicy.allowSystem() ? process.execPath : "";
}

/*
 * 跑插件脚本用哪一份 pwsh：环境变量（显式指定）> 自带那份 > 允许时用系统 PATH 上的 pwsh。
 * 系统上那份 5.1 的 GBK 会毁掉中文输出，这里认的是 `pwsh`（7.x），不是 `powershell`。
 */
function resolvePwshExe(home) {
  if (process.env.MASTERGO_PWSH) return process.env.MASTERGO_PWSH;
  const ours = bundledExe("pwsh", home);
  if (ours) return ours;
  return runtimePolicy.allowSystem() ? "pwsh" : "";
}

/* 真要用 pwsh 的地方走这个：没有可用的一份就把话说清楚，别让子进程抛「找不到文件」。 */
function requirePwshExe(home) {
  const exe = resolvePwshExe(home);
  if (exe) return exe;
  throw new UserError(
    "NO_PWSH",
    "没有可用的 PowerShell 7",
    "设置 → 更新 → 运行环境里下载客户端自带的那份；或在同一页允许使用系统上那一份。"
  );
}

/*
 * 子进程环境：自带的两份排在 PATH 前面。
 * 插件脚本里写的是 bare `node` / `pwsh`，只有这样它们才会用到我们钉死的版本。
 * Windows 上这个变量真名是 Path，另起一个 PATH 会让子进程里出现两个同名变量，
 * 所以改的是原来那一条，不是新加一条。
 */
function childEnv(extra, home) {
  const bins = ["node", "pwsh"]
    .map(function (tool) {
      const link = linkPath(home, tool);
      if (fs.existsSync(path.join(link, TOOLS[tool].exe))) return link;
      const exe = bundledExe(tool, home);
      return exe ? path.dirname(exe) : "";
    })
    .filter(Boolean);
  const env = Object.assign({}, process.env, extra || {});
  if (bins.length) {
    const key = Object.keys(env).filter(function (name) { return /^path$/i.test(name); })[0] || "PATH";
    env[key] = bins.join(path.delimiter) + path.delimiter + (env[key] || "");
  }
  return env;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// 输出里的第一段 x.y.z 就是版本；node 的 -v 带前导 v，这样统一。
function versionFromOutput(text) {
  const hit = /(\d+\.\d+\.\d+)/.exec(String(text || ""));
  return hit ? hit[1] : "";
}

function createRuntime(options) {
  const opts = options || {};
  const home = path.resolve(opts.home || installRoot());
  const root = runtimeRoot(home);
  const store = createBundleStore(root);
  const fetchImpl = opts.fetchImpl || fetch;
  const spawnSyncImpl = opts.spawnSyncImpl || spawnSync;
  const isBusy = opts.isBusy || function () { return ""; };
  const now = opts.now || function () { return new Date().toISOString(); };
  const env = opts.env || process.env;
  // 钉死表默认就是上面那两份；tools 只在测试里换成一份本地小包，免得真下几十兆。
  const table = opts.tools || TOOLS;
  const ids = Object.keys(table);

  let failure = null;
  let task = { phase: "idle", tool: "", received: 0, size: 0, error: null, version: "", startedAt: "" };
  let running = null;
  let claudeCache = null;

  function dirOf(tool) {
    return toolDir(home, tool);
  }

  function exeOf(tool) {
    return bundledExe(tool, home, table);
  }

  // 探测一份程序：拿到版本就算能跑。.cmd/.bat 得经 cmd /c，直接 spawn 起不来。
  function probe(exe, args) {
    const isScript = /\.(cmd|bat)$/i.test(exe);
    const result = spawnSyncImpl(isScript ? "cmd" : exe, isScript ? ["/c", exe].concat(args) : args, {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true
    });
    const text = String(result.stdout || "") + String(result.stderr || "");
    return { ok: result.status === 0, version: versionFromOutput(text) };
  }

  function toolStatus(tool) {
    const spec = table[tool];
    const ours = exeOf(tool);
    const allowed = runtimePolicy.allowSystem();
    // 系统上那一份对着看（有没有、哪一版），但用不用由开关说了算：没允许就只报告、不使用。
    const systemExe = ours ? "" : (tool === "node" ? process.execPath : "pwsh");
    const systemProbed = ours
      ? { ok: false, version: "" }
      : (tool === "node" ? { ok: true, version: process.versions.node } : probe("pwsh", spec.probe));
    const probed = ours ? probe(ours, spec.probe) : systemProbed;
    // 系统上那份「有」不等于「用」：没允许的时候只报告，不列为当前来源。
    const source = ours ? "bundled" : (allowed && systemProbed.ok ? "system" : "");
    return {
      id: tool,
      label: spec.label,
      pinned: spec.version,
      path: ours || (source === "system" ? systemExe : ""),
      installed: Boolean(ours),
      /** 自带那份装在版本目录里的哪几版（旧布局下是空的）。 */
      versions: listVersions(home, tool, spec.exe),
      /** 当前生效的版本：旧布局那份探测出来的版本号。 */
      active: ours && versionNameOf(tool) ? versionNameOf(tool) : (ours ? probed.version : ""),
      source: source,
      /** 系统上那一份是什么（有没有、哪一版）：没允许用时不列为来源，但仍要说清它在那儿。 */
      system: { ok: systemProbed.ok, version: systemProbed.version, path: source === "system" ? systemExe : "" },
      version: probed.version,
      ready: ours ? (probed.ok && probed.version === spec.version) : source === "system",
      switchable: false,
      note: runtimeNote(tool, {
        ours: Boolean(ours),
        ready: ours ? (probed.ok && probed.version === spec.version) : source === "system",
        probed: probed,
        systemProbed: systemProbed,
        allowed: allowed
      })
    };
  }

  /* 照着版本目录里的目录名回一个版本号；旧布局（直接铺在 runtime/<tool>/ 下）返回空串。 */
  function versionNameOf(tool) {
    const exe = exeOf(tool);
    if (!exe) return "";
    const parent = path.basename(path.dirname(exe));
    return parent === tool ? "" : parent;
  }

  function runtimeNote(tool, state) {
    if (state.ours && state.ready) return "";
    if (state.ours) {
      return "自带这份自检没过（期望 " + table[tool].version + "，实际 " + (state.probed.version || "起不来") + "），重下一次修好。";
    }
    if (state.allowed) {
      return state.systemProbed.ok
        ? "正在用系统上那一份（设置里允许的）；下载后改用客户端自带的那份。"
        : "系统上也没有，装上才能跑流水线。";
    }
    return state.systemProbed.ok
      ? "系统上有 v" + state.systemProbed.version + "，但没允许用它；下载自带那份，或到设置里允许。"
      : "系统上也没有，装上才能跑流水线。";
  }

  function detectClaude() {
    if (claudeCache) return claudeCache;
    const candidates = [];
    for (const parts of CLAUDE_CANDIDATES) {
      const base = env[parts[0]];
      if (base) candidates.push(path.join(base, ...parts.slice(1)));
    }
    candidates.push("claude");
    for (const exe of candidates) {
      if (exe !== "claude") {
        if (!fs.existsSync(exe)) continue;
        const probed = probe(exe, ["--version"]);
        claudeCache = { path: exe, version: probed.version, ok: probed.ok };
        return claudeCache;
      }
      const found = spawnSyncImpl("where", ["claude"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, windowsHide: true });
      const first = String(found.stdout || "").split(/\r?\n/).map(function (line) { return line.trim(); })
        .filter(Boolean)[0];
      if (found.status === 0 && first) {
        const probed = probe(first, ["--version"]);
        claudeCache = { path: first, version: probed.version, ok: probed.ok };
        return claudeCache;
      }
    }
    claudeCache = { path: "", version: "", ok: false };
    return claudeCache;
  }

  function claudeStatus() {
    const found = detectClaude();
    return {
      id: "claude",
      label: "Claude Code",
      pinned: "",
      path: found.path,
      installed: false,
      // 它只有「系统上那一份」这一种来源：检测到就用，我们不带自己的版本，也没有版本目录。
      source: found.ok ? "system" : "",
      versions: [],
      active: "",
      system: { ok: found.ok, version: found.version, path: found.path },
      version: found.version,
      ready: found.ok,
      switchable: false,
      note: found.ok ? "检测到就用；不代下载。" : "没检测到；不代下载。"
    };
  }

  function status() {
    return {
      root: root,
      tools: ids.map(toolStatus).concat([claudeStatus()]),
      busy: String(isBusy() || ""),
      error: failure,
      task: task
    };
  }

  /*
   * 解压：包先落到 runtime/ 下的临时目录，解到一个 .building- 目录；自检过了才搬进版本目录。
   * 用系统自带的 tar.exe —— 它认 zip，PowerShell 5.1 的 Expand-Archive 走不了（GBK 会毁路径）。
   */
  function unpack(tool, buffer) {
    const spec = table[tool];
    const tmp = path.join(root, ".tmp-" + tool + "-" + process.pid);
    const staging = path.join(root, "." + tool + ".building-" + process.pid);
    removeDir(tmp);
    removeDir(staging);
    ensureDir(tmp);
    ensureDir(staging);
    const zipName = tool + ".zip";
    fs.writeFileSync(path.join(tmp, zipName), buffer);
    const args = ["-xf", zipName, "-C", staging];
    if (spec.strip) args.push("--strip-components=" + spec.strip);
    const result = spawnSyncImpl("tar", args, {
      cwd: tmp,
      encoding: "utf8",
      timeout: UNPACK_TIMEOUT_MS,
      windowsHide: true
    });
    removeDir(tmp);
    if (result.status !== 0) {
      removeDir(staging);
      throw new UserError("UNPACK_FAILED", "解压失败：" + tool, String(result.stderr || result.error || "").slice(0, 300));
    }
    ensureDir(root);
    return staging;
  }

  /* 把某一版搬进 runtime/<tool>/<版本>/，再写指针、更新 current 链接。 */
  function publish(tool, staging, spec, probed) {
    const target = versionDir(home, tool, spec.version);
    if (fs.existsSync(target)) removeDir(target);
    ensureDir(dirOf(tool));
    fs.renameSync(staging, target);
    writePointer(home, tool, spec, probed);
    refreshLink(tool, spec.version);
    return target;
  }

  /*
   * current 这条链接是给 start.cmd / 启动器用的稳定入口（批处理读不了 JSON）。
   * 非 NTFS 或没权限时建不出来：不影响程序本身，Node 这一侧一律按指针解析。
   */
  function refreshLink(tool, version) {
    const link = linkPath(home, tool);
    try {
      if (fs.existsSync(link) || fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    }
    catch {
      /* 本来就没有 */
    }
    try {
      fs.symlinkSync(versionDir(home, tool, version), link, "junction");
      return true;
    }
    catch {
      return false;
    }
  }

  async function install(tool) {
    const spec = table[tool];
    task.phase = "downloading";
    // putBlob 自己按清单哈希校验：内容不符直接抛 HASH_MISMATCH，坏包不会落到正式目录。
    const buffer = await fetchBuffer(spec.url, {
      fetchImpl: fetchImpl,
      timeoutMs: ASSET_TIMEOUT_MS,
      attempts: DOWNLOAD_ATTEMPTS,
      // 大包单文件几十到上百兆，整包下完才动一下进度条等于没有进度：按字节报。
      onProgress: function (received, size) {
        task.received = received;
        task.size = size;
      }
    });
    task.phase = "extracting";
    store.putBlob(spec.sha256, buffer);
    const staging = unpack(tool, buffer);
    task.phase = "verifying";
    const probed = probe(path.join(staging, spec.exe), spec.probe);
    if (!probed.ok || probed.version !== spec.version) {
      removeDir(staging);
      throw new UserError(
        "RUNTIME_UNVERIFIED",
        "自带的 " + spec.label + " 跑不起来",
        "期望 " + spec.version + "，实际 " + (probed.version || "起不来")
      );
    }
    publish(tool, staging, spec, probed);
    return probed;
  }

  /*
   * 旧布局搬家：0.6.34 及以前把解压结果直接铺在 runtime/<tool>/ 下 —— 没有版本目录，也没有指针。
   * 第一次起来认一次：探到版本就整份搬进 runtime/<tool>/<版本>/ 并写指针；
   * 搬不动（权限、跨卷）就当没搬过 —— 那份还能照用，不为了一个目录重下 100 兆。
   */
  function migrateLegacy(tool) {
    const spec = table[tool];
    const legacy = path.join(dirOf(tool), spec.exe);
    if (!fs.existsSync(legacy)) return;
    if (activeVersion(home, tool, spec.exe)) return;
    try {
      const probed = probe(legacy, spec.probe);
      if (!probed.ok || !probed.version) return;
      const target = versionDir(home, tool, probed.version);
      if (fs.existsSync(target)) return;
      // 先列好要搬的东西，再建目标目录：不然刚建出来的那个目录也会被算进去。
      const moving = fs.readdirSync(dirOf(tool)).filter(function (name) {
        return !name.startsWith(".") && name !== POINTER_NAME && name !== LINK_NAME;
      });
      ensureDir(target);
      for (const entry of moving) {
        fs.renameSync(path.join(dirOf(tool), entry), path.join(target, entry));
      }
      writePointer(home, tool, { version: probed.version, sha256: "" }, probed);
      refreshLink(tool, probed.version);
    }
    catch {
      /* 搬不动就照旧用：下次启动再试 */
    }
  }

  for (const tool of ids) migrateLegacy(tool);

  function startDownload(tool) {
    if (ids.indexOf(tool) < 0) {
      throw new UserError("BAD_TOOL", "不认识的运行时：" + tool, "可用：" + ids.join(" / "));
    }
    if (running) return { started: false, tool: tool, note: "上一次下载还没结束", status: status() };
    const busy = String(isBusy() || "");
    if (busy) return { started: false, tool: tool, note: busy, status: status() };

    failure = null;
    // 三步：下载 → 解压 → 自检。界面的进度条按 phase 走，下载那一段按 received/size 走。
    task = { phase: "downloading", tool: tool, received: 0, size: 0, error: null, version: table[tool].version, startedAt: now() };
    running = install(tool)
      .then(function () {
        task.phase = "done";
      })
      .catch(function (error) {
        task.phase = "error";
        task.error = toFailure(error);
        failure = toFailure(error);
      })
      .then(function () {
        running = null;
      });
    return { started: true, tool: tool, note: "", status: status() };
  }

  return { status: status, startDownload: startDownload };
}

module.exports = {
  createRuntime,
  runtimeRoot,
  bundledExe,
  resolveNodeExe,
  resolvePwshExe,
  requirePwshExe,
  childEnv,
  TOOLS
};
