"use strict";

/*
 * 出网代理：Node 的 fetch 只认环境变量，不认 Windows「Internet 选项」里的系统代理。
 *
 * 谁在用：server.js 装配时调一次 —— 程序更新、Codex 与运行时的按需下载都靠它出网。
 * 边界：环境里一个代理变量都没有时，用系统代理（WinINET）补齐 HTTP_PROXY / HTTPS_PROXY / NO_PROXY，
 *       然后让 fetch 立刻按这些变量走。读不到就直连；只在 Windows 上读系统代理。
 */

const http = require("http");
const { spawnSync } = require("child_process");

const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"];
const DEFAULT_NO_PROXY = "localhost,127.0.0.1,::1";
const REGISTRY_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const HOST = "[A-Za-z0-9._:\\-\\[\\]]+";

// 代理地址只有两种合法写法：host:port 或带 http(s):// 前缀的同一件事；其它一律当没配。
function toUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (new RegExp("^https?://" + HOST + "$").test(text)) return text;
  if (new RegExp("^" + HOST + "$").test(text)) return "http://" + text;
  return "";
}

// ProxyServer 要么是 host:port，要么是 http=host:port;https=host:port —— 优先 https 那一项。
function normalizeServer(value) {
  let secure = "";
  let plain = "";
  let bare = "";
  for (const raw of String(value || "").split(";")) {
    const part = raw.trim();
    if (!part) continue;
    const at = part.indexOf("=");
    if (at < 0) {
      if (!bare) bare = part;
      continue;
    }
    const key = part.slice(0, at).trim().toLowerCase();
    const entry = part.slice(at + 1).trim();
    if (key === "https" && !secure) secure = entry;
    if (key === "http" && !plain) plain = entry;
  }
  return toUrl(secure) || toUrl(plain) || toUrl(bare);
}

// reg query 的输出里取 ProxyEnable / ProxyServer 两行；没开或没有地址就是没配代理。
function parseSystemProxy(text) {
  const source = String(text || "");
  const enabled = /ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(source);
  if (!enabled || Number.parseInt(enabled[1], 16) !== 1) return "";
  const server = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(source);
  return server ? normalizeServer(server[1]) : "";
}

function readSystemProxy(options) {
  const opts = options || {};
  if ((opts.platform || process.platform) !== "win32") return "";
  const run = opts.run || function (args) {
    return spawnSync("reg", args, { encoding: "utf8", windowsHide: true });
  };
  const result = run(["query", REGISTRY_KEY]);
  if (!result || result.status !== 0) return "";
  return parseSystemProxy(result.stdout);
}

function hasProxyEnv(env) {
  for (const key of PROXY_KEYS) {
    if (String(env[key] || "").trim()) return true;
  }
  return false;
}

// 只补「环境里一个代理变量都没有」这一种情况：有就一个字都不动。
function fillProxyEnv(env, server) {
  const filled = [];
  if (!server) return filled;
  env.HTTP_PROXY = server;
  env.HTTPS_PROXY = server;
  filled.push("HTTP_PROXY", "HTTPS_PROXY");
  if (!String(env.NO_PROXY || "").trim()) {
    env.NO_PROXY = DEFAULT_NO_PROXY;
    filled.push("NO_PROXY");
  }
  return filled;
}

/*
 * 返回 { enabled, filled }：enabled 表示 fetch 已经按代理变量走了，filled 是这次补上的变量名。
 * setProxy 可注入：老引擎没有这个 API 就什么都做不了，保持直连（不报错、不挡住启动）。
 */
function applyProxy(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const filled = hasProxyEnv(env) ? [] : fillProxyEnv(env, readSystemProxy(opts));
  const setProxy = opts.setProxy === undefined ? http.setGlobalProxyFromEnv : opts.setProxy;
  if (typeof setProxy !== "function") return { enabled: false, filled: filled };
  setProxy();
  return { enabled: true, filled: filled };
}

module.exports = { applyProxy };
