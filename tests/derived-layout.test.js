#!/usr/bin/env node
"use strict";

// 作业A 第 8 步推出来的布局：产物在不在、字段怎么归一、同层怎么排、摆不进树的从同趟报告取。
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
 * 期望里的一个格子：与界面那侧的夹具（ui/src/lib/layout-fixtures.ts）同形，只是这里用 JS 写。
 * 顺序就是摆的顺序（读视图按产物给的行列排好才出去）；装了子网格的格子带上那一层的行列带
 * （没给就是空表，照「产物没写带」算 —— 与界面那侧夹具的缺省一致）。
 */
function cell(ref, controlType, children, axis, childBands) {
  const kids = children || [];
  const shape = {
    ref: ref,
    group: kids.length > 0,
    axis: axis || "",
    controlType: controlType || "",
    children: kids,
    refs: [ref, ...kids.flatMap(function (item) { return item.refs; })]
  };
  if (kids.length > 0) shape.bands = childBands || { rows: [], columns: [] };
  return shape;
}

function caseNoProduct() {
  const root = sandbox();
  const state = read(root);
  assert.strictEqual(state.available, false, "产物不在就没有可显示的东西");
  assert.match(state.reason, /还没有推导产物/, "给界面一句话照实显示");
  assert.deepStrictEqual(state.regions, []);
  assert.deepStrictEqual(state.unplaced, []);
  assert.deepStrictEqual(state.singles, []);
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
  assert.deepStrictEqual(derivedLayout.emptyDerived(), {
    available: false, reason: "", regions: [], unplaced: [], singles: []
  });
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
            rows: [{ size: "Pixel", value: 1 }, { size: "Star" }],
            columns: [{ size: "Pixel", value: 1 }, { size: "Pixel", value: 2 }, { size: "Star" }],
            cells: [
              { ref: "1:10", controlType: "TextBlock", row: 1, column: 3 },
              { ref: "1:9", controlType: "Camera", row: 1, column: 2 }
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

  // 出去的就是这几样：名字 / 发不发射 / 行带列带 / 格子（同层按行列排好了）。
  assert.deepStrictEqual(state.regions[0], {
    /* 夹具给这两条带写的不是产物的 {size} 形状：认不出 Star，就照实说不吃剩余。 */
    id: "top-strip",
    name: "顶部栏",
    emit: false,
    bands: { rows: [{ star: false }], columns: [{ star: false }] },
    cells: []
  });
  assert.deepStrictEqual(state.regions[1], {
    id: "work-area",
    name: "work-area",
    emit: true,
    /* 带照产物给：size=Star 的那条是吃剩余的（star），其余不是。 */
    bands: {
      rows: [{ star: false }, { star: true }],
      columns: [{ star: false }, { star: false }, { star: true }]
    },
    /* 产物那一列是按位置倒着写的，出去按行列排好了：第 1 行第 2 列在前。 */
    cells: [cell("1:9", "Camera"), cell("1:10", "TextBlock")]
  });
  assert.deepStrictEqual(state.regions[2], {
    id: "no-grid", name: "no-grid", emit: true, bands: { rows: [], columns: [] }, cells: []
  }, "网格缺了就是没有格子");

  fs.rmSync(root, { recursive: true, force: true });
}

/*
 * 格子里还套着格子：子网格照带出去、套几层带几层。
 * 容器那层前缀剥掉交出去（界面不认识它），容器自己列在子网格里的那一条也不重复记；
 * 装了子网格的格子带上自己那一层的行列带（它是界面上的「组」）。
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
                synthAxis: "y",
                children: {
                  rows: [{ size: "Pixel", value: 1 }, { size: "Star" }],
                  columns: [{ size: "Pixel", value: 2 }],
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
    cell("9:1", "", [
      cell("9:2", "IconButton"),
      cell("9:3", "", [cell("9:4", "TextBlock")])
    ], "column", {
      rows: [{ star: false }, { star: true }],
      columns: [{ star: false }]
    })
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}

/*
 * 一格往哪个方向排：合成容器看 synthAxis（y/x），成层的容器看它那一层网格的 owner.direction，
 * 两样都没给就是空串（界面照实说「方向不明」，不拿行列数替它推一个）。
 */
function caseAxis() {
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
              { ref: "synth:a", row: 0, column: 0, synthAxis: "y", children: { cells: [{ ref: "a1", row: 0, column: 0 }] } },
              { ref: "synth:b", row: 0, column: 1, synthAxis: "x", children: { cells: [{ ref: "b1", row: 0, column: 0 }] } },
              {
                ref: "c", row: 0, column: 2,
                children: { owner: { direction: "column" }, cells: [{ ref: "c1", row: 0, column: 0 }] }
              },
              { ref: "d", row: 0, column: 3, children: { cells: [{ ref: "d1", row: 0, column: 0 }] } },
              { ref: "e", row: 1, column: 0 }
            ]
          }
        }
      ]
    }),
    "utf8"
  );
  const directions = read(root).regions[0].cells.map(function (item) { return [item.ref, item.axis]; });
  assert.deepStrictEqual(directions, [
    ["a", "column"],
    ["b", "row"],
    ["c", "column"],
    ["d", ""],
    ["e", ""]
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}

/* 同层先后：行优先、列次之；子网格里那一层也一样。 */
function caseSiblingOrder() {
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
            rows: [1, 1],
            columns: [1, 1],
            cells: [
              { ref: "r2c2", row: 2, column: 2 },
              { ref: "r1c3", row: 1, column: 3 },
              { ref: "r1c1", row: 1, column: 1 },
              {
                ref: "group", row: 3, column: 1,
                children: { cells: [{ ref: "g2", row: 2, column: 1 }, { ref: "g1", row: 1, column: 1 }] }
              }
            ]
          }
        }
      ]
    }),
    "utf8"
  );
  const cells = read(root).regions[0].cells;
  assert.deepStrictEqual(cells.map(function (item) { return item.ref; }), ["r1c1", "r1c3", "r2c2", "group"]);
  assert.deepStrictEqual(cells[3].children.map(function (item) { return item.ref; }), ["g1", "g2"]);
  fs.rmSync(root, { recursive: true, force: true });
}

