"use strict";

/*
 * 「推导出来的布局」这份读视图：作业A 第 8 步按「分区 → 行/列 → 格子」推出来的产物
 * （Generated/<Target>.wpf-layout.json），加上同一趟报告里的未归宿条目
 * （Generated/_inputs/<Target>.wpf-layout.report.json 的 unresolved：既没进分组表、也没被机械判据收走的散条目）。
 *
 * 只出去界面要看的事实：分区（名字 / 发不发射 / 行数列数）、格子（哪个控件在第几行第几列、跨几行几列）、
 * 没归宿的那几条（带插件给的原因）。原始产物里的尺寸定义、约束这些不往界面搬。
 * 这一步没跑过（或产物被删）时给 available:false + 一句原因 —— 界面据此不摆空的树。
 *
 * 谁在用：lib/layout-groups.js 的 inspect（界面那栏「布局树」读它；待确认队列那条路不读，见那边的 withDerived）。
 */

const workdir = require("./workdir.js");

const readJsonIfExists = workdir.readJsonIfExists;

/* 不读产物时给同一形状的空读数（调用方按同一套字段用，不用分两支）。 */
function emptyDerived(reason) {
  return { available: false, reason: reason || "", regions: [], unresolved: [] };
}

function read(query) {
  const projectRoot = String((query && query.projectRoot) || "").trim();
  const target = String((query && query.target) || "").trim();
  const doc = readJsonIfExists(workdir.wpfLayoutPath(projectRoot, target));
  if (!doc || !Array.isArray(doc.regions)) {
    return emptyDerived("还没有推导产物：布局那一步跑完之后，这里显示它推出来的「分区 → 行/列 → 格子」");
  }
  const report = readJsonIfExists(workdir.wpfLayoutReportPath(projectRoot, target));
  return {
    available: true,
    reason: "",
    regions: doc.regions.map(function (region) {
      const grid = region.grid || {};
      return {
        id: String(region.id || ""),
        name: String(region.name || region.id || ""),
        /* 发不发射：框架固定区（顶部栏 / 底部栏）照实标出来，它们是只注册不发射的。 */
        emit: region.emit !== false,
        rows: Array.isArray(grid.rows) ? grid.rows.length : 0,
        columns: Array.isArray(grid.columns) ? grid.columns.length : 0,
        cells: (Array.isArray(grid.cells) ? grid.cells : []).map(function (cell) {
          return {
            ref: String(cell.ref || ""),
            row: Number(cell.row || 0),
            column: Number(cell.column || 0),
            rowSpan: Number(cell.rowSpan || 1),
            columnSpan: Number(cell.columnSpan || 1)
          };
        })
      };
    }),
    unresolved: (report && Array.isArray(report.unresolved) ? report.unresolved : []).map(function (item) {
      return { ref: String(item.ref || ""), reason: String(item.reason || "") };
    })
  };
}

module.exports = { read, emptyDerived };
