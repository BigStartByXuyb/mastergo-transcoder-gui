"use strict";

/*
 * 作业A 的设计稿位图：那条「读图」开关的输入。
 *
 * 口径来自插件（skills/mastergo-to-wpf/references/adapters/mw-wpf/mw-wpf-mode.md 第 2 节）：
 *   - 图放 <工程目录>/Generated/_inputs/<页面名>.design.png（.jpg / .jpeg 同口径；目录与文件名由 lib/workdir.js 拼）
 *   - **按设计稿原始尺寸导出**：位图尺寸必须等于 DSL 画板尺寸，否则图上的框与 DSL 的 bbox 会整体错一个倍数
 *   - 有图就必须先有分组表 <页面名>.layout-groups.json，否则布局推导那一步停下报告
 *
 * 「读」（read）说清这三件事的事实：图在哪、尺寸对不对、分组表在不在。
 * 「写」（save）在落盘前核两件：内容得是 PNG / JPEG、尺寸得等于画板尺寸 —— 插件自己不核位图尺寸
 * （它把图当读图的输入交给模型看），所以这一道只有这里。至于「有图无表就失败」，判定归插件自己（布局推导那一步）。
 *
 * 画板尺寸取 DSL 快照的根节点（dsl.nodes[0].layoutStyle.width/height）—— 与插件的 layoutTree 读的是同一处；快照由流水线的「取数 + 固化快照」那一步产出。
 * 谁在用：lib/routes.js 的 GET / POST /api/design-image（读状态与存图），
 * 以及 lib/pending.js 的 hasImage（待确认停点只问「有没有图」）。
 */

const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");
const workdir = require("./workdir.js");
const atomicWrite = require("./atomic-write.js");
// 上限与换算、名字判据都取自那两个中立模块：值与判据各只有一处（对话附件也用同一份）。
const { MAX_FILE_BYTES, bodyLimitFor, mb } = require("./limits.js");
const { isSafeName, requirePageTarget, requireProjectRoot, requireTaskId } = require("./name-safety.js");

/*
 * 插件认的三个后缀，顺序就是「先看哪一张」——落盘时按**内容的真实格式**取其中一个
 * （PNG → .png，JPEG → .jpg），不按上传文件的名字：改名字混进来的图，格式仍是它自己的。
 */
const EXTENSIONS = [".png", ".jpg", ".jpeg"];
const EXTENSION_OF_FORMAT = { png: ".png", jpeg: ".jpg" };
/* 路由拿它当 bodyLimit：这张图最大，请求体也按它算。 */
const MAX_BODY_BYTES = bodyLimitFor(MAX_FILE_BYTES);

/*
 * 画板尺寸还没有时给同一句话：读（blocked，界面照实显示并禁用按钮）与写（NO_CANVAS 的修法）都用它。
 * 什么时候可以传只有这一处判据，说法也只有这一处。
 */
const NO_CANVAS_REASON = "先让流水线跑到「取数 + 固化快照」那一步，那时才知道图该多大";

/* 图名是与插件约定的接口（<页面名>.design<后缀>）：这一份拼法只有这一处，读 / 写 / 清理都读它。 */
function designImagePathOf(projectRoot, target, ext) {
  return path.join(workdir.inputsDir(projectRoot), String(target).trim() + ".design" + ext);
}

/*
 * 尺寸不符时那两个数的写法只有这一处：存图被拒（下面 save 的原话）与暂存件落地的行上提示
 * （lib/board.js）说的是同一件事 —— 改措辞只改这里。
 */
function sizeMismatchText(image, canvas) {
  return "图 " + image.width + "×" + image.height + "，画板 " + canvas.width + "×" + canvas.height;
}

/*
 * 收一份上传来的内容 → 位图：base64 解出来，并按**文件头**必须是 PNG / JPEG。
 * 空、读不出、太大、不是这两种 —— 四条判据与它们的原话都只有这一处，暂存（stage）与存图（save）都从这里过。
 * 「按内容的格式认、不认名字」也在这里：把别的格式改名成 .png 混进来，格式仍是它自己的。
 */
function requireBitmap(data) {
  const text = String(data || "");
  if (!text) throw new UserError("BAD_IMAGE", "这张图是空的", "重新导出一次再传。");
  // Buffer.from 的 base64 解码不会抛：认不出来的内容留给调用方按文件头判（那时才知道「不是位图」）。
  const buffer = Buffer.from(text, "base64");
  if (!buffer.length) throw new UserError("BAD_IMAGE", "这张图读不出来", "重新导出一次再传。");
  if (buffer.length > MAX_FILE_BYTES) {
    throw new UserError("BAD_IMAGE", "这张图太大（" + mb(buffer.length) + "）", "上限 " + mb(MAX_FILE_BYTES) + "。");
  }
  const size = readPixelSize(buffer);
  if (!size) {
    throw new UserError(
      "BAD_IMAGE",
      "只接 PNG / JPEG 位图，这一份两种都不是",
      "按设计稿原始尺寸重新导出一次再传（按内容的格式认，改名字没有用）。"
    );
  }
  return { buffer: buffer, size: size };
}

