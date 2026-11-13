"use strict";

/*
 * 作业 A 的布局分组：读控件清单与分组表，自动生成并写回分组表。
 *
 * 分组表是「语义输入」之一：流水线 A 看图后自动产出，流水线在「布局推导」前消费它。
 * 本模块只做读写与校验，不推导分组，也不判定谁该跟谁一组。
 *
 * 数据源：
 *   - 控件清单：Generated/<Target>.component-types.json（nodes[]：ref / controlType / absX / absY / w / h）
 *   - 控件文本：Generated/runs/<Target>/dsl.snapshot.json（节点 text）
 *   - 分组表：Generated/_inputs/<Target>.layout-groups.json
 *   - 分组表可引用的条目清单：Generated/_inputs/<Target>.layout-group-candidates.json（转发 lib/layout-candidates.js）
 *   - 这一页是否有页面 PNG：转发 lib/design-image.js
 *
 * 口径来自插件（mw-wpf-mode.md 第 2 节）：分组表 shape 是
 *   { schemaVersion:"mw-wpf-layout-groups/1", pageTarget:"<Target>",
 *     groups:[{ id:"<组名>", kind:"column"|"row", members:["<ref>", ...] }] }
 * 校验与插件布局推导入口同一套判据：id 非空且不重复、kind 只取 column/row、members 至少 2 个非空 ref、
 * 一个 ref 只能进一个分组、**每个 ref 必须在那份条目清单里**（清单为空＝这一层不参与分组，表里不许声明组）。
 * pageTarget 由本模块写成本次页面（插件那边读到它会核对与本次页面一致，防止把另一页的表套上来）。
 * groups 是空数组也合法 —— 那是「本页没有要声明的分组」（插件那边表在就用它，没表才停），所以空表照写。
 *
 * 读与写都从这里走：自动补输入的停点读数（inspect）、/api/confirm 的写、
 * AI 候选的清理（ai.js 用 cleanGroups）与 AI 候选的输入
 * （candidatesInput：本层可引用条目 + 本页页面 PNG 的 data URL）。
 */

const fs = require("fs");

const { UserError } = require("./errors.js");
const workdir = require("./workdir.js");
const layoutCandidates = require("./layout-candidates.js");
const atomicWrite = require("./atomic-write.js");
const designImage = require("./design-image.js");
const { requirePageTarget, requireProjectRoot } = require("./name-safety.js");

const GROUPS_SCHEMA = "mw-wpf-layout-groups/1";
const readJsonIfExists = workdir.readJsonIfExists;

/*
 * 分组的规模判据（插件 mw-wpf-mode.md 第 2 节）：一组至少 2 个成员；控件少于 2 个时压根分不出组
 * （AI 不必问）。这两个数只有这一处定义 —— 写回校验、AI 候选清洗与自动补输入判据都读它们。
 */
const MIN_MEMBERS = 2;
const MIN_CONTROLS = 2;
const NO_GROUP_ENTRIES = "NO_ENTRIES";
/*
 * 插件 scripts/lib/failure-codes.json 定义的失败协议码；插件的 run-all 与 A 布局生成器共用那一份，
 * 本文件只消费失败摘要首行里的码，不读给人看的文案。
 */
const GROUP_FAILURE_CODE = Object.freeze({
  missing: "LAYOUT_GROUPS_MISSING",
  rejected: "LAYOUT_GROUPS_REJECTED"
});

/*
 * 分组表校验：与插件布局推导入口同一套判据（插件那侧是 gen-mw-wpf-layout.js 的 declaredGroups /
 * requireNoDeclaredGroups）。校验通过返回归一后的 groups，不通过抛 UserError。
 *
 * candidates 是这一层的条目清单（lib/layout-candidates.js 的读法）：
 *   清单为空（或不在）→ 这一层不参与分组，表里不许声明组；
 *   清单有条目 → 每个成员必须在这一层的条目里。
 * 插件还有一条「组的地盘里不得有未归组的条目」，那条要看几何，只有插件那侧判 —— 界面把它的话照实显示。
 */
