"use strict";

/*
 * 发布源：客户端从哪儿取清单、从哪儿下文件。
 *
 * 三种形态，都只是「一个基址 + 可选 token」：
 *   github  https://github.com/<owner>/<repo>（企业版同形）
 *           最新清单 <base>/releases/latest/download/manifest.json
 *           某版清单 <base>/releases/download/v<版本>/manifest.json
 *           文件     <base>/releases/download/v<版本>/<sha256>
 *   gitlab  https://git.公司.com/<组>/<仓库>
 *           最新清单 <base>/-/releases/permalink/latest/downloads/manifest.json
 *           某版清单 <base>/-/packages/generic/<包名>/v<版本>/manifest.json
 *           文件     <base>/-/packages/generic/<包名>/v<版本>/<sha256>
 *           最新那份走 release 的固定链接，是因为 GitLab 通用包同一个版本不允许覆盖同名文件 ——
 *           「latest」这种每版都要刷新的槽位放不进通用包，而 release permalink 正是它给最新版准备的固定地址。
 *   static  http://10.0.0.9/updates（nginx / 共享盘 / 任意静态目录）
 *           最新清单 <base>/manifest.json
 *           某版清单 <base>/v<版本>/manifest.json
 *           文件     <base>/files/<sha256>
 *
 * 于是「静态清单 + 按哈希取文件」这一套协议对三种源都成立，客户端只有一份实现：
 * 不需要先调 API 问「最新是哪一版」，直接取清单就行。
 * 边界：GitLab 这一套按官方文档的固定地址拼（permalink / 通用包），首次在真机上发布时要实测一次。
 *
 * 边界：只拼地址、只给请求头；不认识版本号大小，也不认识文件内容。
 */

// 客户端默认从公开仓库取；正式客户可以在设置里改成公司 GitLab 或内网静态目录。
const DEFAULT_BASE = "https://github.com/BigStartByXuyb/mastergo-transcoder-gui";
/*
 * 插件（mastergo-wpf-transcoder）有自己的版本线：它在插件仓库那边打 tag 时发同构的发布件
 * （plugin-manifest.json + 按 sha256 命名的文件），客户端只做消费者 —— 不再跟着客户端发布件钉一份。
 * 所以插件线的默认基址是插件仓库，不是客户端仓库。
 */
const PLUGIN_DEFAULT_BASE = "https://github.com/BigStartByXuyb/test";
const KINDS = ["github", "gitlab", "static"];
/*
 * 两份清单的名字同属这一套协议：客户端本体一份、插件发布件一份。
 * 插件那一半（发布侧 scripts/pack-plugin.js、客户端侧 lib/plugin-update.js）都从这里取名字，
 * 免得「打包写了一个名、下载找另一个名」。
 */
const MANIFEST_NAME = "manifest.json";
const PLUGIN_MANIFEST_NAME = "plugin-manifest.json";
// GitLab 通用包的名字：客户端按它拼通用包地址。发布侧的 GitLab 上传随公司内网那条线一起做，
// 届时复用这一个常量，改名只改这里。
const GITLAB_PACKAGE = "mastergo-transcoder-gui";
const LATEST = "latest";

/*
 * 解析一份源配置：能用就返回归一化后的 {kind, base}，不能用返回 null。
 * 给「不想回落」的调用方用（发布脚本、winget 清单生成器）—— 它们宁可报错，也不要一份悄悄指到别处的地址。
 */
