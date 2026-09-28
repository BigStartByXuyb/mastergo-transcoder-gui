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
 *   2. 环境变量 MASTERGO_PLUGIN_ROOT
 *   3. <CODEX_HOME>/plugins/{cache,marketplaces} 下的同名插件（有版本目录时取最高版本）
 *   4. ~/.claude/plugins/{cache,marketplaces} 下的同名插件（同上）
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

function candidateRoots() {
  const home = os.homedir();
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
  const roots = [];
  if (process.env.MASTERGO_PLUGIN_ROOT) roots.push(path.resolve(process.env.MASTERGO_PLUGIN_ROOT));
  roots.push(path.join(codexHome, "plugins", "cache"));
  roots.push(path.join(codexHome, "plugins", "marketplaces"));
  roots.push(path.join(home, ".claude", "plugins", "cache"));
  roots.push(path.join(home, ".claude", "plugins", "marketplaces"));
  return roots;
}

function resolvePluginRoot(explicitDir) {
  const explicit = explicitDir ? path.resolve(explicitDir) : "";
  if (explicit) {
    if (isPluginRoot(explicit)) return explicit;
    throw new Error(
      "--plugin 指向的目录不是 " + PLUGIN_NAME + " 插件根（缺 " + MARKER + "）：" + explicit
    );
  }

  /*
   * 环境变量是本机显式指定的目录（本地开发/验证用），优先级高于安装目录里的副本：
   * 它通常没有版本号目录名，按版本排序会输给 cache 里的旧版本，与「先命中先用」的顺序相反。
   */
  const fromEnv = process.env.MASTERGO_PLUGIN_ROOT ? path.resolve(process.env.MASTERGO_PLUGIN_ROOT) : "";
  if (fromEnv && isPluginRoot(fromEnv)) return fromEnv;

  const hits = [];
  for (const root of candidateRoots()) {
    hits.push(...findUnder(root, 1));
  }
  const unique = Array.from(new Set(hits)).sort(compareVersionsDesc);
  if (unique.length > 0) return unique[0];

  throw new Error(
    [
      "找不到 " + PLUGIN_NAME + " 插件。",
      "已查找：" + candidateRoots().join("  |  "),
      "请安装插件，或用 --plugin <插件目录> / 环境变量 MASTERGO_PLUGIN_ROOT 指定。"
    ].join("\n")
  );
}

module.exports = { resolvePluginRoot, isPluginRoot, PLUGIN_NAME, MARKER };
