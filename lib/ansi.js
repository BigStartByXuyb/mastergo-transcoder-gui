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
 * 装饰行的判据只有这一处，但它们不是一类东西，两个消费者要的也不一样：
 *
 *   FRAME_LINES（框线与栈帧）—— 没有信息量：pwsh 错误框的 `Line |` / ` 3 |` / `| ~~~~` /
 *     `+ CategoryInfo`，Node 未捕获异常后面的 `at …` / `Node.js v…`。
 *     摘一段给人看（childOutputDetail）时丢掉它们，否则超长时留下的全是框线
 *     （实测：3.6KB 的 Node 输出截尾只剩栈帧）。
 *   HEADER_LINES（头行）—— 只说「哪个文件第几行」：`Exception:` / `At line:`。
 *     流水线取因（lib/run.js）不能把这种行当原因报出去，所以要一起跳；
 *     但摘录时得留着 —— 管道里那句「Exception: 缺少 MasterGo token…MASTERGO_MCP_TOKEN…」
 *     整行就是原因，也是唯一带得上标记的那行，丢了就认不出是 token 问题。
 *
 * 下划线另有 isUnderlineLine()：取因那边要靠它定位分隔线。
 */
const FRAME_LINES = [
  /^Line \|$/,
  /^\s*\+/,
  /^\s*CategoryInfo/,
  /^\s*FullyQualifiedErrorId/,
  /^\s*\d+ \|/,
  /^\s*\^+$/,
  /^\s*at\s/,                                     // Node 栈帧
  /^Node\.js v/
];
const HEADER_LINES = [/^Exception:/, /^At line:/];

// 下划线（分隔线）有两种形态：`|     ~~~~` 与裸的 `~~~~`；两种都要认，否则框线会被当成原因。
function isUnderlineLine(line) {
  const value = String(line == null ? "" : line).trim();
  return /^\|\s*~+$/.test(value) || /^~+$/.test(value);
}

function isFrameLine(line) {
  const value = String(line == null ? "" : line).trim();
  return isUnderlineLine(value) || FRAME_LINES.some((pattern) => pattern.test(value));
}

/* 取因用：框线 + 头行都不能当原因。 */
function isDecorationLine(line) {
  return isFrameLine(line) || HEADER_LINES.some((pattern) => pattern.test(String(line == null ? "" : line).trim()));
}

/*
 * 失败片段留多长：档位只有这一份（各处按「这段文字给谁看」挑一档，不各写数字）。
 *   hint   —— 界面/看板上的一句话提示（读子进程输出的那几个入口）
 *   step   —— 引擎内部的子步骤（lib/node-controls.js 写进 stderr 的那段）：外层还要再读一遍，留宽
 *   layout —— Layout 重新注册：调用方还要按行取末尾 4 行，窗口留大
 */
const DETAIL_LIMITS = { hint: 800, step: 1200, layout: 4000 };

/* 掐到 limit：超长留末尾（原因在后半段）。 */
function tailText(text, limit) {
  const value = String(text == null ? "" : text);
  return value.length <= limit ? value : value.slice(value.length - limit);
}

/*
 * 子进程失败时的输出片段：剥色码 → 去尾空白 → 掐到 limit。
 * 读法在这里统一两件事：stderr → stdout → 起不来的那个 error；超长先丢装饰行再留末尾。
 * 别处不各写一份。
 */
function childOutputDetail(result, limit) {
  const parts = result || {};
  // 先各自剥色码、去空白再挑：stderr 只剩一个换行时不能把 stdout 那句真话挡掉。
  const text = [parts.stderr, parts.stdout, parts.error]
    .map((part) => stripText(part).trim())
    .find((part) => part) || "";
  if (text.length <= limit) return text;
  const kept = text
    .split(/\r?\n/)
    .filter((line) => !isFrameLine(line))
    .join("\n")
    .trim();
  // 整段都是装饰行（或丢完只剩空白）：回退到原文，别给一个空提示。
  return tailText(kept || text, limit);
}

module.exports = {
  stripText, createStripper, childOutputDetail, isDecorationLine, isUnderlineLine, DETAIL_LIMITS
};
