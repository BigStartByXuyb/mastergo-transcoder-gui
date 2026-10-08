"use strict";

// 一个文件整体替换：先写同目录下的临时件，再改名成正式名 —— 读到的要么是旧的、要么是完整的新的，
// 不会读到半截。谁在用：版本指针与内容库写入（lib/bundle-store.js）、安装根的壳对齐（lib/bootstrap.js）。
// 边界：只管一个文件；一组文件要「要么都成、要么都不动」，由调用方用 stage/land/discard 自己编排
// （见 lib/bootstrap.js 的 syncSupervisor）。

const fs = require("fs");
const path = require("path");

// 临时件跟正式名同目录（改名才在同一个卷上）、带进程号（两个进程同时写不会撞）。
function tempNameOf(file) {
  return file + "." + process.pid + ".tmp";
}

// 把内容写成临时件，返回临时件路径（还没落位）。
function stage(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = tempNameOf(file);
  fs.writeFileSync(temp, content);
  return temp;
}

// 临时件落位成正式名（覆盖旧的）。
function land(temp, file) {
  fs.renameSync(temp, file);
}

// 丢掉一个临时件：本来就没有、或者删不掉，都不算错。
function discard(file) {
  try {
    fs.rmSync(file, { force: true });
  }
  catch {
    // 一个临时件留在原地不该影响调用方。
  }
}

// 单个文件一步到位：临时件写完立刻落位。
function writeAtomic(file, content) {
  land(stage(file, content), file);
}

module.exports = { writeAtomic, stage, land, discard };
