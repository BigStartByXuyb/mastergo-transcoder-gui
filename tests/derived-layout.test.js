#!/usr/bin/env node
"use strict";

// 作业A 第 8 步推出来的布局：产物在不在、字段怎么归一、没归宿的从同趟报告取。
// 跑法：node tests/derived-layout.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const derivedLayout = require("../lib/derived-layout.js");

const TARGET = "DemoPage";

/* 一份最小工程：Generated/ 与 Generated/_inputs/ 两个目录。 */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-derived-layout-"));
  fs.mkdirSync(path.join(root, "Generated", "_inputs"), { recursive: true });
  return root;
}

function productFile(root) {
  return path.join(root, "Generated", TARGET + ".wpf-layout.json");
}

function reportFile(root) {
  return path.join(root, "Generated", "_inputs", TARGET + ".wpf-layout.report.json");
}

function read(root) {
  return derivedLayout.read({ projectRoot: root, target: TARGET });
}

/*
 * 期望里的一个顶层格子：与界面那侧的夹具（ui/src/lib/layout-fixtures.ts）同形，只是这里用 JS 写。
 * 顶层带行列，产物之外的那几样（类型 / 子网格 / 容器标记）缺省时是空串、空表与 false。
 */
function cell(ref, controlType, row, column, rowSpan, columnSpan, children, container) {
  const kids = children || [];
  return {
    ref: ref,
    container: Boolean(container),
    controlType: controlType || "",
    row: row,
    column: column,
    rowSpan: rowSpan === undefined ? 1 : rowSpan,
    columnSpan: columnSpan === undefined ? 1 : columnSpan,
    children: kids,
    refs: [ref, ...kids.flatMap((item) => item.refs)]
  };
}

/* 期望里的一个子格子：它挂在父格子下，不带行列。 */
function child(ref, controlType, rowSpan, columnSpan, children, container) {
  const kids = children || [];
  return {
    ref: ref,
    container: Boolean(container),
    controlType: controlType || "",
    rowSpan: rowSpan === undefined ? 1 : rowSpan,
    columnSpan: columnSpan === undefined ? 1 : columnSpan,
    children: kids,
    refs: [ref, ...kids.flatMap((item) => item.refs)]
  };
}

function caseNoProduct() {
  const root = sandbox();
  const state = read(root);
  assert.strictEqual(state.available, false, "产物不在就没有可显示的东西");
  assert.match(state.reason, /还没有推导产物/, "给界面一句话照实显示");
  assert.deepStrictEqual(state.regions, []);
  assert.deepStrictEqual(state.unresolved, []);
  fs.rmSync(root, { recursive: true, force: true });
}

/* 产物在但读不出 regions（写坏 / 只写了一半）：照「还没有推导产物」说，不摆一棵半截的树。 */
function caseBrokenProduct() {
  const root = sandbox();
  fs.writeFileSync(productFile(root), "{ 这不是 JSON", "utf8");
  assert.strictEqual(read(root).available, false);

  fs.writeFileSync(productFile(root), JSON.stringify({ pageTarget: TARGET }), "utf8");
  const state = read(root);
  assert.strictEqual(state.available, false, "没有 regions 的产物按没有算");
  assert.match(state.reason, /还没有推导产物/);
  fs.rmSync(root, { recursive: true, force: true });
}

/* 不读产物时给的空读数与「读不到产物」同形：调用方按同一套字段用，不分两支。 */
function caseEmptyDerived() {
  assert.deepStrictEqual(derivedLayout.emptyDerived(), { available: false, reason: "", regions: [], unresolved: [] });
  assert.strictEqual(derivedLayout.emptyDerived("还没跑").reason, "还没跑");
}

function caseRegions() {
  const root = sandbox();
  fs.writeFileSync(
    productFile(root),
    JSON.stringify({
      pageTarget: TARGET,
      regions: [
        { id: "top-strip", name: "顶部栏", emit: false, grid: { rows: [1], columns: [1], cells: [] } },
        {
          id: "work-area",
          grid: {
            rows: [1, 2],
            columns: [1, 2, 3],
            cells: [
              { ref: "1:9", controlType: "Camera", row: 1, column: 2 },
              { ref: "1:10", controlType: "TextBlock", row: 1, column: 3, rowSpan: 2, columnSpan: 1 }
            ]
          }
        },
        { id: "no-grid" }
      ]
    }),
    "utf8"
  );
  const state = read(root);
  assert.strictEqual(state.available, true);
  assert.strictEqual(state.reason, "");

  // 出去的就是这几样：名字 / 发不发射 / 格子；网格维度不往界面搬（有哪几行由界面按格子现算）。
  assert.deepStrictEqual(state.regions[0], { id: "top-strip", name: "顶部栏", emit: false, cells: [] });
  assert.deepStrictEqual(state.regions[1], {
    id: "work-area",
    name: "work-area",
    emit: true,
    cells: [cell("1:9", "Camera", 1, 2), cell("1:10", "TextBlock", 1, 3, 2, 1)]
  });
  assert.deepStrictEqual(state.regions[2], { id: "no-grid", name: "no-grid", emit: true, cells: [] }, "网格缺了就是没有格子");

  fs.rmSync(root, { recursive: true, force: true });
}

