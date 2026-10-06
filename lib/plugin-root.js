"use strict";
/*
 * plugin-root.js —— 定位 mastergo-wpf-transcoder 插件的根目录。
 *
 * 本 GUI 不自带引擎：节点 ID、映射命中、控件 XML 一律由插件内的脚本产出，
 * 与 Codex/Claude Code 走的是同一份实现（同一逻辑只有一个实现）。
 * 本模块只负责回答"插件在哪"，找不到就 fail-closed，绝不回退到自带副本。
 *
 * 查找顺序（先命中先用）：
 *   1. 显式传入的目录（命令行 --plugin）
 *   2. 界面上选的目录（设置里的 pluginRoot）
 *   3. 环境变量 MASTERGO_PLUGIN_ROOT
 *   4. <CODEX_HOME>/plugins/{cache,marketplaces} 下的同名插件（有版本目录时取最高版本）
 *   5. ~/.claude/plugins/{cache,marketplaces} 下的同名插件（同上）
 *   6. 客户端自带的那一份（安装根 plugins/）
 *
 * 顺序只有一处：pluginSources() 列出全部候选，resolvePluginRoot() 就按这份列表取第一个有插件的。
 * 界面上「列出来 + 选一个」读的也是同一份，两边不会各说各话。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const PLUGIN_NAME = "mastergo-wpf-transcoder";
// 指名插件根的环境变量：定位、列出、设置页写入的那一项，名字只有这一处。
const PLUGIN_ENV_NAME = "MASTERGO_PLUGIN_ROOT";
const MARKER = path.join("skills", "mastergo-to-wpf", "SKILL.md");
const MAX_DEPTH = 4;

function isPluginRoot(dir) {
  if (!dir) return false;
  try {
    return fs.statSync(path.join(dir, MARKER)).isFile();
  }
  catch {
    return false;
  }
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(function (entry) { return entry.isDirectory(); })
      .map(function (entry) { return path.join(dir, entry.name); });
  }
  catch {
    return [];
  }
}

// 目录名是纯版本号（如 1.0.301）时返回数字段，否则返回 null。
function versionKey(name) {
  const matched = /^(\d+(?:\.\d+)*)$/.exec(name);
  return matched ? matched[1].split(".").map(Number) : null;
}

// 版本高的排前面；字符串比较会把 1.0.99 排到 1.0.301 之后，必须按数字段比。
function compareVersionsDesc(a, b) {
  const va = versionKey(path.basename(a)) || [];
  const vb = versionKey(path.basename(b)) || [];
  for (let i = 0; i < Math.max(va.length, vb.length); i += 1) {
    const diff = (vb[i] || 0) - (va[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// 在 root 下浅层搜索名为 PLUGIN_NAME 的目录；命中后把"它本身"或"它的版本子目录"作为候选。
function findUnder(root, depth) {
  const found = [];
  for (const dir of listDirs(root)) {
    if (path.basename(dir) === PLUGIN_NAME) {
      if (isPluginRoot(dir)) found.push(dir);
      for (const child of listDirs(dir)) {
        if (isPluginRoot(child)) found.push(child);
      }
      continue;
    }
    if (depth < MAX_DEPTH) {
      found.push(...findUnder(dir, depth + 1));
    }
  }
  return found;
}

/*
 * 插件所在的目录树（纯计算，不读盘）：三条内置位置，加上本机显式指定的那几处（命令行、设置里选的、环境变量）。
 * 只给 env 时拿到的是三条内置位置；要挡住自定插件根，装配处用 createPluginHomes()（下面那个）。
 */
function pluginHomes(options) {
  const ctx = contextOf(options);
  const homes = [];
  const push = function (dir) {
    if (!dir) return;
    const full = path.resolve(dir);
    if (homes.indexOf(full) < 0) homes.push(full);
  };
  push(ctx.explicit);
  push(ctx.chosen);
  push(ctx.env[PLUGIN_ENV_NAME]);
  push(path.join(ctx.codexHome, "plugins"));
  push(path.join(ctx.home, ".claude", "plugins"));
  return homes;
}

/*
 * 写盘防线用的那份清单：与插件定位同一份来源（命令行、设置里选的、环境变量、两条内置）。
 * 装配处（server.js）把它的返回值交给 lib/codex.js —— 这些都是别人家的目录，
 * 工程目录落在里面一律拒绝；接线只有这一处，测试也用同一个工厂，不会各拼一份。
 */
function createPluginHomes(deps) {
  const d = deps || {};
  return function pluginHomesOfApp() {
    return pluginHomes({
      env: d.env || process.env,
      home: d.home,
      explicitDir: d.pluginDir || "",
      chosenRoot: typeof d.chosenRoot === "function" ? d.chosenRoot() : (d.chosenRoot || "")
    });
  };
}

/*
 * 全部候选来源：界面要一份「都查过哪些、各自有没有、用的是哪一份」的清单。
 * 每条给 id / 名字 / 路径 / 找到的插件根与版本 / 这一条此刻是不是生效的那条。
 */
