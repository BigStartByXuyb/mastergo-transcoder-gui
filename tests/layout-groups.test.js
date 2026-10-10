#!/usr/bin/env node
"use strict";

// 布局确认：读控件清单 + 分组表，写回分组表。
// 跑法：node tests/layout-groups.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createLayoutGroups } = require("../lib/layout-groups.js");

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
  const layout = createLayoutGroups();

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
  }

  // 写回分组表并读回。
  {
    const root = sandbox();
    const saved = layout.save({
      projectRoot: root,
      target: TARGET,
      groups: [{ id: "g1", kind: "column", members: ["a", "b"] }]
    });
    assert.strictEqual(saved.groups.length, 1);
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
  }

  console.log("PASS layout-groups.test.js");
}

main();
