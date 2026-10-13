"use strict";

/*
 * 布局确认（作业A）：读控件清单 + 分组表，写回分组表。
 *
 * 这是「语义输入」之一（与图标命名表、译文清单同类）：分组表 layout-groups.json 由人 / AI 看图后写，
 * 流水线在「布局推导」前消费它。本模块只做读与写，不推导分组，也不判定谁该跟谁一组。
 *
 * 数据源：
 *   - 控件清单：Generated/<Target>.component-types.json（nodes[]：ref / controlType / absX / absY / w / h）
 *   - 控件文本：Generated/runs/<Target>/dsl.snapshot.json（节点 text）
 *   - 分组表：Generated/_inputs/<Target>.layout-groups.json
 *   - 分组表可引用的条目清单：Generated/_inputs/<Target>.layout-group-candidates.json（转发 lib/layout-candidates.js）
 *   - 画板尺寸与图身份：转发 lib/design-image.js；推导出来的布局：转发 lib/derived-layout.js（判据都在各自那一处）
 *
 * 口径来自插件（mw-wpf-mode.md 第 2 节）：分组表 shape 是
 *   { schemaVersion:"mw-wpf-layout-groups/1", pageTarget:"<Target>",
 *     groups:[{ id:"<组名>", kind:"column"|"row", members:["<ref>", ...] }] }
 * 校验与插件布局推导入口同一套判据：id 非空且不重复、kind 只取 column/row、members 至少 2 个非空 ref、
 * 一个 ref 只能进一个分组、**每个 ref 必须在那份条目清单里**（清单为空＝这一层不参与分组，表里不许声明组）。
 * pageTarget 由本模块写成本次页面（插件那边读到它会核对与本次页面一致，防止把另一页的表套上来）。
 * groups 是空数组也合法 —— 那是「本页没有要声明的分组」（插件那边表在就用它，没表才停），所以空表照写。
 *
 * 读与写都从这里走：/api/layout-groups 的读、/api/confirm 的写、AI 候选的去重（ai.js 用 uniqueMembers）
 * 与 AI 候选的输入（candidatesInput：本层可引用条目 + 本页设计稿位图的 data URL）。
 */

const { UserError } = require("./errors.js");
const workdir = require("./workdir.js");
const derivedLayout = require("./derived-layout.js");
const layoutCandidates = require("./layout-candidates.js");
const atomicWrite = require("./atomic-write.js");
const designImage = require("./design-image.js");
const { requirePageTarget, requireProjectRoot } = require("./name-safety.js");

const GROUPS_SCHEMA = "mw-wpf-layout-groups/1";
const readJsonIfExists = workdir.readJsonIfExists;

/*
 * 分组的规模判据（插件 mw-wpf-mode.md 第 2 节）：一组至少 2 个成员；控件少于 2 个时压根分不出组
 * （AI 不必问、自动通过也不必试）。这两个数只有这一处定义 —— 写回校验、AI 候选清洗、自动通过判据都读它们。
 */
const MIN_MEMBERS = 2;
const MIN_CONTROLS = 2;

// DSL 快照里 ref → 文本：只做「补一个展示用文本」，分组判据不落在这里。
function collectTexts(snapshot) {
  const texts = new Map();
  const walk = function (node) {
    if (!node) return;
    const text = Array.isArray(node.text)
      ? node.text.map(function (part) { return part && typeof part.text === "string" ? part.text : ""; }).join("")
      : "";
    texts.set(String(node.id || ""), text);
    (node.children || []).forEach(walk);
  };
  (snapshot && snapshot.dsl && Array.isArray(snapshot.dsl.nodes) ? snapshot.dsl.nodes : []).forEach(walk);
  return texts;
}

