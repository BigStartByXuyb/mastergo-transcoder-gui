"use strict";

/*
 * 发布件的名字：目录名与 zip 名都按 `mastergo-transcoder-gui-<版本>` 拼。
 * 打包脚本产出它，winget 清单与内网源数据按它填包地址与入口路径 —— 两边必须是同一个名字。
 * 客户机上的安装脚本（scripts/install-client.ps1）是另一门语言、引不到这里，它按同一口径自己拼一份。
 */

const PREFIX = "mastergo-transcoder-gui-";

function folderOf(version) {
  return PREFIX + version;
}

module.exports = { folderOf: folderOf };
