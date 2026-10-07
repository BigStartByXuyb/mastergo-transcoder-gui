#!/usr/bin/env node
"use strict";

/*
 * 内网 winget 源：按 winget 的 REST 源协议回答三件事 —— 服务信息、搜索、取某个包的清单。
 * 数据只有一份文件（scripts/lib/winget-manifest.js 的 SOURCE_FILE）加一个静态资产目录；
 * 每次请求现读那份文件，所以换一版就是把文件换掉，不用重启。
 *
 * 跑法（服务机上要哪些文件、地址与端口用哪个，都由 docs/winget-internal-source.md 一处给）：
 *   node scripts/winget-source-server.js --root <数据目录> --port <端口>
 *   node scripts/winget-source-server.js --root … --port … --cert server.crt --key server.key
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
const sourceApi = require("./lib/winget-source-api.js");

// winget source list 里显示的名字。
const DEFAULT_IDENTIFIER = "BigStart";
const MANIFESTS_PREFIX = "/api/packageManifests/";
// 静态资产的路由前缀与目录名同一处来：地址里的段落名与盘上的目录名还是一件事。
const FILES_PREFIX = "/" + winget.SOURCE_FILES_DIR + "/";

// 数据文件每次请求现读：换一版就是把文件换掉，不用重启服务。
function readPackages(root) {
  const file = path.join(root, winget.SOURCE_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    // 形状不对也按同一个口径失败：静默当成「空源」会让 winget 报「找不到这个包」，
    // 而真正的原因是数据文件坏了 —— 发布方式恰恰是运行中换这个文件。
    if (!Array.isArray(raw.Packages)) throw new Error("Packages 不是数组（形状不对）");
    return raw.Packages;
  }
  catch (error) {
    // 报出是哪个文件读不了：这条消息既进 server.log（启动时）也进 500 的响应体（运行中）。
    throw new Error("读不了数据文件 " + file + "：" + error.message);
  }
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

// 调用方造成的失败（地址不是合法百分号编码、请求体不是 JSON）标一下；
// 状态码只有一个消费点：createHandler 的 catch 里按这个标记选 400 还是 500。
function callerFault(message) {
  const error = new Error(message);
  error.callerFault = true;
  return error;
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
        reject(callerFault("请求体不是合法 JSON：" + error.message));
      }
    });
    // 连接断了是我们的故障，不标 callerFault。
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
  const stream = fs.createReadStream(file);
  // 发布方式就是「换掉数据目录里的文件」：读到一半文件被换走/删掉时，别让一个未处理的
  // 'error' 事件带走整个服务 —— 这一条响应断掉就行。
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

/* 四条 GET 路由。writesBody 只影响写不写体（HEAD 走同一条）。 */
function handleGet(route, params, response, options, writesBody) {
  // 给人看的一眼确认：服务活着、手上有几个包。
  if (route === "/") {
    return sendJson(response, 200, { Ok: true, Packages: readPackages(options.root).length }, writesBody);
  }
  if (route === "/api/information") {
    return sendJson(response, 200, sourceApi.informationBody(options.identifier), writesBody);
  }
  if (route.startsWith(MANIFESTS_PREFIX)) {
    const identifier = route.slice(MANIFESTS_PREFIX.length);
    const version = params.get("Version");
    const body = sourceApi.manifestBody(readPackages(options.root), identifier, version);
    if (!body) return sendError(response, 404, "没有这个包：" + identifier + (version ? " @" + version : ""), writesBody);
    return sendJson(response, 200, body, writesBody);
  }
  if (route.startsWith(FILES_PREFIX)) {
    return sendFile(response, options.root, route.slice(FILES_PREFIX.length), writesBody);
  }
  return sendError(response, 404, "没有这个地址：" + route, writesBody);
}

/*
 * 搜索：两种失败分开说 —— 请求体不是 JSON 是客户端的事（400），
 * 读数据文件 / 渲染响应出问题是我们自己的事（500，与 GET 路由同一个口径）。
 */
function handleSearch(request, response, options) {
  return readBody(request)
    .then((body) => {
      try {
        return sendJson(response, 200, sourceApi.searchBody(readPackages(options.root), body));
      }
      catch (error) {
        return sendError(response, 500, error.message);
      }
    })
    .catch((error) => sendError(response, error.callerFault ? 400 : 500, error.message));
}

function createHandler(options) {
  return function (request, response) {
    // HEAD 与 GET 同一条路由：只看一眼「在不在、多大」不该 404，但不写体。
    const writesBody = request.method !== "HEAD";
    const method = writesBody ? request.method : "GET";
    const at = request.url.indexOf("?");
    try {
      let route = "";
      try {
        route = decodeURIComponent(at < 0 ? request.url : request.url.slice(0, at));
      }
      catch {
        throw callerFault("请求地址不是合法的百分号编码");
      }
      const params = new URLSearchParams(at < 0 ? "" : request.url.slice(at + 1));
      if (request.method === "POST" && route === "/api/manifestSearch") return handleSearch(request, response, options);
      if (method !== "GET") return sendError(response, 404, "没有这个地址：" + route, writesBody);
      return handleGet(route, params, response, options, writesBody);
    }
    catch (error) {
      // 一处选码：调用方造成的（标了 callerFault）回 400，其余（读盘、渲染、传输）回 500。
      return sendError(response, error.callerFault ? 400 : 500, error.message, writesBody);
    }
  };
}

function main() {
  const root = path.resolve(argValue("root", path.join(__dirname, "..", "dist", "winget-source")));
  // 端口由部署那台定（见 docs/winget-internal-source.md）：服务不猜，也就不留一份会过期的默认值。
  const port = Number(argValue("port", ""));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("--port 要给一个 1-65535 的端口");
  }
  const identifier = String(argValue("identifier", DEFAULT_IDENTIFIER));
  const cert = String(argValue("cert", ""));
  const key = String(argValue("key", ""));
  if (Boolean(cert) !== Boolean(key)) throw new Error("--cert 与 --key 要一起给");

  const handle = createHandler({ root: root, identifier: identifier });
  // 先读一次：数据文件读不到或不是 JSON，就在启动这一步按 main 的口径报错退出，
  // 而不是打印完「已就绪」再在 listen 回调里抛一个没人接的异常（那是运行中读盘失败才该有的 500）。
  const packages = readPackages(root);
  const server = cert
    ? https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, handle)
    : http.createServer(handle);
  const scheme = cert ? "https" : "http";

  server.listen(port, "0.0.0.0", function () {
    const at = server.address().port;
    process.stdout.write("内网 winget 源已就绪\n");
    process.stdout.write("  数据：" + root + "（" + packages.length + " 个包）\n");
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
