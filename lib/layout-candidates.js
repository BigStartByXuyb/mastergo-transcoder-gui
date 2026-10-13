"use strict";

/*
 * 分组表可引用的条目清单：作业A 第 8 步的产物 Generated/_inputs/<Target>.layout-group-candidates.json
 * （插件 gen-mw-wpf-layout.js 的 writeGroupCandidates 落的那一份）。
 *
 * 形状：{ schemaVersion: "mw-wpf-layout-group-candidates/1", pageTarget, source: { dslPath, dslSha256 },
 *         entries: [{ ref, controlType, text }] }
 *
 * 它只回答一件事：**这一层的分组表里能写哪些 ref**（内容区根网格那一层、机械补组之前的条目，所以没有
 * `synth:` / `declared:` 这类合成容器的 ref）。分组的结论仍由人 / 模型写进分组表 —— 这份清单不是输入。
 * 清单为空 = 这一层不参与分组（条目不足 2 个 / 内容区没有条目 / 这一层已由设计稿成层）：那种层唯一合法的表
 * 就是空表。
 *
 * 口径与插件推导入口同一套（插件 gen-mw-wpf-layout.js 的 declaredGroups / requireNoDeclaredGroups）：
 *   ① 表里的 ref 必须在这份清单里；
 *   ② 一个 ref 只能进一个组；
 *   ③ 不参与分组的层不许声明组。
 * 三条怎么判、拒的时候说什么话，都只有一处：lib/layout-groups.js 的 validateGroups（界面把它的原话显示出来）。
 * 插件还有第 ④ 条「组的地盘里不得有未归组的条目」，那条要看几何，只有插件那侧判；界面把它的话照实显示。
 *
 * 谁在读它：lib/layout-groups.js 的 inspect（界面读读数）、candidatesInput（喂模型）、validateGroups（写回校验）。
 */

const workdir = require("./workdir.js");

/*
 * 清单不在时给界面 / 模型的整句：措辞只有这一处（写回校验与喂模型两条路共用）。
 * 两种成因都说清：这一步还没跑过；或跑过了仍没有 —— 那说明当前插件比 2.4.0 老（这份清单是 2.4.0 起的产物）。
 */
const NO_CANDIDATES_REASON =
  "还没有这一步的条目清单（Generated/_inputs/<页面>.layout-group-candidates.json）：作业A 第 8 步会把它落下来，" +
  "它回答「分组表里能写哪些 ref」——先跑一次那一步；跑过仍没有的话，是当前插件比 2.4.0 老（这份清单从 2.4.0 起才有），" +
  "到「插件来源」换成自带的那一份。";

/* 条目那一格只留界面要的两栏（文案可能缺）。 */
function entryOf(raw) {
  return {
    ref: String((raw && raw.ref) || ""),
    controlType: String((raw && raw.controlType) || ""),
    text: String((raw && raw.text) || "")
  };
}

/*
 * 读清单：文件不在 / 解析不出 / entries 不是数组 → available:false + 那句原因；空 entries 是合法结论
 * （这一层不参与分组），照原样出去。
 */
function read(query) {
  const projectRoot = String((query && query.projectRoot) || "").trim();
  const target = String((query && query.target) || "").trim();
  const doc = workdir.readJsonIfExists(workdir.layoutGroupCandidatesPath(projectRoot, target));
  if (!doc || !Array.isArray(doc.entries)) {
    return { available: false, reason: NO_CANDIDATES_REASON, pageTarget: "", entries: [] };
  }
  return {
    available: true,
    reason: "",
    pageTarget: String(doc.pageTarget || ""),
    entries: doc.entries.filter(function (item) { return item && item.ref; }).map(entryOf)
  };
}

/* 清单里那些 ref。「表里的 ref 在不在本层条目里」只有这一处算（Set 只在这里建）。 */
function refsOf(candidates) {
  return new Set(((candidates && candidates.entries) || []).map(function (item) { return item.ref; }));
}

/*
 * 手上已经有一份条目（模型那一步的输入里就是它）时，拼成同一种读数 —— 判据与写回校验只认这个形状，
 * 于是「这份条目是哪来的」不影响判据。
 */
function of(entries) {
  return { available: true, reason: "", pageTarget: "", entries: (Array.isArray(entries) ? entries : []).map(entryOf) };
}

module.exports = { read, refsOf, of, NO_CANDIDATES_REASON };
