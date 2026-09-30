"use strict";

/*
 * 对话附件：浏览器把文件读成 base64 传上来，这里落到安装根的 chats/uploads/<批次>/ 下。
 *
 * 一次上传一个批次目录，重名不覆盖；选文件夹时带的相对路径照原样保留（子目录也建出来）。
 * 谁在用：lib/routes.js 的 POST /api/agent/upload，以及对话路由校验附件路径。
 * 边界：只管安全落盘与「这个路径是不是我们落的」；怎么给 AI 看由 lib/agent-context.js 决定。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"]);

function kindOf(name) {
  return IMAGE_EXT.has(path.extname(String(name || "")).toLowerCase()) ? "image" : "file";
}

// Windows 上文件名里不能出现这些字符；统一换成下划线，别让一次上传把落盘搞失败。
function safeSegment(segment) {
  return String(segment).replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").slice(0, 80) || "_";
}

/*
 * 相对路径归一化：去掉盘符与开头的斜杠，丢掉空段与 `.`，遇到 `..` 直接拒。
 * 选文件夹时 rel 里带的是子目录，这里保住。
 */
function safeRelative(input) {
  const raw = String(input || "").replace(/\\/g, "/").replace(/^[A-Za-z]:/, "").replace(/^\/+/, "");
  const out = [];
  for (const piece of raw.split("/")) {
    if (!piece || piece === ".") continue;
    if (piece === "..") throw new UserError("BAD_PATH", "附件路径不合法", "不要带 .. 这类跳出去的路径。");
    out.push(safeSegment(piece));
  }
  if (out.length === 0) throw new UserError("BAD_PATH", "附件没有名字", "");
  return out.join("/");
}

function createUploads(home) {
  const root = path.join(path.resolve(home), "chats", "uploads");

  function newBatch() {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    return path.join(root, stamp + "-" + crypto.randomBytes(3).toString("hex"));
  }

  // 同名就顺延：同一批里两个文件重名时不许互相覆盖。
  function freePath(dir, relative) {
    const target = path.join(dir, relative);
    if (!fs.existsSync(target)) return target;
    const ext = path.extname(target);
    const stem = target.slice(0, target.length - ext.length);
    for (let index = 2; index < 1000; index += 1) {
      const next = stem + "-" + index + ext;
      if (!fs.existsSync(next)) return next;
    }
    throw new UserError("UPLOAD_BUSY", "这一批同名的文件太多了", "分几次传。");
  }

  /*
   * items: [{ name, relativePath, base64 }] → [{ name, path, bytes, kind }]，path 是绝对路径。
   */
  function saveBatch(items) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) throw new UserError("NO_FILES", "没有要上传的文件", "");
    const batch = newBatch();
    let total = 0;
    const saved = [];
    for (const item of list) {
      const relative = safeRelative(item.relativePath || item.name);
      const buffer = Buffer.from(String(item.base64 || ""), "base64");
      if (buffer.length === 0) throw new UserError("EMPTY_FILE", "文件是空的：" + relative, "");
      if (buffer.length > MAX_FILE_BYTES) {
        throw new UserError("FILE_TOO_BIG", "单个文件超过 25 MB：" + relative, "大文件先放工程里，再让 AI 去读那个路径。");
      }
      total += buffer.length;
      if (total > MAX_TOTAL_BYTES) throw new UserError("TOTAL_TOO_BIG", "这一次加起来超过 60 MB", "分几次传。");
      const target = freePath(batch, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer);
      saved.push({ name: path.basename(target), path: target, bytes: buffer.length, kind: kindOf(target) });
    }
    return saved;
  }

  // 对话路由只认这里落下的路径：界面上报什么路径都不能直接信。
  function belongs(file) {
    const abs = path.resolve(String(file || ""));
    const base = path.resolve(root);
    return abs === base || abs.startsWith(base + path.sep);
  }

  return { root, saveBatch, belongs };
}

module.exports = { createUploads, kindOf, safeRelative };
