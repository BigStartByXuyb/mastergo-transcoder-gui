"use strict";

/*
 * 「推导出来的布局」这份读视图：作业A 第 8 步推出来的布局（Generated/<Target>.wpf-layout.json）
 * 与同一趟报告（Generated/_inputs/<Target>.wpf-layout.report.json，它那份 unresolved 是插件报的单条目栏）。
 *
 * 出去的是树要用的事实：分区（名字 / 发不发射 / 自己的行带列带），格子（哪个 ref、往哪个方向排、
 * 里面装着谁、它自己那一层网格的行带列带），摆不进树的那几条（带原因）。
 * 原始产物里的尺寸定义、约束这些不往界面搬。
 *
 * 一格装不装别人决定它在界面上是不是「组」：有子网格就是一个组，界面按 children 往下展开一层。
 * 组的排版方向照产物给（axisOf：合成容器看 synthAxis，成层的容器看它那一层网格的 owner.direction），
 * 产物两样都没给就是空串 —— 界面照实说「方向不明」，不拿行列数替它推一个。
 * 同层格子的先后按产物给的行列排（行优先、列次之）：产物里那一列不是按位置写的；坐标只用来定这个先后，
 * 不往界面搬（界面按给好的顺序摆）。
 *
 * 树之外还有两份读数，各说各的事（界面也分开摆）：
 *   unplaced —— 界面摆不进树的那几条：产物里那一格读不出行列坐标（连它里面那些控件一起）。
 *   singles —— 插件那一步报的单条目栏（没进任何组）：它们在树上有位置，report 那句原话照给界面。
 * 这一步没跑过（或产物被删）时给 available:false + 一句原因 —— 界面据此不摆空的树。
 *
 * 谁在用：lib/layout-groups.js 的 inspect（界面那栏「布局树」读它）。
 */

const workdir = require("./workdir.js");

const readJsonIfExists = workdir.readJsonIfExists;

/* 一格读不出行列坐标时给界面的原因：措辞只有这一处。 */
const NO_POSITION_REASON = "推导产物里这一格没有行列坐标";
/* 外面那一格读不出坐标、里面那些控件跟着摆不进树时的原因：措辞同样只有这一处。 */
const OUTER_NO_POSITION_REASON = "外面那一格没有行列坐标，里面的控件摆不进树";
/*
 * 产物把「这一格是合成出来的容器」标成在 ref 前面加这个前缀：只认这一处。
 * 它只用来认出「容器自己又列在它的子网格里」那一条（剥掉前缀两边才比得上），出去给界面的 ref 一律是剥过的。
 */
const SYNTH_PREFIX = "synth:";

/* 产物的 ref 读成界面认的那个 ref：合成容器那层前缀只在这里剥。 */
function plainRef(value) {
  const raw = String(value || "");
  return raw.indexOf(SYNTH_PREFIX) === 0 ? raw.slice(SYNTH_PREFIX.length) : raw;
}

/* 不读产物时给同一形状的空读数（调用方按同一套字段用，不用分两支）。 */
function emptyDerived(reason) {
  return { available: false, reason: reason || "", regions: [], unplaced: [], singles: [] };
}

/*
 * 行列坐标：产物给的**非负整数**才算数 —— 不按「从 1 起」判（同一批页面里就有从 0 起的），
 * 同层的先后只按它比大小，界面不依赖基准。
 * 其余一律算「读不出」：缺字段、空串（含纯空白）、数字串、布尔、非整数、负数 —— 判据只在 positionOf 这一处。
 */
function positionOf(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/*
 * 一格往哪个方向排（界面把它念成「垂直布局 / 水平布局」）：
 *   合成容器看 synthAxis（y = 上下排、x = 左右排）；
 *   成层的容器看它那一层网格的 owner.direction（column = 上下排、row = 左右排）；
 * 两样都没给就是空串。
 */
function axisOf(raw) {
  const synth = String((raw && raw.synthAxis) || "");
  if (synth === "y") return "column";
  if (synth === "x") return "row";
  const owner = (raw && raw.children && raw.children.owner) || null;
  const direction = String((owner && owner.direction) || "");
  return direction === "column" || direction === "row" ? direction : "";
}

/* 一层网格的带：产物给 size=Star 的是吃剩余的那一条。界面据它在行/列上标 *，像素值不往界面搬。 */
function bandsOf(list) {
  return (Array.isArray(list) ? list : []).map(function (band) {
    return { star: String((band && band.size) || "") === "Star" };
  });
}

/* 一层网格的行列带：分区与「装了子网格的格子」各有自己的一份，界面据此说明谁吃剩余。 */
function gridBandsOf(grid) {
  return { rows: bandsOf(grid && grid.rows), columns: bandsOf(grid && grid.columns) };
}

/*
 * 一格在它那一层里的位置（产物给的行列）：读不出坐标的排到最后（它反正也摆不进树，顺序不影响谁）。
 */
function orderOf(raw) {
  const row = positionOf(raw && raw.row);
  const column = positionOf(raw && raw.column);
  return row === null || column === null ? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] : [row, column];
}

