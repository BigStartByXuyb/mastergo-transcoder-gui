"use strict";

// 合并：把任务工作目录里的改动搬回主工程。
//
// 逐文件三态比较（base = 建工作目录时的快照）：
//   主工程 == base              → 主工程这一份没人动过，落本任务的版本（快进）
//   主工程 == 本任务             → 已经一样，跳过
//   主工程既不是 base 也不是本任务 → 真正的冲突
//
// 冲突一律不猜：先把整张合并计划算完，只要有一处冲突就一个字节都不写。
//
// 唯一的例外是人在界面上明确选过，范围限于「内容归属」类冲突 —— 两边都改过、主工程里已删、
// 行级合并失败 —— 人选「以本任务产出为准」或「保留主工程」。结构校验不过不在其列：
// 那说明产物本身不合格，取哪一份都错，必须回去修。
//
// 项目级共享文件（Resources/Layout/Layout.xml、csproj、framework.config.json）两边都动过时
// 走行级三方合并（base / 主工程 / 本任务）：两边改到的行不重叠就自动合，重叠才报冲突；
// 合完还要过结构校验（Layout 必须仍含本页 Target、标签必须闭合），校验不过按冲突处理。
//
// 边界：合并从不删除主工程的文件；bak- 备份与 Generated/_work/ 不回写。
// 运行产物（整个 Generated/**，含 _inputs 里那份命名表/译文记录）由本次运行覆盖 ——
// 建工作目录时不复制这一层，主工程里那份只是上一次运行的记录，不参与本次运行。

const fs = require("fs");
const path = require("path");

const fsp = fs.promises;
const workdir = require("./workdir.js");

// LCS 是 O(n*m) 的：超过这个规模直接报冲突，让人去看，别把服务卡死。
const MAX_LCS_CELLS = 4000000;

function splitLines(text) {
  return text.split(/\r?\n/);
}

// base 每行在 other 里配到哪一行（配不上为 -1）。规模超限返回 null。
function lcsMap(base, other) {
  const n = base.length;
  const m = other.length;
  if (n === 0 || m === 0) return new Int32Array(n).fill(-1);
  if (n * m > MAX_LCS_CELLS) return null;

  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] = base[i] === other[j]
        ? dp[(i + 1) * width + (j + 1)] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const map = new Int32Array(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === other[j]) {
      map[i] = j;
      i += 1;
      j += 1;
      continue;
    }
    if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) i += 1;
    else j += 1;
  }
  return map;
}

// base → other 的改动块：base[baseStart, baseEnd) 被 lines 替换（纯插入时区间为空）。
function hunks(base, other) {
  const map = lcsMap(base, other);
  if (!map) return null;
  const result = [];
  let prevBase = 0;
  let prevOther = 0;
  for (let index = 0; index < base.length; index += 1) {
    if (map[index] < 0) continue;
    const at = map[index];
    if (index > prevBase || at > prevOther) {
      result.push({ baseStart: prevBase, baseEnd: index, lines: other.slice(prevOther, at) });
    }
    prevBase = index + 1;
    prevOther = at + 1;
  }
  if (prevBase < base.length || prevOther < other.length) {
    result.push({ baseStart: prevBase, baseEnd: base.length, lines: other.slice(prevOther) });
  }
  return result;
}

function isClosingLine(line) {
  return /^<\//.test(String(line || "").trim());
}

