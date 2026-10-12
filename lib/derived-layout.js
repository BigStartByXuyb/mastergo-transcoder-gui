"use strict";

/*
 * 「推导出来的布局」这份读视图：作业A 第 8 步按「分区 → 行/列 → 格子」推出来的产物
 * （Generated/<Target>.wpf-layout.json），加上同一趟报告里的未归宿条目
 * （Generated/_inputs/<Target>.wpf-layout.report.json 的 unresolved：既没进分组表、也没被机械判据收走的散条目）。
 *
 * 只出去界面要看的事实：分区（名字 / 发不发射）、格子（哪个控件在第几行第几列、跨几行几列、
 * 里面还装着哪些控件）、没归宿的那几条（带原因）。原始产物里的网格维度、尺寸定义、约束这些不往界面搬 ——
 * 「这个分区有哪几行」由界面按格子现算（ui/src/lib/layout-edit.ts 的 rowsOfRegion），只留一处口径。
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
const NO_POSITION_REASON = "推导产物里这一格没有行列坐标（坐标从 1 起）";

/* 不读产物时给同一形状的空读数（调用方按同一套字段用，不用分两支）。 */
function emptyDerived(reason) {
  return { available: false, reason: reason || "", regions: [], unresolved: [] };
}

/* 行列坐标：从 1 起的整数才算数，读不出给 null（缺字段与给得不合法同一种）。 */
function positionOf(value) {
  const at = Number(value);
  return Number.isInteger(at) && at >= 1 ? at : null;
}

/* 跨几行几列：没给或给得不合法都按 1 —— 跨度只在这里归一，界面直接用。 */
function spanOf(value) {
  const span = Number(value);
  return Number.isInteger(span) && span >= 1 ? span : 1;
}

/* 一个分区的格子：坐标读不出的那几格不进树，按「没归宿」记（unplaced 由调用方汇总）。 */
function cellsOf(grid, unplaced) {
  const raw = Array.isArray(grid.cells) ? grid.cells : [];
  const cells = [];
  for (const cell of raw) {
    const ref = String((cell && cell.ref) || "");
    const row = positionOf(cell && cell.row);
    const column = positionOf(cell && cell.column);
    if (row === null || column === null) {
      unplaced.push({ ref: ref, reason: NO_POSITION_REASON });
      continue;
    }
    cells.push({
      ref: ref,
      controlType: String((cell && cell.controlType) || ""),
      row: row,
      column: column,
      rowSpan: spanOf(cell && cell.rowSpan),
      columnSpan: spanOf(cell && cell.columnSpan),
      children: childCellsOf(cell && cell.children && cell.children.cells)
    });
  }
  return cells;
}

/* 格子里的子网格（可以再套）：位置不参与分组，坐标照产物带出来、不校验。 */
function childCellsOf(list) {
  return (Array.isArray(list) ? list : []).map(function (cell) {
    return {
      ref: String((cell && cell.ref) || ""),
      controlType: String((cell && cell.controlType) || ""),
      row: Number((cell && cell.row) || 0),
      column: Number((cell && cell.column) || 0),
      rowSpan: spanOf(cell && cell.rowSpan),
      columnSpan: spanOf(cell && cell.columnSpan),
      children: childCellsOf(cell && cell.children && cell.children.cells)
    };
  });
}

function read(query) {
  const projectRoot = String((query && query.projectRoot) || "").trim();
  const target = String((query && query.target) || "").trim();
  const doc = readJsonIfExists(workdir.wpfLayoutPath(projectRoot, target));
  if (!doc || !Array.isArray(doc.regions)) {
    return emptyDerived("还没有推导产物：布局那一步跑完之后，这里显示它推出来的「分区 → 行/列 → 格子」");
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
        cells: cellsOf(grid, unplaced)
      };
    }),
    unresolved: (report && Array.isArray(report.unresolved) ? report.unresolved : [])
      .map(function (item) {
        return { ref: String(item.ref || ""), reason: String(item.reason || "") };
      })
      .concat(unplaced)
  };
}

module.exports = { read, emptyDerived };
