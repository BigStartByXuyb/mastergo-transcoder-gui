"use strict";

/*
 * 页面图标资源名的唯一化。
 *
 * 插件的图标台账（第 7 步）要求同一页里的 name 互不重复，重名直接失败；
 * 而设计稿里同一个图层名可以出现在多个图标实例上（复制组件后只改名字），
 * 按图层名起名就会撞在一起。这里按出现顺序补数字，插在 Geometry 后缀之前，
 * 保持「…Geometry」的命名形态。
 */

const GEOMETRY = "Geometry";

// taken：已占用的名字集合，按小写比较（避免只差大小写的两个资源键）。调用方持有，逐个登记。
function uniqueIconName(name, taken) {
  const base = String(name).trim();
  let out = base;
  for (let n = 2; taken.has(out.toLowerCase()); n += 1) {
    out = base.endsWith(GEOMETRY) ? base.slice(0, -GEOMETRY.length) + n + GEOMETRY : base + n;
  }
  taken.add(out.toLowerCase());
  return out;
}

// 命名表行里的重名分组（行形态：{ index, name }）：[{ name, indexes }]，按首次出现的下标排序。
// 空名字不参与 —— 没登记的行本来就不进台账。
function duplicatedNames(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.name || "").trim().toLowerCase();
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.indexes.push(row.index);
    else groups.set(key, { name: String(row.name).trim(), indexes: [row.index] });
  }
  return [...groups.values()]
    .filter((group) => group.indexes.length > 1)
    .sort((left, right) => left.indexes[0] - right.indexes[0]);
}

// 按行序唯一化：保留第一个名字，后面的补数字（行序即优先级，调用方负责排序）。
function uniqueRowNames(rows) {
  const taken = new Set();
  return rows.map((row) => {
    const name = String(row.name || "").trim();
    if (!name) return row;
    const unique = uniqueIconName(name, taken);
    return unique === row.name ? row : { ...row, name: unique };
  });
}

module.exports = { uniqueIconName, duplicatedNames, uniqueRowNames };
