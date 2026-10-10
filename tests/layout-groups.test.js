#!/usr/bin/env node
"use strict";

// 布局确认：读控件清单 + 分组表，写回分组表。
// 跑法：node tests/layout-groups.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const layout = require("../lib/layout-groups.js");

const TARGET = "DemoPage";

/* 最小工程：类型判定产物 + DSL 快照（文本）+ _inputs 目录。 */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-layout-groups-"));
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
            children: [
              { type: "INSTANCE", id: "a", text: [{ text: "A" }] },
              { type: "INSTANCE", id: "b", text: [{ text: "B" }] },
              { type: "TEXT", id: "c", text: [{ text: "C" }] }
            ]
          }
        ]
      }
    }),
    "utf8"
  );
  return root;
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
    assert.deepStrictEqual(info.groups, []);
    // 读图状态不在这里（lib/design-image.js 一处）、「有没有分组表」也不在这里（lib/workdir.js 一处）；
    // canSuggest 由后端给，界面照它禁用「AI 辅助」。
    assert.deepStrictEqual(Object.keys(info).sort(), ["available", "canSuggest", "controls", "groups", "reason"]);
    assert.strictEqual(info.canSuggest, true, "三个控件够分组");
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

  console.log("PASS layout-groups.test.js");
}

main();