function pluginSources(options) {
  const ctx = contextOf(options);

  const entries = [];
  const add = function (id, label, dir, kind) {
    if (!dir) return;
    entries.push({ id: id, label: label, path: path.resolve(dir), kind: kind });
  };
  add("arg", "启动参数 --plugin", ctx.explicit, "arg");
  add("chosen", "设置里选的", ctx.chosen, "chosen");
  add("env", "环境变量 " + PLUGIN_ENV_NAME, ctx.env[PLUGIN_ENV_NAME], "env");
  add("codex-cache", "Codex 插件缓存", path.join(ctx.codexHome, "plugins", "cache"), "agent");
  add("codex-market", "Codex 插件市场", path.join(ctx.codexHome, "plugins", "marketplaces"), "agent");
  add("claude-cache", "Claude 插件缓存", path.join(ctx.home, ".claude", "plugins", "cache"), "agent");
  add("claude-market", "Claude 插件市场", path.join(ctx.home, ".claude", "plugins", "marketplaces"), "agent");
  add("install", "客户端自带", ctx.installRoot ? path.join(ctx.installRoot, "plugins") : "", "install");

  return entries.map(function (entry) {
    const found = pluginRootsUnder(entry.path);
    return Object.assign({}, entry, {
      exists: found.length > 0,
      pluginRoot: found[0] || "",
      version: found[0] ? pluginVersionOf(found[0]) : "",
      found: found
    });
  });
}

/*
 * 一个位置下能解析出的插件根，高版本在前。
 * 「本身是插件根」（命令行、设置里选的、环境变量通常直接指到根）与「它下面若干层里有同名插件目录」
 * 是同一件事的两种摆法：定位、列出、界面校验都读这一份，别处不再各自判一遍。
 * 下钻深度由 findUnder 的 MAX_DEPTH 决定（含同名的那个目录自己再往下一层）。
 */
function pluginRootsUnder(dir) {
  if (!dir) return [];
  return (isPluginRoot(dir) ? [dir] : []).concat(findUnder(dir, 1)).sort(compareVersionsDesc);
}

/*
 * 各条来源的参数。env / home / codexHome 都可以显式给，不给就用本进程的 ——
 * 取值与判据必须是同一份，否则「查过哪些路径」与实际用的那一份会对不上。
 */
function contextOf(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const codexHome = opts.codexHome || env.CODEX_HOME || path.join(home, ".codex");
  return {
    env: env,
    home: home,
    codexHome: codexHome,
    explicit: opts.explicitDir ? path.resolve(opts.explicitDir) : "",
    chosen: opts.chosenRoot ? path.resolve(opts.chosenRoot) : "",
    installRoot: opts.installRoot || ""
  };
}

// 插件版本读插件自己的清单（.claude-plugin / .codex-plugin 里的 plugin.json）。
// 「这一条是哪一版」「现在生效的是哪一版」「要打包的是哪一版」都走它，三处不会各说各话。
function pluginVersionFrom(read) {
  if (typeof read !== "function") return "";
  for (const id of [".claude-plugin", ".codex-plugin"]) {
    try {
      const raw = read(id + "/plugin.json");
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version) return String(parsed.version);
    }
    catch {
      // 没有这个清单就试下一个
    }
  }
  return "";
}

function pluginVersionOf(dir) {
  if (!dir) return "";
  return pluginVersionFrom(function (rel) {
    try {
      return fs.readFileSync(path.join(dir, rel), "utf8");
    }
    catch {
      return "";
    }
  });
}

function resolvePluginRoot(explicitDir, options) {
  const scope = activePluginSource(Object.assign({}, options, { explicitDir: explicitDir || (options || {}).explicitDir }));
  const sources = scope.list;
  const fromArg = sources.find(function (item) { return item.id === "arg"; });
  if (fromArg && !fromArg.exists) {
    throw new Error(
      "--plugin 指的位置不是 " + PLUGIN_NAME + " 插件根（它自己与它下面都没有，缺 " + MARKER + "）：" + fromArg.path
    );
  }

  if (scope.active) return scope.active.pluginRoot;

  throw new Error(
    [
      "找不到 " + PLUGIN_NAME + " 插件。",
      "已查找：" + sources.map(function (item) { return item.path + (item.exists ? "（有）" : "（没有）"); }).join("  |  "),
      "请安装插件，或在设置里选一个目录 / 用 --plugin <插件目录> / 环境变量 MASTERGO_PLUGIN_ROOT 指定。"
    ].join("\n")
  );
}

/*
 * 生效的那一条来源：按 pluginSources() 的顺序取第一个解析到插件的 ——
 * 命令行 → 界面上选的 → 环境变量 → 各插件缓存/市场 → 客户端自带那一份。
 * 定位（resolvePluginRoot）与界面标「正在用」都读它，这条优先级规则只有这一处。
 * 命令行给了却一处都没解析到时 active 为 null（且 list 里能看出是 --plugin 那一条没成），调用方据此报错。
 */
function activePluginSource(options) {
  const list = pluginSources(options);
  const fromArg = list.find(function (item) { return item.id === "arg"; });
  if (fromArg && !fromArg.exists) return { list: list, active: null };
  return { list: list, active: list.find(function (item) { return item.exists; }) || null };
}

module.exports = {
  resolvePluginRoot,
  activePluginSource,
  pluginHomes,
  createPluginHomes,
  pluginSources,
  pluginRootsUnder,
  isPluginRoot,
  pluginVersionOf,
  PLUGIN_NAME: PLUGIN_NAME,
  PLUGIN_ENV_NAME: PLUGIN_ENV_NAME,
  PLUGIN_MARKER: MARKER
};
