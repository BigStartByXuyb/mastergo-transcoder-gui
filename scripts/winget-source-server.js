#!/usr/bin/env node
"use strict";

/*
 * 内网 winget 源：按 winget 的 REST 源协议回答三件事 —— 服务信息、搜索、取某个包的清单。
 * 数据只有一份文件（scripts/lib/winget-manifest.js 的 SOURCE_FILE）加一个静态资产目录；
 * 每次请求现读那份文件，所以换一版就是把文件换掉，不用重启。
 *
 * 跑法（服务机上要哪些文件由 docs/winget-internal-source.md 一处列全，用例盯着那份清单与依赖图一致）：
 *   node scripts/winget-source-server.js --root /srv/mastergo-winget --port 18443
 *   node scripts/winget-source-server.js --root … --port 18443 --cert server.crt --key server.key
 *
 * 路由：
 *   GET  /api/information                winget 先问服务认哪些 REST 版本
 *   POST /api/manifestSearch             winget 按关键词或字段搜包
 *   GET  /api/packageManifests/<标识>     取某个包的清单（?Version= 指定某一版）
 *   GET  /files/<名字>                    静态资产（zip、部署时生成的证书）
 *
 * 边界：只读、无状态、无鉴权 —— 它放在内网，只发我们自己的包。
 * 不实现 /packages* 那半（发布接口）：发布走 scripts/winget-source.js 换数据文件。
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const { argValue } = require("./lib/args.js");
const winget = require("./lib/winget-manifest.js");

// 不给 --port 时的端口：与部署那台一致（见 docs/winget-internal-source.md）。
const DEFAULT_PORT = 18443;
// winget source list 里显示的名字。
const DEFAULT_IDENTIFIER = "BigStart";
const MANIFESTS_PREFIX = "/api/packageManifests/";
// 静态资产的路由前缀与目录名同一处来：地址里的段落名与盘上的目录名还是一件事。
const FILES_PREFIX = "/" + winget.SOURCE_FILES_DIR + "/";

// 数据文件每次请求现读：换一版就是把文件换掉，不用重启服务。
function readPackages(root) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, winget.SOURCE_FILE), "utf8"));
  return Array.isArray(raw.Packages) ? raw.Packages : [];
}

function sendJson(response, status, body, writesBody) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text)
  });
  response.end(writesBody === false ? undefined : text);
}

// 出错照 winget 的 Error 形状回：状态码 + ErrorCode / ErrorMessage。
function sendError(response, status, message, writesBody) {
  sendJson(response, status, { ErrorCode: status, ErrorMessage: message }, writesBody);
}

function readBody(request) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      }
      catch (error) {
        reject(new Error("请求体不是合法 JSON：" + error.message));
      }
    });
    request.on("error", reject);
  });
}

// 静态资产：名字里不许有分隔符，也不许爬出 files/ 目录。
function sendFile(response, root, name, writesBody) {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return sendError(response, 404, "没有这个文件", writesBody);
  }
  const file = path.join(root, winget.SOURCE_FILES_DIR, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return sendError(response, 404, "没有这个文件：" + name, writesBody);
  }
  response.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": fs.statSync(file).size
  });
  if (writesBody === false) return response.end();
  fs.createReadStream(file).pipe(response);
}

function createHandler(options) {
  return function (request, response) {
    const at = request.url.indexOf("?");
    const route = decodeURIComponent(at < 0 ? request.url : request.url.slice(0, at));
    const query = new URLSearchParams(at < 0 ? "" : request.url.slice(at + 1));
    // HEAD 与 GET 同一条路由：只看一眼「在不在、多大」不该 404，但不写体。
    const writesBody = request.method !== "HEAD";
    const method = writesBody ? request.method : "GET";
    try {
      // 给人看的一眼确认：服务活着、手上有几个包。
      if (method === "GET" && route === "/") {
        return sendJson(response, 200, { Ok: true, Packages: readPackages(options.root).length }, writesBody);
      }
      if (method === "GET" && route === "/api/information") {
        return sendJson(response, 200, winget.informationBody(options.identifier), writesBody);
      }
      if (method === "GET" && route.startsWith(MANIFESTS_PREFIX)) {
        const identifier = route.slice(MANIFESTS_PREFIX.length);
        const version = query.get("Version");
        const body = winget.manifestBody(readPackages(options.root), identifier, version);
        if (!body) return sendError(response, 404, "没有这个包：" + identifier + (version ? " @" + version : ""), writesBody);
        return sendJson(response, 200, body, writesBody);
      }
      if (method === "GET" && route.startsWith(FILES_PREFIX)) {
        return sendFile(response, options.root, route.slice(FILES_PREFIX.length), writesBody);
      }
      if (request.method === "POST" && route === "/api/manifestSearch") {
        return readBody(request)
          .then((body) => sendJson(response, 200, winget.searchBody(readPackages(options.root), body)))
          .catch((error) => sendError(response, 400, error.message));
      }
      return sendError(response, 404, "没有这个地址：" + route, writesBody);
    }
    catch (error) {
      return sendError(response, 500, error.message, writesBody);
    }
  };
}

function main() {
  const root = path.resolve(argValue("root", path.join(__dirname, "..", "dist", "winget-source")));
  const port = Number(argValue("port", DEFAULT_PORT));
  const identifier = String(argValue("identifier", DEFAULT_IDENTIFIER));
  const cert = String(argValue("cert", ""));
  const key = String(argValue("key", ""));
  if (Boolean(cert) !== Boolean(key)) throw new Error("--cert 与 --key 要一起给");

  const handle = createHandler({ root: root, identifier: identifier });
  const server = cert
    ? https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, handle)
    : http.createServer(handle);
  const scheme = cert ? "https" : "http";

  server.listen(port, "0.0.0.0", function () {
    const at = server.address().port;
    process.stdout.write("内网 winget 源已就绪\n");
    process.stdout.write("  数据：" + root + "（" + readPackages(root).length + " 个包）\n");
    process.stdout.write("  端口：" + at + "（" + scheme.toUpperCase() + "）\n");
    process.stdout.write("  客户机：winget source add -n " + identifier + " -a " + scheme + "://<这台机器的地址>:" + at + "/api -t Microsoft.Rest\n");
  });
}

try {
  main();
}
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