function containsRun(haystack, needle) {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let hit = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

// 这一块改动落到 ours 的哪个位置；ours 在同一处也改过就返回 null。
//
// 同一个插入点两边各插了一段，是这份工程里最常见的写法（Layout 的 <Pages>、csproj 的
// <ItemGroup> 都是「往闭合标签前追加」）：锚点确实是闭合标签时把两边都留下，顺序不影响
// 语义（<Page> 与 <Include> 都是各自独立的条目）；锚点不是闭合标签就按冲突处理，不猜。
function locate(hunk, oursMap, baseLength, oursLength, ours) {
  if (hunk.baseStart < hunk.baseEnd) {
    const first = oursMap[hunk.baseStart];
    if (first < 0) return null;
    for (let index = hunk.baseStart; index < hunk.baseEnd; index += 1) {
      if (oursMap[index] !== first + (index - hunk.baseStart)) return null;
    }
    return { at: first, remove: hunk.baseEnd - hunk.baseStart };
  }

  if (baseLength === 0) return null;
  const after = hunk.baseStart < baseLength ? oursMap[hunk.baseStart] : -1;
  const before = hunk.baseStart > 0 ? oursMap[hunk.baseStart - 1] : -1;

  if (after >= 0) {
    if (before >= 0 && after !== before + 1 && !isClosingLine(ours[after])) return null;
    return { at: after, remove: 0 };
  }
  if (hunk.baseStart !== baseLength || oursLength === 0) return null;
  if (before < 0 && baseLength > 0) return null;
  return { at: oursLength, remove: 0 };
}

function threeWayMerge(baseText, oursText, theirsText) {
  const crlf = oursText.includes("\r\n");
  const base = splitLines(baseText);
  const ours = splitLines(oursText);
  const theirs = splitLines(theirsText);

  const theirsHunks = hunks(base, theirs);
  const oursMap = lcsMap(base, ours);
  if (!theirsHunks || !oursMap) {
    return { ok: false, reason: "文件规模超出自动合并上限，请人工处理" };
  }

  const edits = [];
  for (const hunk of theirsHunks) {
    // 纯插入时如果这几行已经在 ours 里了，说明这一块本来就合过了，别再插一遍。
    if (hunk.baseStart === hunk.baseEnd && containsRun(ours, hunk.lines)) continue;
    const spot = locate(hunk, oursMap, base.length, ours.length, ours);
    if (!spot) return { ok: false, reason: "两边改到了同一处，无法自动合并" };
    edits.push({ at: spot.at, remove: spot.remove, lines: hunk.lines });
  }

  edits.sort(function (left, right) { return right.at - left.at; });
  const out = ours.slice();
  let boundary = Infinity;
  for (const edit of edits) {
    if (edit.at + edit.remove > boundary) return { ok: false, reason: "两边改到的行区间重叠，无法自动合并" };
    out.splice(edit.at, edit.remove, ...edit.lines);
    boundary = edit.at;
  }
  return { ok: true, content: out.join(crlf ? "\r\n" : "\n") };
}

// 写完才发现的坏结构没有意义：先在计划阶段拦下来。
function guardProjectFile(rel, content, target) {
  if (rel === workdir.LAYOUT_REL) {
    if (!/<Layout[\s>]/i.test(content)) return "合并结果不是合法 Layout.xml（缺 Layout 开标签）";
    if (!/<\/Layout>/i.test(content)) return "合并结果不是合法 Layout.xml（缺 Layout 闭标签）";
    if (target) {
      const escaped = target.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
      if (!new RegExp("Target=[\"']" + escaped + "[\"']", "i").test(content)) {
        return "合并结果里找不到本页注册（Target=" + target + "），拒绝写入";
      }
    }
    return "";
  }
  if (/\.csproj$/i.test(rel) && !/<\/Project>/.test(content)) {
    return "合并结果不是合法 csproj（缺 Project 闭标签）";
  }
  return "";
}

async function readTextOr(file, fallback) {
  try {
    return await fsp.readFile(file, "utf8");
  }
  catch {
    return fallback;
  }
}

// 本页的 Layout 清单：插件第 8 步的产物，重新注册时喂给它。
// 任务没显式给 Target 时按「清单里只有一个」取，多于一个就报错让人把 Target 写清楚。
async function findLayoutManifest(workDir, target) {
  const dir = workdir.absolute(workDir, workdir.runProductRel("_inputs"));
  let names = [];
  try {
    names = (await fsp.readdir(dir)).filter((name) => name.endsWith(".layout-manifest.json"));
  }
  catch {
    return "";
  }
  if (target) {
    const wanted = target + ".layout-manifest.json";
    return names.includes(wanted) ? path.join(dir, wanted) : "";
  }
  return names.length === 1 ? path.join(dir, names[0]) : "";
}

/*
 * 一个文件该走哪条路：纯函数 —— 只看路径与三态哈希，不读盘、不改状态。
 * 判定顺序本身就是规则：
 *   工作文件/备份先出局 → 两边内容一致跳过 → 主工程没动过快进 →
 *   Generated/** 是本次运行的产物（主工程那份是上一次运行的）→ 覆盖 →
 *   项目级共享文件行级三方合并 → 其余是真冲突。
 * action: skip | write | mergeLines | conflict
 */
function classifyFile(input) {
  if (input.isScratch) return { action: "skip", note: "运行工作文件，不回写" };
  if (input.isBackup) return { action: "skip", note: "覆盖备份，不回写" };
  if (!input.mainExists) {
    return input.baseHash
      ? { action: "conflict", reason: "主工程里这个文件已经不存在（建工作目录时还在），不自动重建" }
      : { action: "write" };
  }
  if (input.mainHash === input.mineHash) return { action: "skip", note: "主工程内容已经一致" };
  if (input.mainHash === input.baseHash) return { action: "write", seen: input.mainHash };
  if (input.isRunProduct) return { action: "write", note: "本次运行的产物，覆盖主工程上一次的" };
  if (input.isProjectLevel) return { action: "mergeLines", seen: input.mainHash };
  return { action: "conflict", reason: "主工程与本任务都改过它，且它不是项目级共享文件，不自动合并" };
}

/*
 * 落地：把算好的计划写回主工程。中途任何一处不成立就整单放弃（一个字节都不写），
 * 三件必须按顺序做的事都在这里，不外泄到调用方：
 *   1) 计划做完到落盘之间主工程又变了 → 放弃，让用户重新合并；
 *   2) 需要重新注册 Layout 时，注册入口与 Layout 清单必须齐备（先注册，注册失败主工程还是原样）；
 *   3) 注册结果要过结构校验，然后才写文件。
 */
async function applyPlan(options) {
  const stop = (rel, reason) => ({
    applied: [],
    skipped: options.skipped,
    notes: options.notes,
    conflicts: [{ path: rel, reason: reason, resolvable: false }]
  });

  let manifestPath = "";
  if (options.layoutPending) {
    if (!options.layout || typeof options.layout.register !== "function") {
      return stop(workdir.LAYOUT_REL, "需要插件重新注册本页 Layout，但没有可用的注册入口");
    }
    // 只找一次：下面注册用的就是这一份路径，别在两次调用之间让「校验过的」与「实际用的」分家。
    manifestPath = await findLayoutManifest(options.workDir, options.target);
    if (!manifestPath) {
      return stop(
        workdir.LAYOUT_REL,
        "找不到本页的 Layout 清单（" + workdir.runProductRel("_inputs", "<Target>.layout-manifest.json") + "），无法重新注册"
      );
    }
  }

  // 计划做完到真正落盘之间，主工程又被改过就整个放弃，不写半份。
  for (const item of options.plan) {
    if (!item.seen) continue;
    const now = await workdir.readFileInfo(workdir.absolute(options.projectRoot, item.path));
    if (!now || now.hash !== item.seen) {
      return stop(item.path, "合并计划做出之后主工程又变了，请重新合并");
    }
  }

  const applied = [];
  if (options.layoutPending) {
    try {
      await options.layout.register({
        projectRoot: options.projectRoot,
        manifestPath: manifestPath,
        mode: options.mode
      });
    }
    catch (error) {
      return stop(workdir.LAYOUT_REL, String(error && error.message ? error.message : error));
    }
    const written = await workdir.readFileInfo(workdir.absolute(options.projectRoot, workdir.LAYOUT_REL));
    const problem = written
      ? guardProjectFile(workdir.LAYOUT_REL, written.text, options.target)
      : "注册后主工程里没有 Layout.xml";
    if (problem) return stop(workdir.LAYOUT_REL, problem);
    applied.push(workdir.LAYOUT_REL);
  }

  for (const item of options.plan) {
    const dest = workdir.absolute(options.projectRoot, item.path);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, item.content);
    applied.push(item.path);
  }
  return { applied: applied, skipped: options.skipped, notes: options.notes, conflicts: [] };
}

