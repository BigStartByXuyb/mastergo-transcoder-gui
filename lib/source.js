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
const KINDS = ["github", "gitlab", "static"];
// GitLab 通用包的名字：客户端按它拼通用包地址。发布侧的 GitLab 上传随公司内网那条线一起做，
// 届时复用这一个常量，改名只改这里。
const GITLAB_PACKAGE = "mastergo-transcoder-gui";
const LATEST = "latest";

function normalizeSource(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const fallback = { kind: "github", base: DEFAULT_BASE };
  // 类型不认识就整体不用它：只换一半（类型回落、基址照用）会拼出对不上任何服务的地址。
  if (!KINDS.includes(value.kind)) return fallback;
  // 去掉末尾斜杠：拼地址时统一由这一处负责分隔符。
  const base = String(value.base || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return fallback;
  return { kind: value.kind, base: base };
}

// 某一版的资产地址；version 为空＝最新。
function assetUrl(source, version, asset) {
  const current = normalizeSource(source);
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

function manifestUrl(source) {
  return assetUrl(source, "", "manifest.json");
}

function manifestUrlOf(source, version) {
  return assetUrl(source, version, "manifest.json");
}

/*
 * 文件按内容寻址取回。静态源把文件集中在 files/ 下（历史版本共用一份，不重复占地方）；
 * GitHub 与 GitLab 的资产挂在某版下面，同一个哈希在不同版本里是同一份内容，取哪版都一样。
 */
function blobUrl(source, version, hash) {
  const current = normalizeSource(source);
  if (current.kind === "static") return current.base + "/files/" + hash;
  return assetUrl(current, version, hash);
}

/*
 * 私有源要带 creds：GitLab 认 private-token，GitHub 与静态目录认 Bearer。没有 token 就不带头。
 * GitHub 私有仓库取 release 资产时，第一跳带着这个头过鉴权，重定向到签名地址（另一域）——
 * 按 fetch 规范换域时 Authorization 会被丢掉，正好不会污染签名请求。
 * 边界：私有 GitHub 这条路首次真机发布时实测一次。
 */
function requestHeaders(source, token) {
  const secret = String(token || "").trim();
  if (!secret) return null;
  const current = normalizeSource(source);
  return current.kind === "gitlab" ? { "private-token": secret } : { authorization: "Bearer " + secret };
}

/* 给界面看的：现在会去哪个地址取清单，以及后端认哪几种源类型（界面下拉照它渲染，不另抄一份）。 */
function describeSource(source) {
  const current = normalizeSource(source);
  return { kind: current.kind, base: current.base, manifestUrl: manifestUrl(current), kinds: KINDS.slice() };
}

module.exports = {
  DEFAULT_BASE: DEFAULT_BASE,
  normalizeSource: normalizeSource,
  // 某一版的某个资产地址：程序更新、运行时安装包、winget 清单里的包地址，拼法都走这一处。
  assetUrl: assetUrl,
  manifestUrl: manifestUrl,
  manifestUrlOf: manifestUrlOf,
  blobUrl: blobUrl,
  requestHeaders: requestHeaders,
  describeSource: describeSource
};