function validateGroups(raw, candidates) {
  if (!Array.isArray(raw)) {
    // 「没给 groups」与「明确给了一张空表」是两回事：空表是有语义的结论，不能由缺省静默折成。
    throw new UserError("BAD_GROUPS", "分组表必须是数组", "空数组是合法声明（本页没有要声明的分组）；没给就别调写回。");
  }
  /* 清单还没落下来（这一步还没跑过）：没有「能写哪些 ref」这条事实，就不许写表。那句原话由读清单那一处给。 */
  if (!candidates || typeof candidates.available !== "boolean") {
    throw new UserError("NO_CANDIDATES", "没有这一层条目清单的读数（candidates）：写回校验要有它才能判 ref", "");
  }
  if (!candidates.available) {
    throw new UserError("NO_CANDIDATES", candidates.reason, "跑一次作业A 第 8 步（layout）之后再来写这张表。");
  }
  /* 清单为空＝这一层不参与分组（条目不足 2 个 / 内容区没有条目 / 已由设计稿成层）：唯一合法的表是空表。 */
  const citable = layoutCandidates.refsOf(candidates);
  if (raw.length > 0 && citable.size === 0) {
    throw new UserError(
      "BAD_GROUPS",
      "这一层的条目清单是空的（这一层不参与分组）：表里不声明任何组",
      "把 groups 写成空数组（空表是合法声明）；这一层的分组结论不由表给。"
    );
  }
  const list = raw;
  const usedIds = new Set();
  list.forEach(function (group, index) {
    const label = "分组表第 " + (index + 1) + " 项";
    if (!group || typeof group !== "object") throw new UserError("BAD_GROUP", label + "不是对象", "");
    if (!group.id) throw new UserError("BAD_GROUP", label + "缺 id", "");
    // 组名唯一：表里两个组同名，插件那边就分不清谁是谁（与别的写回校验同处，界面不自己判一遍）。
    if (usedIds.has(String(group.id))) throw new UserError("BAD_GROUP", "分组表里组名重复: " + group.id, "");
    usedIds.add(String(group.id));
    if (group.kind !== "column" && group.kind !== "row") {
      throw new UserError("BAD_GROUP", label + "（" + group.id + "）的 kind 必须是 column 或 row", "");
    }
    if (!Array.isArray(group.members) || group.members.length < MIN_MEMBERS) {
      throw new UserError("BAD_GROUP", label + "（" + group.id + "）的 members 至少 " + MIN_MEMBERS + " 个 ref", "");
    }
    group.members.forEach(function (ref) {
      if (typeof ref !== "string" || !ref) {
        throw new UserError("BAD_GROUP", label + "（" + group.id + "）的 members 只能是非空字符串 ref", "");
      }
      if (!citable.has(ref)) {
        throw new UserError(
          "BAD_GROUP",
          "分组 " + group.id + " 的 ref 不在本层条目里: " + ref,
          "表里的 ref 只能从这一步的条目清单里取（界面上那份「可引用条目」）。"
        );
      }
    });
  });
  // 跨组唯一性走 uniqueMembers：写回校验（重复即失败）与 AI 候选（重复即合并）同一条判据。
  const unique = uniqueMembers(normalize(list));
  if (unique.repeated.length > 0) {
    throw new UserError("BAD_GROUP", "ref 出现在多个分组里: " + unique.repeated[0], "");
  }
  return unique.groups;
}

function normalize(groups) {
  return groups.map(function (group) {
    return { id: String(group.id), kind: group.kind, members: group.members.map(String) };
  });
}

/*
 * 候选清理（AI 出的分组先过这一道）：同名组只留第一个、成员跨组去重、**清单外的成员丢掉**、
 * 去重后不够 MIN_MEMBERS 的组丢掉。
 * 与写回校验是同一件事的两种时刻：那边（validateGroups）同名即拒收，这边先收拾成能通过的样子 ——
 * 别让人点了「AI 辅助」才发现要重来。判据都在本文件，ai.js 只调它，不自己判一遍。
 */
function cleanGroups(raw, candidates) {
  /* 与写回校验同一条口径：没有那份清单就不许收拾出「能通过的样子」（漏传时无声清空比报错更难查）。 */
  if (!candidates || typeof candidates.available !== "boolean") {
    throw new UserError("NO_CANDIDATES", "没有这一层条目清单的读数（candidates）：候选清理要有它才能判 ref", "");
  }
  if (!candidates.available) {
    throw new UserError("NO_CANDIDATES", candidates.reason, "");
  }
  const citable = layoutCandidates.refsOf(candidates);
  const usedIds = new Set();
  const kept = [];
  for (const group of Array.isArray(raw) ? raw : []) {
    if (!group || typeof group !== "object") continue;
    const id = String(group.id || "").trim();
    if (!id || usedIds.has(id)) continue;
    if (group.kind !== "column" && group.kind !== "row") continue;
    usedIds.add(id);
    kept.push({
      id: id,
      kind: group.kind,
      members: (Array.isArray(group.members) ? group.members : [])
        .map(String)
        .filter(function (ref) { return citable.has(ref); })
    });
  }
  return uniqueMembers(kept).groups.filter(function (group) { return group.members.length >= MIN_MEMBERS; });
}

