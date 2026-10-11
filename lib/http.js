"use strict";

const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");

// 请求体缺省上限。要收大东西的路由自己声明 bodyLimit（见 lib/routes.js 的上传那条）。
const MAX_BODY_BYTES = 1024 * 1024;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
};

function contentTypeOf(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/*
 * 发一个磁盘上的文件（静态件、附件、设计稿位图都用它）：头部（类型 + no-store）与「流出去」只有这一处。
 * 调用方只管自己的那一段（路径怎么算、该不该发），以后要加 Range 或安全头也只改这里。
 */
function sendFile(response, file) {
  response.writeHead(200, { "content-type": contentTypeOf(file), "cache-control": "no-store" });
  fs.createReadStream(file).pipe(response);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendText(response, status, text) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

function readBody(request, limit) {
  const max = typeof limit === "number" && limit > 0 ? limit : MAX_BODY_BYTES;
  return new Promise(function (resolve, reject) {
    let text = "";
    request.on("data", function (chunk) {
      text += chunk;
      if (text.length > max) {
        reject(new UserError("BODY_TOO_LARGE", "请求体过大", "超过这一条接口 " + Math.round(max / 1024 / 1024) + " MB。"));
      }
    });
    request.on("end", function () {
      try {
        resolve(text ? JSON.parse(text) : {});
      }
      catch {
        reject(new UserError("BAD_JSON", "请求不是合法 JSON", ""));
      }
    });
    request.on("error", reject);
  });
}

// 静态文件服务：命中文件就发，未命中且看起来是前端路由（无扩展名）时回落到 index.html。
function serveStatic(response, baseDir, urlPath) {
  const relative = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const candidate = path.resolve(baseDir, relative);
  const insideBase = candidate === baseDir || candidate.startsWith(baseDir + path.sep);
  if (insideBase && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    sendFile(response, candidate);
    return true;
  }
  if (!path.extname(relative)) {
    const fallback = path.join(baseDir, "index.html");
    if (fs.existsSync(fallback)) {
      sendFile(response, fallback);
      return true;
    }
  }
  return false;
}

module.exports = { sendJson, sendText, readBody, serveStatic, sendFile, contentTypeOf, MAX_BODY_BYTES };
