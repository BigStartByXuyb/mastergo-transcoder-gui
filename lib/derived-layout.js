"use strict";

/*
 * 「推导出来的布局」这份读视图：作业A 第 8 步推出来的「分区 → 组 → 格子」（组＝分区里的某一行）
 * （Generated/<Target>.wpf-layout.json），加上同一趟报告里的未归宿条目
 * （Generated/_inputs/<Target>.wpf-layout.report.json 的 unresolved：既没进分组表、也没被机械判据收走的散条目）。
 *
 * 只出去界面要看的事实：分区（名字 / 发不发射）、格子（哪个控件在第几行第几列、跨几行几列、
 * 里面还装着哪些控件）、没归宿的那几条（带原因）。原始产物里的网格维度、尺寸定义、约束这些不往界面搬 ——
 * 「这个分区分成哪几组」由界面按格子现算（ui/src/lib/layout-edit.ts 的 groupsOf），只留一处口径。
 * 没归宿的槽里坐两件事：插件标记的散条目（同趟报告的 unresolved），以及产物里那一格读不出行列坐标的
 * （坐标从 1 起，读不出就说读不出，不拿 0 顶上）。两件都是「界面摆不进树」的同一类。
 *
 * 格子可以套格子：一个格子里那份子网格（产物的 children）跟着出去，界面按它把树往下展开一层。
 * 子层的位置不参与分组（它们挂在父格子下），所以子层的坐标不校验 —— 产物那层是从 0 起的。
 * 这一步没跑过（或产物被删）时给 available:false + 一句原因 —— 界面据此不摆空的树。
 *
 * 谁在用：lib/layout-groups.js 的 inspect（界面那栏「布局树」读它；待确认队列那条路不读，见那边的 withDerived）。
 */

const workdir = require("./workdir.js");

const readJsonIfExists = workdir.readJsonIfExists;

/* 一格读不出行列坐标时给界面的原因：措辞只有这一处。 */
const NO_POSITION_REASON = "推导产物里这一格没有行列坐标";
/* 外面那一格读不出坐标、它跟着摆不进树时的原因：措辞同样只有这一处。 */
const OUTER_NO_POSITION_REASON = "外面那一格没有行列坐标，里面的控件摆不进树";
/* 产物把「这一格是个容器」标成在 ref 前面加这个前缀：只认这一处，出去给界面的 ref 一律是剥过的。 */
const SYNTH_PREFIX = "synth:";

/*
 * 产物给的 ref 读成两样：剥掉容器那层标记的 ref，以及它是不是合成出来的容器 —— 前缀只在这里认。
 * 出去给界面的 ref 一律是剥过的（界面不认识前缀，只认 container 这个标记）。
 */
function readRef(value) {
  const raw = String(value || "");
  return raw.indexOf(SYNTH_PREFIX) === 0
    ? { ref: raw.slice(SYNTH_PREFIX.length), container: true }
    : { ref: raw, container: false };
}

/* 不读产物时给同一形状的空读数（调用方按同一套字段用，不用分两支）。 */
function emptyDerived(reason) {
  return { available: false, reason: reason || "", regions: [], unresolved: [] };
}

/*
 * 行列坐标：产物给的**非负整数**才算数 —— 不按「从 1 起」判（同一批页面里就有从 0 起的），
 * 界面只按先后排组、不依赖基准。
 * 其余一律算「读不出」：缺字段、空串（含纯空白）、布尔、非整数、负数 —— 判据只在 positionOf 这一处。
 */
function positionOf(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/* 跨几行几列：没给或给得不合法都按 1 —— 跨度只在这里归一，界面直接用。 */
function spanOf(value) {
  const span = Number(value);
  return Number.isInteger(span) && span >= 1 ? span : 1;
}

/*
 * 一个格子的形状只在这里拼（顶层与子网格同一份契约，界面那侧共用一个类型）。
 * 传了 unplaced 就是顶层格子：带行列（从 1 起），读不出坐标的那几格不进树、按「没归宿」记进 unplaced；
 * 不传就是子网格里的格子：它挂在父格子下、位置不参与分组，所以不带行列。
 */
function cellOf(raw, unplaced) {
  const { ref, container } = readRef(raw && raw.ref);
  const children = cellsOf(raw && raw.children && raw.children.cells, ref, null);
  const shape = {
    ref: ref,
    /* 是不是产物合成出来的容器：树上的「容器」标记按它，界面不必认识那层前缀。 */
    container: container,
    controlType: String((raw && raw.controlType) || ""),
    rowSpan: spanOf(raw && raw.rowSpan),
    columnSpan: spanOf(raw && raw.columnSpan),
    children: children,
    /* 这一格连同它里面装着的全部 ref：界面点它要高亮的就是这些 —— 往下摊平只在这一处做。 */
    refs: [ref, ...children.flatMap(function (child) { return child.refs; })]
  };
  if (!unplaced) return shape;
  const row = positionOf(raw && raw.row);
  const column = positionOf(raw && raw.column);
  if (row === null || column === null) {
    unplaced.push({ ref: ref, reason: NO_POSITION_REASON });
    /* 这一格摆不进树，但它里面那些控件不能跟着消失：整棵子树（refs 去掉自己那一条）按同一原因记出去。 */
    for (const inside of shape.refs.slice(1)) {
      unplaced.push({ ref: inside, reason: OUTER_NO_POSITION_REASON });
    }
    return null;
  }
  return Object.assign(shape, { row: row, column: column });
}

/*
 * 一层格子：顶层（unplaced 是数组）与子网格（null）都走它。
 * parentRef 是外面那一格的 ref —— 产物会把容器自己又列在它的子网格里一条：那一层不重复记，它的孩子并上来。
 */
function cellsOf(list, parentRef, unplaced) {
  const cells = [];
  for (const cell of Array.isArray(list) ? list : []) {
    const built = cellOf(cell, unplaced);
    if (!built) continue;
    if (parentRef && built.ref === parentRef) {
      cells.push(...built.children);
      continue;
    }
    cells.push(built);
  }
  return cells;
}

/* 没归宿那份读数里同一个 ref 只留一条：报告与产物那两条来源可能撞上。 */
function dedupeByRef(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item.ref)) continue;
    seen.add(item.ref);
    out.push(item);
  }
  return out;
}

function read(query) {
  const projectRoot = String((query && query.projectRoot) || "").trim();
  const target = String((query && query.target) || "").trim();
  const doc = readJsonIfExists(workdir.wpfLayoutPath(projectRoot, target));
  if (!doc || !Array.isArray(doc.regions)) {
    return emptyDerived("还没有推导产物：布局那一步跑完之后，这里显示它推出来的「分区 → 组 → 格子」");
  }
  const report = readJsonIfExists(workdir.wpfLayoutReportPath(projectRoot, target));
  const unplaced = [];
  return {
    available: true,
    reason: "",
    regions: doc.regions.map(function (region) {
      const grid = region.grid || {};
      return {
        id: String(region.id || ""),
        name: String(region.name || region.id || ""),
        /* 发不发射：照产物给的算 —— 只有明确写着 false 才标「只注册」，没给这一项按发射算。 */
        emit: region.emit !== false,
        cells: cellsOf(grid.cells, null, unplaced)
      };
    }),
    unresolved: dedupeByRef(
      (report && Array.isArray(report.unresolved) ? report.unresolved : [])
        .map(function (item) {
          return { ref: readRef(item && item.ref).ref, reason: String((item && item.reason) || "") };
        })
        .concat(unplaced)
    )
  };
}

module.exports = { read, emptyDerived };
