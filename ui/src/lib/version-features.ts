import { compareVersions } from "@/lib/update-state"

/*
 * 每个版本「从它起具备哪些关键能力」，来源是 changelog.json 里结构化的 features。
 * 回退前拿它比对：目标版本缺了当前版本有的哪些能力，就在确认弹窗里一条条列出来。
 *
 * 规则：能力是累加的（0.6.12 加的能力，0.6.13 也有）；某一版去掉了某个能力就在 drops 里写 id。
 */

export type VersionFeature = { id: string; label: string }

export type FeatureHistoryEntry = {
  version: string
  features?: VersionFeature[]
  drops?: string[]
}

/** 到 upTo 这一版为止具备的能力（按能力 id 去重，后加的 label 覆盖先加的）。 */
export function featuresUpTo(history: FeatureHistoryEntry[], upTo: string): Map<string, VersionFeature> {
  const known = new Map<string, VersionFeature>()
  for (const entry of history) {
    if (compareVersions(entry.version, upTo) > 0) continue
    for (const feature of entry.features ?? []) known.set(feature.id, feature)
    for (const id of entry.drops ?? []) known.delete(id)
  }
  return known
}

/** 从当前版本回退到 target 会缺掉的能力：当前有、目标没有的那些。 */
export function missingFeatures(
  history: FeatureHistoryEntry[],
  target: string,
  current: string
): VersionFeature[] {
  const atTarget = featuresUpTo(history, target)
  const atCurrent = featuresUpTo(history, current)
  const missing: VersionFeature[] = []
  for (const [id, feature] of atCurrent) {
    if (!atTarget.has(id)) missing.push(feature)
  }
  return missing
}
