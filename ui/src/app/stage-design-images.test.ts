import { afterEach, describe, expect, it, vi } from "vitest"

import { STAGE_FAILED_NOTE, picksForCreated, picksForRoute, stagePickedImages } from "@/app/stage-design-images"

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

describe("picksForRoute", () => {
  const picks = [{ taskId: "task-1", file: file("a") }]

  it("跑 A / AB 才送：不跑 A 时选的图不算数", () => {
    expect(picksForRoute("A", picks)).toEqual(picks)
    expect(picksForRoute("AB", picks)).toEqual(picks)
    expect(picksForRoute("B", picks)).toEqual([])
  })
})

describe("picksForCreated", () => {
  const one = { link: "https://a" }
  const two = { link: "https://b" }
  const three = { link: "https://c" }

  it("一行对一条任务：created 与 items 同一个次序", () => {
    const images = { "https://a": file("a"), "https://c": file("c") }
    expect(picksForCreated([one, two, three], ["t1", "t2", "t3"], images).map((pick) => pick.taskId)).toEqual(["t1", "t3"])
  })

  it("没选图的行跳过，后面几行照旧", () => {
    const images = { "https://b": file("b") }
    expect(picksForCreated([one, two], ["t1", "t2"], images).map((pick) => pick.taskId)).toEqual(["t2"])
  })

  it("任务没建出来（created 短了）就不送那一行", () => {
    const images = { "https://a": file("a"), "https://b": file("b") }
    expect(picksForCreated([one, two], ["t1"], images).map((pick) => pick.taskId)).toEqual(["t1"])
  })
})
