#!/usr/bin/env node
"use strict";

// 布局确认：读控件清单 + 分组表，写回分组表。
// 跑法：node tests/layout-groups.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const layout = require("../lib/layout-groups.js");
const { png } = require("./image-fixtures.js");

const TARGET = "DemoPage";

/* 本文件建的沙盒目录：用例自己建，main 跑完一起收掉。 */
const sandboxes = [];

/* 最小工程：类型判定产物 + DSL 快照（文本）+ _inputs 目录。 */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-layout-groups-"));
  sandboxes.push(root);
  const generated = path.join(root, "Generated");
  const runs = path.join(generated, "runs", TARGET);
  const inputs = path.join(generated, "_inputs");
  fs.mkdirSync(runs, { recursive: true });
  fs.mkdirSync(inputs, { recursive: true });
  fs.writeFileSync(
    path.join(generated, TARGET + ".component-types.json"),
    JSON.stringify({
      nodes: [
        { ref: "a", controlType: "IconButton", absX: 100, absY: 200, w: 120, h: 60 },
        { ref: "b", controlType: "IconButton", absX: 260, absY: 200, w: 120, h: 60 },
        { ref: "c", controlType: "TextBlock", absX: 100, absY: 300, w: 200, h: 20 }
      ]
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runs, "dsl.snapshot.json"),
    JSON.stringify({
      dsl: {
        nodes: [
          {
            type: "FRAME", id: "root", layoutStyle: { width: 1280, height: 1024 },
            flexContainerInfo: { flexDirection: "column" },
            children: [
              {
                type: "FRAME", id: "row", layoutStyle: { width: 300, height: 80 },
                flexContainerInfo: { flexDirection: "row" },
                children: [
                  { type: "INSTANCE", id: "a", text: [{ text: "A" }] },
                  { type: "INSTANCE", id: "b", text: [{ text: "B" }] }
                ]
              },
              { type: "TEXT", id: "c", text: [{ text: "C" }] }
            ]
          }
        ]
      }
    }),
    "utf8"
  );
  /* 分组表可引用的条目清单（作业A 第 8 步的产物）：默认把它写成与控件清单同一拨条目。 */
  writeCandidates(root, [
    { ref: "a", controlType: "IconButton", text: "A" },
    { ref: "b", controlType: "IconButton", text: "B" },
    { ref: "c", controlType: "TextBlock", text: "C" }
  ]);
  return root;
}

/* 把条目清单写进沙盒（传 null 就是「这一步还没跑过」）。 */
function writeCandidates(root, entries) {
  const file = path.join(root, "Generated", "_inputs", TARGET + ".layout-group-candidates.json");
  if (entries === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: "mw-wpf-layout-group-candidates/1",
      pageTarget: TARGET,
      source: { dslPath: "", dslSha256: "" },
      entries: entries
    }),
    "utf8"
  );
}

/* 写一张本页的设计稿位图（尺寸与快照的画板一致）：这一步是看图判分组，没有图就不问模型。 */
function writeImage(root) {
  fs.writeFileSync(path.join(root, "Generated", "_inputs", TARGET + ".design.png"), png(1280, 1024));
}