// 合并一个任务。options: { projectRoot, workDir, baseDir, manifest, target, resolutions }
// resolutions 是人在界面上做过的冲突选择（相对路径 → mine / main），没选过就是空。
// 返回 { applied, skipped, notes, conflicts }；conflicts 非空时 applied 一定是空的，
// 也就是主工程一个字节都没动 —— 不产出半成品。
async function merge(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const workDir = path.resolve(options.workDir);
  const baseDir = path.resolve(options.baseDir);
  const target = String(options.target || "");
  const layout = options.layout || null;
  const resolutions = options.resolutions && typeof options.resolutions === "object" ? options.resolutions : {};

  const delta = await workdir.changed(workDir, options.manifest);
  const plan = [];
  const skipped = [];
  const notes = [];
  const conflicts = [];
  let layoutPending = false;

  /*
   * 冲突处的人工决策。返回 "" 表示已按人的选择处理掉，null 表示这次没选，
   * 非空串是选择不成立的理由（项目级文件过不了结构校验）。
   * 只有「以本任务产出为准」会落盘，且不写 seen：人已经明确要求覆盖，
   * 再拿主工程当前哈希比一次等于把这个选择否掉。
   */
  async function overridden(rel) {
    const pick = resolutions[rel];
    if (pick === "main") {
      skipped.push(rel);
      notes.push(rel + "：按人工选择保留主工程版本");
      return "";
    }
    if (pick !== "mine") return null;
    const content = await fsp.readFile(workdir.absolute(workDir, rel));
    if (workdir.isProjectLevel(rel)) {
      const problem = guardProjectFile(rel, content.toString("utf8"), target);
      if (problem) return problem;
    }
    plan.push({ path: rel, content: content, seen: null });
    notes.push(rel + "：按人工选择以本任务产出为准");
    return "";
  }

  for (const item of delta.added.concat(delta.modified)) {
    const rel = item.path;
    if (rel === workdir.LAYOUT_REL) {
      // 这份文件不搬不并：交给插件在主工程当前内容上重新注册本页（见 lib/plugin-layout.js）。
      layoutPending = true;
      continue;
    }

    const main = await workdir.readFileInfo(workdir.absolute(projectRoot, rel));
    const decision = classifyFile({
      rel: rel,
      mainExists: Boolean(main),
      mainHash: main ? main.hash : null,
      baseHash: options.manifest.files[rel] ?? null,
      mineHash: item.hash,
      isScratch: workdir.isScratch(rel),
      isBackup: workdir.isBackup(rel),
      isRunProduct: workdir.isRunProduct(rel),
      isProjectLevel: workdir.isProjectLevel(rel)
    });
    if (decision.action === "skip") {
      skipped.push(rel);
      notes.push(rel + "：" + decision.note);
      continue;
    }
    if (decision.action === "conflict") {
      const override = await overridden(rel);
      if (override === "") continue;
      // override 非空 = 人的选择本身不成立（项目级文件过不了结构校验）：这个不能由人拍板。
      conflicts.push({ path: rel, reason: override || decision.reason, resolvable: !override });
      continue;
    }

    const mine = await fsp.readFile(workdir.absolute(workDir, rel));
    let content = mine;
    if (decision.action === "mergeLines") {
      const baseText = await readTextOr(workdir.absolute(baseDir, rel), "");
      const merged = threeWayMerge(baseText, main.text, mine.toString("utf8"));
      if (!merged.ok) {
        const override = await overridden(rel);
        if (override === "") continue;
        conflicts.push({ path: rel, reason: override || merged.reason, resolvable: !override });
        continue;
      }
      if (merged.content === main.text) {
        skipped.push(rel);
        notes.push(rel + "：合并结果与主工程一致");
        continue;
      }
      content = Buffer.from(merged.content, "utf8");
      notes.push(rel + "：与主工程做了行级三方合并");
    }
    else if (decision.note) {
      notes.push(rel + "：" + decision.note);
    }

    if (workdir.isProjectLevel(rel)) {
      const problem = guardProjectFile(rel, content.toString("utf8"), target);
      if (problem) {
        conflicts.push({ path: rel, reason: problem, resolvable: false });
        continue;
      }
    }

    plan.push({ path: rel, content: content, seen: decision.seen ?? null });
  }

  for (const rel of delta.removed) {
    skipped.push(rel);
    notes.push(rel + "：本任务里被删掉了，合并从不删除主工程文件");
  }

  if (conflicts.length > 0) {
    return { applied: [], skipped: skipped, notes: notes, conflicts: conflicts };
  }

  return applyPlan({
    projectRoot: projectRoot,
    workDir: workDir,
    target: target,
    layout: layout,
    mode: options.mode,
    plan: plan,
    skipped: skipped,
    notes: notes,
    layoutPending: layoutPending
  });
}

module.exports = { merge, threeWayMerge, classifyFile };
