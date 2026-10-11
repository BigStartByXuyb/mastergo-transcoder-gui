import type { Health, PluginAvailable, PluginUpdateStatus, UpdateSource, UpdateStatus } from "@/lib/api"
import { sourceViewOf } from "@/lib/source-check"

/*
 * 设置页用例共用的那几件夹具：路径拼法、客户端健康快照、假响应。
 * 两份用例（更新页 / 运行环境页）本来各抄一份，接口加字段时容易只改一处。
 *
 * 夹具路径按段拼：源码里不出现「盘符 + 反斜杠」那种机器专属写法（结构检查会拦）。
 */

export function drive(letter: string, ...parts: string[]): string {
  return [letter + ":", ...parts].join("\\")
}

export const PLUGIN_ROOT = drive("C", "Users", "me", ".codex", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "1.0.369")
export const ENGINE = drive("D", "app", "lib", "node-controls.js")
/** 客户端自带那一处：装好之后是 <安装根>/plugins/<插件名>/<版本>/。 */
export const INSTALL_PARENT = drive("D", "app", "plugins")
export const INSTALLED_ROOT = drive("D", "app", "plugins", "mastergo-wpf-transcoder", "1.0.369")

/** 程序更新的状态：没传覆盖项就是「本机一份都没下、还没查过远端」。版本号这类由用例自己覆盖。 */
export function updateStatusFixture(over: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    state: "up_to_date",
    current: "0.6.31",
    currentNotes: [],
    history: [],
    root: "",
    pointer: null,
    busy: "",
    staged: [],
    ready: "",
    rollback: "",
    available: null,
    error: null,
    task: { phase: "idle", done: 0, total: 0, downloaded: 0, error: null },
    source: sourceFixture("source"),
    hasToken: false,
    ...over
  }
}

/** 弹窗要的「现状」：从这条线自己的状态里取发布源那两格（`lib/source-check` 的 `sourceViewOf` 一处给形状）。 */
export function sourceViewFixture(value: UpdateStatus) {
  return sourceViewOf(value.source, value.hasToken)
}

/*
 * 界面夹具用的两份发布源基址：**故意不是**产品那两个内置默认（它们只有后端 lib/source.js 一处；
 * 前端 require 不到、也不该抄一份）。夹具只要形状像就行，地址是假的 —— 后端换默认不用动这里。
 */
export const SOURCE_BASE = "https://github.com/example/client-release"
export const PLUGIN_SOURCE_BASE = "https://github.com/example/plugin-release"

/**
 * 发布源：程序更新与插件各有一项设置，形状一样 —— 字段名（存哪一项）由调用方按这条线给，
 * 没有默认值：哪条线就说哪条线的字段名，不在这里留一个「默认是程序更新那条」。
 * kinds 是接口给的取值（后端认哪几种由它说），夹具只按形状放一格，前端不据此校验。
 */
export function sourceFixture(field: string, base = SOURCE_BASE, manifest = "manifest.json"): UpdateSource {
  return {
    kind: "github",
    base: base,
    manifestUrl: base + "/releases/latest/download/" + manifest,
    kinds: ["github", "gitlab", "static"],
    field: field
  }
}

/** 远端清单那几项（插件这一半只用得上版本、时间与「差几个文件」）。 */
export function pluginAvailableFixture(over: Partial<PluginAvailable> = {}): PluginAvailable {
  return {
    version: "1.0.369",
    tag: "v1.0.369",
    releasedAt: "2026-10-06T00:00:00.000Z",
    changed: 0,
    removed: 0,
    total: 12,
    checkedAt: "2026-10-06T01:00:00.000Z",
    ...over
  }
}

/** 自带那一份插件的状态里，除「处境 + 清单」以外的那些（四种处境都一样）。 */
type PluginUpdateCommon = Omit<PluginUpdateStatus, "state" | "available">
export type PluginUpdateOverrides = Partial<PluginUpdateCommon> & {
  state?: PluginUpdateStatus["state"]
  available?: PluginAvailable | null
}

/**
 * 自带那一份插件的状态：没传覆盖项就是「本地装了 1.0.369，查过远端且是最新」。
 * 处境与清单的对齐只在这一处（与后端 readState 同一套：有清单才有「有新版 / 是最新」），
 * 用例只管说自己测的那一格。
 */
export function pluginUpdateFixture(over: PluginUpdateOverrides = {}): PluginUpdateStatus {
  const common: PluginUpdateCommon = {
    local: { version: "1.0.369", dir: INSTALLED_ROOT },
    error: null,
    task: { phase: "idle", done: 0, total: 0, downloaded: 0, error: null },
    busy: "",
    // 插件从哪儿取：插件自己那一项设置（默认是插件仓库，清单名也换成插件那份）。
    source: sourceFixture("pluginSource", PLUGIN_SOURCE_BASE, "plugin-manifest.json"),
    hasToken: false,
    ...over
  }
  const available = over.available === undefined ? pluginAvailableFixture() : over.available
  const state = over.state ?? (available ? "up_to_date" : "unchecked")
  if (state === "unchecked") return { ...common, state: state, available: null }
  if (state === "error") return { ...common, state: state, available: available }
  return { ...common, state: state, available: available ?? pluginAvailableFixture() }
}

export function healthFixture(version = "0.6.37"): Health {
  return {
    ok: true,
    version: version,
    supervised: true,
    plugin: { root: PLUGIN_ROOT, version: "1.0.369", engine: ENGINE, engineExists: true, runAllExists: true, failure: "" },
    frames: [],
    update: {
      state: "up_to_date",
      current: version,
      target: "",
      ready: "",
      busy: "",
      availableVersion: "",
      stagedFreshRunRequired: null
    }
  }
}

export function okResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}
