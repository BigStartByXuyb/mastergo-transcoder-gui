"use strict";

/*
 * 子进程输出里的终端色码，只有这一处处理。
 *
 * PowerShell 7 的错误框、以及一些 CLI 的着色输出会带 ANSI 控制序列（`ESC[31;1m` 之类）。
 * 这些字节落在控制台里是颜色，落到日志、失败原因、修复提示里就是乱码 —— 凡是把子进程输出
 * 转成给人看的文字，都从这里过一道：
 *   stripText(text)    已经拿到完整字符串时用（一次剥干净）
 *   createStripper()   流式读取时用（能扛住控制序列被切在两个 chunk 之间）
 *
 * 只剥控制序列，可见字符一个不动。
 */

/*
 * 控制序列：CSI（ESC [ 参数 中间字节 终止字节）、OSC（ESC ] … BEL / ST）、以及两字节/三字节转义。
 * 通用转义那支的终止字节要排掉 `[`：否则 `ESC[` 会被当成一个「两字节转义」整条吃掉，
 * 后面半截参数就漏成了可见文字（`ESC[` 与 `ESC[0m` 从两个 chunk 来时正是这样）。
 * OSC 必须收尾才算一条：没收尾的先攥在手里（它可能还在下一个 chunk 里），当场吃掉的话，
 * 后面的 BEL 会作为可见字符漏出来。
 */
const ANSI_PATTERN = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[ -/]*[0-9:;<=>?@A-Z\\^_`a-z{|}~])/g;

/*
 * 结尾这一小段可能是「还没写完」的控制序列：流式处理时先攥在手里，等下一个 chunk 拼上再看。
 * OSC 那支的 `(?:\u001b)?` 是为了收尾符（ST 的 ESC）正好落在这个 chunk 末尾的情况 ——
 * 只攥最后一个 ESC 的话，前面那段标题会当成正文漏出去。
 */
const TAIL_PATTERN = /\u001b(?:\[[0-9;?]*[ -/]*|\][^\u0007\u001b]*(?:\u001b)?|[ -/]*)?$/;

function stripText(text) {
  return String(text == null ? "" : text).replace(ANSI_PATTERN, "");
}

/*
 * 流式剥：喂进来什么 chunk 都行，返回已经剥干净的可见文字。
 * 控制序列正好跨在 chunk 边界上时，先攥住那一小段尾巴；它永远是不可见字节，
 * 攥住的这段时间里可见文字不丢、不重排（调用方可以照常按「到达即落地」写日志）。
 */
function createStripper() {
  let carry = "";
  return function push(chunk) {
    const text = carry + String(chunk == null ? "" : chunk);
    carry = "";
    const clean = text.replace(ANSI_PATTERN, "");
    const tail = TAIL_PATTERN.exec(clean);
    if (!tail) return clean;
    carry = tail[0];
    return clean.slice(0, clean.length - carry.length);
  };
}

/*
 * 子进程失败时的输出片段：先剥色码、再去尾空白。
 * 读法在这里统一两件事：stderr → stdout → 起不来的那个 error；超长时留末尾 ——
 * 子进程的报错写在输出的最后，留开头只会把真正那句截掉。别处不各写一份。
 */
function childOutputDetail(result, limit) {
  const parts = result || {};
  // 先各自剥色码、去空白再挑：stderr 只剩一个换行时不能把 stdout 那句真话挡掉。
  const trimmed = [parts.stderr, parts.stdout, parts.error]
    .map((part) => stripText(part).trim())
    .find((part) => part) || "";
  if (trimmed.length <= limit) return trimmed;
  return trimmed.slice(trimmed.length - limit);
}

module.exports = { stripText, createStripper, childOutputDetail };