function snapshotPathOf(projectRoot, target) {
  return workdir.snapshotPath(projectRoot, target);
}

/*
 * 画板尺寸：DSL 根节点的 layoutStyle。读不出来（还没跑到固化快照那一步、快照被删）时给 null ——
 * 界面照实显示「还不知道」，而 save() 按 fail-closed 拒收（没有基准就没法判图对不对），
 * 等那一步产出快照之后再传。
 */
function readCanvas(projectRoot, target) {
  // 容错读那份快照只有一处（lib/workdir.js 的 readJsonIfExists）：文件不在、内容坏了都回 null。
  const snapshot = workdir.readJsonIfExists(snapshotPathOf(projectRoot, target));
  const root = snapshot && snapshot.dsl && Array.isArray(snapshot.dsl.nodes) ? snapshot.dsl.nodes[0] : null;
  const style = root ? root.layoutStyle || {} : {};
  const width = Number(style.width || 0);
  const height = Number(style.height || 0);
  return width > 0 && height > 0 ? { width: width, height: height } : null;
}

/* 这一页现在放着的那张图（先按 EXTENSIONS 的顺序找）。 */
function currentImage(projectRoot, target) {
  for (const ext of EXTENSIONS) {
    const file = designImagePathOf(projectRoot, target, ext);
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

/*
 * 这一页此刻的读图输入状态（界面那一块就渲染它）。
 * canvas 是「要求的尺寸」，image 是「现在放着的那张」，matches 是两者是否相等 —— 尺寸错了要说清两边的数。
 */
function read(query) {
  const projectRoot = requireProjectRoot(query && query.projectRoot);
  const target = requirePageTarget(query && query.target);
  const canvas = readCanvas(projectRoot, target);
  const image = currentImage(projectRoot, target);
  const groups = workdir.layoutGroupsPath(projectRoot, target);
  return {
    dir: workdir.inputsDir(projectRoot),
    canvas: canvas,
    image: image,
    matches: Boolean(canvas && image && canvas.width === image.width && canvas.height === image.height),
    // 「有没有分组表」的判据在 lib/workdir.js 的 readLayoutGroups（读得出来就算有，空表也算有）。
    groups: { path: groups, exists: workdir.readLayoutGroups(projectRoot, target) !== null },
    /*
     * 现在能不能传：不能就让后端把原因说出来，界面照实渲染并禁用按钮 ——
     * 「什么时候可以传」这条判据只有这一处（save 在同一种情况下按同一句话拒收），界面不自己判一遍。
     */
    blocked: canvas ? "" : NO_CANVAS_REASON
  };
}

/*
 * 只回答「这一页有没有图」（待确认清单只要这一个事实：要不要停在布局确认）：
 * 按 EXTENSIONS 的顺序看一眼文件在不在就够，不读整张图、也不算尺寸与分组表 ——
 * 那几样是 /api/design-image 那一份读视图的事。待确认队列会逐页调它，所以这条要便宜。
 */
function hasImage(query) {
  const projectRoot = requireProjectRoot(query && query.projectRoot);
  const target = requirePageTarget(query && query.target);
  return EXTENSIONS.some(function (ext) {
    return fs.existsSync(designImagePathOf(projectRoot, target, ext));
  });
}

/*
 * ---------------------------------------------------------------- 暂存与落地
 *
 * 新建任务时人就能把设计稿位图选好，但那时**还不知道页面名与画板尺寸**（两者都要等流水线跑起来），
 * 所以先按**任务**暂存一份（键就是任务 id），等那一步产出快照之后再核对尺寸落地：
 *   对 → 装进工作目录的 _inputs/（插件从那读图）；
 *   不对 → 把两边的数回给人，按原尺寸重新导出后在任务详情那一步再传一张。
 * 工作目录里已经有人传过图时不覆盖（人在布局那一步补的那张为准）。
 * 暂存件的寿命跟着任务：落地成功或工作目录里已经有图就清掉，任务被移除就清掉；
 * 「尺寸不对」那一份留着，认领它的是下一个动作：人重导一张之后在任务详情那一步传（那一张进工作目录，
 * 下一轮轮询见工作目录已有图，这份暂存件就跟着清掉），或重新建一条任务。
 * 暂存件放在安装根的 work/staged/ 下（运行目录，不随程序版本走）。
 *
 * 谁在用：POST /api/design-image/stage（任务建好之后暂存）与 lib/board.js（跑到取数那一步之后落地、
 * 移除任务时清理）。
 */

/*
 * 暂存件的键：一条任务一份（后缀只是这一份暂存件的名字，图是什么格式落地时按文件头认）。
 * 任务 id 不是一段能当文件名用的值（没有 / 非法）时给空串 —— 落地与清理都当「没有这一份」看，
 * 收图那一步（stage）才要求有 id：写入得有地方写，读与删没有就什么都不做。
 */
function stagedPathOf(home, taskId) {
  if (!home || !isSafeName(taskId)) return "";
  return path.join(workdir.workRootOf(home), "staged", String(taskId).trim() + ".staged");
}

/* 暂存一张图：只按内容校「是不是 PNG / JPEG 位图」，尺寸留到落地那一步核。 */
function stage(body) {
  const home = String((body && body.home) || "");
  if (!home) throw new UserError("NEED_HOME", "缺少安装根", "");
  const taskId = requireTaskId(body && body.taskId);
  const { buffer, size } = requireBitmap(body && body.data);
  const file = stagedPathOf(home, taskId);
  atomicWrite.writeAtomic(file, buffer);
  return { path: file, width: size.width, height: size.height };
}

/** 扔掉这一条任务的暂存件（没有就什么都不做）：任务没跑到能落地就被移除时不留残件。 */
function discardStaged(input) {
  const home = String((input && input.home) || "");
  const file = stagedPathOf(home, input && input.taskId);
  if (!file) return;
  fs.rmSync(file, { force: true });
}

/**
 * 把暂存图落地到工作目录（流水线跑到「取数 + 固化快照」之后才有基准，所以由轮询侧在合适的时候调）：
 *   没有暂存件（任务 id / 页面名还不全也算没有）/ 还没有画板尺寸 / 工作目录里已经有人传过图 → 什么都不做（null）；
 *   尺寸对上 → 装进 <工作目录>/Generated/_inputs/<页面名>.design<后缀>；
 *   尺寸不对 / 读不出尺寸 → 返回两边的数，暂存件留着（人重导一张再选一次）。
 * 「还没有画板尺寸」与「尺寸不对」都留着：前者还没轮到，后者要等人重导。
 */
function installStaged(input) {
  const home = String((input && input.home) || "");
  const workDir = String((input && input.workDir) || "");
  const target = String((input && input.target) || "");
  if (!workDir || !target) return null;
  const staged = stagedPathOf(home, input && input.taskId);
  if (!staged) return null;
  if (!fs.existsSync(staged)) return null;
  const canvas = readCanvas(workDir, target);
  if (!canvas) return null;
  if (currentImage(workDir, target)) {
    fs.rmSync(staged, { force: true });
    return null;
  }

  const buffer = fs.readFileSync(staged);
  const size = readPixelSize(buffer);
  if (!size || canvas.width !== size.width || canvas.height !== size.height) {
    const image = size ? { width: size.width, height: size.height } : { width: 0, height: 0 };
    return { mismatch: { image: image, canvas: canvas } };
  }
  const file = designImagePathOf(workDir, target, EXTENSION_OF_FORMAT[size.format]);
  atomicWrite.writeAtomic(file, buffer);
  fs.rmSync(staged, { force: true });
  return { installed: file };
}

/*
 * 存一张图：只接 PNG / JPEG —— 认的是**文件内容的真实格式**（文件头），不认名字；
 * 落盘后缀也按那个格式取，所以「把别的格式改名成 .png 混进来」既进不来、也不会落成错的扩展名。
 * 落盘是整份替换（临时件 + 改名），写一半不会把上一张好的图毁掉。
 */
function save(body) {
  const projectRoot = requireProjectRoot(body && body.projectRoot);
  const target = requirePageTarget(body && body.target);
  // 只看内容，不看名字：格式由文件头判定（见 requireBitmap），所以上传文件叫什么都不影响落盘。
  const { buffer, size } = requireBitmap(body && body.data);

  const canvas = readCanvas(projectRoot, target);
  /*
   * 画板尺寸就是这条判据的基准：读不出来（还没跑到固化快照那一步、快照不在）时**不收** ——
   * 收下去的话，这张错尺寸的图会一路传下去，直到图上的框与控件位置整体错一个倍数才被发现
   * （插件自己不核位图尺寸，那是「读图」的判断输入）。等那一步产出快照之后再传。
   */
  if (!canvas) {
    throw new UserError("NO_CANVAS", "还不知道这一页的画板尺寸（固化快照那一步还没跑）", NO_CANVAS_REASON);
  }
  if (canvas.width !== size.width || canvas.height !== size.height) {
    throw new UserError(
      "SIZE_MISMATCH",
      "图与画板尺寸不一致：" + sizeMismatchText(size, canvas),
      "按设计稿原始尺寸导出（位图尺寸必须等于 DSL 画板尺寸），否则图上的框与控件位置会整体错一个倍数。"
    );
  }

  /*
   * 后缀按内容的真实格式取。顺序要紧：先整份写新的，落位成功之后再删其它后缀的旧图 ——
   * 反过来的话，换格式时（PNG 换 JPEG）一旦写失败，这一页就两张都没有了。
   */
  const ext = EXTENSION_OF_FORMAT[size.format];
  const file = designImagePathOf(projectRoot, target, ext);
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
    const stale = designImagePathOf(projectRoot, target, other);
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

module.exports = { read, save, hasImage, stage, discardStaged, installStaged, sizeMismatchText, MAX_BODY_BYTES };
