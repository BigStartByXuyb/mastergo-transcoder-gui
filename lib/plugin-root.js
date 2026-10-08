"use strict";
/*
 * plugin-root.js —— 定位 mastergo-wpf-transcoder 插件的根目录。
 *
 * 本 GUI 不自带引擎：节点 ID、映射命中、控件 XML 一律由插件内的脚本产出，
 * 与 Codex/Claude Code 走的是同一份实现（同一逻辑只有一个实现）。
 * 本模块只负责回答"插件在哪"，找不到就 fail-closed，绝不回退到自带副本以外的地方。
 *
 * 插件只有一处来源：**客户端自带那一份**，装在安装根下的 plugins/<插件名>/<版本>/。
 * 客户端按插件发布件自己装它（lib/plugin-update.js 把版本铺到那儿），装完就是生效的那一份。
 *
 * 判据只有一处：pluginRootsUnder() 给「一个位置下认出来的全部插件根，高版本在前」，
 * 定位、来源清单、安装校验都读它，别处不再各自判一遍。
 */

const fs = require("fs");
const path = require("path");

const { compareVersions, isVersionName } = require("./versions.js");

const PLUGIN_NAME = "mastergo-wpf-transcoder";
/*
 * 客户端自带那一份装在哪：安装根下的这个子目录（装好是 plugins/<插件名>/<版本>/）。
 * 定位与安装（lib/plugin-update.js）都从这一处取这个名字。
 */
const INSTALL_PARENT_NAME = "plugins";
const MARKER = path.join("skills", "mastergo-to-wpf", "SKILL.md");
const MAX_DEPTH = 4;
/*
 * 来源清单里那一条的 id 与名字。界面按 id 认这一条（例如把更新动作挂在它这一行上），
 * 名字只有这一处；后端给 id、界面读 id，两边不会各写一版字符串。
 */
const INSTALL_SOURCE_ID = "install";
const INSTALL_SOURCE_LABEL = "客户端自带";

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

/*
 * 版本高的排前面。怎么比、什么算版本号都只有 lib/versions.js 一处 ——
 * 这里只负责降序取反，不再自己写一套比较。
 */
function compareVersionsDesc(a, b) {
  const left = path.basename(a);
  const right = path.basename(b);
  const leftKnown = isVersionName(left);
  const rightKnown = isVersionName(right);
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  if (!leftKnown) return 0;
  return compareVersions(right, left);
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
 * 「插件的地盘」：工程目录落在里面一律拒绝（写盘防线，lib/codex.js 读）。
 * 只有一处 —— 客户端自带那一份所在的目录。空 installRoot 时给空清单（还没定安装根）。
 */
function pluginHomes(options) {
  const dir = installDirOf((options || {}).installRoot);
  return dir ? [path.resolve(dir)] : [];
}

/*
 * 写盘防线用的那份清单：与插件定位同一份来源（客户端自带那一份所在的位置）。
 * 装配处（server.js）把它的返回值交给 lib/codex.js；接线只有这一处，测试也用同一个工厂。
 * 取 installRoot 的函数而非值：安装根是装配时定的，取值时机不影响这份判据。
 */
function createPluginHomes(deps) {
  const d = deps || {};
  const rootOf = typeof d.installRoot === "function" ? d.installRoot : function () { return d.installRoot || ""; };
  return function pluginHomesOfApp() {
    return pluginHomes({ installRoot: rootOf() });
  };
}

/* 客户端自带那一份所在的目录（安装根下）：定位、来源清单、写盘防线都从这一处取名字。 */
function installDirOf(installRoot) {
  return installRoot ? path.join(installRoot, INSTALL_PARENT_NAME) : "";
}

/*
 * 插件来源清单：只有一条 —— 客户端自带。
 * path 是「那一处」的目录，pluginRoot 是它下面解析到、实际会用的那一份，found 是它下面认出来的全部
 * （装了多版时按高版本在前）。界面照这一条渲染，不重排也不另算。
 */
function pluginSources(options) {
  const dir = installDirOf((options || {}).installRoot);
  const found = pluginRootsUnder(dir);
  return [{
    id: INSTALL_SOURCE_ID,
    label: INSTALL_SOURCE_LABEL,
    path: dir,
    kind: INSTALL_SOURCE_ID,
    exists: found.length > 0,
    pluginRoot: found[0] || "",
    version: found[0] ? pluginVersionOf(found[0]) : "",
    found: found
  }];
}

/*
 * 一个位置下能解析出的插件根，高版本在前。
 * 「这个位置本身是插件根」与「它下面若干层里有同名插件目录」是同一件事的两种摆法：
 * 定位、来源清单、安装校验都读这一份，别处不再各自判一遍。
 * 下钻深度由 findUnder 的 MAX_DEPTH 决定（含同名的那个目录自己再往下一层）。
 */
function pluginRootsUnder(dir) {
  if (!dir) return [];
  return (isPluginRoot(dir) ? [dir] : []).concat(findUnder(dir, 1)).sort(compareVersionsDesc);
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

/*
 * 生效的那一条来源 = 客户端自带那一份。定位（resolvePluginRoot）与界面标「正在用」都读它，
 * 这条判据只有这一处，界面不另推一遍。
 */
function activePluginSource(options) {
  const list = pluginSources(options);
  return { list: list, active: list[0].exists ? list[0] : null };
}

function resolvePluginRoot(options) {
  const scope = activePluginSource(options);
  if (scope.active) return scope.active.pluginRoot;

  throw new Error(
    [
      "找不到 " + PLUGIN_NAME + " 插件。",
      "已查找：" + scope.list[0].path + "（没有）",
      "到「更新 → 插件（流水线）」里装上客户端自带的那一份。"
    ].join("\n")
  );
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
  INSTALL_PARENT_NAME: INSTALL_PARENT_NAME,
  PLUGIN_MARKER: MARKER,
  INSTALL_SOURCE_ID: INSTALL_SOURCE_ID
};
