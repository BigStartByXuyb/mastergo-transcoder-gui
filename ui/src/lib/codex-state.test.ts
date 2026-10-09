import { describe, expect, it } from "vitest"

import type { CodexStatus } from "@/lib/api"
import {
  canDownload,
  canRollback,
  canSwitchTo,
  describeEngine,
  describeRelease,
  describeVersion,
  stateLabel
} from "@/lib/codex-state"

function status(overrides: Partial<CodexStatus> = {}): CodexStatus {
  return {
    pinned: "1.2.3",
    engine: { version: "1.2.3", source: "managed", path: at("app", "codex.exe"), state: "verified" },
    versions: [
      { version: "1.2.3", path: at("app", "1.2.3", "codex.exe"), state: "verified", note: "1.2.3", active: true, ready: true },
      { version: "0.158.0", path: at("app", "0.158.0", "codex.exe"), state: "untested", note: "", active: false, ready: true },
      { version: "0.157.0", path: at("app", "0.157.0", "codex.exe"), state: "broken", note: "起不来", active: false, ready: false }
    ],
    system: [],
    isolated: { codexHome: at("app", "agents", "codex", "home"), exists: true, keyEnv: "（夹具）KEY_ENV" },
    pointer: null,
    release: { version: "1.2.3", tag: "rust-v1.2.3", checkedAt: "2026-09-30T00:00:00.000Z", missing: [], newer: false },
    busy: "",
    error: null,
    task: { phase: "idle", done: 0, total: 0, downloaded: 0, error: null },
    ...overrides
  }
}

/* 造一个 Windows 绝对路径：直接写盘符会被结构检查当成写死的机器路径。 */
function at(...parts: string[]): string {
  return ["C:", ...parts].join("\\")
}

describe("现在用的是哪一份", () => {
  it("还没读到状态时只说读取中", () => {
    expect(describeEngine(null)).toEqual({ label: "读取中…", tone: "outline", note: "" })
  })

  it("一份都没有时给出去哪弄", () => {
    const summary = describeEngine(status({ engine: null }))
    expect(summary.tone).toBe("destructive")
    expect(summary.label).toContain("还没有可用的 Codex")
    expect(summary.note).toContain("下载")
  })

  it("下载版说「客户端下载的」，本机版说「本机装的」", () => {
    expect(describeEngine(status()).label).toBe("客户端下载的 v1.2.3")
    expect(
      describeEngine(status({ engine: { version: "0.158.0", source: "system", path: at("x.exe"), state: "untested" } })).label
    ).toBe("本机装的 v0.158.0")
  })

  it("起不来的一份直接标红", () => {
    const summary = describeEngine(status({ engine: { version: "0.157.0", source: "managed", path: at("x.exe"), state: "broken" } }))
    expect(summary.tone).toBe("destructive")
    expect(summary.note).toContain("起不来")
  })

  it("状态词与来源词都是固定说法", () => {
    expect(stateLabel("verified")).toBe("自检通过")
    expect(stateLabel("untested")).toBe("没验证过")
    expect(stateLabel("broken")).toBe("起不来")
  })
})

describe("远端那一版", () => {
  it("没检查过就说没检查过", () => {
    expect(describeRelease(status({ release: null }))).toBe("还没检查过远端版本。")
    expect(describeRelease(null)).toBe("")
  })

  it("同号就说已是最新，高一版就提示有新版", () => {
    expect(describeRelease(status())).toBe("已是最新 v1.2.3。")
    expect(
      describeRelease(
        status({ release: { version: "0.160.0", tag: "rust-v0.160.0", checkedAt: "", missing: [], newer: true } })
      )
    ).toBe("远端有 v0.160.0，比现在用的新。")
  })

  it("缺程序时优先说缺了什么", () => {
    const text = describeRelease(
      status({ release: { version: "0.160.0", tag: "rust-v0.160.0", checkedAt: "", missing: ["codex-command-runner"], newer: true } })
    )
    expect(text).toContain("codex-command-runner")
  })

  it("检查失败的原因也走这里", () => {
    expect(describeRelease(status({ error: { code: "OFFLINE", message: "连不上 GitHub", hint: "看网络" } }))).toBe(
      "连不上 GitHub：看网络"
    )
  })
})

describe("能不能切", () => {
  it("有任务在跑就都不给切", () => {
    expect(canSwitchTo(status({ busy: "转码中" }), "0.158.0")).toBe(false)
    expect(canRollback(status({ busy: "转码中", pointer: { version: "", previous: "1.2.3" } }))).toBe(false)
  })

  it("当前这一版、没下载完的、没有的都不给切", () => {
    expect(canSwitchTo(status(), "1.2.3")).toBe(false)
    expect(canSwitchTo(status(), "0.157.0")).toBe(false)
    expect(canSwitchTo(status(), "9.9.9")).toBe(false)
    expect(canSwitchTo(status(), "0.158.0")).toBe(true)
    expect(canSwitchTo(null, "0.158.0")).toBe(false)
  })

  it("切到本机那份要有本机版，且现在不是本机版", () => {
    expect(canSwitchTo(status(), "")).toBe(false)
    expect(canSwitchTo(status({ system: [{ version: "0.158.0", path: at("x.exe"), active: false }] }), "")).toBe(true)
    expect(
      canSwitchTo(
        status({
          engine: { version: "0.158.0", source: "system", path: at("x.exe"), state: "untested" },
          system: [{ version: "0.158.0", path: at("x.exe"), active: true }]
        }),
        ""
      )
    ).toBe(false)
  })

  it("回退只认指针里的上一份", () => {
    expect(canRollback(status())).toBe(false)
    expect(canRollback(status({ pointer: { version: "0.158.0", previous: "1.2.3" } }))).toBe(true)
    expect(canRollback(status({ pointer: { version: "0.158.0", previous: "" } }))).toBe(false)
  })

  it("版本行带上验证状态", () => {
    expect(describeVersion(status().versions[0])).toBe("v1.2.3（自检通过）")
    expect(describeVersion(status().versions[2])).toBe("v0.157.0（起不来）")
  })
})

describe("能不能下载", () => {
  it("检查过、清单齐全、本地还没有，才给下载", () => {
    expect(canDownload(status())).toBe(false)
    expect(
      canDownload(status({ release: { version: "0.160.0", tag: "rust-v0.160.0", checkedAt: "", missing: [], newer: true } }))
    ).toBe(true)
    expect(canDownload(null)).toBe(false)
    expect(
      canDownload(
        status({
          release: { version: "0.160.0", tag: "rust-v0.160.0", checkedAt: "", missing: ["codex-code-mode-host"], newer: true }
        })
      )
    ).toBe(false)
  })

  it("正在下载时按钮不给按", () => {
    const release = { version: "0.160.0", tag: "rust-v0.160.0", checkedAt: "", missing: [], newer: true }
    expect(
      canDownload(status({ release, task: { phase: "downloading", done: 1, total: 4, downloaded: 1, error: null } }))
    ).toBe(false)
    expect(
      canDownload(status({ release, task: { phase: "materializing", done: 4, total: 4, downloaded: 1, error: null } }))
    ).toBe(false)
  })
})
