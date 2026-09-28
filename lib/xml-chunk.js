"use strict";
/*
 * xml-chunk.js —— 从整页 IOContorl XML 里取出**单个控件**的完整片段。
 *
 * 自闭合标签只取那一行；带子节点时取整棵子树。给人工复制的代码一旦多吞一个相邻控件，
 * 粘过去就是重复 ID 加多余控件，所以抽取口径必须严格：只认 ID 命中的那个根节点。
 */

function extractXmlChunk(xml, xmlId) {
  const text = String(xml === undefined || xml === null ? "" : xml);
  const id = String(xmlId || "");
  if (!text || !id) return "";
  const at = text.indexOf('ID="' + id + '"');
  if (at < 0) return "";
  const start = text.lastIndexOf("<IOContorl", at);
  if (start < 0) return "";

  let cursor = start;
  let depth = 0;
  while (cursor < text.length) {
    const nextOpen = text.indexOf("<IOContorl", cursor);
    const nextClose = text.indexOf("</IOContorl>", cursor);
    if (nextOpen >= 0 && (nextClose < 0 || nextOpen < nextClose)) {
      const tagEnd = text.indexOf(">", nextOpen);
      if (tagEnd < 0) break;
      const selfClosing = text[tagEnd - 1] === "/";
      if (selfClosing) {
        if (depth === 0) return text.slice(start, tagEnd + 1);
      }
      else {
        depth += 1;
      }
      cursor = tagEnd + 1;
      continue;
    }
    if (nextClose < 0) break;
    depth -= 1;
    cursor = nextClose + "</IOContorl>".length;
    if (depth === 0) return text.slice(start, cursor);
  }
  return text.slice(start, cursor);
}

module.exports = { extractXmlChunk };
