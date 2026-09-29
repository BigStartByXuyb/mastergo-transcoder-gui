"use strict";

const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");

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
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
};

function contentTypeOf(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
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

function readBody(request) {
  return new Promise(function (resolve, reject) {
    let text = "";
    request.on("data", function (chunk) {
      text += chunk;
      if (text.length > MAX_BODY_BYTES) reject(new UserError("BODY_TOO_LARGE", "请求体过大", ""));
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
    response.writeHead(200, { "content-type": contentTypeOf(candidate), "cache-control": "no-store" });
    fs.createReadStream(candidate).pipe(response);
    return true;
  }
  if (!path.extname(relative)) {
    const fallback = path.join(baseDir, "index.html");
    if (fs.existsSync(fallback)) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      fs.createReadStream(fallback).pipe(response);
      return true;
    }
  }
  return false;
}

module.exports = { sendJson, sendText, readBody, serveStatic };
