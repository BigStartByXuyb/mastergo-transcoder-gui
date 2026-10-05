import type { Health } from "@/lib/api"

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
