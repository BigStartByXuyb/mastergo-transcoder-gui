import { afterEach, describe, expect, it, vi } from "vitest"

import { stageDesignImages } from "@/lib/stage-design-images"

/*
 * 新建时先选好的位图 → 暂存件（一条任务一份）：走真的 api 层，只把 fetch 换掉。
 * 要验的是「每张图各送各的任务 id」与「一张被挡回来不连累其余几张」。
 */

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
})

describe("stageDesignImages", () => {
  it("每一张各送各的任务 id", async () => {
    const seen = stub(() => new Response(okBody, { status: 200 }))
    const failure = await stageDesignImages([
      { taskId: "task-1", file: file("a") },
      { taskId: "task-2", file: file("b") }
    ])
    expect(failure).toBe("")
    expect(seen.map((item) => item.taskId)).toEqual(["task-1", "task-2"])
    expect(seen.every((item) => item.data.length > 0)).toBe(true)
  })

  it("一张被挡回来不连累同一批里其余的，原话照后端给", async () => {
    const seen = stub((_url, body) =>
      body.taskId === "task-1"
        ? new Response(JSON.stringify({ error: { code: "BAD_IMAGE", message: "这张图不是位图", hint: "传 PNG / JPEG" } }), { status: 400 })
        : new Response(okBody, { status: 200 })
    )
    const failure = await stageDesignImages([
      { taskId: "task-1", file: file("a") },
      { taskId: "task-2", file: file("b") }
    ])
    expect(failure).toBe("这张图不是位图：传 PNG / JPEG")
    expect(seen.map((item) => item.taskId)).toEqual(["task-1", "task-2"])
  })

  it("都没选图时什么都不发", async () => {
    const seen = stub(() => new Response(okBody, { status: 200 }))
    expect(await stageDesignImages([])).toBe("")
    expect(seen).toEqual([])
  })
})
