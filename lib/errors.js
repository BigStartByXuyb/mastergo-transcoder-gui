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

module.exports = { UserError, toFailure };
