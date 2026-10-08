#!/usr/bin/env node
"use strict";

// Codex 引擎：发行版折算、检查版本、按需下载、切换/回退、一次提问的参数与进程。
// 远端与子进程都用假实现顶替：全程不联网、不真起 codex。
// 跑法：node tests/codex.test.js

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PassThrough } = require("stream");
const zlib = require("zlib");

const { createCodex } = require("../lib/codex.js");
const { describeRelease, fetchRelease, versionOfTag } = require("../lib/codex-release.js");
const { createPluginHomes } = require("../lib/plugin-root.js");

/*
 * 写盘防线的插件地盘清单在 createCodex 里是必给的（见 lib/codex.js）：
 * 这些用例不关心它，给一份空清单；关心防线的用例自己传一份（用的是装配处同一个工厂）。
 */
function makeCodex(options) {
  return createCodex(Object.assign({ pluginHomes: function () { return []; } }, options));
}

const CHANNEL = "x86_64-pc-windows-msvc";
const BINARIES = ["codex", "codex-command-runner", "codex-code-mode-host", "codex-windows-sandbox-setup"];
const tempDirs = [];

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function makeHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gui-codex-"));
  tempDirs.push(dir);
  return dir;
}

// 一个 release：raw 是解压后的 exe 字节，zst 是压缩包本身；资产里两种都带摘要。
function makeRelease(version, names) {
  const tag = "rust-v" + version;
  const exes = new Map();
  const packed = new Map();
  const assets = [];
  for (const name of names) {
    const raw = Buffer.from(name + "@" + version, "utf8");
    const zst = zlib.zstdCompressSync(raw);
    exes.set(name, raw);
    packed.set(name + "-" + CHANNEL + ".exe.zst", zst);
    assets.push({ name: name + "-" + CHANNEL + ".exe", digest: "sha256:" + sha256(raw) });
    assets.push({ name: name + "-" + CHANNEL + ".exe.zst", digest: "sha256:" + sha256(zst) });
  }
  return { tag: tag, version: version, json: { tag_name: tag, assets: assets }, packed: packed, exes: exes };
}

function okBuffer(buffer) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async function () {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  };
}

function okJson(value) {
  return okBuffer(Buffer.from(JSON.stringify(value), "utf8"));
}

// 假远端：不带 tag 的地址给最新一版，带 tag 的给那一版；.zst 资产按名字回压缩包。
function fakeRemote(releases) {
  const urls = [];
  return {
    urls: urls,
    fetchImpl: async function (url) {
      urls.push(url);
      if (/api\.github\.com/.test(url)) {
        const tagHit = /\/releases\/tags\/(.+)$/.exec(url);
        const release = tagHit ? releases.find((item) => item.tag === tagHit[1]) : releases[releases.length - 1];
        return release ? okJson(release.json) : { ok: false, status: 404 };
      }
      const assetHit = /\/([^/]+\.zst)$/.exec(url);
      const owner = releases.find((item) => url.indexOf("/" + item.tag + "/") >= 0);
      if (assetHit && owner && owner.packed.has(assetHit[1])) return okBuffer(owner.packed.get(assetHit[1]));
      return { ok: false, status: 404 };
    }
  };
}

function fakeSettings(overrides) {
  const ai = Object.assign(
    { provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "sk-test" },
    overrides || {}
  );
  return {
    resolveAi: function () { return ai; },
    read: function () { return { agent: { allowWrite: false } }; }
  };
}

// 本机那份 codex 的探测结果；默认这台机器上什么都没有。
function probe(stdout, extra) {
  return function () {
    return Object.assign({ status: 0, stdout: stdout || "codex-cli 0.159.0\n", stderr: "" }, extra || {});
  };
}

function cleanEnv(root) {
  return { LOCALAPPDATA: path.join(root, "no-openai"), PATH: "" };
}

// 下载跑在后台：轮询到不再是 downloading / materializing 为止。
async function settle(codex) {
  for (let i = 0; i < 400; i += 1) {
    const phase = codex.status().task.phase;
    if (phase !== "downloading" && phase !== "materializing") return codex.status();
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
  }
  throw new Error("下载没有在预期时间内结束");
}