function parseSource(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  // 类型不认识就整体不用它：只换一半（类型回落、基址照用）会拼出对不上任何服务的地址。
  if (!KINDS.includes(value.kind)) return null;
  // 去掉末尾斜杠：拼地址时统一由这一处负责分隔符。
  const base = String(value.base || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return null;
  return { kind: value.kind, base: base };
}

/*
 * 归一：能用就用，不能用回这个默认基址 —— 两条版本线各有一个默认（客户端仓库 / 插件仓库），
 * 写法只有这一处，别各写一遍。
 */
function normalizeWith(raw, defaultBase) {
  return parseSource(raw) || { kind: "github", base: defaultBase };
}

// 客户端那边用这个：拿到什么都能给出一份可用的源（坏配置一律回到内置的公网源）。
function normalizeSource(raw) {
  return normalizeWith(raw, DEFAULT_BASE);
}

/*
 * 插件那条线的源：它是**自己那一项设置**（local.json 的 pluginSource），与程序更新那项互不影响 ——
 * 两条线各有各的版本线，编辑其中一条不该把另一条带沟里。没配／配坏了都回插件仓库这个默认。
 * 内网部署想一个地址取两边：把两份清单（manifest.json 与 plugin-manifest.json）与它们的文件放进
 * 同一个静态目录（文件按内容哈希命名，两边不会撞），然后两项设置都填那个目录。
 */
function pluginSourceOf(explicit) {
  return normalizeWith(explicit, PLUGIN_DEFAULT_BASE);
}

/*
 * 两条版本线各自的归一：**「哪条线回哪个默认」只有这张表知道**。
 * 取清单与缓存、拼地址、设置读写的调用点都从它取，别在各处再写一遍 normalizeSource / pluginSourceOf 的选择。
 * 「有哪几条版本线」也只在这张表里列一次：设置层按 lineOf 给的字段名派生本机凭据文件名，
 * 不另列一份字段清单。
 */
const LINES = {
  source: { normalize: normalizeSource },
  pluginSource: { normalize: pluginSourceOf }
};

/**
 * 按设置字段取这条线的定义（不传＝程序更新那条）：{ field: 归一后的字段名, normalize: 这条线的归一 }。
 * field 一并给出，调用方要按字段定落盘位置时不必再写一遍默认字段名。
 * 不认识的字段直接说 —— 静默回落会把「写错字段名」变成「悄悄用了另一条线的默认」。
 */
function lineOf(field) {
  const name = field || "source";
  const line = LINES[name];
  if (!line) throw new Error("不认识的发布源字段：" + field);
  return { field: name, normalize: line.normalize };
}

/*
 * 某一版的资产地址；version 为空＝最新。
 * normalize 是「坏的 / 空的源回落哪份默认」：默认客户端那份；插件那条线传 pluginSourceOf，
 * 两条线各自的默认才不会串（取清单那边也是这么注入的）。
 */
function assetUrl(source, version, asset, normalize) {
  const current = (normalize || normalizeSource)(source);
  const at = String(version || "").trim();
  if (current.kind === "gitlab") {
    if (!at) return current.base + "/-/releases/permalink/" + LATEST + "/downloads/" + asset;
    return current.base + "/-/packages/generic/" + GITLAB_PACKAGE + "/v" + at.replace(/^v/, "") + "/" + asset;
  }
  if (current.kind === "static") {
    return at ? current.base + "/v" + at.replace(/^v/, "") + "/" + asset : current.base + "/" + asset;
  }
  const tag = at ? "download/v" + at.replace(/^v/, "") : "latest/download";
  return current.base + "/releases/" + tag + "/" + asset;
}

// 最新那份清单的地址。名字不传就是客户端本体那一份；插件按同一套协议换清单名取它自己那份。
function manifestUrl(source, name, normalize) {
  return assetUrl(source, "", name || MANIFEST_NAME, normalize);
}

function manifestUrlOf(source, version, normalize) {
  return assetUrl(source, version, MANIFEST_NAME, normalize);
}

/*
 * 文件按内容寻址取回。静态源把文件集中在 files/ 下（历史版本共用一份，不重复占地方）；
 * GitHub 与 GitLab 的资产挂在某版下面，同一个哈希在不同版本里是同一份内容，取哪版都一样。
 */
function blobUrl(source, version, hash, normalize) {
  const current = (normalize || normalizeSource)(source);
  if (current.kind === "static") return current.base + "/files/" + hash;
  return assetUrl(current, version, hash);
}

/*
 * 私有源要带 creds：GitLab 认 private-token，GitHub 与静态目录认 Bearer。没有 token 就不带头。
 * GitHub 私有仓库取 release 资产时，第一跳带着这个头过鉴权，重定向到签名地址（另一域）——
 * 按 fetch 规范换域时 Authorization 会被丢掉，正好不会污染签名请求。
 * 边界：私有 GitHub 这条路首次真机发布时实测一次。
 */
function requestHeaders(source, token, normalize) {
  const secret = String(token || "").trim();
  if (!secret) return null;
  const current = (normalize || normalizeSource)(source);
  return current.kind === "gitlab" ? { "private-token": secret } : { authorization: "Bearer " + secret };
}

/* 给界面看的：现在会去哪个地址取清单，以及后端认哪几种源类型（界面下拉照它渲染，不另抄一份）。 */
function describeSource(source, name, normalize) {
  const current = (normalize || normalizeSource)(source);
  return { kind: current.kind, base: current.base, manifestUrl: manifestUrl(current, name, normalize), kinds: KINDS.slice() };
}

module.exports = {
  DEFAULT_BASE: DEFAULT_BASE,
  PLUGIN_DEFAULT_BASE: PLUGIN_DEFAULT_BASE,
  MANIFEST_NAME: MANIFEST_NAME,
  PLUGIN_MANIFEST_NAME: PLUGIN_MANIFEST_NAME,
  // 认哪几种源：设置页下拉、发布脚本、winget 清单生成器都读这一份，不再各抄一遍。
  KINDS: KINDS,
  parseSource: parseSource,
  normalizeSource: normalizeSource,
  pluginSourceOf: pluginSourceOf,
  LINES: LINES,
  lineOf: lineOf,
  // 某一版的某个资产地址：程序更新与 winget 清单里的包地址走这一处。
  // （运行时的安装包是另一条：基址 + 文件名，见 lib/runtime.js 的 assetUrl —— 语义不同，不共用。）
  assetUrl: assetUrl,
  manifestUrl: manifestUrl,
  manifestUrlOf: manifestUrlOf,
  blobUrl: blobUrl,
  requestHeaders: requestHeaders,
  describeSource: describeSource
};
