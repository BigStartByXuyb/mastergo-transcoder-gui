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
 * 插件所在的目录树（纯计算，不读盘）：Codex 与 Claude Code 的安装区，加上环境变量显式指定的那份。
 * 除当作搜索起点外，写盘拦截也用这一份判断"是不是插件的地盘"——这些都是别人家的目录，工程目录落在里面一律拒绝。
 */
function pluginHomes(options) {
  const ctx = contextOf(options);
  const homes = [];
  if (ctx.env.MASTERGO_PLUGIN_ROOT) homes.push(path.resolve(ctx.env.MASTERGO_PLUGIN_ROOT));
  homes.push(path.join(ctx.codexHome, "plugins"));
  homes.push(path.join(ctx.home, ".claude", "plugins"));
  return homes;
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
  add("env", "环境变量 MASTERGO_PLUGIN_ROOT", ctx.env.MASTERGO_PLUGIN_ROOT, "env");
  add("codex-cache", "Codex 插件缓存", path.join(ctx.codexHome, "plugins", "cache"), "agent");
  add("codex-market", "Codex 插件市场", path.join(ctx.codexHome, "plugins", "marketplaces"), "agent");
  add("claude-cache", "Claude 插件缓存", path.join(ctx.home, ".claude", "plugins", "cache"), "agent");
  add("claude-market", "Claude 插件市场", path.join(ctx.home, ".claude", "plugins", "marketplaces"), "agent");
  add("install", "客户端自带", ctx.installRoot ? path.join(ctx.installRoot, "plugins") : "", "install");

  return entries.map(function (entry) {
    /*
     * 这一条自己就是插件根（命令行、设置里选的、环境变量通常是直接指到根的），
     * 那就以它为准，不再往下找同名目录 —— 否则界面上会出现「正在用这一条，却标着没有」。
     */
    const found = (isPluginRoot(entry.path) ? [entry.path] : []).concat(findUnder(entry.path, 1)).sort(compareVersionsDesc);
    return Object.assign({}, entry, {
      exists: found.length > 0,
      pluginRoot: found[0] || "",
      version: found[0] ? versionOf(found[0]) : "",
      found: found
    });
  });
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
function versionOf(dir) {
  for (const id of [".claude-plugin", ".codex-plugin"]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, id, "plugin.json"), "utf8"));
      if (parsed && parsed.version) return String(parsed.version);
    }
    catch {
      // 没有这个清单就试下一个
    }
  }
  return "";
}

function resolvePluginRoot(explicitDir, options) {
  const sources = pluginSources(Object.assign({}, options, { explicitDir: explicitDir || (options || {}).explicitDir }));
  const fromArg = sources.find(function (item) { return item.id === "arg"; });
  if (fromArg) {
    if (isPluginRoot(fromArg.path)) return fromArg.path;
    throw new Error(
      "--plugin 指向的目录不是 " + PLUGIN_NAME + " 插件根（缺 " + MARKER + "）：" + fromArg.path
    );
  }

  /*
   * 顺序取自 pluginSources()：命令行 → 界面上选的 → 环境变量 → 各插件缓存/市场 → 客户端自带那一份。
   * 界面上选的和环境变量这两种「本机显式指定」优先于缓存里的副本 —— 它们可能没有版本号目录名，
   * 按版本排序会输给缓存里的旧版本，与「先命中先用」的顺序相反。
   * 显式指定的那一份不在了（被挪走、被删）就往下走：客户端照常能用，界面上那一条会标成「没有」。
   */
  for (const item of sources) {
    if (item.id !== "chosen" && item.id !== "env") continue;
    if (isPluginRoot(item.path)) return item.path;
  }

  for (const source of sources) {
    if (source.id === "arg" || source.id === "chosen" || source.id === "env") continue;
    if (source.exists) return source.pluginRoot;
  }

  throw new Error(
    [
      "找不到 " + PLUGIN_NAME + " 插件。",
      "已查找：" + sources.map(function (item) { return item.path + (item.exists ? "（有）" : "（没有）"); }).join("  |  "),
      "请安装插件，或在设置里选一个目录 / 用 --plugin <插件目录> / 环境变量 MASTERGO_PLUGIN_ROOT 指定。"
    ].join("\n")
  );
}

module.exports = { resolvePluginRoot, pluginHomes, pluginSources, isPluginRoot };