function main() {
  // 读控件清单 + 补文本。
  {
    const root = sandbox();
    const info = layout.inspect({ projectRoot: root, target: TARGET });
    assert.strictEqual(info.available, true);
    assert.strictEqual(info.controls.length, 3);
    assert.strictEqual(info.controls[0].ref, "a");
    assert.strictEqual(info.controls[0].text, "A");
    assert.strictEqual(info.controls[2].text, "C");
    /* 「这个 ref 在不在本层条目里」的结论由后端一处给（判据在 lib/layout-candidates.js 的 refsOf）。 */
    assert.deepStrictEqual(info.controls.map(function (item) { return [item.ref, item.citable]; }), [
      ["a", true],
      ["b", true],
      ["c", true]
    ]);
    assert.deepStrictEqual(info.groups, []);
    // 读图状态不在这里（lib/design-image.js 一处）；hasGroups 与 canSuggest 都由后端给
    // （hasGroups 与 tables 同一次读，界面照 canSuggest 禁用「AI 辅助」）。
    // canvas 是画板尺寸（界面拿它把控件坐标换算成百分比，把编号画到图上），判据仍在 design-image 那一处。
    assert.deepStrictEqual(Object.keys(info).sort(), ["available", "candidates", "canvas", "controls", "derived", "groups", "hasGroups", "hasImage", "imageStamp", "reason", "suggest"]);
    assert.deepStrictEqual(info.canvas, { width: 1280, height: 1024 }, "画板尺寸取 DSL 快照根节点");
    assert.strictEqual(info.imageStamp, "", "还没传图：图的身份是空串（判据在 lib/design-image.js 的 imageStamp）");
    // 推导结果（布局那一步的产物）这一份工程里还没有：只给一句原因，界面据此不摆空的树。
    assert.strictEqual(info.derived.available, false);
    assert.match(info.derived.reason, /布局那一步跑完/);
    assert.deepStrictEqual(info.derived.regions, []);
    assert.deepStrictEqual(info.derived.unplaced, []);
    assert.deepStrictEqual(info.derived.singles, []);
    assert.strictEqual(info.suggest.ready, false, "还没传图：这一步是看图判分组，不必问模型");
    assert.strictEqual(info.hasGroups, false, "还没写过分组表");
    assert.deepStrictEqual(
      info.candidates,
      {
        available: true,
        reason: "",
        pageTarget: TARGET,
        entries: [
          { ref: "a", controlType: "IconButton", text: "A" },
          { ref: "b", controlType: "IconButton", text: "B" },
          { ref: "c", controlType: "TextBlock", text: "C" }
        ]
      },
      "条目清单照产物给（ref / 类型 / 文本）"
    );
    /* 传上图之后：这一层的条目够分组，才谈得上问模型（两个条件缺一不可）。 */
    writeImage(root);
    assert.strictEqual(layout.inspect({ projectRoot: root, target: TARGET }).suggest.ready, true, "有图 + 条目够 = 可以问模型");
  }

  /*
   * 这一步还没跑过（清单不在）：读数说清是哪一件事、canSuggest 关掉；这时不许写表
   * （没有「能写哪些 ref」这条事实），空表也不行 —— 表是给人确认的结论，不是猜的。
   */
  {
    const root = sandbox();
    writeCandidates(root, null);
    const info = layout.inspect({ projectRoot: root, target: TARGET });
    assert.strictEqual(info.candidates.available, false);
    assert.match(info.candidates.reason, /还没有这一步的条目清单/);
    assert.deepStrictEqual(info.candidates.entries, []);
    assert.strictEqual(info.suggest.ready, false, "清单不在就不必问模型");
    assert.throws(
      () => layout.save({ projectRoot: root, target: TARGET, groups: [] }),
      /还没有这一步的条目清单/
    );
    assert.strictEqual(
      fs.existsSync(path.join(root, "Generated", "_inputs", TARGET + ".layout-groups.json")),
      false,
      "被拒的表不落盘"
    );
  }

  /* 清单为空＝这一层不参与分组：唯一合法的表是空表；声明了组就按同一个理由拒。 */
  {
    const root = sandbox();
    writeCandidates(root, []);
    const info = layout.inspect({ projectRoot: root, target: TARGET });
    assert.strictEqual(info.candidates.available, true);
    assert.deepStrictEqual(info.candidates.entries, []);
    assert.strictEqual(info.suggest.ready, false, "这一层凑不出组");
    assert.throws(
      () => layout.save({ projectRoot: root, target: TARGET, groups: [{ id: "g1", kind: "column", members: ["a", "b"] }] }),
      /这一层的条目清单是空的（这一层不参与分组）：表里不声明任何组/
    );
    assert.strictEqual(layout.save({ projectRoot: root, target: TARGET, groups: [] }).count, 0, "空表照写");
  }

  /* 表里的 ref 必须在这一层的条目里：清单外的那条（例如别层的控件）当场拒，原话与插件一致。 */
  {
    const root = sandbox();
    writeCandidates(root, [{ ref: "a", controlType: "IconButton", text: "A" }, { ref: "b", controlType: "IconButton", text: "B" }]);
    /* 清单只有 a、b：c 不在本层条目里，读数里它的 citable 是 false（界面据此不让拖）。 */
    const info = layout.inspect({ projectRoot: root, target: TARGET });
    assert.deepStrictEqual(info.controls.map(function (item) { return [item.ref, item.citable]; }), [
      ["a", true],
      ["b", true],
      ["c", false]
    ]);
    assert.throws(
      () => layout.save({ projectRoot: root, target: TARGET, groups: [{ id: "g1", kind: "column", members: ["a", "c"] }] }),
      /分组 g1 的 ref 不在本层条目里: c/
    );
    assert.strictEqual(
      layout.save({ projectRoot: root, target: TARGET, groups: [{ id: "g1", kind: "column", members: ["a", "b"] }] }).count,
      1,
      "清单内的 ref 照写"
    );
  }

  /* 候选清理也认这份清单：模型给出的清单外成员直接丢掉（别让人点了「AI 辅助」才发现要重来）。 */
  {
    const candidates = require("../lib/layout-candidates.js").of([
      { ref: "a", controlType: "IconButton", text: "A" },
      { ref: "b", controlType: "IconButton", text: "B" }
    ]);
    assert.deepStrictEqual(
      layout.cleanGroups([{ id: "g1", kind: "column", members: ["a", "b", "zzz"] }], candidates),
      [{ id: "g1", kind: "column", members: ["a", "b"] }],
      "清单外那条丢掉，够 2 个的组留下"
    );
    assert.deepStrictEqual(
      layout.cleanGroups([{ id: "g1", kind: "column", members: ["a", "zzz"] }], candidates),
      [],
      "丢掉清单外那条后不够 2 个：这一组不留"
    );
  }

  // 推导结果：分区 → 组（装着子网格的格子）→ 控件 + 摆不进树的那几条（都从布局那一步的两份产物里读）。
  {
    const root = sandbox();
    fs.writeFileSync(
      path.join(root, "Generated", TARGET + ".wpf-layout.json"),
      JSON.stringify({
        pageTarget: TARGET,
        regions: [
          { id: "top", name: "顶部栏", emit: false, grid: { rows: [{}], columns: [{}], cells: [] } },
          {
            id: "work", name: "工作区", emit: true,
            grid: {
              rows: [{}, {}],
              columns: [{}, {}, {}],
              cells: [
                { ref: "c", row: 2, column: 1 },
                { ref: "a", row: 1, column: 2 }
              ]
            }
          }
        ]
      }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(root, "Generated", "_inputs", TARGET + ".wpf-layout.report.json"),
      JSON.stringify({ pageTarget: TARGET, unresolved: [{ ref: "b", reason: "单条目栏：几何判不出它跟谁同组" }] }),
      "utf8"
    );
    const info = layout.inspect({ projectRoot: root, target: TARGET });
    assert.strictEqual(info.derived.available, true);
    assert.strictEqual(info.derived.reason, "");
    assert.deepStrictEqual(info.derived.regions, [
      {
        /* 带照产物给（夹具那几条是空对象：认不出 Star，照实说不吃剩余）。 */
        id: "top", name: "顶部栏", emit: false,
        bands: { rows: [{ star: false }], columns: [{ star: false }] },
        cells: []
      },
      {
        id: "work",
        name: "工作区",
        emit: true,
        bands: {
          rows: [{ star: false }, { star: false }],
          columns: [{ star: false }, { star: false }, { star: false }]
        },
        cells: [
          /* 产物那一列是倒着写的，出去按行列排好了（坐标不往界面搬）。 */
          { ref: "a", group: false, axis: "", controlType: "", children: [], refs: ["a"] },
          { ref: "c", group: false, axis: "", controlType: "", children: [], refs: ["c"] }
        ]
      }
    ]);
    assert.deepStrictEqual(info.derived.singles, [{ ref: "b", reason: "单条目栏：几何判不出它跟谁同组" }]);
  }

  // 写回分组表并读回。
  {
    const root = sandbox();
    const saved = layout.save({
      projectRoot: root,
      target: TARGET,
      groups: [{ id: "g1", kind: "column", members: ["a", "b"] }]
    });
    assert.strictEqual(saved.count, 1);
    const file = JSON.parse(
      fs.readFileSync(path.join(root, "Generated", "_inputs", TARGET + ".layout-groups.json"), "utf8")
    );
    assert.strictEqual(file.schemaVersion, "mw-wpf-layout-groups/1");
    assert.strictEqual(file.pageTarget, TARGET);
    assert.deepStrictEqual(file.groups, [{ id: "g1", kind: "column", members: ["a", "b"] }]);
    assert.strictEqual(layout.inspect({ projectRoot: root, target: TARGET }).hasGroups, true, "写过之后就算有表");
  }

  // 校验失败：kind 非法、members 不足。
  {
    const root = sandbox();
    // 没给 groups（undefined / 不是数组）与「明确给一张空表」是两回事：前者要拦住。
    assert.throws(
      function () { layout.save({ projectRoot: root, target: TARGET }); },
      /分组表必须是数组/
    );
    assert.throws(
      function () {
        layout.save({ projectRoot: root, target: TARGET, groups: [{ id: "g1", kind: "grid", members: ["a", "b"] }] });
      },
      /kind 必须是 column 或 row/
    );
    assert.throws(
      function () {
        layout.save({ projectRoot: root, target: TARGET, groups: [{ id: "g1", kind: "column", members: ["a"] }] });
      },
      /members 至少 2 个/
    );
    // 组名唯一：两个组同名就是不合法的表（判据在后端，界面只渲染这句话）。
    assert.throws(
      function () {
        layout.save({
          projectRoot: root,
          target: TARGET,
          groups: [
            { id: "g1", kind: "column", members: ["a", "b"] },
            { id: "g1", kind: "row", members: ["b", "c"] }
          ]
        });
      },
      /组名重复/
    );
    // 一个 ref 只能进一个分组（写回校验与 AI 候选去重用同一份判据）。
    assert.throws(
      function () {
        layout.save({
          projectRoot: root,
          target: TARGET,
          groups: [
            { id: "g1", kind: "column", members: ["a", "b"] },
            { id: "g2", kind: "row", members: ["b", "c"] }
          ]
        });
      },
      /ref 出现在多个分组里: b/
    );
  }

  // 空分组表照写：那是「本页没有要声明的分组」，插件按表在不在判（有图无表才停）。
  {
    const root = sandbox();
    const saved = layout.save({ projectRoot: root, target: TARGET, groups: [] });
    assert.strictEqual(saved.count, 0);
    const file = JSON.parse(
      fs.readFileSync(path.join(root, "Generated", "_inputs", TARGET + ".layout-groups.json"), "utf8")
    );
    assert.strictEqual(file.schemaVersion, "mw-wpf-layout-groups/1");
    assert.deepStrictEqual(file.groups, []);
  }

  for (const root of sandboxes) fs.rmSync(root, { recursive: true, force: true });
  console.log("PASS layout-groups.test.js");
}

main();
