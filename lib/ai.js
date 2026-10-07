"use strict";

/*
 * 模型调用。
 *
 * 只做「出候选」这一件事：把插件算好的清单喂给模型，要回结构化结果，交界面预填。
 * 从不直接写任何文件——写盘一律走 /api/confirm，人确认之后。
 *
 * 客户端用 openai 包（Apache-2.0，零传递依赖）：baseURL 一换就是任意 OpenAI 兼容厂商，
 * 重试 / 超时 / 流式 / 结构化错误都由它提供。这里自己补两件它不管的：熔断与 JSON 兜底解析。
 *
 * 包从哪来：仓库里开发时装在 node_modules；发布件只带一份压缩件 vendor/openai.tgz，
 * 第一次要用时解压成 vendor/openai（一个文件换上千个资产名额）。解析只有这里一处。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const VENDORED = path.join(__dirname, "..", "vendor", "openai");
const VENDORED_ARCHIVE = path.join(__dirname, "..", "vendor", "openai.tgz");

function openaiPackage() {
  if (fs.existsSync(path.join(VENDORED, "index.js"))) return VENDORED;
  // 发布件里只有压缩件：就地解开再用。解不开就退回开发机上的 node_modules（装到哪跑哪一份）。
  if (fs.existsSync(VENDORED_ARCHIVE)) {
    const unzip = spawnSync("tar", ["-xzf", VENDORED_ARCHIVE, "-C", path.dirname(VENDORED)], { stdio: "ignore" });
    if (unzip.status === 0 && fs.existsSync(path.join(VENDORED, "index.js"))) return VENDORED;
  }
  return "openai";
}

const { OpenAI } = require(openaiPackage());

const { UserError } = require("./errors.js");
const { uniqueIconName } = require("./icon-names.js");

/*
 * 交给 SDK 之前把响应按它自己声明的字符集解一遍。
 * 有些厂商与内网网关的错误体不是 UTF-8（中文环境常见 GBK），SDK 一律按 UTF-8 读，
 * 报错原文就成了乱码 —— 而这段话正是要给人看的那句。声明 UTF-8 或没声明的原样透传，不碰。
 */
