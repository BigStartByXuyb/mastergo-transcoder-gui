import { afterEach, describe, expect, it, vi } from "vitest"

import type { Board } from "@/lib/api"
import { STAGE_FAILED_NOTE, picksForCreated, stagePickedImages } from "@/app/stage-design-images"

/*
 * 新建时先选好的位图 → 暂存件（一条任务一份）：走真的 api 层，只把 fetch 与 toast 换掉。
 * 要验的是「每张图各送各的任务 id」「不跑 A 就不送」「一张被挡回来不连累其余几张，且原话弹得出来」。
 */

const toasted: string[] = []
vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => toasted.push(message)
  }
}))

function stub(handler: (url: string, body: { taskId: string; data: string }) => Response) {
  const seen: { taskId: string; data: string }[] = []
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : { taskId: "", data: "" }
    seen.push(body)
    return Promise.resolve(handler(String(input), body))
  })
  return seen
}

const okBody = JSON.stringify({ ok: true, staged: { path: "p", width: 1, height: 1 } })
/* 这一组只验编排：文件给一份能读出字节的壳就够（读字节本身的写法由 upload-files 那一处负责）。 */
const file = (content: string) =>
  ({ name: "picked.png", size: content.length, arrayBuffer: async () => new TextEncoder().encode(content).buffer }) as unknown as File

afterEach(() => {
  vi.unstubAllGlobals()
  toasted.length = 0
})

describe("stagePickedImages", () => {
  it("每一张各送各的任务 id", async () => {
    const seen = stub(() => new Response(okBody, { status: 200 }))
    await stagePickedImages("A", [
      { taskId: "task-1", file: file("a") },
      { taskId: "task-2", file: file("b") }
    ])
    expect(seen.map((item) => item.taskId)).toEqual(["task-1", "task-2"])
    expect(seen.every((item) => item.data.length > 0)).toBe(true)
    expect(toasted).toEqual([])
  })

  it("一张被挡回来不连累同一批里其余的，原话照后端给", async () => {
    const seen = stub((_url, body) =>
      body.taskId === "task-1"
        ? new Response(JSON.stringify({ error: { code: "BAD_IMAGE", message: "这张图不是位图", hint: "传 PNG / JPEG" } }), { status: 400 })
        : new Response(okBody, { status: 200 })
    )
    await stagePickedImages("A", [
      { taskId: "task-1", file: file("a") },
      { taskId: "task-2", file: file("b") }
    ])
    expect(seen.map((item) => item.taskId)).toEqual(["task-1", "task-2"])
    expect(toasted).toEqual(["这张图不是位图：传 PNG / JPEG" + STAGE_FAILED_NOTE])
  })

  it("都没选图时什么都不发", async () => {
    const seen = stub(() => new Response(okBody, { status: 200 }))
    await stagePickedImages("A", [])
    expect(seen).toEqual([])
  })

  it("不跑 A 路线就不送：选了也不送，也不弹提示", async () => {
    const seen = stub(() => new Response(okBody, { status: 200 }))
    await stagePickedImages("B", [{ taskId: "task-1", file: file("a") }])
    expect(seen).toEqual([])
    expect(toasted).toEqual([])
  })
})

describe("picksForCreated", () => {
  const one = { link: "https://a" }
  const two = { link: "https://b" }
  const three = { link: "https://c" }

  /* 看板快照里任务自己带着它的链接：配图按它配，不比次序。 */
  const board = (rows: { id: string; link: string }[]) =>
    ({ tasks: rows.map((row) => ({ id: row.id, request: { link: row.link } })) }) as unknown as Board

  it("有图的任务带上那张图，不看次序", () => {
    const images = { "https://a": file("a"), "https://c": file("c") }
    const snapshot = board([
      { id: "t3", link: three.link },
      { id: "t1", link: one.link },
      { id: "t2", link: two.link }
    ])
    expect(picksForCreated(snapshot, ["t1", "t2", "t3"], images).map((pick) => pick.taskId)).toEqual(["t1", "t3"])
  })

  it("没选图的任务跳过，别的照旧", () => {
    const images = { "https://b": file("b") }
    const snapshot = board([
      { id: "t1", link: one.link },
      { id: "t2", link: two.link }
    ])
    expect(picksForCreated(snapshot, ["t1", "t2"], images).map((pick) => pick.taskId)).toEqual(["t2"])
  })
})
