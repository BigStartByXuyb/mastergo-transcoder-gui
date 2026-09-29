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
  childEnv,
  TOOLS
} = require("../lib/runtime.js");

const tempDirs = [];

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
    assert.match(spec.sha256, /^[0-9a-f]{64}$/, id + " 的哈希要是 sha256");
    assert.strictEqual(typeof spec.strip, "number", id + " 要写清解压时剥几层");
    assert.ok(spec.probe.length > 0, id + " 要有自检命令");
    assert.strictEqual(spec.exe, id + ".exe", id + " 的程序名按约定");
  }

  // ---- 目录与程序路径 ----
  const home = makeHome();
  assert.strictEqual(runtimeRoot(home), path.join(home, "runtime"));
  assert.strictEqual(bundledExe("node", home), path.join(home, "runtime", "node", "node.exe"));
  assert.strictEqual(bundledExe("pwsh", home), path.join(home, "runtime", "pwsh", "pwsh.exe"));

  // ---- 起服务用哪一份 node：自带优先，没有才用当前进程这一份 ----
  assert.strictEqual(resolveNodeExe(home), process.execPath, "没自带就用当前进程这一份");
  fs.mkdirSync(path.join(home, "runtime", "node"), { recursive: true });
  fs.writeFileSync(bundledExe("node", home), "");
  assert.strictEqual(resolveNodeExe(home), bundledExe("node", home), "有自带就用自带的");

  // ---- 跑插件脚本用哪一份 pwsh：环境变量 > 自带 > 系统 PATH ----
  const pwshHome = makeHome();
  const savedCustom = process.env.MASTERGO_PWSH;
  try {
    assert.strictEqual(resolvePwshExe(pwshHome), "pwsh", "都没有就落到系统 PATH 里的 pwsh");
    fs.mkdirSync(path.join(pwshHome, "runtime", "pwsh"), { recursive: true });
    fs.writeFileSync(bundledExe("pwsh", pwshHome), "");
    assert.strictEqual(resolvePwshExe(pwshHome), bundledExe("pwsh", pwshHome), "有自带就用自带的");
    process.env.MASTERGO_PWSH = "C:\\custom\\pwsh.exe";
    assert.strictEqual(resolvePwshExe(pwshHome), "C:\\custom\\pwsh.exe", "环境变量最优先");
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
  fs.mkdirSync(path.join(pathHome, "runtime", "pwsh"), { recursive: true });
  const withPwsh = childEnv({ TAG: "x" }, pathHome);
  const childPath = pathOf(withPwsh).split(path.delimiter);
  assert.strictEqual(childPath[0], path.join(pathHome, "runtime", "pwsh"));
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
  assert.strictEqual(nodeRow.source, "system", "没自带就在用当前进程这一份");
  assert.strictEqual(nodeRow.ready, true);
  assert.match(nodeRow.note, /正在用系统上那一份/);

  const pwshRow = bareStatus.tools[1];
  assert.strictEqual(pwshRow.installed, false);
  assert.strictEqual(pwshRow.source, "");
  assert.strictEqual(pwshRow.ready, false);
  assert.match(pwshRow.note, /系统上也没有/);

  const claudeRow = bareStatus.tools[2];
  assert.strictEqual(claudeRow.installed, false, "claude 永远不是「自带」");
  assert.strictEqual(claudeRow.source, "");
  assert.strictEqual(claudeRow.ready, false);
  assert.match(claudeRow.note, /不代下载/);

  // 系统上有 pwsh：认它，但提示「下载后改用客户端自带的那份」。
  const sysPwsh = createRuntime({
    home: makeHome(),
    spawnSyncImpl: fakeSpawn([{ match: "pwsh", result: { status: 0, stdout: "7.6.6", stderr: "" } }]),
    env: {}
  });
  const sysPwshRow = sysPwsh.status().tools[1];
  assert.strictEqual(sysPwshRow.source, "system");
  assert.strictEqual(sysPwshRow.version, "7.6.6");
  assert.strictEqual(sysPwshRow.ready, true);
  assert.match(sysPwshRow.note, /下载后改用客户端自带的那份/);

  // 自带那份在，但自检出来的版本不对：不许当它是好的，且提示重下。
  const badBundledHome = makeHome();
  fs.mkdirSync(path.join(badBundledHome, "runtime", "node"), { recursive: true });
  fs.writeFileSync(bundledExe("node", badBundledHome), "");
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
  fs.writeFileSync(bundledExe("node", goodBundledHome), "");
  const goodBundled = createRuntime({
    home: goodBundledHome,
    spawnSyncImpl: fakeSpawn([{ match: "node.exe", result: { status: 0, stdout: "v" + TOOLS.node.version, stderr: "" } }]),
    env: {}
  });
  const goodRow = goodBundled.status().tools[0];
  assert.strictEqual(goodRow.source, "bundled");
  assert.strictEqual(goodRow.ready, true);
  assert.strictEqual(goodRow.note, "");

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
  assert.ok(fs.existsSync(path.join(runtimeRoot(dlHome), "node")), "装好的目录要留着");
  assert.ok(fs.existsSync(path.join(runtimeRoot(dlHome), "blobs", sha256(ZIP))), "安装包按内容存一份，重装不用再下");
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot(dlHome), ".tmp-node-" + process.pid)), false, "解压用的临时目录要清掉");
  assert.strictEqual(fs.existsSync(path.join(runtimeRoot(dlHome), ".node.building-" + process.pid)), false, "拼到一半的目录要改名，不留残骸");

  // 同一份包第二次下载：内容已经在库里，但装上仍然要重新解压一遍（用户点的是「修复」）。
  const again = downloadRuntime(dlHome, okSpawn());
  assert.strictEqual(again.startDownload("node").started, true);
  assert.strictEqual(await waitSettled(again), "done");

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
