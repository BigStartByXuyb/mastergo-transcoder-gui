"use strict";

/*
 * 可复现的 tar.gz：同样的目录内容，永远打出同样的字节。
 *
 * 为什么需要：更新是内容寻址的 —— 客户端按 sha256 比对文件，哈希不同才下载。系统 tar 会把打包时间、
 * 文件属主、目录顺序写进归档，于是同一份内容每次打出来哈希都不同：客户端每发一版就得重下这个包
 * （模型依赖那份就是这么白下的），本地这份也会和发布清单对不上。
 *
 * 谁在用：scripts/vendor-openai.js（把模型依赖收成一份随包走的压缩件）。
 * 边界：只写 ustar（长路径拆 name/prefix），装不下就报错，不静默截断；输出是 gzip 包，时间戳为 0。
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;

function octal(value, length) {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

/* ustar 的路径上限：name 100 字节、prefix 155 字节；长的在斜杠处拆开。 */
function splitPath(name) {
  if (Buffer.byteLength(name) <= NAME_MAX) return { name: name, prefix: "" };
  for (let index = name.lastIndexOf("/"); index > 0; index = name.lastIndexOf("/", index - 1)) {
    const prefix = name.slice(0, index);
    const leaf = name.slice(index + 1);
    if (Buffer.byteLength(leaf) <= NAME_MAX && Buffer.byteLength(prefix) <= PREFIX_MAX) {
      return { name: leaf, prefix: prefix };
    }
  }
  throw new Error("路径太长，ustar 装不下：" + name);
}

function headerFor(name, size, type) {
  const split = splitPath(name);
  const buffer = Buffer.alloc(BLOCK);
  buffer.write(split.name, 0, NAME_MAX, "utf8");
  buffer.write(octal(type === "5" ? 0o755 : 0o644, 8), 100, 8, "utf8");
  buffer.write(octal(0, 8), 108, 8, "utf8");
  buffer.write(octal(0, 8), 116, 8, "utf8");
  buffer.write(octal(size, 12), 124, 12, "utf8");
  // 时间戳写死 0（1970）：这是让哈希稳定的关键一项。
  buffer.write(octal(0, 12), 136, 12, "utf8");
  buffer.write("        ", 148, 8, "utf8");
  buffer.write(type, 156, 1, "utf8");
  buffer.write("ustar\0", 257, 6, "utf8");
  buffer.write("00", 263, 2, "utf8");
  buffer.write(split.prefix, 345, PREFIX_MAX, "utf8");
  let sum = 0;
  for (const byte of buffer) sum += byte;
  buffer.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return buffer;
}

function excluded(rel, list) {
  return list.some(function (item) { return rel === item || rel.indexOf(item + "/") === 0; });
}

/*
 * 目录整棵读成条目表。排除项按「相对 root 的路径」比，整棵子树一起排掉；
 * 最后按路径排序（父目录天然排在子项前面），这样归档顺序与文件系统给的顺序无关。
 */
function collect(dir, prefix, exclude) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const rel = prefix ? prefix + "/" + name : name;
    if (excluded(rel, exclude)) continue;
    const abs = path.join(dir, name);
    const stat = fs.lstatSync(abs);
    if (stat.isDirectory()) {
      out.push({ rel: rel, abs: abs, dir: true, size: 0 });
      for (const child of collect(abs, rel, exclude)) out.push(child);
      continue;
    }
    if (stat.isFile()) out.push({ rel: rel, abs: abs, dir: false, size: stat.size });
  }
  return out.sort(function (a, b) { return a.rel < b.rel ? -1 : (a.rel > b.rel ? 1 : 0); });
}

/*
 * 打一个 tar.gz。opts.prefix：归档里那层顶层目录名（不给就按目录名原名铺开）。
 * opts.exclude：要排掉的相对路径（整棵子树一起排）。
 */
function packDir(root, options) {
  const opts = options || {};
  const exclude = opts.exclude || [];
  const chunks = [];
  for (const entry of collect(root, "", exclude)) {
    const name = opts.prefix ? opts.prefix + "/" + entry.rel : entry.rel;
    chunks.push(headerFor(name, entry.size, entry.dir ? "5" : "0"));
    if (entry.dir) continue;
    const content = fs.readFileSync(entry.abs);
    chunks.push(content);
    const pad = (BLOCK - (content.length % BLOCK)) % BLOCK;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(BLOCK * 2));
  // gzip 头：时间戳 0（zlib 不写当前时间），OS 字节写死成 3（Unix）——
  // 这个字节是 zlib 编译时的 OS_CODE，Windows 与 Linux 上不一样，不写死的话跨平台哈希会不同。
  const packed = zlib.gzipSync(Buffer.concat(chunks), { level: 9 });
  packed[9] = 3;
  return packed;
}

module.exports = { packDir: packDir };