/* fetch 由调用方给：这条包装能单独验，不必去改全局 fetch。 */
function createFetchDecodedCharset(fetchImpl) {
  return async function fetchDecodedCharset(url, init) {
    const response = await fetchImpl(url, init);
    const type = response.headers.get("content-type") || "";
    const charset = (/charset\s*=\s*"?([\w-]+)/i.exec(type) || [])[1];
    if (!charset || /^utf-?8$/i.test(charset)) return response;
    const bytes = Buffer.from(await response.arrayBuffer());
    let text = bytes.toString("utf8");
    try {
      text = new TextDecoder(charset).decode(bytes);
    }
    catch {
      // 不认识的字符集：按 UTF-8 显示，别拿一个错字符集去拆。
    }
    // 正文已经重编码过：长度与压缩头不再描述它，去掉；字符集改成 utf-8。
    const headers = new Headers(response.headers);
    headers.set("content-type", type.replace(/charset\s*=\s*"?[\w-]+"?/i, "charset=utf-8"));
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(text, { status: response.status, statusText: response.statusText, headers });
  };
}

const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60 * 1000;
const MAX_ITEMS = 200;

const ICON_SYSTEM = [
  "你在为 MTSLG 界面资源命名。给你的是设计稿里需要登记的图标候选，",
  "每条含它所在的控件（ownerText / ownerControlType）、同级 PATH 数、图标尺寸与图层名。",
  "为每条给一个英文资源名，规则：",
  "1) name 必须是英文大驼峰，以 Geometry 结尾，例如 SetGeometry；",
  "2) 语义取自「它归属的控件/文本 + 图层名」，不要按图形外观猜；",
  "3) 同一页里 name 必须唯一：图层名相同的两个图标要按「归属控件/所在位置」区分开，给不同的名字；",
  "4) takenNames 里的名字已被同一页其它图标占用，不许再用；",
  "5) comment 用中文一句话说清这个图标表示什么；",
  "6) confidence 是 0~1 的数，不确定就给低分。",
  "只输出 JSON：{\"items\":[{\"index\":<候选下标>,\"name\":\"...\",\"comment\":\"...\",\"confidence\":0.0}]}"
].join("\n");

const TRANSLATION_SYSTEM = [
  "你在为工业设备界面做中译英。给你的是界面文案（中文），逐条给英文译文。",
  "规则：",
  "1) 译文要短，适合放在按钮/标签里，不要加句号；",
  "2) 数字、单位、型号、功能键名（ENTER / EXIT / F1）原样保留；",
  "3) 专业术语用设备行业的通用英文说法；",
  "4) 不确定的照字面直译，不要编造缩写。",
  "只输出 JSON：{\"items\":[{\"text\":\"<原中文>\",\"translation\":\"<英文>\"}]}"
].join("\n");

const GLOSSARY_SYSTEM = [
  "你在为一个界面项目维护术语表。给你的是派生不出语义键的文案（单字符、纯符号之类），",
  "逐条给一个英文标识符，供编号规则拼成资源键。规则：",
  "1) 用英文大驼峰，只含字母数字，首字符必须是字母；",
  "2) 要表达这个文案在界面上的含义（例如坐标轴标签 X → AxisX）；",
  "3) 同一个含义在不同页面必须给同一个标识符；",
  "4) 拿不准含义时用保守的描述性名字，不要编造缩写。",
  "只输出 JSON：{\"items\":[{\"text\":\"<原文案>\",\"identifier\":\"<英文标识符>\"}]}"
].join("\n");

const IDENTITY_SYSTEM = [
  "你在为一个工业设备界面的页面起名字。给你的是设计页名、项目里已有的页面名与区域前缀。",
  "要求：",
  "1) semanticName 是英文 PascalCase，只含字母数字，首字符大写字母；表达这一页的用途（如 手动对准 → ManualAlign）；",
  "2) ui 只能从给定的区域前缀里选一个（区域是项目既有约定，不许新造）；",
  "3) target 必须是 ui + semanticName 直接拼接（插件会按 Target 前缀反推区域，拼错就会写错目录）；",
  "4) confidence 是 0~1 的数，不确定就给低分；",
  "5) reason 用中文一句话说明依据（来自哪个设计页名、为什么用这个区域）。",
  "只输出 JSON：{\"items\":[{\"semanticName\":\"...\",\"ui\":\"...\",\"target\":\"...\",\"confidence\":0.0,\"reason\":\"...\"}]}"
].join("\n");

function stripFence(text) {
  return String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

// 模型偶尔会加解释或代码围栏；先按整体解析，失败再退到第一个 JSON 对象。
function parseJson(text) {
  const body = stripFence(text);
  try {
    return JSON.parse(body);
  }
  catch {
    /* 继续尝试截取 */
  }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(body.slice(start, end + 1));
    }
    catch {
      /* 落到下面的报错 */
    }
  }
  throw new UserError("AI_BAD_JSON", "模型没有返回可解析的 JSON", body.slice(0, 500));
}

