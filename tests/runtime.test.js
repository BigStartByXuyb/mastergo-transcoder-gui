#!/usr/bin/env node
"use strict";

// 运行时：自带 Node / PowerShell 7 的定位、子进程 PATH、下载→解压→自检三步、claude 只检测。
// 远端与子进程都用假实现顶替，全程不联网；只有一条解压用例走真实 tar。
// 跑法：node tests/runtime.test.js

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  createRuntime,
  runtimeRoot,
  bundledExe,
  resolveNodeExe,
  resolvePwshExe,
  requireNodeExe,
  requirePwshExe,
  assetUrl,
  childEnv,
  TOOLS
} = require("../lib/runtime.js");
const runtimePolicy = require("../lib/runtime-policy.js");

const tempDirs = [];

/* 允许不允许用系统上那份由设置决定（逐份）；用例里显式打开两份，跑完复位。 */
function withSystem(allowed, run) {
  runtimePolicy.setSource(function () { return { node: allowed, pwsh: allowed }; });
  try {
    return run();
  }
  finally {
    runtimePolicy.setSource(function () { return {}; });
  }
}

function makeHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gui-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
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

// 真 Response（带真可读流与 content-length）：下载那一段按字节报进度，与用户点「下载」时同一条路。
function okStream(buffer) {
  return new Response(buffer, { headers: { "content-length": String(buffer.length) } });
}

// 假子进程：按命令正文认领；没认领的一律当「起不来」，这样「探测失败」这条路不用真找个坏程序。
function fakeSpawn(handlers) {
  return function (cmd, args) {
    const key = [cmd].concat(args || []).join(" ").toLowerCase();
    for (const handler of handlers) {
      if (key.indexOf(handler.match.toLowerCase()) >= 0) return handler.result;
    }
    return { status: 1, stdout: "", stderr: "起不来" };
  };
}

const notFound = function () {
  return { status: 1, stdout: "", stderr: "" };
};

// 下载里最省事的假包：内容随便，只要和清单里那个哈希对得上。
const ZIP = Buffer.from("not-a-real-zip-but-hash-matches", "utf8");

function specOf(overrides) {
  return Object.assign({
    label: "Node.js",
    version: "1.2.3",
    fileName: "node-1.2.3.zip",
    url: "https://example.invalid/node.zip",
    sha256: sha256(ZIP),
    strip: 1,
    exe: "node.exe",
    probe: ["-v"]
  }, overrides || {});
}

// 下载走后台，这里等它落到终态；假实现都是立刻返回，两三个 tick 就够。
async function waitSettled(rt) {
  for (let i = 0; i < 300; i += 1) {
    const phase = rt.status().task.phase;
    if (phase === "done" || phase === "error") return phase;
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
  }
  throw new Error("下载没在预期时间内结束");
}

