import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

import { compareVersions, isNewer } from "@/lib/update-state"

// 版本比法前后端不能互相引代码：这里拿同一组夹具跑两边，任何一侧改口径都会让对拍失败。
const require_ = createRequire(import.meta.url)
const backend = require_("../../../lib/versions.js")

const PAIRS = [
  ["1.0.0", "1.0.1"],
  ["1.10.0", "1.9.0"],
  ["1.0", "1.0.0"],
  ["1.0.301", "1.0.302"],
  ["0.6.64", "0.6.63"],
  ["1.0.371-rc", "1.0.371"],
  ["", "1.0.0"]
]

describe("版本比较前后端同一口径", () => {
  for (const [left, right] of PAIRS) {
    it(`${left} 对 ${right}`, () => {
      expect(compareVersions(left, right)).toBe(backend.compareVersions(left, right))
      expect(compareVersions(right, left)).toBe(backend.compareVersions(right, left))
      expect(isNewer(left, right)).toBe(backend.isNewer(left, right))
      expect(isNewer(right, left)).toBe(backend.isNewer(right, left))
    })
  }
})