function createAi(deps) {
  const settings = deps.settings;

  let consecutiveFailures = 0;
  let openUntil = 0;

  function breakerCheck() {
    if (Date.now() < openUntil) {
      const seconds = Math.ceil((openUntil - Date.now()) / 1000);
      throw new UserError("AI_BREAKER", "模型连续失败，已暂停调用", seconds + " 秒后可重试；检查设置里的地址/模型/key。");
    }
  }

  function noteFailure() {
    consecutiveFailures += 1;
    if (consecutiveFailures >= BREAKER_THRESHOLD) {
      openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      consecutiveFailures = 0;
    }
  }

  function noteSuccess() {
    consecutiveFailures = 0;
  }

  async function complete(system, user) {
    breakerCheck();
    const config = settings.resolveAi();
    const client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      maxRetries: 2,
      timeout: 120000,
      // 错误原文按响应声明的字符集解好再进来：厂商用 GBK 时，报错不会是乱码。
      fetch: createFetchDecodedCharset(fetch)
    });
    try {
      const response = await client.chat.completions.create({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });
      noteSuccess();
      return response.choices?.[0]?.message?.content ?? "";
    }
    catch (error) {
      noteFailure();
      const status = error && error.status ? "（HTTP " + error.status + "）" : "";
      throw new UserError("AI_CALL", "调用模型失败" + status, String(error && error.message ? error.message : error).slice(0, 500));
    }
  }

  async function suggestIconNames(input) {
    const items = (Array.isArray(input.mustName) ? input.mustName : []).slice(0, MAX_ITEMS);
    if (items.length === 0) return { items: [] };
    /*
     * 已被同一页其它图标占用的资源名：第 7 步 build-icon-ledger 要求同一页里 name 互不重复，
     * 所以既要告诉模型避开，也要在这里兜住模型偶尔给重名的结果。
     */
    const takenNames = (Array.isArray(input.takenNames) ? input.takenNames : [])
      .map((name) => String(name).trim())
      .filter(Boolean);
    const taken = new Set(takenNames.map((name) => name.toLowerCase()));
    const payload = items.map((item) => ({
      index: item.index,
      layerName: item.svgName ?? "",
      nodeName: item.nodeName ?? "",
      ownerText: item.ownerText ?? "",
      ownerControlType: item.ownerControlType ?? "",
      parentType: item.parentType ?? "",
      siblingPathCount: item.siblingPathCount ?? null,
      iconSize: item.ledgerFields?.iconSize ?? null,
      reason: item.reason ?? ""
    }));
    const text = await complete(ICON_SYSTEM, JSON.stringify({ icons: payload, takenNames: takenNames }, null, 2));
    const parsed = parseJson(text);
    const allowed = new Set(items.map((item) => item.index));
    const out = (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((item) => allowed.has(item.index) && typeof item.name === "string" && item.name.trim())
      .sort((left, right) => left.index - right.index)
      .map((item) => ({
        index: item.index,
        name: uniqueIconName(String(item.name).trim(), taken),
        comment: String(item.comment ?? "").trim(),
        confidence: typeof item.confidence === "number" ? item.confidence : null
      }));
    return { items: out };
  }

  async function suggestTranslations(input) {
    const items = (Array.isArray(input.texts) ? input.texts : []).slice(0, MAX_ITEMS);
    if (items.length === 0) return { items: [] };
    const text = await complete(TRANSLATION_SYSTEM, JSON.stringify({ texts: items }, null, 2));
    const parsed = parseJson(text);
    const known = new Set(items.map((item) => String(item)));
    const out = (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((item) => known.has(String(item.text)) && typeof item.translation === "string")
      .map((item) => ({ text: String(item.text), translation: String(item.translation).trim() }));
    return { items: out };
  }

  async function suggestGlossary(input) {
    const items = (Array.isArray(input.texts) ? input.texts : []).slice(0, MAX_ITEMS);
    if (items.length === 0) return { items: [] };
    const text = await complete(GLOSSARY_SYSTEM, JSON.stringify({ texts: items }, null, 2));
    const parsed = parseJson(text);
    const known = new Set(items.map((item) => String(item)));
    const out = (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((item) => known.has(String(item.text)) && /^[A-Za-z][A-Za-z0-9]*$/.test(String(item.identifier ?? "")))
      .map((item) => ({ text: String(item.text), identifier: String(item.identifier) }));
    return { items: out };
  }

  // 页面身份候选：只出候选，不写盘；写盘由 /api/identity/apply 在人或自动层级确认后做。
  async function suggestIdentity(input) {
    const pageName = String(input.pageName || "").trim();
    if (!pageName) return { items: [] };
    const payload = {
      designPageName: pageName,
      uiCandidates: Array.isArray(input.uiCandidates) ? input.uiCandidates : [],
      existingTargets: (Array.isArray(input.existingTargets) ? input.existingTargets : []).slice(0, 40)
    };
    const text = await complete(IDENTITY_SYSTEM, JSON.stringify(payload, null, 2));
    const parsed = parseJson(text);
    const allowedUi = new Set(payload.uiCandidates.map((item) => String(item.ui || "")));
    return {
      items: (Array.isArray(parsed.items) ? parsed.items : [])
        .filter((item) => typeof item.semanticName === "string" && item.semanticName.trim())
        .filter((item) => allowedUi.has(String(item.ui)))
        .map((item) => ({
          semanticName: String(item.semanticName).trim(),
          ui: String(item.ui).trim(),
          target: String(item.ui).trim() + String(item.semanticName).trim(),
          // 显式补齐与机械候选同形的字段：类型说它有值，运行时就得有（不然正确性靠 undefined 兜着）。
          needsSemanticName: false,
          basis: String(item.reason ?? "").trim() || "模型按设计页名与既有区域约定给出",
          confidence: typeof item.confidence === "number" ? item.confidence : null,
          reason: String(item.reason ?? "").trim()
        }))
    };
  }

  return { suggestIconNames, suggestTranslations, suggestGlossary, suggestIdentity };
}

module.exports = { createAi, createFetchDecodedCharset };