/* 同层格子的先后：行优先、列次之。 */
function byPosition(left, right) {
  const one = orderOf(left);
  const other = orderOf(right);
  return one[0] - other[0] || one[1] - other[1];
}

/*
 * 一个格子的形状只在这里拼（顶层与子网格同一份契约）：
 *   children —— 这一格自己那份子网格里的格子（有子网格的格子就是界面上的「组」，空的就没有这一层）；
 *   bands —— 那一层网格的行列带（没有子网格时不给）；
 *   refs —— 这一格连同它里面装着的全部 ref（界面点它要高亮的就是这些，往下摊平只在这一处做）。
 * 行列坐标读不出的那一格不进树：按「摆不进树」记出去，它里面那些控件跟着记（整棵子树都不摆）。
 */
function cellOf(raw, unplaced) {
  const ref = plainRef(raw && raw.ref);
  const grid = (raw && raw.children) || null;
  const children = cellsOf(grid && grid.cells, ref, unplaced);
  const row = positionOf(raw && raw.row);
  const column = positionOf(raw && raw.column);
  const refs = [ref, ...children.flatMap(function (child) { return child.refs; })];
  if (row === null || column === null) {
    unplaced.push({ ref: ref, reason: NO_POSITION_REASON });
    /* 这一格摆不进树，但它里面那些控件不能跟着消失：整棵子树（refs 去掉自己那一条）按同一原因记出去。 */
    for (const inside of refs.slice(1)) {
      unplaced.push({ ref: inside, reason: OUTER_NO_POSITION_REASON });
    }
    return null;
  }
  const shape = {
    ref: ref,
    /* 这一格是不是一组：有子网格就是（界面按它摆组行还是控件行，不自己再判一遍）。 */
    group: children.length > 0,
    axis: axisOf(raw),
    controlType: String((raw && raw.controlType) || ""),
    children: children,
    refs: refs
  };
  /* 组那一层的行列带跟着出去（谁吃剩余写在组那一行）。 */
  if (shape.group) shape.bands = gridBandsOf(grid);
  return shape;
}

/*
 * 一层格子：顶层与子网格都走它。parentRef 是外面那一格的 ref —— 产物会把容器自己又列在它的子网格里一条：
 * 那一条不重复记，它的孩子并上来（剥掉前缀之后两边才比得上；它自己那份坐标不算数，摆哪由外面那一格定）。
 * 拼之前先按行列排一遍（产物那一列不是按位置写的）；坐标只用来定这个先后，不往界面搬 ——
 * 界面按给好的顺序摆，不看坐标。
 */
function cellsOf(list, parentRef, unplaced) {
  const cells = [];
  for (const cell of (Array.isArray(list) ? list : []).slice().sort(byPosition)) {
    if (parentRef && plainRef(cell && cell.ref) === parentRef) {
      cells.push(...cellsOf((cell && cell.children && cell.children.cells), parentRef, unplaced));
      continue;
    }
    const built = cellOf(cell, unplaced);
    if (!built) continue;
    cells.push(built);
  }
  return cells;
}

/*
 * 摆不进树那份读数里同一个 ref 只留一条：一个格子可能自己没坐标，又被外面那一格连累报一次；
 * 留先报的那一条（先碰到的那一格自己的原因）。先报后报由 cellOf 的走法定：先算里面、再报外面那一格。
 */
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
    return emptyDerived("还没有推导产物：布局那一步跑完之后，这里显示它推出来的「分区 → 组 → 控件」");
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
        /* 这一层的行列带：界面据它在分区那一行上说明谁吃剩余（*）。 */
        bands: gridBandsOf(grid),
        cells: cellsOf(grid.cells, null, unplaced)
      };
    }),
    /* 界面摆不进树的那几条（产物里读不出坐标的格子，连它里面那些控件一起）。 */
    unplaced: dedupeByRef(unplaced),
    /* 插件那一步报的单条目栏：reason 照它的原话说，界面不另拟一句；同一个 ref 只列一条。 */
    singles: dedupeByRef(
      (report && Array.isArray(report.unresolved) ? report.unresolved : []).map(function (item) {
        return { ref: plainRef(item && item.ref), reason: String((item && item.reason) || "") };
      })
    )
  };
}

module.exports = { read, emptyDerived };
