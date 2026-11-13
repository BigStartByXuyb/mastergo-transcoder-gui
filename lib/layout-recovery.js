"use strict";

/*
 * 布局分组恢复的唯一编排：先核对恢复停点，再用这一步的同一份输入叫模型，
 * 最后把模型结果交给 confirm 的共用写回入口。
 */

const layoutGroups = require("./layout-groups.js");
const { commitFromSource } = require("./confirm.js");

const INPUT_FAILURE_CODES = new Set(["NO_CANDIDATES", "BAD_IMAGE", "NO_IMAGE"]);

class LayoutInputError extends Error {
  constructor(cause) {
    super(String(cause && cause.message || cause || "布局输入读取失败"));
    this.name = "LayoutInputError";
    this.cause = cause;
  }
}

function isInputError(error) {
  return error instanceof LayoutInputError;
}

function createLayoutRecovery(deps) {
  const ai = deps.ai;
  const pending = deps.pending;
  const confirm = deps.confirm;
  const boardOf = deps.board;

  function board() {
    return typeof boardOf === "function" ? boardOf() : boardOf;
  }

  function requireRecovery(source, layout) {
    layoutGroups.requireRecovery(layout || pending.inspect(source.query).layout);
  }

  async function suggestGroups(source, options) {
    requireRecovery(source, options && options.layout);
    let input;
    try {
      input = layoutGroups.candidatesInput({
        projectRoot: source.query.projectRoot,
        target: source.query.target
      });
    }
    catch (error) {
      if (options && options.emptyWhenNoEntries === true && error && error.code === layoutGroups.NO_GROUP_ENTRIES) return [];
      // 条目清单缺失或位图读不出来是输入读取失败：自动补输入要把它交回给人，不占模型额度。
      if (options && options.emptyWhenNoEntries === true && error && INPUT_FAILURE_CODES.has(error.code)) {
        throw new LayoutInputError(error);
      }
      if (error && error.userFacing) throw error;
      throw new LayoutInputError(error);
    }
    const suggested = await ai.suggestLayoutGroups(input);
    return suggested.groups;
  }

  function commit(source, body) {
    return commitFromSource({
      body: body,
      source: source,
      board: board(),
      confirm: confirm
    });
  }

  async function suggestAndCommit(source, body, options) {
    const groups = await suggestGroups(source, options);
    const result = commit(source, Object.assign({}, body, { groups: groups }));
    return Object.assign({ groups: groups }, result);
  }

  return { requireRecovery, suggestGroups, commit, suggestAndCommit, isInputError };
}

module.exports = { createLayoutRecovery };
