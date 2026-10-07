"use strict";

/*
 * winget 的包：同一份事实渲染成两种形状。
 *
 *   三个 YAML —— 提公网源（winget-pkgs）用；客户机 `winget install --manifest <目录>` 也吃这一份。
 *   REST 清单 —— 内网源服务发出去的包对象（scripts/winget-source.js 落成数据文件）。
 *
 * 包是 portable：zip 里就是我们的启动器，winget 把 zip 解进自己的包目录、把 mastergo-transcoder.exe
 * 链进 PATH，不跑任何安装程序。
 *
 * 放在 scripts/lib 而不是 lib：它不是运行时代码（客户端那份运行树的清单只收 lib/public/vendor，
 * 放 lib 会跟着每个客户机的更新包走）。用它的是两个生成器与内网源服务。
 *
 * 边界：只渲染调用方给的事实（标识 / 版本 / 包地址 / 哈希 / 包内目录），自身不做 IO、不认识请求 ——
 * 「这一版的事实」怎么装配（读 package.json、算哈希）在 scripts/lib/winget-facts.js，
 * 源服务怎么回答搜索与取清单在 scripts/lib/winget-source-api.js。
 */

// 公网那一份的标识；内网那一份用 INTERNAL_ID（同一台机器上两个同名包会打架）。
const DEFAULT_ID = "BigStart.MasterGoTranscoder";
const INTERNAL_ID = "BigStart.MasterGoTranscoder.Internal";
const PUBLISHER = "BigStart";
const PACKAGE_NAME = "MasterGo 转码客户端";
const SHORT_DESCRIPTION = "MasterGo 设计稿转码客户端：看板跑流水线、待确认、更新与回退";
// 内部工具：清单里必须有一项 License。这里按「公司内部使用」写，改发布策略时改这一处。
const LICENSE = "Proprietary";
const MONIKER = "mastergo-transcoder";
// 装完链进 PATH 的命令名。
const COMMAND_ALIAS = "mastergo-transcoder";
const LOCALE = "zh-CN";
// zip 里保留着那一层目录，所以入口的相对路径要带上包内目录。
const ENTRY_EXE = "mastergo-transcoder.exe";
// 内网源的数据文件：生成器写它、服务读它，名字只在这一处。
const SOURCE_FILE = "winget-source.json";
// 内网源里的静态资产（zip、部署时生成的证书）放在这个子目录下。
const SOURCE_FILES_DIR = "files";

// 入口在包里的相对路径。
function entryOf(pkg) {
  return pkg.folder + "/" + ENTRY_EXE;
}

/* 三个 YAML。字段名与结构由 winget 的模式定死，这里只填值。 */
function yamlFiles(pkg) {
  return [
    {
      name: pkg.id + ".yaml",
      body: [
        "# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json",
        "PackageIdentifier: " + pkg.id,
        "PackageVersion: " + pkg.version,
        "DefaultLocale: " + LOCALE,
        "ManifestType: version",
        "ManifestVersion: 1.6.0",
        ""
      ].join("\n")
    },
    {
      name: pkg.id + ".locale." + LOCALE + ".yaml",
      body: [
        "# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json",
        "PackageIdentifier: " + pkg.id,
        "PackageVersion: " + pkg.version,
        "PackageLocale: " + LOCALE,
        "Publisher: " + PUBLISHER,
        "PackageName: " + PACKAGE_NAME,
        "ShortDescription: " + SHORT_DESCRIPTION,
        "License: " + LICENSE,
        "Moniker: " + MONIKER,
        "ManifestType: defaultLocale",
        "ManifestVersion: 1.6.0",
        ""
      ].join("\n")
    },
    {
      name: pkg.id + ".installer.yaml",
      body: [
        "# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json",
        "PackageIdentifier: " + pkg.id,
        "PackageVersion: " + pkg.version,
        "InstallerType: zip",
        "NestedInstallerType: portable",
        "NestedInstallerFiles:",
        "  - RelativeFilePath: " + entryOf(pkg),
        "    PortableCommandAlias: " + COMMAND_ALIAS,
        "Installers:",
        "  - Architecture: x64",
        "    InstallerUrl: " + pkg.url,
        "    InstallerSha256: " + pkg.sha256,
        "ManifestType: installer",
        "ManifestVersion: 1.6.0",
        ""
      ].join("\n")
    }
  ];
}

/* 一个包的 REST 形状：版本、默认区域、安装器。 */
function restPackage(pkg) {
  return {
    PackageIdentifier: pkg.id,
    Versions: [
      {
        PackageVersion: pkg.version,
        DefaultLocale: {
          PackageLocale: LOCALE,
          Publisher: PUBLISHER,
          PackageName: PACKAGE_NAME,
          ShortDescription: SHORT_DESCRIPTION,
          License: LICENSE,
          Moniker: MONIKER
        },
        Installers: [
          {
            Architecture: "x64",
            InstallerType: "zip",
            NestedInstallerType: "portable",
            NestedInstallerFiles: [{ RelativeFilePath: entryOf(pkg), PortableCommandAlias: COMMAND_ALIAS }],
            InstallerUrl: pkg.url,
            InstallerSha256: pkg.sha256
          }
        ]
      }
    ]
  };
}

/* 内网源服务读的那一份文件的内容：它一问，服务就照包对象回答。 */
function sourceDocument(packages) {
  return { Packages: packages.slice() };
}

module.exports = {
  DEFAULT_ID: DEFAULT_ID,
  INTERNAL_ID: INTERNAL_ID,
  ENTRY_EXE: ENTRY_EXE,
  SOURCE_FILE: SOURCE_FILE,
  SOURCE_FILES_DIR: SOURCE_FILES_DIR,
  yamlFiles: yamlFiles,
  restPackage: restPackage,
  sourceDocument: sourceDocument
};
