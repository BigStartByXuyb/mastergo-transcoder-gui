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
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
/*
 * 只有栅格图进 IMAGE_EXT —— 它们会走 Codex 的 -i 直接给模型看。
 * .svg 故意不算：它不是栅格图，当文件给路径让它自己读更稳。
 */
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"]);

/*
 * 上传那一条接口的请求体上限：base64 比原文大 4/3，再加 JSON 外壳的余量。
 * 路由拿它当 bodyLimit —— 别的接口仍然是 lib/http.js 的 1 MiB 缺省值。
 */
const MAX_BODY_BYTES = Math.ceil((MAX_TOTAL_BYTES * 4) / 3) + 1024 * 1024;

function kindOf(name) {
  return IMAGE_EXT.has(path.extname(String(name || "")).toLowerCase()) ? "image" : "file";
}

function mb(bytes) {
  return Math.round(bytes / 1024 / 1024) + " MB";
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
        throw new UserError(
          "FILE_TOO_BIG",
          "单个文件超过 " + mb(MAX_FILE_BYTES) + "：" + relative,
          "大文件先放工程里，再让 AI 去读那个路径。"
        );
      }
      total += buffer.length;
      if (total > MAX_TOTAL_BYTES) {
        throw new UserError("TOTAL_TOO_BIG", "这一次加起来超过 " + mb(MAX_TOTAL_BYTES), "分几次传。");
      }
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

// 上限只导出传输层要用的那一个（请求体上限由它算出来）；单文件与总量是模块内部约定。
/*
 * MAX_FILE_BYTES 也导出：这是「浏览器传上来的单个文件」这一档上限，值与判据只在这里。
 * 别的入口（作业A 的设计稿位图，lib/design-image.js）按它推导自己的请求体上限，不另抄一份数字；
 * 前端 ui/src/lib/upload-files.ts 那边是同口径的另一端（前后端各一份，改这里要同步改那一处）。
 */
module.exports = { createUploads, kindOf, safeRelative, MAX_FILE_BYTES, MAX_BODY_BYTES };
