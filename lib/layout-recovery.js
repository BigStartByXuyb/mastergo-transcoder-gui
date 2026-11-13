"use strict";

/*
 * 布局分组恢复的唯一编排：先核对恢复停点，再用这一步的同一份输入叫模型，
 * 最后把模型结果交给 confirm 的共用写回入口。
 */

const layoutGroups = require("./layout-groups.js");
const { commitFromSource } = require("./confirm.js");

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
      if (options && options.emptyWhenNoEntries === true && error.code === layoutGroups.NO_GROUP_ENTRIES) return [];
      throw error;
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

  return { requireRecovery, suggestGroups, commit, suggestAndCommit };
}

module.exports = { createLayoutRecovery };