/*
 * 插件报的单条目栏从同趟报告取：它们在树上有位置，所以另摆一块（不与「摆不进树」混在一起）。
 * 报告不在 / 不是数组 / 字段缺了都只是「没有那几条」。
 */
function caseSingles() {
  const root = sandbox();
  fs.writeFileSync(productFile(root), JSON.stringify({ regions: [] }), "utf8");
  assert.deepStrictEqual(read(root).singles, [], "报告不在就没有单条目栏");

  fs.writeFileSync(reportFile(root), JSON.stringify({ unresolved: "nope" }), "utf8");
  assert.deepStrictEqual(read(root).singles, []);

  fs.writeFileSync(
    reportFile(root),
    JSON.stringify({ unresolved: [{ ref: "1:11", reason: "单条目栏：几何判不出它跟谁同组" }, {}] }),
    "utf8"
  );
  const state = read(root);
  assert.deepStrictEqual(state.singles[0], { ref: "1:11", reason: "单条目栏：几何判不出它跟谁同组" });
  assert.deepStrictEqual(state.singles[1], { ref: "", reason: "" }, "缺字段的照空串给，不自造说法");
  assert.deepStrictEqual(state.unplaced, [], "单条目栏不是「摆不进树」：两件事各说各的");

  fs.rmSync(root, { recursive: true, force: true });
}

/* 报告那条出口也剥容器那层前缀：两路 ref 交给界面时是同一副样子。 */
function caseReportRefStripped() {
  const root = sandbox();
  fs.writeFileSync(productFile(root), JSON.stringify({ regions: [] }), "utf8");
  fs.writeFileSync(
    reportFile(root),
    JSON.stringify({ unresolved: [{ ref: "synth:1872:59913", reason: "单条目栏：几何判不出它跟谁同组" }] }),
    "utf8"
  );
  assert.deepStrictEqual(read(root).singles, [
    { ref: "1872:59913", reason: "单条目栏：几何判不出它跟谁同组" }
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}

/*
 * 一格读不出行列坐标（缺字段 / 空串 / 布尔 / 非整数 / 负数）：不拿一个位置顶上，照「摆不进树」说给界面。
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
  assert.deepStrictEqual(state.regions[0].cells, [cell("1:10", ""), cell("1:9", "")]);
  assert.deepStrictEqual(state.unplaced, [
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

/*
 * 摆不进树的那一格里面还装着控件：它们不能跟着消失，整棵子树照「外面那格没坐标」记出去。
 * 容器自己列在子网格里的那一条不算一格（它的坐标本来就不参与），不跟着变成一条「摆不进树」。
 */
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
                    { ref: "9:3", controlType: "TextBlock", row: 1, column: 0 }
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
  assert.deepStrictEqual(state.unplaced, [
    { ref: "9:1", reason: "推导产物里这一格没有行列坐标" },
    { ref: "9:2", reason: "外面那一格没有行列坐标，里面的控件摆不进树" },
    { ref: "9:3", reason: "外面那一格没有行列坐标，里面的控件摆不进树" }
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}

/*
 * 子网格里的一格读不出坐标：它自己摆不进树（整棵子树照同一原因记出去），
 * 但外面那一层照常摆出来 —— 少的是那一格，不是那一整组。
 */
function caseNestedCellWithoutPosition() {
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
                ref: "group", row: 1, column: 1,
                children: {
                  cells: [
                    { ref: "g1", controlType: "TextBlock", row: 0, column: 0 },
                    {
                      ref: "g2", column: 1,
                      children: { cells: [{ ref: "g3", controlType: "TextBlock", row: 0, column: 0 }] }
                    }
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
  assert.deepStrictEqual(state.regions[0].cells, [
    cell("group", "", [cell("g1", "TextBlock")])
  ]);
  assert.deepStrictEqual(state.unplaced, [
    { ref: "g2", reason: "推导产物里这一格没有行列坐标" },
    { ref: "g3", reason: "外面那一格没有行列坐标，里面的控件摆不进树" }
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}

try {
  const cases = [
    ["这一步还没跑过：说一句原因，不摆空的树", caseNoProduct],
    ["产物在但读不出 regions：按没有算", caseBrokenProduct],
    ["不读产物时的空读数", caseEmptyDerived],
    ["分区与格子归一（只注册 / 缺字段 / 缺网格 / 同层排序）", caseRegions],
    ["格子里还套着格子（子网格照带出去，容器那层前缀剥掉）", caseNestedCells],
    ["一格往哪个方向排照产物给（合成容器与成层容器各一处）", caseAxis],
    ["同层的先后按行列（子网格里那一层也一样）", caseSiblingOrder],
    ["单条目栏从同趟报告取（与「摆不进树」分开）", caseSingles],
    ["报告那条出口也剥容器前缀", caseReportRefStripped],
    ["一格读不出坐标：照「摆不进树」说，不拿一个位置顶上", caseCellWithoutPosition],
    ["摆不进树的容器：里面的控件跟着记出去", caseContainerWithoutPosition],
    ["子网格里的一格读不出坐标：那一格不摆，那一组照常", caseNestedCellWithoutPosition]
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