/*
 * 格子里还套着格子：子网格照带出去、套几层带几层（子层挂在父格子下，不带行列）。
 * 容器那层标记剥掉交出去（界面不认识它），容器自己列在子网格里的那一条也不重复记。
 */
function caseNestedCells() {
  const root = sandbox();
  fs.writeFileSync(
    productFile(root),
    JSON.stringify({
      regions: [
        {
          id: "work-area",
          name: "工作区",
          emit: true,
          grid: {
            rows: [1],
            columns: [1],
            cells: [
              {
                ref: "synth:9:1",
                row: 1,
                column: 1,
                children: {
                  cells: [
                    /* 容器自己那一条：不重复记，它的孩子并上来。 */
                    { ref: "9:1", row: 0, column: 0 },
                    { ref: "9:2", controlType: "IconButton", row: 0, column: 0 },
                    { ref: "9:3", row: 1, column: 0, children: { cells: [{ ref: "9:4", controlType: "TextBlock", row: 0, column: 0 }] } }
                  ]
                }
              }
            ]
          }
        }
      ]
    }),
    "utf8"
  );
  assert.deepStrictEqual(read(root).regions[0].cells, [
    cell("9:1", "", 1, 1, 1, 1, [
      child("9:2", "IconButton"),
      child("9:3", "", 1, 1, [child("9:4", "TextBlock")])
    ], true)
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}

/* 没归宿的几条从同趟报告取：报告不在 / 不是数组 / 字段缺了都只是「没有那几条」。 */
function caseUnresolved() {
  const root = sandbox();
  fs.writeFileSync(productFile(root), JSON.stringify({ regions: [] }), "utf8");
  assert.deepStrictEqual(read(root).unresolved, [], "报告不在就没有没归宿的");

  fs.writeFileSync(reportFile(root), JSON.stringify({ unresolved: "nope" }), "utf8");
  assert.deepStrictEqual(read(root).unresolved, []);

  fs.writeFileSync(
    reportFile(root),
    JSON.stringify({ unresolved: [{ ref: "1:11", reason: "单条目栏：几何判不出它跟谁同组" }, {}] }),
    "utf8"
  );
  const state = read(root);
  assert.deepStrictEqual(state.unresolved[0], { ref: "1:11", reason: "单条目栏：几何判不出它跟谁同组" });
  assert.deepStrictEqual(state.unresolved[1], { ref: "", reason: "" }, "缺字段的照空串给，不自造说法");

  fs.rmSync(root, { recursive: true, force: true });
}

/* 报告那条出口也剥容器那层标记：两路 ref 交给界面时是同一副样子。 */
function caseReportRefStripped() {
  const root = sandbox();
  fs.writeFileSync(productFile(root), JSON.stringify({ regions: [] }), "utf8");
  fs.writeFileSync(
    reportFile(root),
    JSON.stringify({ unresolved: [{ ref: "synth:1872:59913", reason: "单条目栏：几何判不出它跟谁同组" }] }),
    "utf8"
  );
  assert.deepStrictEqual(read(root).unresolved, [
    { ref: "1872:59913", reason: "单条目栏：几何判不出它跟谁同组" }
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}

/*
 * 一格读不出行列坐标（缺字段 / 空串 / 布尔 / 非整数 / 负数）：不拿一个位置顶上，照「没归宿」说给界面。
 * 注意「0 起」不是读不出 —— 产物那侧有从 0 起也有从 1 起的，非负整数都算数。
 */
function caseCellWithoutPosition() {
  const root = sandbox();
  fs.writeFileSync(
    productFile(root),
    JSON.stringify({
      regions: [
        {
          id: "work-area",
          name: "工作区",
          emit: true,
          grid: {
            rows: [1],
            columns: [1],
            cells: [
              { ref: "1:9", row: 1, column: 1 },
              { ref: "1:10", row: 0, column: 0 },
              { ref: "1:11", column: 2 },
              { ref: "1:12", row: "x", column: "y" },
              { ref: "1:13", row: null, column: null },
              { ref: "1:14", row: "", column: "" },
              /* 布尔假值、纯空白串、负数、非整数都不是坐标（Number 会把前两个折成 0，负数与小数会照抄）。 */
              { ref: "1:15", row: false, column: false },
              { ref: "1:16", row: " ", column: " " },
              { ref: "1:17", row: -1, column: -1 },
              { ref: "1:18", row: 0.5, column: 0.5 }
            ]
          }
        }
      ]
    }),
    "utf8"
  );
  const state = read(root);
  assert.deepStrictEqual(state.regions[0].cells, [cell("1:9", "", 1, 1), cell("1:10", "", 0, 0)]);
  assert.deepStrictEqual(state.unresolved, [
    { ref: "1:11", reason: "推导产物里这一格没有行列坐标" },
    { ref: "1:12", reason: "推导产物里这一格没有行列坐标" },
    { ref: "1:13", reason: "推导产物里这一格没有行列坐标" },
    { ref: "1:14", reason: "推导产物里这一格没有行列坐标" },
    { ref: "1:15", reason: "推导产物里这一格没有行列坐标" },
    { ref: "1:16", reason: "推导产物里这一格没有行列坐标" },
    { ref: "1:17", reason: "推导产物里这一格没有行列坐标" },
    { ref: "1:18", reason: "推导产物里这一格没有行列坐标" }
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}

/* 摆不进树的那一格里面还装着控件：它们不能跟着消失，整棵子树照「外面那格没坐标」记出去。 */
function caseContainerWithoutPosition() {
  const root = sandbox();
  fs.writeFileSync(
    productFile(root),
    JSON.stringify({
      regions: [
        {
          id: "work-area",
          name: "工作区",
          emit: true,
          grid: {
            rows: [1],
            columns: [1],
            cells: [
              {
                ref: "synth:9:1",
                children: {
                  cells: [
                    /* 容器自己那一条：不重复记。 */
                    { ref: "9:1" },
                    { ref: "9:2", controlType: "IconButton", row: 0, column: 0 },
                    { ref: "9:3" }
                  ]
                }
              }
            ]
          }
        }
      ]
    }),
    "utf8"
  );
  const state = read(root);
  assert.deepStrictEqual(state.regions[0].cells, []);
  assert.deepStrictEqual(state.unresolved, [
    { ref: "9:1", reason: "推导产物里这一格没有行列坐标" },
    { ref: "9:2", reason: "外面那一格没有行列坐标，里面的控件摆不进树" },
    { ref: "9:3", reason: "外面那一格没有行列坐标，里面的控件摆不进树" }
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}

/* 跨度：没给或给得不合法都按 1 —— 跨度只在这一处归一，界面直接用。 */
function caseSpans() {
  const root = sandbox();
  fs.writeFileSync(
    productFile(root),
    JSON.stringify({
      regions: [
        {
          id: "work-area",
          name: "工作区",
          emit: true,
          grid: {
            rows: [1],
            columns: [1],
            cells: [
              { ref: "1:9", row: 1, column: 1, rowSpan: 0, columnSpan: -2 },
              { ref: "1:10", row: 2, column: 1, rowSpan: 2, columnSpan: 3 },
              /* 数字串与布尔不算数（与坐标同一条类型口径）。 */
              { ref: "1:11", row: 3, column: 1, rowSpan: "2", columnSpan: true }
            ]
          }
        }
      ]
    }),
    "utf8"
  );
  assert.deepStrictEqual(read(root).regions[0].cells, [
    cell("1:9", "", 1, 1),
    cell("1:10", "", 2, 1, 2, 3),
    cell("1:11", "", 3, 1)
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}

try {
  const cases = [
    ["这一步还没跑过：说一句原因，不摆空的树", caseNoProduct],
    ["产物在但读不出 regions：按没有算", caseBrokenProduct],
    ["不读产物时的空读数", caseEmptyDerived],
    ["分区与格子归一（只注册 / 缺字段 / 缺网格）", caseRegions],
    ["格子里还套着格子（子网格照带出去）", caseNestedCells],
    ["没归宿的从同趟报告取", caseUnresolved],
    ["报告那条出口也剥容器标记", caseReportRefStripped],
    ["一格读不出坐标：照「没归宿」说，不拿一个位置顶上", caseCellWithoutPosition],
    ["摆不进树的容器：里面的控件跟着记出去", caseContainerWithoutPosition],
    ["跨度按至少 1 归一", caseSpans]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("derived-layout.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