/*
 * 跨组唯一化：同一个 ref 只留第一次出现的组，并把它重复出现在哪些组报出来。
 * 这里是这条规则的唯一实现：写回校验据此拒绝（repeated 非空即失败）、候选清理据此合并（丢掉多出来的那次）。
 */
function uniqueMembers(groups) {
  const used = new Set();
  const repeated = [];
  const unique = groups.map(function (group) {
    return {
      id: group.id,
      kind: group.kind,
      members: group.members.filter(function (ref) {
        if (!used.has(ref)) {
          used.add(ref);
          return true;
        }
        repeated.push(ref);
        return false;
      })
    };
  });
  return { groups: unique, repeated: repeated };
}

/*
 * 布局停点读数：文件事实、失败事实与恢复结论只在这里合一次。
 *
 * hasFile 回答插件会不会看到文件（Test-Path）；hasGroups 回答这份文件能否读成可用表。
 * 两者分开后，文件存在但内容损坏仍能命中 LAYOUT_GROUPS_REJECTED，而不是被折成「缺表」。
 * 停点不是布局步骤，或原话没有稳定机器码时，不提供任何覆盖分组表的恢复动作。
 */
function inspect(query) {
  const projectRoot = requireProjectRoot(query && query.projectRoot);
  const target = requirePageTarget(query && query.target);
  const pendingCandidates = layoutCandidates.read({ projectRoot: projectRoot, target: target });
  const groupsDoc = workdir.readLayoutGroups(projectRoot, target);
  const hasImage = designImage.hasImage({ projectRoot: projectRoot, target: target });
  const regroupBlocker = suggestBlocker(query, { candidates: pendingCandidates, hasImage: hasImage });
  const hasFile = fs.existsSync(workdir.layoutGroupsPath(projectRoot, target));
  const hasGroups = groupsDoc !== null;
  const state = String(query?.state || "");
  const sourceHasState = Boolean(state);
  const recoverable = query?.imageStop !== true && (!state || state === "waiting" || state === "failed");
  const failed = isLayoutStepStop(query || {});
  const failureCode = groupFailureCodeOf(query || {});
  const rejected = recoverable && hasFile && failureCode === GROUP_FAILURE_CODE.rejected;
  const missing = !hasFile && failureCode === GROUP_FAILURE_CODE.missing;
  /*
   * 有来源状态时，恢复入口只认「布局步骤停点 + 缺表/被拒」这组证据；
   * 无状态的手填来源才允许按「有图无表」直接走恢复。
   */
  const sourceAllowsRecovery = !sourceHasState || (failed && (missing || rejected));
  const needsGroups = recoverable &&
    hasImage &&
    !hasGroups &&
    pendingCandidates.available &&
    sourceAllowsRecovery;
  return {
    available: pendingCandidates.available,
    reason: pendingCandidates.reason,
    hasFile: hasFile,
    hasGroups: hasGroups,
    hasImage: hasImage,
    // 待办、自动续跑与两个恢复按钮都读这里算出的结论。
    needsGroups: needsGroups,
    recoverable: recoverable,
    rejected: rejected,
    failed: failed,
    failedMessage: failed ? String(query && query.failedMessage || "") : "",
    waiting: needsGroups || rejected ? 1 : 0,
    regroup: regroupOf(regroupBlocker)
  };
}

/* 服务端的恢复边界：同一次 inspect 算出的恢复资格与恢复结论共同决定是否放行。 */
function requireRecovery(layout) {
  if (layout && layout.recoverable && (layout.needsGroups || layout.rejected)) return;
  throw new UserError(
    "NOT_LAYOUT_RECOVERY",
    "当前停点不是分组表缺失或被拒，不能重新分组",
    "先刷新待确认清单；只有布局分组待办仍在时才能执行这项恢复。"
  );
}

/* 「确实停在吃分组表那一步」的唯一判据：只有等待/失败态、不是等图停点，且失败步骤就是布局步骤。 */
function isLayoutStepStop(input) {
  const state = String(input && input.state || "");
  const layoutStep = String(input && input.layoutStep || "");
  const failedStep = String(input && input.failedStep || "");
  return (state === "waiting" || state === "failed") &&
    input.imageStop !== true &&
    Boolean(layoutStep) &&
    failedStep === layoutStep;
}

/* 布局步骤失败里带的稳定机器码；没有码就不归类成分组表恢复。 */
function groupFailureCodeOf(input) {
  if (!isLayoutStepStop(input || {})) return "";
  const message = String(input && input.failedMessage || "");
  return Object.values(GROUP_FAILURE_CODE).find(function (code) {
    return message.includes("[" + code + "]");
  }) || "";
}

