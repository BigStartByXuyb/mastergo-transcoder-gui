#!/usr/bin/env node
"use strict";

// 插件来源：七档都查过哪些路径、各自有没有、此刻用的是哪一份。
// 跑法：node tests/plugin-sources.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { pluginSources, pluginRootsUnder, resolvePluginRoot, PLUGIN_ENV_NAME, PLUGIN_MARKER } = require("../lib/plugin-root.js");
const { createPluginRuntime } = require("../lib/plugin.js");

/* 路径直接塞进正则：反斜杠与别的元字符都要转义（Windows 路径里这两种都常见）。 */
function escapeRegExp(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

// 造一份能被认出来的插件：认根只看 SKILL.md，版本读插件自己的清单。
function makePlugin(dir, version) {
  fs.mkdirSync(path.dirname(path.join(dir, PLUGIN_MARKER)), { recursive: true });
  fs.writeFileSync(path.join(dir, PLUGIN_MARKER), "# " + version + "\n", "utf8");
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: version }), "utf8");
  return dir;
}

function sandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gui-plugin-src-"));
  const home = path.join(tmp, "home");
  const codex = path.join(tmp, "codex");
  const install = path.join(tmp, "install");
  for (const dir of [home, codex, install]) fs.mkdirSync(dir, { recursive: true });
  return { tmp: tmp, home: home, codex: codex, install: install };
}

// 取值链认的是进程环境：造夹具时临时改掉，结束后原样放回。
function withEnv(values, body) {
  const keys = ["CODEX_HOME", "HOME", "USERPROFILE", PLUGIN_ENV_NAME];
  const previous = {};
  for (const key of keys) previous[key] = process.env[key];
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    body();
  }
  finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