// 控件清单：类型判定产物的 nodes，补上 DSL 里的文本。字段与插件 layout 推导入口读的同一份（ref/controlType/absX/absY/w/h）。
function readControls(projectRoot, target, snapshot) {
  const types = readJsonIfExists(workdir.componentTypesPath(projectRoot, target));
  if (!types || !Array.isArray(types.nodes)) {
    // 这里的产物是**作业A 第 5 步的类型判定表**（不是 B 路线的 mapping 草稿），所以只按 A 的口径说。
    return { available: false, reason: "还没有类型判定产物（流水线尚未跑到第 5 步的类型判定）", controls: [] };
  }
  const texts = collectTexts(snapshot);
  const controls = types.nodes
    .filter(function (node) { return node && node.controlType && node.ref; })
    .map(function (node) {
      const ref = String(node.ref);
      return {
        ref: ref,
        controlType: String(node.controlType),
        text: texts.get(ref) || String(node.sourceText || node.name || ""),
        absX: Number(node.absX || 0),
        absY: Number(node.absY || 0),
        w: Number(node.w || 0),
        h: Number(node.h || 0)
      };
    });
  return { available: true, reason: "", controls: controls };
}

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
  /* 清单还没落下来（这一步还没跑过）：没有「能写哪些 ref」这条事实，就不许写表。 */
  if (!candidates || !candidates.available) {
    throw new UserError(
      "NO_CANDIDATES",
      (candidates && candidates.reason) || layoutCandidates.NO_CANDIDATES_REASON,
      "跑一次作业A 第 8 步（layout）之后再来写这张表。"
    );
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
  if (!candidates || !candidates.available) {
    throw new UserError("NO_CANDIDATES", (candidates && candidates.reason) || layoutCandidates.NO_CANDIDATES_REASON, "");
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
 * 界面把「拖进另一组」做成一次移动（不会写出重复），那是编辑动作，不是第二条校验。
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
 * 布局确认界面要的那一份读数：可编辑的控件清单 + 现在写着的分组，再顺带两样界面要用的尺寸/事实。
 *
 * 画板尺寸与「有没有设计稿位图」都不在这里判 —— 那是 lib/design-image.js 一处的事实（`readCanvas` / `hasImage`），
 * 这里只转发（界面因此不用为画布另取一次 /api/design-image）。
 * hasGroups 是「这一页有没有分组表」（空表也算有）—— 同一次读表顺带给出，待确认停点不再读第二遍；
 * candidates 是这一步的条目清单（转发 lib/layout-candidates.js）：界面据它摆「可引用条目」，写回校验据它挡 ref。
 * canSuggest 是「AI 辅助这个动作现在有没有意义」：这一步是对着设计稿位图判分组（插件 mw-wpf-mode.md 第 2 节），
 * 所以没有位图时不必问模型（没图时分组由机械判据决定）；清单不在（这一步还没跑过）、或这一层的条目少于
 * MIN_CONTROLS（凑不出组）时同样没有意义。判据都在这一处，界面据此禁用那个按钮，不自己再写一遍。
 */
function inspect(query, options) {
  const projectRoot = requireProjectRoot(query && query.projectRoot);
  const target = requirePageTarget(query && query.target);
  /* 同一趟里那份 DSL 快照只读一遍：控件文本与画板尺寸都要它。 */
  const snapshot = readJsonIfExists(workdir.snapshotPath(projectRoot, target));
  const controls = readControls(projectRoot, target, snapshot);
  const groupsDoc = workdir.readLayoutGroups(projectRoot, target);
  const candidates = layoutCandidates.read({ projectRoot: projectRoot, target: target });
  const hasImage = designImage.hasImage({ projectRoot: projectRoot, target: target });
  /* 「这个 ref 在不在本层条目里」的结论由后端一处给（判据在 lib/layout-candidates.js 的 refsOf）：
   * 界面按这面标记分拨，不自己再建一份集合。 */
  const citable = layoutCandidates.refsOf(candidates);
  return {
    available: controls.available,
    reason: controls.reason,
    controls: controls.controls.map(function (control) {
      return Object.assign({}, control, { citable: citable.has(control.ref) });
    }),
    /*
     * 画板尺寸（界面拿它把控件坐标换算成百分比，好把编号画到图上）：
     * 判据只有一处（lib/design-image.js 的 readCanvas 读 DSL 快照根节点），这里只转发。
     */
    canvas: designImage.readCanvas(projectRoot, target, snapshot),
    /*
     * 推导出来的布局（分区 → 组 → 控件）：界面那栏「布局树」显示它；这一步没跑过时 available:false。
     * 只有界面要它 —— 待确认队列与自动补输入那两条路传 withDerived:false（逐页调用，别白读两份产物）。
     */
    derived:
      options && options.withDerived === false
        ? derivedLayout.emptyDerived()
        : derivedLayout.read({ projectRoot: projectRoot, target: target }),
    /*
     * 这一页那张设计稿位图的身份（空串＝没有图）：画布据此决定挂不挂图、给不给「隐藏设计稿」，
     * 并把身份拼进预览地址（换了图地址就变）。判据只有一处（lib/design-image.js 的 imageStamp）。
     */
    imageStamp: designImage.imageStamp({ projectRoot: projectRoot, target: target }),
    candidates: candidates,
    groups: groupsDoc ? groupsDoc.groups : [],
    hasGroups: groupsDoc !== null,
    canSuggest: controls.available && candidates.available && candidates.entries.length >= MIN_CONTROLS && hasImage
  };
}

/*
 * 布局分组这一步喂给模型的输入：**本层可引用的条目** + 本页设计稿位图的 data URL（没有图就是空串）。
 * 只有这一处说「这一步的输入是什么」—— 自动补输入（lib/autofill.js）与人点「AI 出候选」（lib/routes.js）
 * 都拿它去调 ai.suggestLayoutGroups，免得两条路的输入各拼一份、日后走岔。
 * 条目就是插件第 8 步落的那份清单里那几条（插件 Skill 也是让模型「写表前先看它」）：两边看的是同一份。
 * 取图那一处仍是 lib/design-image.js 的 dataUrl（图坏了它抛 BAD_IMAGE，由调用方按自己的处境处置）；
 * 条目不够分组（含清单为空）时不必取图：那一步在模型层也是直接回空。
 * 清单还没落下来时按 NO_CANDIDATES 抛出去（与图坏了同一类：输入自己读不出来，不是模型给不出结果）。
 * 没有位图时按 NO_IMAGE 抛出去：这一步就是看图判分组，没有图就没有可判断的输入（没图时分组由机械判据决定，
 * 插件那侧的契约也是这样 —— 表只在有位图时才要）。
 */
function candidatesInput(query) {
  const candidates = layoutCandidates.read({
    projectRoot: query && query.projectRoot,
    target: query && query.target
  });
  if (!candidates.available) {
    throw new UserError("NO_CANDIDATES", candidates.reason, "跑一次作业A 第 8 步（layout）之后再来问模型。");
  }
  if (!designImage.hasImage({ projectRoot: query && query.projectRoot, target: query && query.target })) {
    throw new UserError(
      "NO_IMAGE",
      "这一步要对着设计稿位图判分组：这一页还没有传图，没有可判断的输入",
      "先在「设计稿位图」那一栏传一张本页的图；这一页没有图时分组由机械判据决定，不必问模型。"
    );
  }
  const image =
    candidates.entries.length < MIN_CONTROLS
      ? ""
      : designImage.dataUrl({ projectRoot: query && query.projectRoot, target: query && query.target });
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

module.exports = { inspect, candidatesInput, save, uniqueMembers, cleanGroups, MIN_MEMBERS, MIN_CONTROLS };
