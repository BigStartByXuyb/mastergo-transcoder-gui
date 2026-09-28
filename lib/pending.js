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

const LANG_KEYS_REL = path.join(
  "skills", "mastergo-to-wpf", "scripts", "adapters", "mtslg-iocontrol", "gen-mtslg-lang-keys-from-dsl.js"
);

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  catch {
    return null;
  }
}

function createPending(deps) {
  const plugin = deps.plugin;
  const langKeysPath = path.join(plugin.root, ...LANG_KEYS_REL.split(path.sep));

  let langKeys = null;
  function loadLangKeys() {
    if (langKeys) return langKeys;
    if (!fs.existsSync(langKeysPath)) {
      throw new UserError("NO_LANG_KEYS", "插件里找不到语言键派生实现", "期望文件：" + langKeysPath);
    }
    langKeys = require(langKeysPath);
    return langKeys;
  }

  function pathsOf(projectRoot, target) {
    const generated = path.join(projectRoot, "Generated");
    const inputs = path.join(generated, "_inputs");
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
      runRegistry: path.join(generated, "runs", target, "run.json"),
      mapping: path.join(generated, target + ".mapping.json"),
      mappingDraft: path.join(work, target + ".mapping.draft.json"),
      // 作业A 不产 mapping 草稿，第 5 步的产物是类型判定表（插件自己的口径，见
      // run-all.ps1 的 $langSourceJson = if ($Mode -eq 'mw-wpf') { $TypeAuditJson } ...）。
      typeAudit: path.join(generated, target + ".component-types.json")
    };
  }

  function iconSection(files) {
    const payload = readJsonIfExists(files.candidates);
    if (!payload) {
      return { available: false, reason: "还没有候选清单（流水线尚未跑到 discover）", candidatesPath: files.candidates };
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
    return {
      available: true,
      candidatesPath: files.candidates,
      namingPath: files.naming,
      registrationSummary: payload.registrationSummary ?? null,
      candidates: withIndex,
      mustName: mustName,
      missing: missing.length,
      naming: namingRows,
      needsNaming: missing.length > 0
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
      return { available: false, reason: "还没有 mapping 来源（流水线尚未跑到第 5 步 mapping）", translationsPath: files.translations };
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
      needsGlossary: glossaryRequired.length > 0
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
      translations: translationSection(files, target)
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
    const output = Array.from(merged.values())
      .filter((row) => !allowed || allowed.has(row.index))
      .sort((left, right) => left.index - right.index);
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
   * 把已经写歪的命名表裁回当前候选清单。
   * 用在「第 7 步报台账多出图标」之后：那是旧下标留在表里的典型症状，裁完再续跑。
   */
  function reconcileNaming(query) {
    const projectRoot = String(query.projectRoot || "").trim();
    const target = String(query.target || "").trim();
    if (!projectRoot || !target) throw new UserError("NEED_PROJECT", "缺少工程目录或页面 Target", "");
    const files = pathsOf(projectRoot, target);
    const allowed = allowedNamingIndexes(files);
    if (!allowed) return { removed: 0, kept: 0, note: "没有候选清单，未做裁剪" };
    const rows = readJsonIfExists(files.naming);
    if (!Array.isArray(rows)) return { removed: 0, kept: 0, note: "命名表还没写" };
    const kept = rows.filter((row) => Number.isInteger(row.index) && allowed.has(row.index));
    if (kept.length === rows.length) return { removed: 0, kept: kept.length, path: files.naming };
    fs.mkdirSync(files.inputs, { recursive: true });
    fs.writeFileSync(files.naming, JSON.stringify(kept, null, 2) + "\n", "utf8");
    return { removed: rows.length - kept.length, kept: kept.length, path: files.naming };
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

  return { inspect, writeNaming, writeTranslations, writeGlossary, clearNaming, reconcileNaming, pathsOf };
}

module.exports = { createPending };