async function main() {
  if (typeof zlib.zstdDecompressSync !== "function" || typeof zlib.zstdCompressSync !== "function") {
    process.stdout.write("codex skip（这个 Node 没有 zstd）\n");
    return;
  }

  // ---- 发行版折算 ----
  assert.strictEqual(versionOfTag("rust-v0.159.0"), "0.159.0");
  assert.throws(function () { versionOfTag("v0.159.0"); }, /rust-v/);

  const full = makeRelease("0.159.0", BINARIES);
  const described = describeRelease(full.json);
  assert.strictEqual(described.version, "0.159.0");
  assert.strictEqual(described.tag, "rust-v0.159.0");
  assert.deepStrictEqual(Object.keys(described.files).sort(), BINARIES.map((name) => name + ".exe").sort());
  assert.deepStrictEqual(described.missing, []);
  assert.strictEqual(described.files["codex.exe"], sha256(full.exes.get("codex")), "清单里记的是解压后的哈希");
  assert.strictEqual(described.sources["codex.exe"].sha256, sha256(full.packed.get("codex-" + CHANNEL + ".exe.zst")));
  assert.match(described.sources["codex.exe"].url, /releases\/download\/rust-v0\.159\.0\/codex-x86_64-pc-windows-msvc\.exe\.zst$/);
  assert.match(described.sources["codex.exe"].asset, /\.exe\.zst$/);

  const partial = describeRelease(makeRelease("0.159.0", ["codex"]).json);
  assert.deepStrictEqual(partial.missing.sort(), BINARIES.filter((name) => name !== "codex").sort());
  assert.throws(function () {
    describeRelease(makeRelease("0.159.0", ["codex-command-runner"]).json);
  }, /没有 Windows x64 的 codex 程序/);
  assert.throws(function () { describeRelease({ tag_name: "rust-v0.159.0", assets: [] }); }, /没有 Windows x64 的 codex 程序/);

  let askedHeaders = null;
  let askedUrl = "";
  const fetched = await fetchRelease({
    fetchJson: async function (url, options) {
      askedUrl = url;
      askedHeaders = options.headers;
      return full.json;
    }
  });
  assert.strictEqual(fetched.version, "0.159.0");
  assert.match(askedUrl, /repos\/openai\/codex\/releases\/latest$/);
  assert.strictEqual(askedHeaders.accept, "application/vnd.github+json");
  assert.strictEqual(askedHeaders["user-agent"], "mastergo-transcoder-gui");

  let taggedUrl = "";
  await fetchRelease({ fetchJson: async function (url) { taggedUrl = url; return full.json; }, tag: "rust-v0.159.0" });
  assert.match(taggedUrl, /releases\/tags\/rust-v0\.159\.0$/);

  // ---- 检查版本 ----
  const home = makeHome();
  const remote = fakeRemote([full]);
  const codex = makeCodex({
    home: home,
    settings: fakeSettings(),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: probe(),
    env: cleanEnv(home),
    now: function () { return "2026-09-30T00:00:00.000Z"; }
  });

  const empty = codex.status();
  assert.strictEqual(empty.pinned, "0.159.0");
  assert.strictEqual(empty.engine, null);
  assert.deepStrictEqual(empty.versions, []);
  assert.deepStrictEqual(empty.system, []);
  assert.strictEqual(empty.release, null);
  assert.strictEqual(empty.busy, "");
  assert.strictEqual(empty.error, null);
  assert.strictEqual(empty.isolated.keyEnv, "MASTERGO_CODEX_KEY");
  assert.throws(function () { codex.startDownload(); }, /还没有检查过/);

  const checked = await codex.check();
  assert.strictEqual(checked.release.version, "0.159.0");
  assert.strictEqual(checked.release.tag, "rust-v0.159.0");
  assert.strictEqual(checked.release.checkedAt, "2026-09-30T00:00:00.000Z");
  assert.strictEqual(checked.release.newer, false, "和钉死的这一版同号就不算新");
  assert.deepStrictEqual(checked.release.missing, []);

  // ---- 按需下载 ----
  const started = codex.startDownload();
  assert.strictEqual(started.started, true);
  assert.strictEqual(started.version, "0.159.0");
  assert.throws(function () { codex.startDownload(); }, /已经在下载了/, "同一时刻只跑一次下载");

  let after = await settle(codex);
  assert.strictEqual(after.task.phase, "done");
  assert.strictEqual(after.task.total, 4);
  assert.strictEqual(after.task.downloaded, 4, "四个程序都要下");
  assert.strictEqual(after.task.error, null);
  assert.strictEqual(after.versions.length, 1);
  assert.strictEqual(after.versions[0].version, "0.159.0");
  assert.strictEqual(after.versions[0].ready, true);
  assert.strictEqual(after.versions[0].state, "verified", "下载完自检通过就记 verified");
  assert.strictEqual(after.versions[0].note, "0.159.0", "自检记下的是探测到的版本号");
  assert.strictEqual(after.versions[0].active, true);
  assert.strictEqual(after.engine.source, "managed");
  assert.strictEqual(after.engine.version, "0.159.0");
  assert.strictEqual(after.engine.state, "verified");

  const exePath = path.join(home, "agents", "codex", "versions", "0.159.0", "codex.exe");
  assert.ok(fs.existsSync(exePath), "解压后的程序要落在版本目录里");
  assert.strictEqual(fs.readFileSync(exePath, "utf8"), "codex@0.159.0");
  assert.ok(fs.existsSync(path.join(home, "agents", "codex", "release.json")));
  assert.ok(fs.existsSync(path.join(home, "agents", "codex", "known.json")));

  const again = codex.startDownload();
  assert.strictEqual(again.started, false);
  assert.strictEqual(again.note, "本地已经有这一版");

  // ---- 切换与回退 ----
  assert.throws(function () { codex.switchTo("0.159.0"); }, /已经在用 0\.159\.0/);
  assert.throws(function () { codex.switchTo("9.9.9"); }, /本地没有 Codex 9\.9\.9/);
  assert.throws(function () { codex.switchTo(""); }, /本机没有检测到 Codex/);

  // 本机自己装的那一份：只在检测到的时候才排得上用场。
  const local = path.join(home, "localappdata");
  const binDir = path.join(local, "OpenAI", "Codex", "bin", "abc123");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "codex.exe"), "system", "utf8");
  const withSystem = makeCodex({
    home: home,
    settings: fakeSettings(),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: probe("codex-cli 0.158.0\n"),
    // 本机 Codex 的发现路径是 %LOCALAPPDATA% 专属，钉成 win32 才能在任何宿主上验这一条。
    platform: "win32",
    env: { LOCALAPPDATA: local, PATH: "" }
  });
  const sysStatus = withSystem.status();
  assert.strictEqual(sysStatus.system.length, 1);
  assert.strictEqual(sysStatus.system[0].version, "0.158.0");
  assert.strictEqual(sysStatus.engine.source, "managed", "已经下过就用下的那一份，本机的只是备选");

  const toSystem = withSystem.switchTo("");
  assert.strictEqual(toSystem.ok, true);
  assert.strictEqual(toSystem.version, "");
  assert.strictEqual(toSystem.previous, "0.159.0", "记下切走之前用的那一份，供回退");
  assert.strictEqual(withSystem.status().engine.source, "system");
  assert.throws(function () { withSystem.switchTo(""); }, /已经在用本机那份/);

  const rolled = withSystem.rollback();
  assert.strictEqual(rolled.version, "0.159.0", "回退 = 回到切走之前的那一份");
  assert.strictEqual(withSystem.status().engine.source, "managed");
  assert.throws(function () { withSystem.rollback(); }, /没有可回退/, "退完一次就把指针清掉");

  withSystem.switchTo("");
  assert.strictEqual(withSystem.switchTo("0.159.0").previous, "", "从本机版切回下载版时没有上一份下载版可记");

  // 探测失败：拿不到版本号的本机程序不算候选。
  const brokenProbeHome = makeHome();
  const brokenProbeBin = path.join(brokenProbeHome, "localappdata", "OpenAI", "Codex", "bin");
  fs.mkdirSync(path.join(brokenProbeBin, "old"), { recursive: true });
  fs.writeFileSync(path.join(brokenProbeBin, "old", "codex.exe"), "old", "utf8");
  const noVersion = makeCodex({
    home: brokenProbeHome,
    settings: fakeSettings(),
    env: { LOCALAPPDATA: path.join(brokenProbeHome, "localappdata"), PATH: "" },
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: function () { return { error: new Error("ENOENT"), status: null }; }
  });
  assert.deepStrictEqual(noVersion.status().system, []);

  // PATH 里的 .cmd：要经 cmd /c 探测。
  let sawCmd = false;
  const cmdHome = makeHome();
  const cmdDir = path.join(cmdHome, "pathdir");
  fs.mkdirSync(cmdDir, { recursive: true });
  fs.writeFileSync(path.join(cmdDir, "codex.cmd"), "@echo off\n", "utf8");
  const scripted = makeCodex({
    home: cmdHome,
    settings: fakeSettings(),
    env: { LOCALAPPDATA: path.join(cmdHome, "nope"), PATH: cmdDir },
    // 夹具是 codex.cmd、「走 cmd /c 探测」也是 Windows 的事：钉成 win32，别跟着宿主平台变。
    platform: "win32",
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: function (cmd, args) {
      if (Array.isArray(args) && args[0] === "/c") sawCmd = true;
      return { status: 0, stdout: "codex-cli 0.157.0\n", stderr: "" };
    }
  });
  assert.strictEqual(scripted.status().engine.version, "0.157.0");
  assert.ok(sawCmd, ".cmd 要走 cmd /c 探测");

  // 有任务在跑：切版本与回退都拒。
  const busyCodex = makeCodex({
    home: home,
    settings: fakeSettings(),
    env: cleanEnv(home),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: probe(),
    isBusy: function () { return "1 次流水线正在跑"; }
  });
  const busyStatus = busyCodex.status();
  assert.strictEqual(busyStatus.busy, "1 次流水线正在跑");
  assert.throws(function () { busyCodex.switchTo("0.159.0"); }, /有任务在跑/);
  assert.throws(function () { busyCodex.rollback(); }, /有任务在跑/);

  // ---- 下载失败与坏档 ----
  const failHome = makeHome();
  const failCodex = makeCodex({
    home: failHome,
    settings: fakeSettings(),
    env: cleanEnv(failHome),
    spawnSyncImpl: probe(),
    fetchImpl: async function (url) {
      if (/api\.github\.com/.test(url)) return okJson(full.json);
      return { ok: false, status: 404 };
    }
  });
  await failCodex.check();
  failCodex.startDownload();
  const failed = await settle(failCodex);
  assert.strictEqual(failed.task.phase, "error");
  assert.strictEqual(failed.task.error.code, "HTTP_404");
  assert.strictEqual(failed.versions.length, 0);
  assert.throws(function () { failCodex.switchTo("0.159.0"); }, /本地没有 Codex 0\.159\.0/);

  // 压缩包与发布页摘要不符：拒收，不落盘。
  const badHome = makeHome();
  const badCodex = makeCodex({
    home: badHome,
    settings: fakeSettings(),
    env: cleanEnv(badHome),
    spawnSyncImpl: probe(),
    fetchImpl: async function (url) {
      if (/api\.github\.com/.test(url)) return okJson(full.json);
      const assetHit = /\/([^/]+\.zst)$/.exec(url);
      return okBuffer(zlib.zstdCompressSync(Buffer.from("换过的内容" + assetHit[1], "utf8")));
    }
  });
  await badCodex.check();
  badCodex.startDownload();
  const bad = await settle(badCodex);
  assert.strictEqual(bad.task.error.code, "HASH_MISMATCH");
  assert.strictEqual(bad.versions.length, 0);

  // 清单里有一个路径没有来源：直接说是哪一条，不去猜地址。
  const oddHome = makeHome();
  const oddCodex = makeCodex({
    home: oddHome,
    settings: fakeSettings(),
    env: cleanEnv(oddHome),
    spawnSyncImpl: probe(),
    fetchImpl: remote.fetchImpl
  });
  fs.mkdirSync(path.join(oddHome, "agents", "codex"), { recursive: true });
  fs.writeFileSync(
    path.join(oddHome, "agents", "codex", "release.json"),
    JSON.stringify({ release: { version: "0.159.0", tag: "rust-v0.159.0", files: { "codex.exe": sha256(Buffer.from("x")) }, sources: {} }, checkedAt: "x" }),
    "utf8"
  );
  oddCodex.startDownload();
  const odd = await settle(oddCodex);
  assert.strictEqual(odd.task.error.code, "NO_SOURCE");

  // 这个 Node 不支持 zstd 时给一句能照做的话。
  const noZstdHome = makeHome();
  const noZstdCodex = makeCodex({
    home: noZstdHome,
    settings: fakeSettings(),
    env: cleanEnv(noZstdHome),
    spawnSyncImpl: probe(),
    fetchImpl: remote.fetchImpl
  });
  await noZstdCodex.check();
  const savedZstd = zlib.zstdDecompressSync;
  zlib.zstdDecompressSync = undefined;
  try {
    noZstdCodex.startDownload();
    const noZstd = await settle(noZstdCodex);
    assert.strictEqual(noZstd.task.error.code, "NO_ZSTD");
  }
  finally {
    zlib.zstdDecompressSync = savedZstd;
  }

  // 下载完自检起不来：记 broken，界面据此显示徽标。
  const brokenHome = makeHome();
  const brokenCodex = makeCodex({
    home: brokenHome,
    settings: fakeSettings(),
    env: cleanEnv(brokenHome),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: function () { return { status: 1, stdout: "", stderr: "boom" }; }
  });
  await brokenCodex.check();
  brokenCodex.startDownload();
  const brokenAfter = await settle(brokenCodex);
  assert.strictEqual(brokenAfter.versions[0].state, "broken");
  assert.match(brokenAfter.versions[0].note, /自检没跑起来/);
  assert.strictEqual(brokenAfter.engine.state, "broken");

  // 目录里混进没有主程序的版本、和拼到一半的目录：都不算版本。
  fs.mkdirSync(path.join(home, "agents", "codex", "versions", "0.0.1"), { recursive: true });
  fs.mkdirSync(path.join(home, "agents", "codex", "versions", ".building-0.159.0-1"), { recursive: true });
  assert.deepStrictEqual(codex.status().versions.map((item) => item.version), ["0.159.0"]);

  // 缓存写歪（release.json / known.json / current.json 都不是合法 JSON）：照常出状态，不炸。
  fs.writeFileSync(path.join(home, "agents", "codex", "release.json"), "{不是 JSON", "utf8");
  fs.writeFileSync(path.join(home, "agents", "codex", "known.json"), "{不是 JSON", "utf8");
  fs.writeFileSync(path.join(home, "agents", "codex", "current.json"), "{不是 JSON", "utf8");
  const scrambled = codex.status();
  assert.strictEqual(scrambled.release, null);
  assert.strictEqual(scrambled.versions[0].state, "verified", "known 读不到就按钉死的那版算已验证");
  assert.strictEqual(scrambled.engine.source, "managed");

  // ---- 检查版本失败 ----
  const offlineHome = makeHome();
  const offline = makeCodex({
    home: offlineHome,
    settings: fakeSettings(),
    env: cleanEnv(offlineHome),
    spawnSyncImpl: probe(),
    fetchImpl: async function () { throw new Error("getaddrinfo ENOTFOUND"); }
  });
  const offlineStatus = await offline.check();
  assert.strictEqual(offlineStatus.error.code, "DOWNLOAD_FAILED");
  assert.match(offlineStatus.error.hint, /ENOTFOUND/);
  const offlineSilent = await offline.check({ silent: true });
  assert.strictEqual(offlineSilent.error.code, "DOWNLOAD_FAILED", "静默检查不抹掉已经记下的错误");

  // ---- 一次提问 ----
  const prepared = codex.execArgs({ prompt: "你好" });
  assert.ok(prepared.args.includes("exec"));
  assert.ok(prepared.args.includes("--json"));
  assert.ok(prepared.args.includes("--skip-git-repo-check"));
  assert.ok(prepared.args.includes("model_provider=deepseek"));
  assert.ok(prepared.args.includes("model_providers.deepseek.name=deepseek"));
  assert.ok(prepared.args.includes("model_providers.deepseek.base_url=https://api.deepseek.com"));
  assert.ok(prepared.args.includes("model_providers.deepseek.wire_api=responses"));
  assert.ok(prepared.args.includes("model_providers.deepseek.env_key=MASTERGO_CODEX_KEY"));
  assert.ok(prepared.args.includes("model=deepseek-chat"));
  assert.ok(prepared.args[prepared.args.length - 1].endsWith("你好"));
  assert.strictEqual(prepared.env.MASTERGO_CODEX_KEY, "sk-test");
  assert.ok(prepared.args.includes("danger-full-access"));
  assert.match(prepared.args[prepared.args.length - 1], /^\[只读\]/);

  assert.throws(function () { codex.execArgs({}); }, /还没有要发的内容/);
  assert.throws(function () { codex.execArgs({ prompt: "   " }); }, /还没有要发的内容/);

  const customCodex = makeCodex({
    home: home,
    settings: fakeSettings({ provider: "bad id!" }),
    env: cleanEnv(home),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: probe()
  });
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "gui-project-"));
  tempDirs.push(project);

  const custom = customCodex.execArgs({
    prompt: "x",
    resume: "th_1",
    projectRoot: project,
    confirmRoot: path.join(project, "..", path.basename(project)),
    write: true
  });
  assert.ok(custom.args.includes("model_provider=custom"), "不合法或空的厂商名统一叫 custom");
  assert.match(custom.args[custom.args.length - 1], /^\[可写\]/, "写盘走提示词授权");
  assert.ok(custom.args[custom.args.length - 1].includes(project), "写盘范围要逐字写进提示词");
  assert.strictEqual(custom.args[custom.args.indexOf("resume") + 1], "th_1");
  assert.ok(custom.args[custom.args.length - 1].endsWith("x"));

  assert.match(codex.execArgs({ prompt: "x" }).args.slice(-1)[0], /^\[只读\]/, "没开写盘就是只读");
  assert.throws(function () { customCodex.execArgs({ prompt: "x", write: true, confirmRoot: project }); }, /没给工程目录/);
  assert.throws(function () { customCodex.execArgs({ prompt: "x", write: true, projectRoot: project }); }, /没有确认可写范围/);
  assert.throws(function () { customCodex.execArgs({ prompt: "x", write: true, projectRoot: project, confirmRoot: home }); }, /没有确认可写范围/);
  assert.throws(function () { customCodex.execArgs({ prompt: "x", write: true, projectRoot: path.join(project, "missing"), confirmRoot: project }); }, /工程目录不存在/);
  assert.throws(function () { customCodex.execArgs({ prompt: "x", write: true, projectRoot: "relative/dir", confirmRoot: project }); }, /不是绝对路径/);
  assert.throws(function () { customCodex.execArgs({ prompt: "x", write: true, projectRoot: path.parse(project).root, confirmRoot: project }); }, /不能是盘根/);
  assert.throws(function () { customCodex.execArgs({ prompt: "x", write: true, projectRoot: home, confirmRoot: home }); }, /本客户端自己的目录/);

  // 插件目录是引擎本体：整棵树都拦，改坏它等于拆掉流水线。
  const pluginHome = fs.mkdtempSync(path.join(os.tmpdir(), "gui-plugin-"));
  tempDirs.push(pluginHome);
  const pluginSub = path.join(pluginHome, "cache", "bigstart-plugins", "mastergo-wpf-transcoder");
  fs.mkdirSync(pluginSub, { recursive: true });
  // 清单是必给的：缺了要装配时就报错，不能等到写盘时少拦一块还没人说。
  assert.throws(
    function () { createCodex({ home: home, settings: fakeSettings(), env: cleanEnv(home) }); },
    /没有给插件地盘清单/
  );
  const fencedCodex = makeCodex({
    home: home,
    settings: fakeSettings(),
    env: cleanEnv(home),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: probe(),
    pluginHomes: function () { return [pluginHome]; }
  });
  assert.throws(function () { fencedCodex.execArgs({ prompt: "x", write: true, projectRoot: pluginHome, confirmRoot: pluginHome }); }, /不能是插件目录/);
  assert.throws(function () { fencedCodex.execArgs({ prompt: "x", write: true, projectRoot: pluginSub, confirmRoot: pluginSub }); }, /不能是插件目录/);
  assert.throws(function () { fencedCodex.execArgs({ prompt: "x", write: true, projectRoot: path.join(pluginHome, "..", path.basename(pluginHome)), confirmRoot: pluginHome }); }, /不能是插件目录/, "换个写法指向同一个目录也要拦");

  // 插件地盘（客户端自带那一份所在的位置）同样在保护清单里：真清单、真判据走一遍。
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gui-install-root-"));
  tempDirs.push(installRoot);
  const installHome = path.join(installRoot, "plugins");
  fs.mkdirSync(installHome, { recursive: true });
  // 与装配处（server.js）用同一个工厂拼这份清单：接线只有一处，测试验的就是它。
  const byInstallRootCodex = makeCodex({
    home: home,
    settings: fakeSettings(),
    env: cleanEnv(home),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: probe(),
    pluginHomes: createPluginHomes({ installRoot: installRoot })
  });
  assert.throws(
    function () { byInstallRootCodex.execArgs({ prompt: "x", write: true, projectRoot: installHome, confirmRoot: installHome }); },
    /不能是插件目录/,
    "插件那一处不能被当成工程目录"
  );

  // 直接给了不可用的厂商名以外，配置缺项要能原样报出来。
  const noKey = makeCodex({
    home: home,
    env: cleanEnv(home),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: probe(),
    settings: { resolveAi: function () { throw new Error("no key"); }, read: function () { return { agent: { allowWrite: false } }; } }
  });
  assert.throws(function () { noKey.execArgs({ prompt: "x" }); }, /no key/);

  // ---- 起进程 ----
  const spawns = [];
  const runner = makeCodex({
    home: home,
    settings: fakeSettings(),
    env: cleanEnv(home),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: probe(),
    spawnImpl: function (file, argv, options) {
      spawns.push({ file: file, argv: argv, options: options });
      const child = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = function () { child.killed = true; };
      setImmediate(function () {
        child.stdout.write("line-1\n");
        child.stdout.write("line-2\nline-3");
        child.stdout.end();
        child.stderr.write("warn\n");
        child.stderr.end("tail-no-newline");
        setImmediate(function () { child.emit("exit", 0); });
      });
      return child;
    }
  });

  const lines = [];
  let exitCode = null;
  const job = runner.execArgs({ prompt: "跑一下" });
  const child = runner.run(job.args, {
    cwd: home,
    env: job.env,
    onLine: function (line, name) { lines.push(name + ":" + line); },
    onExit: function (code) { exitCode = code; }
  });
  assert.ok(child);
  await new Promise(function (resolve) { setTimeout(resolve, 300); });
  assert.deepStrictEqual(lines.filter((line) => line.startsWith("stdout:")), ["stdout:line-1", "stdout:line-2", "stdout:line-3"]);
  assert.deepStrictEqual(lines.filter((line) => line.startsWith("stderr:")), ["stderr:warn", "stderr:tail-no-newline"]);
  assert.strictEqual(exitCode, 0);
  assert.strictEqual(spawns[0].file, exePath);
  assert.strictEqual(spawns[0].options.cwd, home);
  assert.strictEqual(spawns[0].options.env.CODEX_HOME, path.join(home, "agents", "codex", "home"));
  assert.strictEqual(spawns[0].options.env.RUST_LOG, "error");
  assert.strictEqual(spawns[0].options.env.MASTERGO_CODEX_KEY, "sk-test");
  assert.ok(fs.existsSync(path.join(home, "agents", "codex", "home")), "自己的 CODEX_HOME 要真的建出来");

  assert.throws(function () { runner.run(job.args, { cwd: path.join(home, "没有这个目录") }); }, /工程目录不存在/);

  // 子进程起不来：错误交给调用方，不吞。
  let spawnError = null;
  runner.run(job.args, {
    onError: function (error) { spawnError = error; }
  });
  assert.strictEqual(spawnError, null, "错误是异步给的");

  const failing = makeCodex({
    home: home,
    settings: fakeSettings(),
    env: cleanEnv(home),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: probe(),
    spawnImpl: function () {
      const child2 = new PassThrough();
      child2.stdout = new PassThrough();
      child2.stderr = new PassThrough();
      setImmediate(function () { child2.emit("error", new Error("EACCES")); });
      return child2;
    }
  });
  let asyncError = null;
  failing.run(failing.execArgs({ prompt: "x" }).args, { onError: function (error) { asyncError = error; } });
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  assert.match(String(asyncError && asyncError.message), /EACCES/);

  const noneCodex = makeCodex({
    home: makeHome(),
    settings: fakeSettings(),
    env: cleanEnv(home),
    fetchImpl: remote.fetchImpl,
    spawnSyncImpl: probe()
  });
  assert.throws(function () { noneCodex.run(noneCodex.execArgs({ prompt: "x" }).args, {}); }, /还没有可用的 Codex/);

  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write("codex ok\n");
}

main();
