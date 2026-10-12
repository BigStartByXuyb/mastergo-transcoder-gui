"use strict";

// 面向用户的可读错误：带上机器可判的 code 和一句修复提示。
// userFacing 为真时由 HTTP 层转成 400，否则按 500 处理。
class UserError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint || "";
    this.userFacing = true;
  }
}

// 把扔出来的任何东西折成能直接塞进接口响应的三件套；没有 code 就按 INTERNAL 记。
function toFailure(error) {
  return {
    code: String((error && error.code) || "INTERNAL"),
    message: String((error && error.message) || error),
    hint: String((error && error.hint) || "")
  };
}

/*
 * 只有一个字符串字段的地方要的整句（原因 + 怎么做）：拼法只有这一处 ——
 * 带 {message, hint} 的接口仍分两段给、界面自己排版，这条是写给「一行字」的
 * （流水线失败那一行、看板任务行）。没有 hint 就只给原因。
 */
function failureSentence(error) {
  const failure = toFailure(error);
  return failure.hint ? failure.message + "：" + failure.hint : failure.message;
}

module.exports = { UserError, toFailure, failureSentence };
