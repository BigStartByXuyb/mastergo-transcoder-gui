"use strict";

/*
 * 浏览器传上来的文件的字节上限，与「字节数怎么说成人话」的换算：值与公式只在这里。
 * 谁在用：对话附件（lib/uploads.js）与作业A 的设计稿位图（lib/design-image.js）——
 * 两条线共用同一档上限，改一处就是两条线一起改。
 */

/* 单个文件的字节上限。 */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/* 一次上传（多文件）的字节上限。 */
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

/* base64 比原文大 4/3，再加 JSON 外壳的余量：请求体上限一律由它按「装着多少字节」算出来。 */
function bodyLimitFor(bytes) {
  return Math.ceil((bytes * 4) / 3) + 1024 * 1024;
}

/* 字节数说成人话（提示语里要用它，不另抄数字）。 */
function mb(bytes) {
  return Math.round(bytes / 1024 / 1024) + " MB";
}

module.exports = { MAX_FILE_BYTES, MAX_TOTAL_BYTES, bodyLimitFor, mb };
