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
// 项目级共享文件（Resources/Layout/Layout.xml、csproj、framework.config.json）两边都动过时
// 走行级三方合并（base / 主工程 / 本任务）：两边改到的行不重叠就自动合，重叠才报冲突；
// 合完还要过结构校验（Layout 必须仍含本页 Target、标签必须闭合），校验不过按冲突处理。
//
// 边界：合并从不删除主工程的文件；bak- 备份与 Generated/_work/ 不回写。

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
  const dir = workdir.absolute(workDir, "Generated/_inputs");
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

// 合并一个任务。options: { projectRoot, workDir, baseDir, manifest, target }
// 返回 { applied, skipped, notes, conflicts }；conflicts 非空时 applied 一定是空的，
// 也就是主工程一个字节都没动 —— 不产出半成品。
async function merge(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const workDir = path.resolve(options.workDir);
  const baseDir = path.resolve(options.baseDir);
  const target = String(options.target || "");
  const layout = options.layout || null;

  const delta = await workdir.changed(workDir, options.manifest);
  const plan = [];
  const skipped = [];
  const notes = [];
  const conflicts = [];
  let layoutPending = false;

  for (const item of delta.added.concat(delta.modified)) {
    const rel = item.path;
    if (rel === workdir.LAYOUT_REL) {
      // 这份文件不搬不并：交给插件在主工程当前内容上重新注册本页（见 lib/plugin-layout.js）。
      layoutPending = true;
      continue;
    }
    if (workdir.isScratch(rel)) {
      skipped.push(rel);
      notes.push(rel + "：运行工作文件，不回写");
      continue;
    }
    if (workdir.isBackup(rel)) {
      skipped.push(rel);
      notes.push(rel + "：覆盖备份，不回写");
      continue;
    }

    const sourcePath = workdir.absolute(workDir, rel);
    const destPath = workdir.absolute(projectRoot, rel);
    const baseHash = options.manifest.files[rel] ?? null;
    const main = await workdir.readFileInfo(destPath);
    const mine = await fsp.readFile(sourcePath);

    let content = mine;
    let seen = null;

    if (main) {
      if (main.hash === item.hash) {
        skipped.push(rel);
        notes.push(rel + "：主工程内容已经一致");
        continue;
      }
      if (main.hash === baseHash) {
        seen = main.hash;
      }
      else if (workdir.isRunProduct(rel)) {
        // 运行产物：建工作目录时不复制 Generated/，主工程那一份是上一次运行的，
        // 本任务的运行刚重新产出——按「本次运行说了算」覆盖，与插件单独跑同一口径。
        notes.push(rel + "：本次运行的产物，覆盖主工程上一次的");
      }
      else if (!workdir.isProjectLevel(rel)) {
        conflicts.push({ path: rel, reason: "主工程与本任务都改过它，且它不是项目级共享文件，不自动合并" });
        continue;
      }
      else {
        const baseText = await readTextOr(workdir.absolute(baseDir, rel), "");
        const merged = threeWayMerge(baseText, main.text, mine.toString("utf8"));
        if (!merged.ok) {
          conflicts.push({ path: rel, reason: merged.reason });
          continue;
        }
        if (merged.content === main.text) {
          skipped.push(rel);
          notes.push(rel + "：合并结果与主工程一致");
          continue;
        }
        content = Buffer.from(merged.content, "utf8");
        seen = main.hash;
        notes.push(rel + "：与主工程做了行级三方合并");
      }
    }
    else if (baseHash) {
      conflicts.push({ path: rel, reason: "主工程里这个文件已经不存在（建工作目录时还在），不自动重建" });
      continue;
    }

    if (workdir.isProjectLevel(rel)) {
      const problem = guardProjectFile(rel, content.toString("utf8"), target);
      if (problem) {
        conflicts.push({ path: rel, reason: problem });
        continue;
      }
    }

    plan.push({ path: rel, content: content, seen: seen });
  }

  for (const rel of delta.removed) {
    skipped.push(rel);
    notes.push(rel + "：本任务里被删掉了，合并从不删除主工程文件");
  }

  if (conflicts.length > 0) {
    return { applied: [], skipped: skipped, notes: notes, conflicts: conflicts };
  }

  if (layoutPending) {
    if (!layout || typeof layout.register !== "function") {
      return {
        applied: [],
        skipped: skipped,
        notes: notes,
        conflicts: [{ path: workdir.LAYOUT_REL, reason: "需要插件重新注册本页 Layout，但没有可用的注册入口" }]
      };
    }
    const manifestPath = await findLayoutManifest(workDir, target);
    if (!manifestPath) {
      return {
        applied: [],
        skipped: skipped,
        notes: notes,
        conflicts: [{ path: workdir.LAYOUT_REL, reason: "找不到本页的 Layout 清单（Generated/_inputs/<Target>.layout-manifest.json），无法重新注册" }]
      };
    }
  }

  // 计划做完到真正落盘之间，主工程又被改过就整个放弃，不写半份。
  for (const item of plan) {
    if (!item.seen) continue;
    const now = await workdir.readFileInfo(workdir.absolute(projectRoot, item.path));
    if (!now || now.hash !== item.seen) {
      return {
        applied: [],
        skipped: skipped,
        notes: notes,
        conflicts: [{ path: item.path, reason: "合并计划做出之后主工程又变了，请重新合并" }]
      };
    }
  }

  const applied = [];
  if (layoutPending) {
    // 先注册再落文件：注册失败时主工程还是原样，不留半份。
    try {
      await layout.register({
        projectRoot: projectRoot,
        manifestPath: await findLayoutManifest(workDir, target),
        mode: options.mode
      });
    }
    catch (error) {
      return {
        applied: [],
        skipped: skipped,
        notes: notes,
        conflicts: [{ path: workdir.LAYOUT_REL, reason: String(error && error.message ? error.message : error) }]
      };
    }
    const written = await workdir.readFileInfo(workdir.absolute(projectRoot, workdir.LAYOUT_REL));
    const problem = written ? guardProjectFile(workdir.LAYOUT_REL, written.text, target) : "注册后主工程里没有 Layout.xml";
    if (problem) {
      return {
        applied: [],
        skipped: skipped,
        notes: notes,
        conflicts: [{ path: workdir.LAYOUT_REL, reason: problem }]
      };
    }
    applied.push(workdir.LAYOUT_REL);
  }
  for (const item of plan) {
    const dest = workdir.absolute(projectRoot, item.path);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, item.content);
    applied.push(item.path);
  }
  return { applied: applied, skipped: skipped, notes: notes, conflicts: [] };
}

module.exports = { merge, threeWayMerge };
