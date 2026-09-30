import { describe, expect, it } from "vitest"

import { featuresUpTo, missingFeatures, type FeatureHistoryEntry } from "@/lib/version-features"

const history: FeatureHistoryEntry[] = [
  { version: "0.6.0", features: [{ id: "chat", label: "对话页" }] },
  { version: "0.6.12", features: [{ id: "auto-update", label: "自己发现新版" }] },
  { version: "0.6.20", features: [{ id: "history-download", label: "历史版本可下载" }] },
  { version: "0.6.22", features: [{ id: "switch-confirm", label: "换版本先确认" }] }
]

describe("featuresUpTo", () => {
  it("能力是累加的：后面的版本带着前面加的能力", () => {
    expect([...featuresUpTo(history, "0.6.20").keys()]).toEqual(["chat", "auto-update", "history-download"])
  })

  it("比这一版新的能力不算进来", () => {
    expect(featuresUpTo(history, "0.6.11").has("auto-update")).toBe(false)
  })

  it("drops 里的能力被去掉", () => {
    const withDrop: FeatureHistoryEntry[] = [...history, { version: "0.6.30", drops: ["chat"] }]
    expect(featuresUpTo(withDrop, "0.6.30").has("chat")).toBe(false)
    expect(featuresUpTo(withDrop, "0.6.22").has("chat")).toBe(true)
  })
})

describe("missingFeatures", () => {
  it("回退到旧版会说清缺了哪几样", () => {
    expect(missingFeatures(history, "0.6.11", "0.6.22").map((item) => item.id)).toEqual([
      "auto-update",
      "history-download",
      "switch-confirm"
    ])
  })

  it("升级时什么都不缺", () => {
    expect(missingFeatures(history, "0.6.30", "0.6.22")).toEqual([])
  })

  it("同一个版本之间没有差异", () => {
    expect(missingFeatures(history, "0.6.20", "0.6.20")).toEqual([])
  })
})
