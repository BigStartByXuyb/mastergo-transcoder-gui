"use strict";

/*
 * 内容寻址的落盘层：blobs/<sha256> + versions/<版本> + current.json 指针。
 *
 * 「清单 → 下载 → 校验 → 落目录 → 指针」这五步只在这里实现一次，
 * 程序更新、运行时下载、agent 下载都复用同一份。
 *
 * 边界：本模块不认识 GitHub、也不认识插件；远端由调用方给一个 fetchBlob(sha) 回调。
 * 目录约定（都落在传入的根下，三段名字都可以用 layout 换）：
 *   blobs/<sha256>          文件内容按哈希存一份，跨版本共用
 *   versions/<版本>/        某个版本的运行树
 *   versions/.building-xxx/  正在拼的版本，拼完 rename 成正式目录（半成品不冒充成品）
 *   current.json            当前生效的版本指针
 * 第二个实例（插件，见 lib/plugin-update.js）借用同一份实现：版本目录直接落在它自己的根下
 * （versionsDir 给空串），也没有指针（pointerName 给空串）。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");
const { safeJoin } = require("./app-manifest.js");

const POINTER_NAME = "current.json";
const DOWNLOAD_CONCURRENCY = 4;

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeIfAbsent(abs, buffer) {
  if (fs.existsSync(abs)) return false;
  ensureDir(path.dirname(abs));
  const tmp = abs + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, abs);
  return true;
}

function createBundleStore(home, layout) {
  const names = layout || {};
  const root = path.resolve(home);
  const blobsDir = path.join(root, names.blobsDir || "blobs");
  const versionsDir = path.join(root, names.versionsDir === undefined ? "versions" : names.versionsDir);
  // 空串＝这一份内容库没有版本指针（插件按最高版本现取，不需要切换）。
  const pointerPath = names.pointerName === "" ? "" : path.join(root, names.pointerName || POINTER_NAME);

  function blobPath(hash) {
    return path.join(blobsDir, hash);
  }

  function hasBlob(hash) {
    return fs.existsSync(blobPath(hash));
  }

  function putBlob(hash, buffer) {
    const actual = sha256(buffer);
    if (actual !== hash) {
      throw new UserError("HASH_MISMATCH", "下载到的内容与清单不符", "期望 " + hash + "，实际 " + actual);
    }
    return writeIfAbsent(blobPath(hash), buffer);
  }

  function readBlob(hash) {
    return fs.readFileSync(blobPath(hash));
  }

  // 缺哪些内容：同一份内容被多个路径引用时只算一次，第一处出现的相对路径随它一起带上
  // （远端按路径取文件时要用到）。
  function missingBlobs(manifest) {
    const files = (manifest && manifest.files) || {};
    const seen = new Map();
    for (const rel of Object.keys(files).sort()) {
      const hash = files[rel];
      if (!seen.has(hash)) seen.set(hash, rel);
    }
    const out = [];
    for (const entry of seen) {
      if (!hasBlob(entry[0])) out.push({ hash: entry[0], rel: entry[1] });
    }
    return out;
  }

  function copyBlobToFile(hash, abs) {
    ensureDir(path.dirname(abs));
    // FICLONE 走文件系统级克隆（NTFS/ReFS 上是瞬间的），不支持时自动退化成普通复制。
    fs.copyFileSync(blobPath(hash), abs, fs.constants.COPYFILE_FICLONE);
  }

  function verifyDir(dir, manifest) {
    const files = (manifest && manifest.files) || {};
    const bad = [];
    for (const rel of Object.keys(files)) {
      const abs = safeJoin(dir, rel);
      if (!fs.existsSync(abs) || sha256(fs.readFileSync(abs)) !== files[rel]) bad.push(rel);
    }
    return bad;
  }

  function versionDir(version) {
    return path.join(versionsDir, String(version));
  }

  function listVersions() {
    try {
      return fs.readdirSync(versionsDir, { withFileTypes: true })
        .filter(function (entry) { return entry.isDirectory() && !entry.name.startsWith(".building-"); })
        .map(function (entry) { return entry.name; })
        .sort();
    }
    catch {
      return [];
    }
  }

  function readPointer() {
    if (!pointerPath) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
      return null;
    }
  }

  // 指针只整体替换：先写临时文件再 rename，读到的永远是一份完整指针。
  function writePointer(pointer) {
    if (!pointerPath) throw new UserError("NO_POINTER", "这份内容库没有版本指针", "它按最高版本现取，不用写指针。");
    ensureDir(root);
    const tmp = pointerPath + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(pointer, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, pointerPath);
  }

  async function ensureBlob(hash, fetchBlob, rel) {
    if (hasBlob(hash)) return false;
    const buffer = await fetchBlob(hash, rel || "");
    putBlob(hash, buffer);
    return true;
  }

  async function downloadMissing(manifest, fetchBlob, onProgress) {
    const pending = missingBlobs(manifest);
    let done = 0;
    let downloaded = 0;
    let cursor = 0;
    async function worker() {
      while (cursor < pending.length) {
        const item = pending[cursor];
        cursor += 1;
        if (await ensureBlob(item.hash, fetchBlob, item.rel)) downloaded += 1;
        done += 1;
        if (onProgress) onProgress({ done: done, total: pending.length, downloaded: downloaded });
      }
    }
    const workers = [];
    for (let i = 0; i < Math.min(DOWNLOAD_CONCURRENCY, pending.length); i += 1) workers.push(worker());
    await Promise.all(workers);
    return { total: pending.length, downloaded: downloaded };
  }

  /*
   * 本地已经有同内容的文件就直接进内容库：远端不必再传一遍，拼版本时也少下几个包。
   * 判据是哈希相等（两侧清单自己算的），不是路径相等 —— 改名不算变化。
   */
  function seedFrom(rootDir, localManifest, remoteManifest) {
    const local = (localManifest && localManifest.files) || {};
    const remote = (remoteManifest && remoteManifest.files) || {};
    let seeded = 0;
    for (const rel of Object.keys(remote)) {
      const hash = remote[rel];
      if (local[rel] !== hash || hasBlob(hash)) continue;
      putBlob(hash, fs.readFileSync(safeJoin(rootDir, rel)));
      seeded += 1;
    }
    return seeded;
  }

  /*
   * 按清单把一个版本拼到 versions/<版本>/。
   * 已有同名目录且逐文件校验通过就直接用；校验不过或不存在就重拼。
   */
  async function materialize(manifest, fetchBlob, onProgress) {
    const version = String((manifest && manifest.version) || "");
    if (!version) throw new UserError("BAD_MANIFEST", "远端清单没有版本号", "");
    const target = versionDir(version);
    if (fs.existsSync(target) && verifyDir(target, manifest).length === 0) {
      return { dir: target, downloaded: 0, reused: true };
    }

    const result = await downloadMissing(manifest, fetchBlob, onProgress);
    const building = path.join(versionsDir, ".building-" + version + "-" + process.pid);
    fs.rmSync(building, { recursive: true, force: true });
    for (const rel of Object.keys(manifest.files)) {
      copyBlobToFile(manifest.files[rel], safeJoin(building, rel));
    }
    const bad = verifyDir(building, manifest);
    if (bad.length > 0) {
      fs.rmSync(building, { recursive: true, force: true });
      throw new UserError("MATERIALIZE_FAILED", "拼出来的版本和清单不一致", bad.slice(0, 5).join("、"));
    }
    fs.rmSync(target, { recursive: true, force: true });
    ensureDir(versionsDir);
    fs.renameSync(building, target);
    return { dir: target, downloaded: result.downloaded, reused: false };
  }

  return {
    root: root,
    blobsDir: blobsDir,
    versionsDir: versionsDir,
    pointerPath: pointerPath,
    blobPath: blobPath,
    hasBlob: hasBlob,
    putBlob: putBlob,
    readBlob: readBlob,
    sha256: sha256,
    missingBlobs: missingBlobs,
    downloadMissing: downloadMissing,
    seedFrom: seedFrom,
    verifyDir: verifyDir,
    versionDir: versionDir,
    listVersions: listVersions,
    readPointer: readPointer,
    writePointer: writePointer,
    materialize: materialize
  };
}

module.exports = { createBundleStore, POINTER_NAME };
