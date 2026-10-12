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
              { ref: "1:9", row: 1, column: 2 },
              { ref: "1:10", row: 1, column: 3, rowSpan: 2, columnSpan: 1 }
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

  const strip = state.regions[0];
  assert.strictEqual(strip.name, "顶部栏");
  assert.strictEqual(strip.emit, false, "只注册的分区照实标出来");
  assert.strictEqual(strip.rows, 1);
  assert.strictEqual(strip.columns, 1);

  const area = state.regions[1];
  assert.strictEqual(area.name, "work-area", "没有名字就用 id 当名字");
  assert.strictEqual(area.emit, true, "没写 emit 的按发射算");
  assert.strictEqual(area.rows, 2, "行数列数按网格维度数");
  assert.strictEqual(area.columns, 3);
  assert.deepStrictEqual(area.cells[0], { ref: "1:9", row: 1, column: 2, rowSpan: 1, columnSpan: 1 });
  assert.deepStrictEqual(area.cells[1], { ref: "1:10", row: 1, column: 3, rowSpan: 2, columnSpan: 1 });

  const bare = state.regions[2];
  assert.strictEqual(bare.rows, 0, "网格缺了就是 0 行 0 列，没有格子");
  assert.strictEqual(bare.columns, 0);
  assert.deepStrictEqual(bare.cells, []);

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

try {
  const cases = [
    ["这一步还没跑过：说一句原因，不摆空的树", caseNoProduct],
    ["产物在但读不出 regions：按没有算", caseBrokenProduct],
    ["不读产物时的空读数", caseEmptyDerived],
    ["分区与格子归一（只注册 / 缺字段 / 缺网格）", caseRegions],
    ["没归宿的从同趟报告取", caseUnresolved]
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
