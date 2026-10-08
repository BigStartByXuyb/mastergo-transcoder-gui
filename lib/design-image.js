"use strict";

/*
 * 作业A 的设计稿位图：那条「读图」开关的输入。
 *
 * 口径来自插件（skills/mastergo-to-wpf/references/adapters/mw-wpf/mw-wpf-mode.md 第 2 节）：
 *   - 图放 <工程目录>/Generated/_inputs/<页面名>.design.png（.jpg / .jpeg 同口径）
 *   - **按设计稿原始尺寸导出**：位图尺寸必须等于 DSL 画板尺寸，否则图上的框与 DSL 的 bbox 会整体错一个倍数
 *   - 有图就必须先有分组表 <页面名>.layout-groups.json，否则第 8 步停下报告
 *
 * 本模块只说清这三件事的事实：图在哪、尺寸对不对、分组表在不在。「有图无表就失败」的判定归插件第 8 步，
 * 这里只在界面上提前说清，不另写一套判据。
 *
 * 画板尺寸取 DSL 快照的根节点（dsl.nodes[0].layoutStyle.width/height）—— 与插件的 layoutTree 读的是同一处。
 * 谁在用：lib/routes.js 的 GET / POST /api/design-image。
 */

const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");
const workdir = require("./workdir.js");
const atomicWrite = require("./atomic-write.js");
// 单文件上限与请求体换算都取自上传那一处（lib/uploads.js）：值与公式不在这里再写一份。
const { MAX_FILE_BYTES, bodyLimitFor, mb } = require("./uploads.js");

/*
 * 插件认的三个后缀，顺序就是「先看哪一张」——落盘时按**内容的真实格式**取其中一个
 * （PNG → .png，JPEG → .jpg），不按上传文件的名字：改名字混进来的图，格式仍是它自己的。
 */
const EXTENSIONS = [".png", ".jpg", ".jpeg"];
const EXTENSION_OF_FORMAT = { png: ".png", jpeg: ".jpg" };
/* 路由拿它当 bodyLimit：这张图最大，请求体也按它算。 */
const MAX_BODY_BYTES = bodyLimitFor(MAX_FILE_BYTES);

function inputsDirOf(projectRoot) {
  return workdir.inputsDir(projectRoot);
}

function groupsPathOf(projectRoot, target) {
  return path.join(inputsDirOf(projectRoot), String(target).trim() + ".layout-groups.json");
}

function snapshotPathOf(projectRoot, target) {
  return path.join(workdir.runsDir(projectRoot, String(target).trim()), "dsl.snapshot.json");
}

/*
 * 画板尺寸：DSL 根节点的 layoutStyle。读不出来（还没跑到第 2 步、快照被删）时给 null ——
 * 那种情况尺寸这一格没有真值可比，界面只报「还不知道画板尺寸」，不拦上传。
 */
function readCanvas(projectRoot, target) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPathOf(projectRoot, target), "utf8"));
    const root = snapshot && snapshot.dsl && Array.isArray(snapshot.dsl.nodes) ? snapshot.dsl.nodes[0] : null;
    const style = root ? root.layoutStyle || {} : {};
    const width = Number(style.width || 0);
    const height = Number(style.height || 0);
    return width > 0 && height > 0 ? { width: width, height: height } : null;
  }
  catch {
    return null;
  }
}

/* 这一页现在放着的那张图（先按 EXTENSIONS 的顺序找）。 */
function currentImage(projectRoot, target) {
  const dir = inputsDirOf(projectRoot);
  for (const ext of EXTENSIONS) {
    const file = path.join(dir, String(target).trim() + ".design" + ext);
    if (!fs.existsSync(file)) continue;
    const bytes = fs.statSync(file).size;
    let size = null;
    try {
      size = readPixelSize(fs.readFileSync(file));
    }
    catch {
      size = null;
    }
    return { path: file, name: path.basename(file), bytes: bytes, width: size ? size.width : 0, height: size ? size.height : 0 };
  }
  return null;
}

