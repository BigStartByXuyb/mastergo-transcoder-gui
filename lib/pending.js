"use strict";

/*
 * 待确认清单：流水线停在语义判断点时要人/AI 填的东西——读清单，写回答。
 *
 * 两类，都直接读插件产出的文件，界面不自己推规则：
 *   icon-name    图标定名   Generated/_inputs/<Target>.icon-candidates.json → .icon-naming.json
 *   translation  文案译文   Generated/_inputs/<Target>.lang-translations.json
 *
 * 译文待办分组直接调插件自己的 deriveLangSpec（同一逻辑只有一个实现），
 * 不在这里重写一套派生规则。
 */

const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");
const workdir = require("./workdir.js");
const { duplicatedNames, uniqueRowNames } = require("./icon-names.js");
const { createLayoutGroups } = require("./layout-groups.js");

const LANG_KEYS_REL = path.join(
  "skills", "mastergo-to-wpf", "scripts", "adapters", "mtslg-iocontrol", "gen-mtslg-lang-keys-from-dsl.js"
);

const readJsonIfExists = workdir.readJsonIfExists;

function createPending(deps) {
  const plugin = deps.plugin;

  let langKeys = null;
  let langKeysRoot = "";
  function loadLangKeys() {
    if (langKeys && langKeysRoot === plugin.root) return langKeys;
    const langKeysPath = path.join(plugin.root, ...LANG_KEYS_REL.split(path.sep));
    if (!fs.existsSync(langKeysPath)) {
      throw new UserError("NO_LANG_KEYS", "插件里找不到语言键派生实现", "期望文件：" + langKeysPath);
    }
    langKeys = require(langKeysPath);
    langKeysRoot = plugin.root;
    return langKeys;
  }

  function pathsOf(projectRoot, target) {
    const generated = workdir.productDir(projectRoot);
    const inputs = workdir.inputsDir(projectRoot);
    const work = path.join(generated, "_work");
    return {
      generated: generated,
      inputs: inputs,
      work: work,
      candidates: path.join(inputs, target + ".icon-candidates.json"),
      naming: path.join(inputs, target + ".icon-naming.json"),
      translations: path.join(inputs, target + ".lang-translations.json"),
      glossary: path.join(inputs, target + ".lang-glossary.json"),
      layoutManifest: path.join(inputs, target + ".layout-manifest.json"),
      summary: path.join(generated, target + ".summary.json"),
      runRegistry: path.join(workdir.runsDir(projectRoot, target), "run.json"),
      mapping: path.join(generated, target + ".mapping.json"),
      mappingDraft: path.join(work, target + ".mapping.draft.json"),
      // 作业A 不产 mapping 草稿，第 5 步的产物是类型判定表（插件自己的口径，见
      // run-all.ps1 的 $langSourceJson = if ($Mode -eq 'mw-wpf') { $TypeAuditJson } ...）。
      typeAudit: workdir.componentTypesPath(projectRoot, target)
    };
  }

  function iconSection(files) {
    const payload = readJsonIfExists(files.candidates);
    if (!payload) {
      return { available: false, reason: "还没有候选清单（流水线尚未跑到 discover）", candidatesPath: files.candidates, waiting: 0 };
    }
    /*
     * 页面根 ref：命中它的候选，几何是整页级别、必须在命名表里标 fromDsl，
     * 插件的核验日志正是这么点名的（「sourceId 指向页面根（该条目是整页几何）→ 必须 fromDsl + PATH ref」）。
     * 这是机械判定，不该指望模型去猜，所以在这里算好交给界面。
     */
    const pageRootRef = readJsonIfExists(files.runRegistry)?.identity?.layerId ?? "";
    const all = Array.isArray(payload.candidates) ? payload.candidates : [];
    const written = readJsonIfExists(files.naming);
    const namingRows = Array.isArray(written) ? written : [];
    const filled = new Map(namingRows.map((row) => [row.index, row]));
    const withIndex = all.map((item, index) => ({
      index: index,
      ...item,
      sourceIsPageRoot: Boolean(pageRootRef) && String(item.sourceId ?? "") === String(pageRootRef)
    }));
    const mustNameSet = new Set(Array.isArray(payload.mustName) ? payload.mustName.map((item) => item.index ?? item) : []);
    /*
     * 「待定名」= 插件判定必须登记、且命名表里还没有名字的条目。
     * 判断要跟已写入的命名表比 —— 只看候选清单的话，写完之后这里永远显示"还没填"。
     */
    const mustName = withIndex
      .filter((item) => mustNameSet.has(item.index))
      .map((item) => ({ ...item, filled: Boolean(String(filled.get(item.index)?.name ?? "").trim()) }));
    const missing = mustName.filter((item) => !item.filled);
    /*
     * 命名表里那些**插件当前不认的下标**：换了设计稿/图层、沿用同一个 Target 时，
     * 上一版留下的条目就会变成这种「多余项」，第 7 步会以「台账多出图标」拒绝。
     * 只有候选清单确实带了 mustName 才算 —— 没有清单时不能假定全是多余的。
     */
    const stale = Array.isArray(payload.mustName)
      ? namingRows.filter((row) => !mustNameSet.has(row.index))
      : [];
    /*
     * 台账口径的命名表 = 命名表里插件当前认的那些行（旧下标的行会被裁掉）。
     * 它们的资源名必须互不重复 —— 第 7 步 build-icon-ledger 拿 Set 去重后比长度，重名直接 exit 1。
     * 设计稿里复制出来的实例常常共用图层名，按图层名起名就会撞在一起。
     */
    const duplicates = duplicatedNames(
      Array.isArray(payload.mustName) ? namingRows.filter((row) => mustNameSet.has(row.index)) : namingRows
    );
    return {
      available: true,
      candidatesPath: files.candidates,
      namingPath: files.naming,
      registrationSummary: payload.registrationSummary ?? null,
      candidates: withIndex,
      mustName: mustName,
      missing: missing.length,
      stale: stale.length,
      staleIndexes: stale.map((row) => row.index),
      duplicates: duplicates,
      naming: namingRows,
      needsNaming: missing.length > 0,
      /*
       * 「命名表得重写才符合台账口径」：留着插件当前不认的旧下标（第 7 步「台账多出图标」），
       * 或资源名撞在一起（第 7 步「图标资源名重复」）。停点判定、续跑前修复、提交带不带
       * pruneNaming 都只读这一个字段，口径不复制。
       */
      needsRepair: stale.length > 0 || duplicates.length > 0,
      // 这一节要处理多少条：缺名字 + 旧下标 + 重名组。界面与队列都读它，不各算一遍。
      waiting: missing.length + stale.length + duplicates.length
    };
  }

  function translationSection(files, target) {
    /*
     * 文案枚举源按插件自己的口径取，三选一：
     *   Generated\<Target>.mapping.json            Bundle 定稿的映射（第 10 步之后）
     *   Generated\_work\<Target>.mapping.draft.json 作业B 第 5 步的草稿（第 10 步之前）
     *   Generated\<Target>.component-types.json      作业A 第 5 步的类型判定（A 不产 mapping 草稿）
     * 三条路径互斥：B 有草稿没有类型表，A 有类型表没有草稿。
     */
    const mapping = readJsonIfExists(files.mapping)
      ?? readJsonIfExists(files.mappingDraft)
      ?? readJsonIfExists(files.typeAudit);
    if (!mapping) {
      return { available: false, reason: "还没有 mapping 来源（流水线尚未跑到第 5 步 mapping）", translationsPath: files.translations, waiting: 0 };
    }
    const derived = loadLangKeys().deriveLangSpec({
      pageName: target,
      locales: ["CN", "EN"],
      mapping: mapping,
      translations: readJsonIfExists(files.translations) ?? {},
      glossary: readJsonIfExists(files.glossary) ?? {},
      // 底部栏菜单名也是待译项，要等第 8 步产出 layout-manifest 之后才枚举得到。
      menuItems: readJsonIfExists(files.layoutManifest)?.menuItems ?? [],
      // 页面标题也是待译项（门禁会点名 <Target>PageTitle）。取自插件自己的口径：
      // mapping.textAudit 里 role=page-title 的 sourceText。
      titleText: (mapping.textAudit || []).find((entry) => entry.role === "page-title")?.sourceText
    });
    const report = derived.report ?? {};
    const pending = (report.pendingTranslations ?? []).map((item) =>
      typeof item === "string" ? { text: item } : item
    );
    /*
     * 「必须补术语表」的分组规则取自插件自己（list-lang-sources.mjs）：
     *   provisionalKeys 是退回临时键的条目；其中已经进了 pendingTranslations 的补译文即可，
     *   剩下的才是派生不出语义键、只能靠术语表给标识符的（单字符之类）。
     * 术语表格式：{ 中文文案: EnglishIdentifier }。
     */
    const pendingKeys = new Set(pending.map((item) => item.key));
    const glossaryRequired = (report.provisionalKeys ?? []).filter((item) => !pendingKeys.has(item.key));
    return {
      available: true,
      translationsPath: files.translations,
      glossaryPath: files.glossary,
      pendingTranslations: pending,
      glossaryRequired: glossaryRequired,
      translations: readJsonIfExists(files.translations) ?? {},
      glossary: readJsonIfExists(files.glossary) ?? {},
      needsTranslation: pending.length > 0,
      needsGlossary: glossaryRequired.length > 0,
      // 这一节要处理多少条：待译 + 待补术语。界面与队列都读它，不各算一遍。
      waiting: pending.length + glossaryRequired.length
    };
  }

  // 布局确认：控件清单 / 分组 / 位图都在 lib/layout-groups.js 读，这里只翻成「要不要人确认」。
  // 「有图无表」这条失败判据归插件（布局推导那一步）。
  function layoutSection(projectRoot, target) {
    const info = createLayoutGroups().inspect({ projectRoot: projectRoot, target: target });
    const hasImage = Boolean(info.image);
    const hasGroups = Array.isArray(info.groups) && info.groups.length > 0;
    const needs = hasImage && !hasGroups;
    return {
      available: info.available,
      reason: info.reason,
      hasImage: hasImage,
      hasGroups: hasGroups,
      needsGroups: needs,
      waiting: needs ? 1 : 0,
      controls: info.controls
    };
  }

  // 一次读全：界面只需要一次请求就知道该确认什么。
  function inspect(query) {
    const projectRoot = String(query.projectRoot || "").trim();
    const target = String(query.target || "").trim();
    if (!projectRoot) throw new UserError("NEED_PROJECT", "缺少工程目录", "");
    if (!target) throw new UserError("NEED_TARGET", "缺少页面 Target", "待确认清单按页面存放，必须指定 Target。");
    const files = pathsOf(projectRoot, target);
    return {
      projectRoot: projectRoot,
      target: target,
      summary: readJsonIfExists(files.summary),
      icons: iconSection(files),
      translations: translationSection(files, target),
      layout: layoutSection(projectRoot, target)
    };
  }

  /*
   * 写图标命名表：格式由流水线第 7 步约定 —— [{ index, name, comment, fromDsl? }]。
   * 与已有文件**合并**（本次提交的赢）：界面一次只列出当前待确认的条目，
   * 直接覆盖会把上一轮已经填好的条目抹掉。
   *
   * 合并之后还要按插件当前的候选清单裁一遍：候选清单是唯一真值源，它说哪些下标要登记，
   * 命名表就只该留哪些。只合并不裁的话，换了设计稿/图层、沿用同一个 Target 时，
   * 旧下标会以「多余的图标」留在表里，第 7 步会直接拒绝（登记了就是 Icons.xaml 里的死资源）。
   */
  function writeNaming(query) {
    const projectRoot = String(query.projectRoot || "").trim();
    const target = String(query.target || "").trim();
    if (!projectRoot || !target) throw new UserError("NEED_PROJECT", "缺少工程目录或页面 Target", "");
    const items = Array.isArray(query.items) ? query.items : [];
    const files = pathsOf(projectRoot, target);
    const merged = new Map();
    const existing = readJsonIfExists(files.naming);
    if (Array.isArray(existing)) {
      for (const row of existing) {
        if (Number.isInteger(row.index)) merged.set(row.index, row);
      }
    }
    const cleaned = items
      .filter((item) => Number.isInteger(item.index) && typeof item.name === "string" && item.name.trim())
      .map((item) => {
        const row = { index: item.index, name: item.name.trim(), comment: String(item.comment ?? "").trim() };
        if (item.fromDsl === true) row.fromDsl = true;
        return row;
      });
    for (const row of cleaned) merged.set(row.index, row);
    const allowed = allowedNamingIndexes(files);
    const output = normalizeNamingRows(Array.from(merged.values()), allowed);
    fs.mkdirSync(files.inputs, { recursive: true });
    fs.writeFileSync(files.naming, JSON.stringify(output, null, 2) + "\n", "utf8");
    return { path: files.naming, count: output.length };
  }

  // 候选清单里 mustName 的下标集合；没有清单就返回 null（此时不做裁剪）。
  function allowedNamingIndexes(files) {
    const payload = readJsonIfExists(files.candidates);
    if (!payload || !Array.isArray(payload.mustName)) return null;
    return new Set(payload.mustName.map((item) =>
      Number(item && typeof item === "object" && item.index !== undefined ? item.index : item)));
  }

  /*
   * 命名表归一化：只留下当前认的下标（有候选清单才裁，没清单不假定谁是多余的），
   * 名字再按下标升序唯一化。写回（writeNaming）与修复（reconcileNaming）共用这一处。
   */
  function normalizeNamingRows(rows, allowed) {
    return uniqueRowNames(rows.filter((row) => Number.isInteger(row.index) && (!allowed || allowed.has(row.index))));
  }

  /*
   * 把已经写歪的命名表修回台账口径：裁掉候选清单不认的旧下标，再把重名的资源名唯一化。
   * 用在第 7 步拒绝之后 —— 「台账多出图标」是旧下标留下的，「图标资源名重复」是重名留下的，
   * 两种都是那张表的形态问题，改 JSON 不是人的活。
   */
  function reconcileNaming(query) {
    const projectRoot = String(query.projectRoot || "").trim();
    const target = String(query.target || "").trim();
    if (!projectRoot || !target) throw new UserError("NEED_PROJECT", "缺少工程目录或页面 Target", "");
    const files = pathsOf(projectRoot, target);
    const allowed = allowedNamingIndexes(files);
    const rows = readJsonIfExists(files.naming);
    if (!Array.isArray(rows)) return { removed: 0, renamed: 0, kept: 0, note: "命名表还没写" };
    const before = new Map(rows.map((row) => [row.index, String(row.name || "")]));
    const kept = normalizeNamingRows(rows, allowed);
    const removed = rows.length - kept.length;
    const renamed = kept.filter((row) => before.get(row.index) !== String(row.name || "")).length;
    if (removed === 0 && renamed === 0) {
      return { removed: 0, renamed: 0, kept: kept.length, path: files.naming, note: "命名表已经符合台账口径" };
    }
    fs.mkdirSync(files.inputs, { recursive: true });
    fs.writeFileSync(files.naming, JSON.stringify(kept, null, 2) + "\n", "utf8");
    return { removed: removed, renamed: renamed, kept: kept.length, path: files.naming };
  }

  // 写译文清单：格式由流水线约定 —— { 中文文案: 英文译文 }。同样与已有文件合并。
  function writeTranslations(query) {
    const projectRoot = String(query.projectRoot || "").trim();
    const target = String(query.target || "").trim();
    if (!projectRoot || !target) throw new UserError("NEED_PROJECT", "缺少工程目录或页面 Target", "");
    const source = query.map && typeof query.map === "object" && !Array.isArray(query.map) ? query.map : {};
    const files = pathsOf(projectRoot, target);
    const cleaned = { ...(readJsonIfExists(files.translations) ?? {}) };
    for (const key of Object.keys(source)) {
      const value = String(source[key] ?? "").trim();
      if (key.trim() && value) cleaned[key.trim()] = value;
    }
    fs.mkdirSync(files.inputs, { recursive: true });
    fs.writeFileSync(files.translations, JSON.stringify(cleaned, null, 2) + "\n", "utf8");
    return { path: files.translations, count: Object.keys(cleaned).length };
  }

  // 写术语表：格式由流水线约定 —— { 中文文案: EnglishIdentifier }。同样合并。
  function writeGlossary(query) {
    const projectRoot = String(query.projectRoot || "").trim();
    const target = String(query.target || "").trim();
    if (!projectRoot || !target) throw new UserError("NEED_PROJECT", "缺少工程目录或页面 Target", "");
    const source = query.map && typeof query.map === "object" && !Array.isArray(query.map) ? query.map : {};
    const files = pathsOf(projectRoot, target);
    const cleaned = { ...(readJsonIfExists(files.glossary) ?? {}) };
    for (const key of Object.keys(source)) {
      const value = String(source[key] ?? "").trim();
      if (key.trim() && value) cleaned[key.trim()] = value;
    }
    fs.mkdirSync(files.inputs, { recursive: true });
    fs.writeFileSync(files.glossary, JSON.stringify(cleaned, null, 2) + "\n", "utf8");
    return { path: files.glossary, count: Object.keys(cleaned).length };
  }

  /*
   * 删掉命名表。
   *
   * 第 7 步的分支是「看命名表文件在不在」：文件在 → 跑 build-icon-ledger，
   * 而它对空表直接报错「命名表为空…请直接手写空台账」；文件不在 + -AllowEmptyLedger
   * → 脚本自己写空台账。所以走空台账这条路时，必须确保那个文件不存在。
   */
  function clearNaming(query) {
    const projectRoot = String(query.projectRoot || "").trim();
    const target = String(query.target || "").trim();
    if (!projectRoot || !target) throw new UserError("NEED_PROJECT", "缺少工程目录或页面 Target", "");
    const files = pathsOf(projectRoot, target);
    if (!fs.existsSync(files.naming)) return { path: files.naming, removed: false };
    fs.unlinkSync(files.naming);
    return { path: files.naming, removed: true };
  }

  // 写分组表：校验与落盘都在 lib/layout-groups.js（与插件布局推导入口同一套判据），这里只转发。
  function writeGroups(query) {
    return createLayoutGroups().save({
      projectRoot: String(query.projectRoot || "").trim(),
      target: String(query.target || "").trim(),
      groups: Array.isArray(query.groups) ? query.groups : []
    });
  }

  return { inspect, writeNaming, writeTranslations, writeGlossary, writeGroups, clearNaming, reconcileNaming, pathsOf };
}

module.exports = { createPending };
