"use strict";

/*
 * 解 zip：只做一件事 —— 把一个 zip 解到目标目录，并按条目里的 CRC32 校验内容。
 *
 * 为什么自己解：客户机上第一次装插件时，PowerShell 7 可能还没下载（启动器只保证 Node），
 * 所以不能靠 Expand-Archive；这里只用 Node 自带的 zlib，零依赖。
 *
 * 边界：支持 stored（0）与 deflate（8），不支持 zip64 与加密条目 —— 我们的发布件
 * （git archive 打的 zip）就是前两种；遇到不支持的当场报错，不猜。
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const CRC_TABLE = (function () {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const from = Math.max(0, buffer.length - 66000);
  for (let i = buffer.length - 22; i >= from; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("不是 zip（找不到结尾记录）");
}

// 条目名不许跑出目标目录：绝对路径、盘符、.. 一律拒。
function safeTarget(destDir, name) {
  const normalized = String(name).replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error("zip 里有绝对路径的条目：" + name);
  }
  const target = path.resolve(destDir, normalized);
  const root = path.resolve(destDir) + path.sep;
  if (target !== path.resolve(destDir) && !target.startsWith(root)) {
    throw new Error("zip 里有跑到目录外面的条目：" + name);
  }
  return target;
}

function readEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new Error("不支持 zip64");

  const entries = [];
  let at = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(at) !== CENTRAL_SIG) throw new Error("zip 的中央目录坏了");
    const method = buffer.readUInt16LE(at + 10);
    const expectedCrc = buffer.readUInt32LE(at + 16);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    entries.push({ name: name, method: method, expectedCrc: expectedCrc, compressedSize: compressedSize, localOffset: localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extractEntry(buffer, entry) {
  if (buffer.readUInt32LE(entry.localOffset) !== LOCAL_SIG) {
    throw new Error("zip 的条目头坏了：" + entry.name);
  }
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error("zip 里用了不支持的压缩方式（" + entry.method + "）：" + entry.name);
}

// 把 zip 解到 destDir（目录不存在就建）。返回解出来的文件数。
function extractZip(zipPath, destDir) {
  const buffer = fs.readFileSync(zipPath);
  const entries = readEntries(buffer);
  fs.mkdirSync(destDir, { recursive: true });
  let files = 0;
  for (const entry of entries) {
    const target = safeTarget(destDir, entry.name);
    if (entry.name.endsWith("/")) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    const content = extractEntry(buffer, entry);
    if (crc32(content) !== entry.expectedCrc) {
      throw new Error("zip 条目校验不过（内容与记录对不上）：" + entry.name);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    files += 1;
  }
  return files;
}

module.exports = { extractZip: extractZip, crc32: crc32 };