function requireTarget(target) {
  const value = String(target || "").trim();
  if (!value) throw new UserError("NEED_TARGET", "缺少页面 Target", "先在看板上选中这一页，再上传。");
  /*
   * Target 会变成文件名（<页面名>.design.png），所以先归一：路径分隔符与 .. 一律拒 ——
   * 留着的话图能落到 _inputs 之外，插件按约定名就找不到了（也可能盖掉旁边别的文件）。
   */
  if (/[\\/]|\.\./.test(value) || /[<>:"|?*\u0000-\u001f]/.test(value)) {
    throw new UserError("BAD_TARGET", "页面 Target 不能当文件名用：" + value, "它不能含路径分隔符、.. 或 Windows 文件名里的非法字符。");
  }
  return value;
}

function requireProject(projectRoot) {
  const value = String(projectRoot || "").trim();
  if (!value) throw new UserError("NEED_PROJECT", "缺少工程目录", "先在看板上选中这一页，再上传。");
  return path.resolve(value);
}

/*
 * 这一页此刻的读图输入状态（界面那一块就渲染它）。
 * canvas 是「要求的尺寸」，image 是「现在放着的那张」，matches 是两者是否相等 —— 尺寸错了要说清两边的数。
 */
function read(query) {
  const projectRoot = requireProject(query && query.projectRoot);
  const target = requireTarget(query && query.target);
  const canvas = readCanvas(projectRoot, target);
  const image = currentImage(projectRoot, target);
  const groups = groupsPathOf(projectRoot, target);
  return {
    dir: inputsDirOf(projectRoot),
    canvas: canvas,
    image: image,
    matches: Boolean(canvas && image && canvas.width === image.width && canvas.height === image.height),
    groups: { path: groups, exists: fs.existsSync(groups) }
  };
}

/*
 * 存一张图：只接 PNG / JPEG —— 认的是**文件内容的真实格式**（文件头），不认名字；
 * 落盘后缀也按那个格式取，所以「把别的格式改名成 .png 混进来」既进不来、也不会落成错的扩展名。
 * 落盘是整份替换（临时件 + 改名），写一半不会把上一张好的图毁掉。
 */
function save(body) {
  const projectRoot = requireProject(body && body.projectRoot);
  const target = requireTarget(body && body.target);
  // 只看内容，不看名字：格式由文件头判定（见下），所以上传文件叫什么都不影响落盘。
  const data = String((body && body.data) || "");
  if (!data) throw new UserError("BAD_IMAGE", "这张图是空的", "重新导出一次再传。");

  // Buffer.from 的 base64 解码不会抛：认不出来的内容留给下面按文件头判（那时才知道「不是位图」）。
  const buffer = Buffer.from(data, "base64");
  if (!buffer.length) throw new UserError("BAD_IMAGE", "这张图读不出来", "重新导出一次再传。");
  if (buffer.length > MAX_FILE_BYTES) {
    throw new UserError("BAD_IMAGE", "这张图太大（" + mb(buffer.length) + "）", "上限 " + mb(MAX_FILE_BYTES) + "。");
  }

  const size = readPixelSize(buffer);
  if (!size) {
    throw new UserError("BAD_IMAGE", "只接 PNG / JPEG 位图，这一份两种都不是", "按设计稿原始尺寸重新导出一次再传（按内容的格式认，改名字没有用）。");
  }

  const canvas = readCanvas(projectRoot, target);
  if (canvas && (canvas.width !== size.width || canvas.height !== size.height)) {
    throw new UserError(
      "SIZE_MISMATCH",
      "图与画板尺寸不一致：图 " + size.width + "×" + size.height + "，画板 " + canvas.width + "×" + canvas.height,
      "按设计稿原始尺寸导出（位图尺寸必须等于 DSL 画板尺寸），否则图上的框与控件位置会整体错一个倍数。"
    );
  }

  /*
   * 后缀按内容的真实格式取。顺序要紧：先整份写新的，落位成功之后再删其它后缀的旧图 ——
   * 反过来的话，换格式时（PNG 换 JPEG）一旦写失败，这一页就两张都没有了。
   */
  const ext = EXTENSION_OF_FORMAT[size.format];
  const file = path.join(inputsDirOf(projectRoot), String(target) + ".design" + ext);
  const temp = atomicWrite.stage(file, buffer);
  try {
    atomicWrite.land(temp, file);
  }
  catch (error) {
    atomicWrite.discard(temp);
    throw error;
  }
  // 三个后缀只留一个：插件按 EXTENSIONS 的顺序取，留着过期的那张就会取错。
  for (const other of EXTENSIONS) {
    const stale = path.join(inputsDirOf(projectRoot), String(target) + ".design" + other);
    if (stale !== file && fs.existsSync(stale)) fs.rmSync(stale, { force: true });
  }

  return read({ projectRoot: projectRoot, target: target });
}

/*
 * 位图的尺寸与真实格式：只解析这两个容器的文件头，不引第三方库 ——
 * 这是上传前那道「尺寸对不对」与「按哪种格式落盘」的唯一判据。
 * PNG：8 字节签名 + IHDR 里的宽高（大端 4 字节）；JPEG：顺序扫段，遇到 SOF 段取宽高。
 * 认不出来（不是这两种、或文件被截断）返回 null，由调用方按「不认识的图」处理。
 */
function readPixelSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  // PNG 的签名 + IHDR 要够 24 个字节；不够就落到下面按 JPEG 试，两边都不认就返回 null。
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a) {
    if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: "png" };
  }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let at = 2;
  while (at + 3 < buffer.length) {
    if (buffer[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = buffer[at + 1];
    // 填充字节与「无长度」的标记：往后挪，不算段。
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    const length = buffer.readUInt16BE(at + 2);
    if (length < 2) return null;
    // SOF0…SOF15 里，DHT(C4) / JPG(C8) / DAC(CC) 不是帧头，其余才是（宽高在里面）。
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (at + 8 >= buffer.length) return null;
      return { height: buffer.readUInt16BE(at + 5), width: buffer.readUInt16BE(at + 7), format: "jpeg" };
    }
    at += 2 + length;
  }
  return null;
}

module.exports = { read, save, readPixelSize, MAX_BODY_BYTES };
