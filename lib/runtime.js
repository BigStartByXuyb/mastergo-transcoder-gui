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
 *   runtime/node/           解压出来的 Node
 *   runtime/pwsh/           解压出来的 PowerShell 7
 *   runtime/blobs/<sha256>  安装包按内容存一份，重装不用再下
 *
 * 边界：只认 Windows x64。下载 → 校验 → 解压 → 自检四步；claude 只检测，不代下载。
 * 两份都在关键路径上，坏了整个客户端起不来，所以不提供版本切换，只能重下修复。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { UserError, toFailure } = require("./errors.js");
const { createBundleStore } = require("./bundle-store.js");
const { fetchBuffer } = require("./download.js");

const PROBE_TIMEOUT_MS = 20000;
const ASSET_TIMEOUT_MS = 900000;
const UNPACK_TIMEOUT_MS = 600000;
const DOWNLOAD_ATTEMPTS = 2;

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

// 自带那份的程序路径；没有不报错，由调用方决定回落。
function bundledExe(tool, home) {
  return path.join(toolDir(home, tool), TOOLS[tool].exe);
}

function hasBundled(tool, home) {
  try {
    return fs.statSync(bundledExe(tool, home)).isFile();
  }
  catch {
    return false;
  }
}

// 起服务用哪一份 node：自带优先，没有才用当前进程这一份。
function resolveNodeExe(home) {
  return hasBundled("node", home) ? bundledExe("node", home) : process.execPath;
}

// 跑插件脚本用哪一份 pwsh：环境变量 > 自带 > 系统 PATH。5.1 的 GBK 会毁掉中文输出，不能用。
function resolvePwshExe(home) {
  if (process.env.MASTERGO_PWSH) return process.env.MASTERGO_PWSH;
  return hasBundled("pwsh", home) ? bundledExe("pwsh", home) : "pwsh";
}

/*
 * 子进程环境：自带的两份排在 PATH 前面。
 * 插件脚本里写的是 bare `node` / `pwsh`，只有这样它们才会用到我们钉死的版本。
 * Windows 上这个变量真名是 Path，另起一个 PATH 会让子进程里出现两个同名变量，
 * 所以改的是原来那一条，不是新加一条。
 */
function childEnv(extra, home) {
  const root = runtimeRoot(home);
  const bins = ["node", "pwsh"]
    .map(function (tool) { return path.join(root, tool); })
    .filter(function (dir) { return fs.existsSync(dir); });
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
    return bundledExe(tool, home);
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
    const installed = hasBundled(tool, home);
    const exe = installed ? exeOf(tool) : (tool === "node" ? process.execPath : "pwsh");
    const probed = installed
      ? probe(exe, spec.probe)
      : (tool === "node" ? { ok: true, version: process.versions.node } : probe("pwsh", spec.probe));
    const ready = installed ? probed.ok && probed.version === spec.version : probed.ok;
    return {
      id: tool,
      label: spec.label,
      pinned: spec.version,
      path: exe,
      installed: installed,
      source: installed ? "bundled" : (probed.ok ? "system" : ""),
      version: probed.version,
      ready: ready,
      switchable: false,
      note: runtimeNote(tool, installed, probed, ready)
    };
  }

  function runtimeNote(tool, installed, probed, ready) {
    if (installed && ready) return "";
    if (installed) return "自带这份自检没过（期望 " + table[tool].version + "，实际 " + (probed.version || "起不来") + "），重下一次修好。";
    if (!probed.ok) return "系统上也没有，装上才能跑流水线。";
    return "正在用系统上那一份；下载后改用客户端自带的那份。";
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
      source: found.ok ? "system" : "",
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
   * 解压：包先落到 runtime/ 下的临时目录，解到一个 .building- 目录，成功了才 rename 成正式目录。
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
    removeDir(dirOf(tool));
    ensureDir(root);
    fs.renameSync(staging, dirOf(tool));
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
    unpack(tool, buffer);
    task.phase = "verifying";
    const probed = probe(exeOf(tool), spec.probe);
    if (!probed.ok || probed.version !== spec.version) {
      removeDir(dirOf(tool));
      throw new UserError(
        "RUNTIME_UNVERIFIED",
        "自带的 " + spec.label + " 跑不起来",
        "期望 " + spec.version + "，实际 " + (probed.version || "起不来")
      );
    }
    return probed;
  }

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
  childEnv,
  TOOLS
};
