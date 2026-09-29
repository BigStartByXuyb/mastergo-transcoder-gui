"use strict";

// 自动化层级为 auto 时，语义停点由模型补输入：出候选 → 写回工程 → 从断点续跑。
// 模型只负责「叫什么名字、怎么翻译」，写盘与续跑复用 lib/confirm.js 那一份实现。
//
// fill() 返回 { ok, reason?, filled?, job? }：没有可补的东西（模型没给出可用结果）时 ok=false，
// 调用方据此把任务交回给人，不反复重试。

function createAutoFill(deps) {
  const ai = deps.ai;
  const pending = deps.pending;
  const confirm = deps.confirm;
  const settings = deps.settings;

  function toMap(items, keyField, valueField) {
    const map = {};
    for (const item of items) {
      const key = String(item[keyField] ?? "").trim();
      const value = String(item[valueField] ?? "").trim();
      if (key && value) map[key] = value;
    }
    return map;
  }

  async function fill(query) {
    if (settings.read().automation !== "auto") return { ok: false, reason: "自动化层级不是 auto" };

    const projectRoot = query.projectRoot;
    const target = query.target;
    const info = pending.inspect({ projectRoot: projectRoot, target: target });
    const payload = {
      projectRoot: projectRoot,
      target: target,
      runId: query.runId || "",
      // 内存里那次运行没了（客户端重启）时，续跑要靠这两个兜底。
      request: query.request || null
    };
    const filled = [];
    let wanted = 0;

    const icons = info.icons || {};
    // 只补还没名字的条目：命名表是合并写入的，重问一遍已经定好的名字只会把它改坏。
    const mustName = Array.isArray(icons.mustName) ? icons.mustName : [];
    const todoIcons = mustName.filter((item) => !item.filled);
    if (icons.needsNaming) wanted += todoIcons.length;
    if (icons.needsNaming && todoIcons.length > 0) {
      // 已经定名的条目先占好名字：同一页里资源名必须唯一，模型起名得避开它们。
      const settled = new Set(mustName.filter((item) => item.filled).map((item) => item.index));
      const takenNames = (Array.isArray(icons.naming) ? icons.naming : [])
        .filter((row) => settled.has(row.index))
        .map((row) => String(row.name || "").trim())
        .filter(Boolean);
      const suggestion = await ai.suggestIconNames({ mustName: todoIcons, takenNames: takenNames });
      const byIndex = new Map(todoIcons.map((item) => [item.index, item]));
      if (suggestion.items.length > 0) {
        payload.naming = suggestion.items.map((item) => ({
          index: item.index,
          name: item.name,
          comment: item.comment,
          // sourceId 指向页面根的条目，几何必须由各自的 PATH 节点合成。
          // 这是后端对 DSL 的机械判定，直接抄过来，不让模型猜。
          fromDsl: byIndex.get(item.index)?.sourceIsPageRoot === true
        }));
        filled.push("图标命名 " + suggestion.items.length + " 条");
      }
    }

    const texts = info.translations || {};
    if (texts.needsTranslation) wanted += (texts.pendingTranslations || []).length;
    if (texts.needsGlossary) wanted += (texts.glossaryRequired || []).length;

    /*
     * 命名表被写歪的两种形态，都靠重写那张表修：留着插件不认的旧下标（第 7 步「台账多出图标」），
     * 或者资源名撞在一起（第 7 步「图标资源名重复」）。它们不是「要起名字」，但同样得处理，
     * 否则续跑还是同一个错。
     */
    const duplicates = Array.isArray(icons.duplicates) ? icons.duplicates : [];
    if (icons.needsRepair) {
      payload.pruneNaming = true;
      wanted += 1;
      if (icons.stale > 0) filled.push("清理旧命名 " + icons.stale + " 条");
      if (duplicates.length > 0) filled.push("修正重名 " + duplicates.length + " 组");
    }
    if (texts.needsTranslation && Array.isArray(texts.pendingTranslations) && texts.pendingTranslations.length > 0) {
      const translated = await ai.suggestTranslations({ texts: texts.pendingTranslations.map((item) => item.text) });
      if (translated.items.length > 0) {
        payload.translations = toMap(translated.items, "text", "translation");
        filled.push("译文 " + translated.items.length + " 条");
      }
    }
    if (texts.needsGlossary && Array.isArray(texts.glossaryRequired) && texts.glossaryRequired.length > 0) {
      const glossed = await ai.suggestGlossary({ texts: texts.glossaryRequired.map((item) => item.text) });
      if (glossed.items.length > 0) {
        payload.glossary = toMap(glossed.items, "text", "identifier");
        filled.push("术语 " + glossed.items.length + " 条");
      }
    }

    if (filled.length === 0) {
      // 一条都不用补：说明这次停不是缺输入（或者清单已经被人填完了），交回给人看，别当失败。
      if (wanted === 0) return { ok: false, empty: true, reason: "这次停点没有要补的输入" };
      return { ok: false, reason: "模型没有给出可用结果，需要人工填写" };
    }
    const result = confirm.commit(payload);
    return { ok: true, filled: filled, job: result.job };
  }

  return { fill };
}

module.exports = { createAutoFill };