function okSpawn() {
  return function (cmd, args) {
    const key = [cmd].concat(args || []).join(" ").toLowerCase();
    // 假解压：程序真的写进 -C 指定的目录，后面的「装好了」才有东西可认。
    if (key.indexOf("tar") >= 0) {
      fs.writeFileSync(path.join(args[args.indexOf("-C") + 1], "node.exe"), "");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (key.indexOf("node.exe") >= 0) return { status: 0, stdout: "v1.2.3", stderr: "" };
    return { status: 1, stdout: "", stderr: "起不来" };
  };
}

// 环境变量里这个变量的真名在 Windows 上是 Path、别处是 PATH，按大小写不敏感取。
function pathOf(env) {
  const names = Object.keys(env).filter(function (name) { return /^path$/i.test(name); });
  assert.strictEqual(names.length, 1, "PATH 只能有一条，不能同时留 Path 和 PATH");
  return env[names[0]];
}

function downloadRuntime(home, spawn, fetchImpl) {
  return createRuntime({
    home: home,
    tools: { node: specOf() },
    spawnSyncImpl: spawn,
    fetchImpl: fetchImpl || async function () { return okStream(ZIP); },
    env: {}
  });
}

async function main() {
  // ---- 钉死表本身：地址带版本、哈希是 64 位十六进制、可执行文件名对得上 ----
  assert.deepStrictEqual(Object.keys(TOOLS), ["node", "pwsh"], "只钉 node 与 pwsh 两份");
  for (const id of Object.keys(TOOLS)) {
    const spec = TOOLS[id];
    assert.match(spec.url, /^https:\/\//, id + " 的地址要 https");
    assert.ok(spec.url.indexOf(spec.version) >= 0, id + " 的地址要带钉死的版本号");
    assert.ok(spec.url.endsWith("/" + spec.fileName), id + " 的官方地址要以文件名结尾（镜像按同一个文件名放）");
    assert.match(spec.sha256, /^[0-9a-f]{64}$/, id + " 的哈希要是 sha256");
    assert.strictEqual(typeof spec.strip, "number", id + " 要写清解压时剥几层");
    assert.ok(spec.probe.length > 0, id + " 要有自检命令");
    assert.strictEqual(spec.exe, id + ".exe", id + " 的程序名按约定");
  }

  // ---- 安装包从哪儿取：没配镜像是官方地址，配了就是「基址/文件名」 ----
  assert.strictEqual(assetUrl("node", ""), TOOLS.node.url, "留空＝官方地址");
  assert.strictEqual(
    assetUrl("pwsh", "http://10.0.0.9/runtime/"),
    "http://10.0.0.9/runtime/" + TOOLS.pwsh.fileName,
    "配了镜像就按基址拼，末尾斜杠由这一处统一去掉"
  );

  /* 下载真的走了镜像地址，并且带上了凭据头（内网那份要凭据时用发布源那个只读 token）。 */
  const mirrorHome = makeHome();
  const seenUrls = [];
  const mirrorRt = createRuntime({
    home: mirrorHome,
    tools: { node: specOf() },
    mirror: function () { return "http://10.0.0.9/runtime"; },
    token: function () { return "t0ken"; },
    spawnSyncImpl: okSpawn(),
    fetchImpl: async function (url, options) {
      seenUrls.push({ url: String(url), headers: options && options.headers });
      return okStream(ZIP);
    },
    env: {}
  });
  assert.strictEqual(mirrorRt.status().mirror, "http://10.0.0.9/runtime", "状态里照实报出镜像是哪个");
  assert.strictEqual(
    mirrorRt.status().tools[0].downloadUrl,
    "http://10.0.0.9/runtime/" + specOf().fileName,
    "界面上看到的就是真会去取的地址"
  );
  assert.strictEqual(mirrorRt.startDownload("node").started, true);
  assert.strictEqual(await waitSettled(mirrorRt), "done");
  assert.deepStrictEqual(seenUrls, [{ url: "http://10.0.0.9/runtime/" + specOf().fileName, headers: { authorization: "Bearer t0ken" } }]);

  /*
   * ---- 看一眼安装包来源：哪些文件在、哪些不在，直接说清楚 ----
   * 设置里那个框是给内网填的，别让人「保存 → 点下载 → 等失败」才知道填错了。
   */
  const probeRt = createRuntime({
    home: makeHome(),
    tools: { node: specOf(), pwsh: specOf({ label: "PowerShell 7", exe: "pwsh.exe", fileName: "pwsh-1.2.3.zip" }) },
    spawnSyncImpl: notFound,
    fetchImpl: async function (url) {
      return String(url).indexOf(specOf().fileName) >= 0
        ? { ok: true, status: 200 }
        : { ok: false, status: 404 };
    },
    env: {}
  });
  const probed = await probeRt.probeSource("http://10.0.0.9/runtime");
  assert.deepStrictEqual(
    probed.map(function (item) { return [item.id, item.ok, item.status, item.fileName]; }),
    [["node", true, 200, specOf().fileName], ["pwsh", false, 404, "pwsh-1.2.3.zip"]],
    "哪个在、哪个不在（HTTP 几）都要报出来"
  );
  assert.match(probed[1].note, /404/);

  // 取不到（连不上、DNS 不对）也要给一句人话，不是空着。
  const brokenRt = createRuntime({
    home: makeHome(),
    tools: { node: specOf() },
    spawnSyncImpl: notFound,
    fetchImpl: async function () { throw new Error("ECONNREFUSED"); },
    env: {}
  });
  const broken = await brokenRt.probeSource("http://10.0.0.9/runtime");
  assert.strictEqual(broken[0].ok, false);
  assert.match(broken[0].note, /ECONNREFUSED/);

  // ---- 目录：版本目录 + 指针 + current 链接；一份都没装时解析不猜 ----
  const home = makeHome();
  assert.strictEqual(runtimeRoot(home), path.join(home, "runtime"));
  assert.strictEqual(bundledExe("node", home), "", "一份都没装就没有自带那份");

  // ---- 没装自带、也没允许用系统的：解析结果为空，绝不悄悄换成系统那份 ----
  assert.strictEqual(resolveNodeExe(home), "", "默认不用系统那一份");
  assert.strictEqual(resolvePwshExe(home), "", "默认不用系统那一份");
  assert.throws(
    function () { requireNodeExe(home); },
    function (error) {
      assert.strictEqual(error.code, "NO_NODE");
      assert.match(error.hint, /运行环境/);
      return true;
    },
    "没有可用的 node：说清去哪儿补，别让插件脚本悄悄用系统上那份"
  );
  assert.throws(
    function () { requirePwshExe(home); },
    function (error) {
      assert.strictEqual(error.code, "NO_PWSH");
      assert.match(error.hint, /运行环境/);
      return true;
    },
    "真要跑 pwsh 的时候才报错，并说清去哪儿补"
  );

  // 设置里显式允许之后，才轮到系统上那一份。
  withSystem(true, function () {
    /*
     * 用的是「系统上那份」的具体路径（不是裸命令名，也不是当前进程那一份）：
     * 与界面那一行报出来的是同一个查找函数的结果，两处不会分叉。
     * 注入假的 where 与安装位置 —— 用例因此不依赖宿主机上真装没装（CI 上两样都没有）。
     */
    const locatedRoot = makeHome();
    fs.mkdirSync(path.join(locatedRoot, "nodejs"), { recursive: true });
    fs.writeFileSync(path.join(locatedRoot, "nodejs", "node.exe"), "");
    fs.mkdirSync(path.join(locatedRoot, "PowerShell", "7"), { recursive: true });
    fs.writeFileSync(path.join(locatedRoot, "PowerShell", "7", "pwsh.exe"), "");
    const injected = {
      env: { ProgramFiles: locatedRoot }
    };
    assert.strictEqual(
      resolveNodeExe(home, injected),
      path.join(locatedRoot, "nodejs", "node.exe"),
      "允许后用系统那份 node 的绝对路径"
    );
    assert.strictEqual(
      resolvePwshExe(home, injected),
      path.join(locatedRoot, "PowerShell", "7", "pwsh.exe"),
      "允许后用系统那份 pwsh 的绝对路径"
    );
  });

  // 装好自带那份：无论开关怎么设，都优先用我们自己的。
  const installed = path.join(home, "runtime", "node", TOOLS.node.version);
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, "node.exe"), "");
  assert.strictEqual(resolveNodeExe(home), path.join(installed, "node.exe"), "有自带就用自带的");
  withSystem(true, function () {
    assert.strictEqual(resolveNodeExe(home), path.join(installed, "node.exe"), "允许用系统那份也不改变优先级");
  });

  // ---- 跑插件脚本用哪一份 pwsh：环境变量 > 自带 > 允许时系统 PATH ----
  const pwshHome = makeHome();
  const savedCustom = process.env.MASTERGO_PWSH;
  try {
    process.env.MASTERGO_PWSH = "C:\\custom\\pwsh.exe";
    assert.strictEqual(resolvePwshExe(pwshHome), "C:\\custom\\pwsh.exe", "环境变量最优先（显式指定）");
    delete process.env.MASTERGO_PWSH;
    const realPwsh = path.join(pwshHome, "runtime", "pwsh", TOOLS.pwsh.version);
    fs.mkdirSync(realPwsh, { recursive: true });
    fs.writeFileSync(path.join(realPwsh, "pwsh.exe"), "");
    assert.strictEqual(resolvePwshExe(pwshHome), path.join(realPwsh, "pwsh.exe"), "有自带就用自带的");
  }
  finally {
    if (savedCustom === undefined) delete process.env.MASTERGO_PWSH;
    else process.env.MASTERGO_PWSH = savedCustom;
  }

  /*
   * ---- 子进程 PATH：插件脚本里写的是 bare `node` / `pwsh`，只有自带的两份排在最前面，
   * 它们才会用到我们钉死的版本；一份都没解出来时 PATH 一个字节都不动。 ----
   */
  const pathHome = makeHome();
  assert.strictEqual(pathOf(childEnv(null, pathHome)), process.env.PATH, "没有自带的就别碰 PATH");
  const pathPwsh = path.join(pathHome, "runtime", "pwsh", TOOLS.pwsh.version);
  fs.mkdirSync(pathPwsh, { recursive: true });
  fs.writeFileSync(path.join(pathPwsh, "pwsh.exe"), "");
  const withPwsh = childEnv({ TAG: "x" }, pathHome);
  const childPath = pathOf(withPwsh).split(path.delimiter);
  assert.strictEqual(childPath[0], pathPwsh, "PATH 里放的是那一版的目录");

  // 调用方已经解析好了就用它的目录（跑流水线时就是这条路：校验过哪一份，子进程就用哪一份）。
  const givenNode = path.resolve(os.tmpdir(), "自定义", "node", "node.exe");
  const givenPwsh = path.resolve(os.tmpdir(), "自定义", "pwsh", "pwsh.exe");
  const explicit = childEnv(null, makeHome(), { node: givenNode, pwsh: givenPwsh });
  const explicitPath = pathOf(explicit).split(path.delimiter);
  assert.strictEqual(explicitPath[0], path.dirname(givenNode), "显式给的那份排最前");
  assert.strictEqual(explicitPath[1], path.dirname(givenPwsh), "第二份紧随其后");

  // 裸命令名（环境变量 MASTERGO_PWSH 可以这么写）：绝不能用 dirname 得到 "." 塞进 PATH。
  const barePathEnv = childEnv(null, makeHome(), { node: "node", pwsh: "pwsh" });
  assert.strictEqual(pathOf(barePathEnv), process.env.PATH, "裸命令名不往 PATH 里加任何东西");
  assert.ok(childPath.length > 1, "系统 PATH 原样接在自带的两份后面");
  assert.strictEqual(childPath.slice(1).join(path.delimiter), process.env.PATH, "原有的 PATH 一个字节不动");
  assert.strictEqual(withPwsh.TAG, "x", "额外变量照传");

  // ---- 状态：三行固定顺序；没有自带就用系统那份，系统也没有就是缺失 ----
  const bare = createRuntime({ home: makeHome(), spawnSyncImpl: notFound, env: {} });
  const bareStatus = bare.status();
  assert.deepStrictEqual(bareStatus.tools.map(function (item) { return item.id; }), ["node", "pwsh", "claude"]);
  assert.strictEqual(bareStatus.busy, "", "没活干就不是忙");
  assert.strictEqual(bareStatus.error, null);
  assert.strictEqual(bareStatus.task.phase, "idle");
  for (const item of bareStatus.tools) assert.strictEqual(item.switchable, false, "关键路径上的运行时不提供切换");

  const nodeRow = bareStatus.tools[0];
  assert.strictEqual(nodeRow.source, "", "没自带、又没允许用系统那份：现在没有可用的");
  assert.strictEqual(nodeRow.ready, false);
  assert.match(nodeRow.note, /但没允许用它/);

  const pwshRow = bareStatus.tools[1];
  assert.strictEqual(pwshRow.installed, false);
  assert.strictEqual(pwshRow.source, "");
  assert.strictEqual(pwshRow.ready, false);
  assert.match(pwshRow.note, /系统上也没有/);

  const claudeRow = bareStatus.tools[2];
  assert.strictEqual(claudeRow.installed, false, "claude 永远不是「自带」");
  assert.strictEqual(claudeRow.source, "");
  assert.strictEqual(claudeRow.ready, false);
  // 每一行都要带齐新字段：少一个前端读它就整页白屏（v0.6.35 真踩过）。
  assert.deepStrictEqual(claudeRow.versions, []);
  assert.strictEqual(claudeRow.active, "");
  assert.strictEqual(typeof claudeRow.system.ok, "boolean");
  assert.strictEqual(claudeRow.downloadUrl, "", "claude 不代下载：没有安装包地址这一项，但字段要在（三行形状一致）");
  assert.match(claudeRow.note, /不代下载/);

  // 允许用系统那份之后：系统上的 pwsh 被认下来，但仍提示「下载后改用客户端自带的那份」。
  withSystem(true, function () {
    // 「系统上那份」在 PATH 上找：摆一个真目录当 PATH，放上两个平台各自认的名字。
    const pathDir = makeHome();
    for (const name of ["pwsh", "pwsh.exe"]) fs.writeFileSync(path.join(pathDir, name), "");
    const sysPwsh = createRuntime({
      home: makeHome(),
      spawnSyncImpl: fakeSpawn([{ match: "pwsh", result: { status: 0, stdout: "9.9.9", stderr: "" } }]),
      env: { PATH: pathDir }
    });
    const sysPwshRow = sysPwsh.status().tools[1];
    assert.strictEqual(sysPwshRow.source, "system");
    assert.strictEqual(sysPwshRow.version, "9.9.9");
    assert.strictEqual(sysPwshRow.ready, true);
    // 报出来的必须是 PATH 上那一个（目录对、名字是 pwsh）：不在断言里另抄一份平台命名规则。
    assert.strictEqual(path.dirname(sysPwshRow.system.path), pathDir, "系统那份要报出它到底是哪一个");
    assert.match(path.basename(sysPwshRow.system.path), /^pwsh(\.exe)?$/i, "就是 PATH 上那个 pwsh");
    assert.match(sysPwshRow.note, /下载后改用客户端自带的那份/);
  });

  /*
   * PATH 上第一个命中恰好在我们安装根里（我们自己那份）时不能就此停手：后面那个才是系统的。
   * 只看首个命中会把系统那份漏掉，界面就显示「没检测到」。
   */
  const shadowHome = makeHome();
  const oursDir = path.join(shadowHome, "runtime", "node", TOOLS.node.version);
  fs.mkdirSync(oursDir, { recursive: true });
  for (const name of ["node", "node.exe"]) fs.writeFileSync(path.join(oursDir, name), "");
  const sysDir = makeHome();
  for (const name of ["node", "node.exe"]) fs.writeFileSync(path.join(sysDir, name), "");
  const shadowed = createRuntime({
    home: shadowHome,
    spawnSyncImpl: fakeSpawn([{ match: "node", result: { status: 0, stdout: "v24.14.0", stderr: "" } }]),
    env: { PATH: [oursDir, sysDir].join(path.delimiter) }
  });
  const shadowFound = shadowed.status().tools[0].system;
  assert.strictEqual(path.dirname(shadowFound.path), sysDir, "跳过我们自己那份，继续往后找系统的");
  assert.match(path.basename(shadowFound.path), /^node(\.exe)?$/i, "找到的是 PATH 上那一个 node");

  /*
   * PATH 上没有（`where` 找不到）但官方安装位置里有：也要认出来。
   * 客户机上「装好了却没进进程 PATH」是常见情况（装完没重开客户端、Store 版别名目录不在 PATH 里）。
   */
  const systemRoot = makeHome();
  fs.mkdirSync(path.join(systemRoot, "nodejs"), { recursive: true });
  fs.writeFileSync(path.join(systemRoot, "nodejs", "node.exe"), "");
  const byLocation = createRuntime({
    home: makeHome(),
    spawnSyncImpl: fakeSpawn([{ match: "node", result: { status: 0, stdout: "v24.14.0", stderr: "" } }]),
    env: { ProgramFiles: systemRoot }
  });
  const byLocationRow = byLocation.status().tools[0];
  assert.strictEqual(byLocationRow.system.ok, true, "PATH 上没有时按官方安装位置找");
  assert.strictEqual(byLocationRow.system.version, "24.14.0");
  assert.strictEqual(byLocationRow.system.path, path.join(systemRoot, "nodejs", "node.exe"));

  // 自带那份在，但自检出来的版本不对：不许当它是好的，且提示重下。
  const badBundledHome = makeHome();
  fs.mkdirSync(path.join(badBundledHome, "runtime", "node"), { recursive: true });
  fs.writeFileSync(path.join(badBundledHome, "runtime", "node", "node.exe"), "");
  const badBundled = createRuntime({
    home: badBundledHome,
    spawnSyncImpl: fakeSpawn([{ match: "node.exe", result: { status: 0, stdout: "v9.9.9", stderr: "" } }]),
    env: {}
  });
  const badRow = badBundled.status().tools[0];
  assert.strictEqual(badRow.installed, true);
  assert.strictEqual(badRow.ready, false);
  assert.match(badRow.note, /自检没过/);
  assert.match(badRow.note, /重下一次修好/);

  // 自带那份在且版本对得上：这一行没有任何提示。
  const goodBundledHome = makeHome();
  fs.mkdirSync(path.join(goodBundledHome, "runtime", "node"), { recursive: true });
  fs.writeFileSync(path.join(goodBundledHome, "runtime", "node", "node.exe"), "");
  // 系统那份摆在一个独立的目录里（放在我们自己安装根里会被正确排除）。
  const systemPathDir = makeHome();
  for (const name of ["node", "node.exe"]) fs.writeFileSync(path.join(systemPathDir, name), "");
  const goodBundled = createRuntime({
    home: goodBundledHome,
    // 系统那份走 PATH 找：给一个摆着 node 的目录，再让那一份自检回版本号。
    spawnSyncImpl: fakeSpawn([{ match: "node", result: { status: 0, stdout: "v" + TOOLS.node.version, stderr: "" } }]),
    env: { PATH: systemPathDir }
  });
  const goodRow = goodBundled.status().tools[0];
  assert.strictEqual(goodRow.source, "bundled");
  assert.strictEqual(goodRow.ready, true);
  assert.strictEqual(goodRow.note, "");
  // 自带那份装好之后，系统上那份照样要探出来 —— 弹窗里要在两者之间选，不能显示「没检测到」。
  assert.strictEqual(goodRow.system.ok, true, "有自带那份也要报系统上那一份");
  assert.strictEqual(goodRow.system.version, TOOLS.node.version);

  // ---- claude：只检测。装了就报「检测到」，标成系统来源，仍然不给下载 ----
  const claudeEnv = makeHome();
  fs.mkdirSync(path.join(claudeEnv, "npm"), { recursive: true });
  const claudeExe = path.join(claudeEnv, "npm", "claude.cmd");
  fs.writeFileSync(claudeExe, "");
  const claudeRt = createRuntime({
    home: makeHome(),
    spawnSyncImpl: fakeSpawn([{ match: "claude.cmd", result: { status: 0, stdout: "1.0.40 (Claude Code)", stderr: "" } }]),
    env: { APPDATA: claudeEnv }
  });
  const foundRow = claudeRt.status().tools[2];
  assert.strictEqual(foundRow.source, "system");
  assert.strictEqual(foundRow.version, "1.0.40");
  assert.strictEqual(foundRow.ready, true);
  assert.strictEqual(foundRow.path, claudeExe);
  assert.match(foundRow.note, /检测到就用/);

  /*
   * ---- 下载三步：下载 → 解压 → 自检。全程假实现，验的是「落盘位置、包按内容存一份、
   * 进度怎么走、临时目录不留」。 ----
   */
  const dlHome = makeHome();
  const dl = downloadRuntime(dlHome, okSpawn());
  const started = dl.startDownload("node");
  assert.strictEqual(started.started, true);
  assert.strictEqual(started.status.task.phase, "downloading");
  assert.strictEqual(started.status.task.received, 0, "下载进度按字节报，起步是 0");
  assert.strictEqual(started.status.task.version, "1.2.3");
  assert.strictEqual(await waitSettled(dl), "done");

  const dlAfter = dl.status();
  assert.strictEqual(dlAfter.task.received, ZIP.length, "下完要把拿到的字节留在任务上");
  assert.strictEqual(dlAfter.task.error, null);
  assert.strictEqual(dlAfter.error, null);
  assert.strictEqual(dlAfter.tools[0].installed, true);
  assert.strictEqual(dlAfter.tools[0].source, "bundled");
  assert.strictEqual(dlAfter.tools[0].ready, true);
  // 落盘布局：runtime/node/<版本>/ + current.json 指针 + current 链接（start.cmd 的稳定入口）。
  const dlVersionDir = path.join(runtimeRoot(dlHome), "node", "1.2.3");
  assert.ok(fs.existsSync(path.join(dlVersionDir, "node.exe")), "解压结果进版本目录");
  assert.strictEqual(
    JSON.parse(fs.readFileSync(path.join(runtimeRoot(dlHome), "node", "current.json"), "utf8")).version,
    "1.2.3",
    "指针记下当前生效的是哪一版"
  );
  assert.ok(fs.existsSync(path.join(runtimeRoot(dlHome), "node", "current", "node.exe")), "current 链接指向生效的那一版");
  assert.strictEqual(dlAfter.tools[0].active, "1.2.3", "状态里报出生效的版本");
  assert.deepStrictEqual(dlAfter.tools[0].versions, ["1.2.3"], "本机装过哪几版");
  assert.ok(fs.existsSync(path.join(runtimeRoot(dlHome), "blobs", sha256(ZIP))), "安装包按内容存一份，重装不用再下");
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot(dlHome), ".tmp-node-" + process.pid)), false, "解压用的临时目录要清掉");
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot(dlHome), ".node.building-" + process.pid)), false, "拼到一半的目录要改名，不留残骸");

  // 同一份包第二次下载：内容已经在库里，但装上仍然要重新解压一遍（用户点的是「修复」）。
  const again = downloadRuntime(dlHome, okSpawn());
  assert.strictEqual(again.startDownload("node").started, true);
  assert.strictEqual(await waitSettled(again), "done");

  /*
   * ---- 换一版：新的进新目录、指针与 current 链接跟着换，旧的那份留着。
   * 这就是「客户要别的版本时不能互相覆盖」—— 版本目录并存，跑哪一版由指针说了算。
   */
  const upHome = makeHome();
  const ZIP2 = Buffer.from("second-zip-bytes", "utf8");
  const spawnFor = function (version) {
    return function (cmd, args) {
      const key = [cmd].concat(args || []).join(" ").toLowerCase();
      if (key.indexOf("tar") >= 0) {
        fs.writeFileSync(path.join(args[args.indexOf("-C") + 1], "node.exe"), "");
        return { status: 0, stdout: "", stderr: "" };
      }
      if (key.indexOf("node.exe") >= 0) return { status: 0, stdout: "v" + version, stderr: "" };
      return { status: 1, stdout: "", stderr: "" };
    };
  };
  const older = createRuntime({
    home: upHome,
    tools: { node: specOf() },
    spawnSyncImpl: spawnFor("1.2.3"),
    fetchImpl: async function () { return okBuffer(ZIP); },
    env: {}
  });
  assert.strictEqual(older.startDownload("node").started, true);
  assert.strictEqual(await waitSettled(older), "done");

  const newer = createRuntime({
    home: upHome,
    tools: { node: specOf({ version: "1.3.0", sha256: sha256(ZIP2) }) },
    spawnSyncImpl: spawnFor("1.3.0"),
    fetchImpl: async function () { return okBuffer(ZIP2); },
    env: {}
  });
  assert.strictEqual(newer.startDownload("node").started, true);
  assert.strictEqual(await waitSettled(newer), "done");
  const upRow = newer.status().tools[0];
  assert.deepStrictEqual(upRow.versions, ["1.3.0", "1.2.3"], "两版并存，新的排前面");
  assert.strictEqual(upRow.active, "1.3.0");
  assert.ok(fs.existsSync(path.join(runtimeRoot(upHome), "node", "1.2.3", "node.exe")), "旧的那份留着，不被覆盖");
  assert.strictEqual(
    path.basename(fs.readlinkSync(path.join(runtimeRoot(upHome), "node", "current"))),
    "1.3.0",
    "current 链接换到新的那一版"
  );

  // ---- 旧布局（0.6.34 及以前直接铺在 runtime/node/ 下）第一次启动认一次：整份搬进版本目录 ----
  const legacyHome = makeHome();
  fs.mkdirSync(path.join(runtimeRoot(legacyHome), "node"), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot(legacyHome), "node", "node.exe"), "");
  const legacyRt = createRuntime({
    home: legacyHome,
    tools: { node: specOf() },
    spawnSyncImpl: spawnFor("1.2.3"),
    env: {}
  });
  const legacyRow = legacyRt.status().tools[0];
  assert.strictEqual(legacyRow.source, "bundled", "旧布局那份照用，不为了目录重下上百兆");
  assert.strictEqual(legacyRow.active, "1.2.3", "搬家之后认得出是哪一版");
  assert.ok(fs.existsSync(path.join(runtimeRoot(legacyHome), "node", "1.2.3", "node.exe")), "搬进版本目录");
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot(legacyHome), "node", "node.exe")), false, "旧的铺法不再留着");

  // ---- 有活干的时候不许动运行时：这是唯一会互相踩的并发 ----
  const busyHome = makeHome();
  const busy = createRuntime({
    home: busyHome,
    tools: { node: specOf() },
    spawnSyncImpl: okSpawn(),
    fetchImpl: async function () { return okBuffer(ZIP); },
    isBusy: function () { return "流水线在跑，等它结束再改运行时"; },
    env: {}
  });
  const busyStart = busy.startDownload("node");
  assert.strictEqual(busyStart.started, false);
  assert.strictEqual(busyStart.note, "流水线在跑，等它结束再改运行时");
  assert.strictEqual(busy.status().busy, "流水线在跑，等它结束再改运行时");
  assert.strictEqual(busy.status().task.phase, "idle", "被拦住时不该留下半截任务");
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot(busyHome), "node")), false);

  // ---- 上一次还在下：第二次点击直接回绝，不排队 ----
  let openGate = null;
  const gate = new Promise(function (resolve) { openGate = resolve; });
  const gatedHome = makeHome();
  const gated = createRuntime({
    home: gatedHome,
    tools: { node: specOf() },
    spawnSyncImpl: okSpawn(),
    fetchImpl: function () { return gate.then(function () { return okBuffer(ZIP); }); },
    env: {}
  });
  assert.strictEqual(gated.startDownload("node").started, true);
  const rejected = gated.startDownload("node");
  assert.strictEqual(rejected.started, false);
  assert.strictEqual(rejected.note, "上一次下载还没结束");
  openGate();
  assert.strictEqual(await waitSettled(gated), "done");

  // ---- 不认识的工具名：直接拒，别去猜 ----
  const guard = createRuntime({ home: makeHome(), spawnSyncImpl: notFound, env: {} });
  for (const name of ["claude", "", "nodejs"]) {
    assert.throws(
      function () { guard.startDownload(name); },
      function (error) {
        assert.strictEqual(error.code, "BAD_TOOL");
        return true;
      },
      "claude 不代下载，别的名字也不认：" + JSON.stringify(name)
    );
  }

  // ---- 失败路径一：远端下不来。错误原文要留给用户，目录不能留残骸 ----
  const downHome = makeHome();
  const down = downloadRuntime(downHome, okSpawn(), async function () { throw new Error("socket hang up"); });
  assert.strictEqual(down.startDownload("node").started, true);
  assert.strictEqual(await waitSettled(down), "error");
  const downAfter = down.status();
  assert.strictEqual(downAfter.task.error.code, "DOWNLOAD_FAILED");
  assert.match(downAfter.task.error.hint, /socket hang up/);
  assert.deepStrictEqual(downAfter.error, downAfter.task.error, "最后一次失败原文要留在 status.error 上");
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot(downHome), "node")), false);

  // ---- 失败路径二：字节对不上清单哈希。坏包不许冒充好包 ----
  const wrongHome = makeHome();
  const wrong = createRuntime({
    home: wrongHome,
    tools: { node: specOf({ sha256: sha256(Buffer.from("另一份内容", "utf8")) }) },
    spawnSyncImpl: okSpawn(),
    fetchImpl: async function () { return okBuffer(ZIP); },
    env: {}
  });
  assert.strictEqual(wrong.startDownload("node").started, true);
  assert.strictEqual(await waitSettled(wrong), "error");
  assert.strictEqual(wrong.status().task.error.code, "HASH_MISMATCH");
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot(wrongHome), "node")), false);
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot(wrongHome), "blobs")), false, "校验不过就不该进内容库");

  // ---- 失败路径三：解压起不来 ----
  const unzipHome = makeHome();
  const unzip = downloadRuntime(unzipHome, fakeSpawn([{ match: "tar", result: { status: 1, stdout: "", stderr: "bad archive" } }]));
  assert.strictEqual(unzip.startDownload("node").started, true);
  assert.strictEqual(await waitSettled(unzip), "error");
  assert.strictEqual(unzip.status().task.error.code, "UNPACK_FAILED");
  assert.match(unzip.status().task.error.hint, /bad archive/);
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot(unzipHome), "node")), false);

  /*
   * ---- 失败路径四：真解压、真自检。包是真的（系统 tar 打的 zip），里面没有 node.exe，
   * 所以自检必然不过 —— 这时候目录必须被清掉，不能留一个装了一半的运行时在那儿冒充好的。 ----
   */
  const packBase = makeHome();
  fs.mkdirSync(path.join(packBase, "top"), { recursive: true });
  fs.writeFileSync(path.join(packBase, "top", "payload.txt"), "hello");
  const zipPath = path.join(packBase, "pack.zip");
  const packed = spawnSync("tar", ["-a", "-cf", zipPath, "-C", packBase, "top"], { windowsHide: true });
  if (packed.status !== 0) {
    process.stdout.write("runtime: 跳过真解压用例（本机 tar 不支持打 zip）\n");
  }
  else {
    const realHome = makeHome();
    const realZip = fs.readFileSync(zipPath);
    const real = createRuntime({
      home: realHome,
      tools: { node: specOf({ sha256: sha256(realZip) }) },
      fetchImpl: async function () { return okBuffer(realZip); },
      env: {}
    });
    assert.strictEqual(real.startDownload("node").started, true);
    assert.strictEqual(await waitSettled(real), "error");
    assert.strictEqual(real.status().task.error.code, "RUNTIME_UNVERIFIED");
    assert.match(real.status().task.error.hint, /起不来/);
    assert.strictEqual(fs.existsSync(path.join(runtimeRoot(realHome), "node")), false, "自检不过要把目录清掉");
    assert.strictEqual(fs.existsSync(path.join(runtimeRoot(realHome), ".node.building-" + process.pid)), false, "临时目录不留");
    assert.strictEqual(fs.existsSync(path.join(runtimeRoot(realHome), ".tmp-node-" + process.pid)), false, "解压用的临时目录不留");
  }

  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write("runtime ok\n");
}

main().catch(function (error) {
  process.stderr.write(String((error && error.stack) || error) + "\n");
  process.exitCode = 1;
});
