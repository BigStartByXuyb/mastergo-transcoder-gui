"use strict";

/*
 * 对话存档：一次提问一条记录，按对话归堆，落在安装根的 chats.json。
 *
 * 存的是 codex exec 的原始行（stream + line），不是解析后的结构 ——
 * 解析只有一份，在前端（ui/src/lib/agent-stream.ts）：重放存档与实时收流走同一条解析，
 * 换引擎输出格式时只改那一处。后端因此不需要认识 codex 的任何事件类型。
 *
 * 谁在用：lib/routes.js 的 /api/agent/threads* 与 /api/agent/chat。
 * 边界：只管存取（建、改名、删、追加一轮）；不解析协议，不碰子进程。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");

const FILE = "chats.json";
// 上限只防「本地文件无限长大」：超了丢最旧的那条，界面上的历史本来就是越近越有用。
const MAX_CONVERSATIONS = 200;
const MAX_TURNS_PER_CONVERSATION = 200;
const MAX_LINES_PER_TURN = 5000;

// 标题取第一行，长了下刀；用户改名后就不再被第一句覆盖。
function titleFrom(prompt) {
  const line = String(prompt || "").trim().split("\n")[0].trim();
  if (!line) return "新对话";
  return line.length > 40 ? line.slice(0, 40) + "…" : line;
}

function createChats(options) {
  const opts = options || {};
  const home = path.resolve(opts.home);
  const storePath = path.join(home, FILE);
  const now = opts.now || function () { return new Date().toISOString(); };

  let conversations = load();

  function load() {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    }
    catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(function (item) {
      return item && typeof item.id === "string";
    }).map(function (item) {
      if (!Array.isArray(item.turns)) item.turns = [];
      if (typeof item.title !== "string") item.title = "新对话";
      return item;
    });
  }

  function save() {
    try {
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(conversations, null, 2) + "\n", "utf8");
    }
    catch {
      // 落盘失败不影响这一轮对话继续；下次启动会从上一份快照恢复。
    }
  }

  function find(id) {
    return conversations.find(function (item) { return item.id === id; }) || null;
  }

  function mustFind(id) {
    const conversation = find(id);
    if (!conversation) {
      throw new UserError("NO_CHAT", "找不到这个对话", "刷新页面看当前对话列表。");
    }
    return conversation;
  }

  // 列表不带正文：侧边栏只要标题与来源，正文可能很大。
  function list() {
    return conversations.slice().sort(function (a, b) {
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    }).map(function (item) {
      return {
        id: item.id,
        title: item.title,
        agent: item.agent || "",
        projectRoot: item.projectRoot || "",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        turnCount: item.turns.length
      };
    });
  }

  function create(patch) {
    const at = now();
    const conversation = {
      id: crypto.randomUUID(),
      title: String((patch && patch.title) || "").trim() || "新对话",
      agent: "",
      templateId: "",
      projectRoot: String((patch && patch.projectRoot) || ""),
      createdAt: at,
      updatedAt: at,
      turns: []
    };
    conversations.push(conversation);
    if (conversations.length > MAX_CONVERSATIONS) {
      conversations = conversations.slice(conversations.length - MAX_CONVERSATIONS);
    }
    save();
    return conversation;
  }

  function get(id) {
    const conversation = mustFind(String(id || ""));
    return {
      id: conversation.id,
      title: conversation.title,
      agent: conversation.agent || "",
      templateId: conversation.templateId || "",
      projectRoot: conversation.projectRoot || "",
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      turns: conversation.turns
    };
  }

  function remove(id) {
    const before = conversations.length;
    conversations = conversations.filter(function (item) { return item.id !== id; });
    if (conversations.length === before) {
      throw new UserError("NO_CHAT", "找不到这个对话", "刷新页面看当前对话列表。");
    }
    save();
  }

  /*
   * 一轮 = 一次提问。开始就落一条空记录（标题定下来），行随流追加，
   * 收尾时一次性写盘 —— 边跑边写会让每来一行就重写整个文件。
   */
  function beginTurn(id, prompt) {
    const conversation = mustFind(String(id || ""));
    const turn = { at: now(), prompt: String(prompt || ""), exitCode: null, finished: false, lines: [] };
    conversation.turns.push(turn);
    if (conversation.turns.length > MAX_TURNS_PER_CONVERSATION) conversation.turns.shift();
    if (conversation.title === "新对话") conversation.title = titleFrom(prompt);
    conversation.updatedAt = turn.at;
    save();
    return { turn: turn, title: conversation.title };
  }

  function appendLine(turn, stream, line) {
    if (!turn || turn.lines.length >= MAX_LINES_PER_TURN) return;
    turn.lines.push({ stream: stream === "stderr" ? "stderr" : "stdout", line: String(line) });
  }

  // 收尾：退出码落到那一轮上。断开连接与进程退出会先后到，先到的那个算数。
  function endTurn(id, turn, exitCode) {
    if (!turn || turn.finished) return;
    turn.finished = true;
    turn.exitCode = typeof exitCode === "number" ? exitCode : null;
    const conversation = find(String(id || ""));
    if (!conversation) return;
    conversation.updatedAt = now();
    save();
  }

  // 引擎与工程目录记在对话上：换过之后，续跑仍知道这条对话是在哪个目录、哪份 codex 上跑的。
  function stamp(id, patch) {
    const conversation = find(String(id || ""));
    if (!conversation) return;
    if (patch && patch.agent) conversation.agent = String(patch.agent);
    if (patch && patch.projectRoot) conversation.projectRoot = String(patch.projectRoot);
    // 这条对话用哪份提示词模板：跟着对话走，换对话就换模板。
    if (patch && patch.templateId) conversation.templateId = String(patch.templateId);
    save();
  }

  return { list, create, get, remove, beginTurn, appendLine, endTurn, stamp };
}

module.exports = { createChats, titleFrom };