/*
 * 「这一步的输入够不够问模型」的唯一判据：不够就交出是哪一件事（code / reason / hint，三样都照后端原话说）。
 * 条件三样缺一不可：这一层的条目清单在（它回答「表里能写哪些 ref」）、条目够 MIN_CONTROLS（够才成得了组）、
 * 这一页有页面 PNG（这一步就是看图判分组；没图时分组由机械判据决定，插件的契约也是这样）。
 * 唯一生产消费者是 candidatesInput：自动补输入拿这份判据决定能不能问模型。
 * 判据要用到的两样（条目清单 / 有没有位图）调用方已经读过就传进来（seen），免得同一次请求读两遍。
 */
function suggestBlocker(query, seen) {
  const projectRoot = query && query.projectRoot;
  const target = query && query.target;
  const candidates = (seen && seen.candidates) || layoutCandidates.read({ projectRoot: projectRoot, target: target });
  if (!candidates.available) {
    return { code: "NO_CANDIDATES", reason: candidates.reason, hint: "跑一次作业A 第 8 步（layout）之后再来问模型。" };
  }
  if (candidates.entries.length < MIN_CONTROLS) {
    return {
      code: NO_GROUP_ENTRIES,
      reason: "这一层的条目凑不出分组（少于 " + MIN_CONTROLS + " 条）：分组表里不声明任何组",
      hint: "这一层的分组结论不由模型给；直接写一张空表（空表是合法声明）。"
    };
  }
  const hasImage = seen && typeof seen.hasImage === "boolean"
    ? seen.hasImage
    : designImage.hasImage({ projectRoot: projectRoot, target: target });
  if (!hasImage) {
    return {
      code: "NO_IMAGE",
      reason: "这一步要对着页面 PNG 判分组：这一页还没有传图，没有可判断的输入",
      hint: "先在「页面 PNG」那一栏传一张本页的图；这一页没有图时分组由机械判据决定，或直接写一张空表，不必问模型。"
    };
  }
  return null;
}

/* 面板动作与自动层级共用的恢复结论：undefined 表示这个来源根本不消费布局分组。 */
function regroupOf(blocker) {
  if (blocker === undefined) {
    return { allowed: false, code: "", reason: "", hint: "" };
  }
  if (blocker === null) {
    return { allowed: true, code: "", reason: "", hint: "" };
  }
  return {
    allowed: false,
    code: String(blocker.code || ""),
    reason: String(blocker.reason || ""),
    hint: String(blocker.hint || "")
  };
}

/*
 * 布局分组这一步喂给模型的输入：**本层可引用的条目** + 本页页面 PNG 的 data URL。
 * 只有这一处说「这一步的输入是什么」：自动补输入（lib/autofill.js）拿它去调 ai.suggestLayoutGroups。
 * 条目就是插件第 8 步落的那份清单里那几条（插件 Skill 也是让模型「写表前先看它」）：两边看的是同一份。
 * 够不够由 suggestBlocker（唯一判据）判：不够就按它的话抛出去（与图坏了同一类：输入自己读不出来，
 * 不是模型给不出结果）。取图那一处仍是 lib/design-image.js 的 dataUrl（图坏了它抛 BAD_IMAGE，由调用方处置）。
 */
function candidatesInput(query) {
  const projectRoot = query && query.projectRoot;
  const target = query && query.target;
  const candidates = layoutCandidates.read({ projectRoot: projectRoot, target: target });
  const hasImage = designImage.hasImage({ projectRoot: projectRoot, target: target });
  const blocked = suggestBlocker(query, { candidates: candidates, hasImage: hasImage });
  if (blocked) throw new UserError(blocked.code, blocked.reason, blocked.hint);
  const image = designImage.dataUrl({ projectRoot: query && query.projectRoot, target: query && query.target });
  return { entries: candidates.entries, image: image };
}

// 写回分组表：直写整份（临时件 + 改名），写一半不会把上一份好的表毁掉。
function save(body) {
  const projectRoot = requireProjectRoot(body && body.projectRoot);
  const target = requirePageTarget(body && body.target);
  const candidates = layoutCandidates.read({ projectRoot: projectRoot, target: target });
  const groups = validateGroups(body && body.groups, candidates);
  const doc = { schemaVersion: GROUPS_SCHEMA, pageTarget: target, groups: groups };
  const file = workdir.layoutGroupsPath(projectRoot, target);
  atomicWrite.writeAtomic(file, JSON.stringify(doc, null, 2) + "\n");
  return { path: file, count: groups.length };
}

module.exports = {
  inspect,
  requireRecovery,
  GROUP_FAILURE_CODE,
  candidatesInput,
  save,
  uniqueMembers,
  cleanGroups,
  regroupOf,
  MIN_MEMBERS,
  NO_GROUP_ENTRIES
};