// 夹具：Codex 缓存里 1.0.9 与 1.0.10 两份，Claude 缓存里一份。
function fixture(box) {
  return {
    codexOld: makePlugin(path.join(box.codex, "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "1.0.9"), "1.0.9"),
    codexNew: makePlugin(path.join(box.codex, "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "1.0.10"), "1.0.10"),
    claude: makePlugin(path.join(box.home, ".claude", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder"), "2.0.0")
  };
}

function caseSources() {
  const box = sandbox();
  const fx = fixture(box);
  const sources = pluginSources({ env: {}, home: box.home, codexHome: box.codex, installRoot: box.install });
  const byId = new Map(sources.map((item) => [item.id, item]));

  assert.deepStrictEqual(
    sources.map((item) => item.id),
    ["arg", "env", "codex-cache", "codex-market", "claude-cache", "claude-market", "install"],
    "七档按固定顺序列出来：显式指定的两档没设也列（标没有），顺序与文档一致"
  );
  assert.strictEqual(byId.get("arg").exists, false, "没给 --plugin 就说没有");
  assert.strictEqual(byId.get("env").exists, false);
  assert.strictEqual(byId.get("codex-cache").exists, true, "Codex 缓存里两份都认出来");
  assert.strictEqual(byId.get("codex-cache").pluginRoot, fx.codexNew, "同一处有多份时取最高版本");
  assert.strictEqual(byId.get("codex-cache").version, "1.0.10", "版本读插件自己的清单");
  assert.strictEqual(byId.get("codex-cache").found.length, 2, "两份都在清单里");
  assert.strictEqual(byId.get("codex-market").exists, false, "没有这份就说没有，路径照样列出来");
  assert.strictEqual(byId.get("claude-cache").version, "2.0.0");
  assert.strictEqual(byId.get("install").exists, false, "客户端自带那份可以缺席");

  const explicit = pluginSources({
    env: { [PLUGIN_ENV_NAME]: fx.claude },
    home: box.home,
    codexHome: box.codex,
    explicitDir: fx.codexOld,
    installRoot: box.install
  });
  assert.deepStrictEqual(
    explicit.slice(0, 2).map((item) => item.id),
    ["arg", "env"],
    "显式指定的两条排在最前"
  );
  assert.deepStrictEqual(
    explicit.slice(0, 2).map((item) => item.pluginRoot),
    [fx.codexOld, fx.claude],
    "两条各自解析到自己的插件根"
  );
  fs.rmSync(box.tmp, { recursive: true, force: true });
}

function caseOrder() {
  const box = sandbox();
  const fx = fixture(box);
  const options = { env: {}, home: box.home, codexHome: box.codex, installRoot: box.install };

  assert.strictEqual(resolvePluginRoot("", options), fx.codexNew, "没人指定时按查找顺序取（Codex 缓存里最高的那一版）");
  assert.strictEqual(
    resolvePluginRoot(fx.claude, options),
    fx.claude,
    "命令行 --plugin 指到哪一份就用哪一份（它压过缓存里的副本）"
  );
  withEnv(
    { CODEX_HOME: box.codex, HOME: box.home, USERPROFILE: box.home, [PLUGIN_ENV_NAME]: box.install },
    () => {
      assert.match(resolvePluginRoot(""), /1\.0\.10$/, "环境变量指的不是插件根时往下走，不当成命中");
      assert.strictEqual(
        pluginSources({ installRoot: box.install, home: box.home, codexHome: box.codex })
          .find((item) => item.id === "env").exists,
        false,
        "那一条照样列出来，标成没有"
      );
    }
  );
  fs.rmSync(box.tmp, { recursive: true, force: true });
}

function caseRuntime() {
  const box = sandbox();
  const fx = fixture(box);
  const runtime = createPluginRuntime({
    installRoot: box.install,
    home: box.home,
    env: { CODEX_HOME: box.codex }
  });

  assert.strictEqual(runtime.current().root, fx.codexNew, "没人指定时按查找顺序找");
  assert.strictEqual(runtime.failure(), "");
  assert.strictEqual(runtime.sources().find((item) => item.active).id, "codex-cache", "生效的那条标出来");

  fs.rmSync(box.tmp, { recursive: true, force: true });
}

function caseMissing() {
  const box = sandbox();
  const runtime = createPluginRuntime({
    installRoot: box.install,
    home: box.home,
    env: { CODEX_HOME: box.codex }
  });

  assert.strictEqual(runtime.current().root, "", "一处都没有时不是抛栈，是留空由界面说清楚");
  assert.match(runtime.failure(), /找不到 mastergo-wpf-transcoder 插件/);
  assert.match(runtime.failure(), /已查找：/);
  /*
   * 「已查找」只列真的查过的位置：没设的那两档（--plugin / 环境变量）path 是空串，
   * 列出来只是几个空档，所以断言分两半 —— 有 path 的逐条列出，空档一个都不出现。
   */
  const searched = runtime.sources().filter(function (item) { return item.path; });
  for (const source of searched) {
    assert.match(runtime.failure(), new RegExp(escapeRegExp(source.path)), "已查找里要逐条列出查过的路径");
  }
  assert.strictEqual(
    (runtime.failure().match(/（没有）/g) || []).length,
    searched.filter(function (item) { return !item.exists; }).length,
    "「（没有）」的条数＝真的查过且没有的那几档，空档不占位"
  );
  assert.strictEqual(runtime.sources().some((item) => item.active), false, "都没找到就没有生效的那条");

  fs.rmSync(box.tmp, { recursive: true, force: true });
}

// 两条来源指到同一个插件根（例如环境变量指的正好是 Codex 缓存那一处）时，只标一条「正在用」。
function caseActiveOnce() {
  const box = sandbox();
  const fx = fixture(box);
  const runtime = createPluginRuntime({
    installRoot: box.install,
    home: box.home,
    // 环境变量与 Codex 缓存那一档指到同一份（同一个插件根）。
    env: { CODEX_HOME: box.codex, [PLUGIN_ENV_NAME]: fx.codexNew }
  });

  assert.strictEqual(runtime.current().root, fx.codexNew);
  const active = runtime.sources().filter((item) => item.active);
  assert.strictEqual(active.length, 1, "同一个插件根只标一条");
  assert.strictEqual(active[0].id, "env", "标在真正被取用的那一条上（环境变量排在前）");
  fs.rmSync(box.tmp, { recursive: true, force: true });
}

// 命令行指到装着插件的父目录时（不是插件根本身），定位与列出都认。
function caseParentDir() {
  const box = sandbox();
  const parent = path.join(box.tmp, "picked");
  const inside = makePlugin(path.join(parent, "mastergo-wpf-transcoder", "1.5.0"), "1.5.0");
  const options = { env: {}, home: box.home, codexHome: box.codex, installRoot: box.install };

  const listed = pluginSources(Object.assign({}, options, { explicitDir: parent })).find((item) => item.id === "arg");
  assert.strictEqual(listed.exists, true, "父目录里那个同名插件要认出来");
  assert.strictEqual(listed.pluginRoot, inside);
  assert.strictEqual(listed.version, "1.5.0");
  assert.strictEqual(resolvePluginRoot(parent, options), inside, "取的那一份与列出来的那一份是同一个");
  assert.deepStrictEqual(pluginRootsUnder(parent), [inside], "父目录与插件根两种摆法都算能用的位置");
  assert.deepStrictEqual(pluginRootsUnder(box.install), [], "没有插件的位置照旧不算");
  assert.strictEqual(
    createPluginRuntime({ installRoot: box.install, explicitDir: parent, home: box.home, env: { CODEX_HOME: box.codex } }).current().root,
    inside,
    "装配处传 --plugin 指到父目录时照样能定位到插件"
  );

  fs.rmSync(box.tmp, { recursive: true, force: true });
}

/*
 * 插件是在客户端之外装上的（Codex / Claude 那边更新了自己的缓存）时：读一次来源清单就重新定位一次，
 * 顶栏那行版本与「正在用」因此跟着变 —— 不会出现「表里是新版、顶栏还是旧版」。
 */
function caseExternalInstallShowsUp() {
  const box = sandbox();
  const runtime = createPluginRuntime({
    installRoot: box.install,
    home: box.home,
    env: { CODEX_HOME: box.codex }
  });
  assert.strictEqual(runtime.current().root, "", "一开始一处都没有");
  const installed = makePlugin(path.join(box.codex, "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "3.0.0"), "3.0.0");
  assert.strictEqual(runtime.sources().find((item) => item.id === "codex-cache").version, "3.0.0", "读清单时重新定位");
  assert.strictEqual(runtime.current().root, installed, "顶栏那行读的也是这一份");
  assert.strictEqual(runtime.failure(), "", "重新定位之后不再报「找不到插件」");
  fs.rmSync(box.tmp, { recursive: true, force: true });
}

/*
 * 读一次来源清单只扫一遍档位：定位（reload）与读清单（sources）花的扫描次数要一样 ——
 * 数的是 readdirSync（档位扫描走它），不靠看代码。
 */
function caseSourcesScanOnce() {
  const box = sandbox();
  const fx = fixture(box);
  const runtime = createPluginRuntime({
    installRoot: box.install,
    home: box.home,
    env: { CODEX_HOME: box.codex }
  });
  const countScans = function (run) {
    let scans = 0;
    const original = fs.readdirSync;
    fs.readdirSync = function () {
      scans += 1;
      return original.apply(fs, arguments);
    };
    try {
      run();
    }
    finally {
      fs.readdirSync = original;
    }
    return scans;
  };

  const relocateScans = countScans(function () { runtime.reload(); });
  const sourcesScans = countScans(function () { runtime.sources(); });
  assert.ok(relocateScans > 0, "定位本来就要扫一遍档位");
  assert.strictEqual(sourcesScans, relocateScans, "读一次来源清单与定位一次是同一遍扫描（没有多扫一遍）");
  assert.strictEqual(runtime.current().root, fx.codexNew, "顺手同步过之后生效的还是那一份");
  fs.rmSync(box.tmp, { recursive: true, force: true });
}

try {
  const cases = [
    ["来源清单", caseSources],
    ["取值顺序", caseOrder],
    ["装配处按查找顺序定位", caseRuntime],
    ["一处都没有", caseMissing],
    ["同一个插件根只标一条正在用", caseActiveOnce],
    ["父目录里装着插件", caseParentDir],
    ["外面装上的新插件读清单时就能看见", caseExternalInstallShowsUp],
    ["读一次来源清单只扫一遍档位", caseSourcesScanOnce]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("plugin-sources.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
