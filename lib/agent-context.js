"use strict";

/*
 * 一次提问前面那段「背景」：用户设的系统提示词 + 可参考的代码库 + 这次附上的文件。
 *
 * 谁在用：lib/routes.js 的 /api/agent/chat。
 * 边界：只把结构拼成一段文字；读不读、怎么用由 AI 自己决定（提示词里明说去这些目录读）。
 * 只写事实，不写「你应该怎么做」那类规矩 —— 规矩由用户在系统提示词里定。
 */

function codebaseLines(list) {
  return (Array.isArray(list) ? list : [])
    .filter(function (item) {
      return item && item.enabled !== false && String(item.path || "").trim();
    })
    .map(function (item) {
      const name = String(item.name || "").trim();
      const note = String(item.note || "").trim();
      return "- " + String(item.path).trim() + (name ? "（" + name + "）" : "") + (note ? "：" + note : "");
    });
}

function attachmentLines(list) {
  const files = Array.isArray(list) ? list : [];
  const images = files.filter(function (item) { return item && item.kind === "image"; });
  const others = files.filter(function (item) { return item && item.kind !== "image"; });
  const lines = [];
  if (images.length) {
    lines.push("图片（已经作为附件给你，直接看）：");
    for (const item of images) lines.push("- " + item.path);
  }
  if (others.length) {
    lines.push("文件（需要时去读）：");
    for (const item of others) lines.push("- " + item.path);
  }
  return lines;
}

/** 拼出一段背景文字（没有内容就是空串，调用方不用判断）。 */
function buildContext(options) {
  const o = options || {};
  const parts = [];
  const bases = codebaseLines(o.codebases);
  if (bases.length) {
    parts.push("[可参考的代码库]\n" + bases.join("\n") + "\n需要时去这些目录里读文件；不要凭猜测它们的结构。");
  }
  const files = attachmentLines(o.attachments);
  if (files.length) parts.push("[用户这次附上的东西]\n" + files.join("\n"));
  const prompt = String(o.systemPrompt || "").trim();
  if (prompt) parts.push("[用户设定的系统提示词]\n" + prompt);
  return parts.length ? parts.join("\n\n") + "\n\n" : "";
}

/** 图片路径单独给出去：Codex 的 -i 只认图片，别的文件靠上面那段里的路径。 */
function imagePaths(list) {
  return (Array.isArray(list) ? list : [])
    .filter(function (item) { return item && item.kind === "image" && String(item.path || "").trim(); })
    .map(function (item) { return String(item.path); });
}

/*
 * 这次用哪份参考源：点名的那份 → 没有就第一份（名单空则 null）。
 * 规则只在这里一处，路由与测试都读它。
 */
function pickTemplate(templates, wanted) {
  const list = Array.isArray(templates) ? templates : [];
  const id = String(wanted || "");
  return list.find(function (item) { return item && item.id === id; }) || list[0] || null;
}

module.exports = { buildContext, imagePaths, pickTemplate };
