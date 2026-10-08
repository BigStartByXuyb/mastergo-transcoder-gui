import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DesignImageCard } from "@/app/design-image-card"
import type { BoardTask, DesignImage } from "@/lib/api"
import { drive } from "@/lib/settings-fixtures"

/*
 * 作业A 的读图输入：图在哪、尺寸对不对、分组表在不在，以及传一张图这一条路。
 * 判定（尺寸不一致、不是位图）的判据在后端，这里只验界面把后端说的照实渲染、把文件按约定传上去。
 */

// 夹具路径按段拼（drive 在 settings-fixtures 里）：源码里不出现「盘符 + 反斜杠」那种机器专属写法。
const WORK_DIR = drive("D", "work", "task-1")
const INPUTS = drive("D", "work", "task-1", "Generated", "_inputs")

function task(): BoardTask {
  return {
    id: "task-1",
    createdAt: "",
    updatedAt: "",
    state: "running",
    stateLabel: "运行中",
    request: {
      mode: "A",
      link: "",
      target: "DemoPage",
      ui: "F7",
      projectRoot: drive("D", "project"),
      fileId: "",
      layerId: "",
      stopAfter: "",
      overwrite: false
    },
    jobId: "",
    workDir: WORK_DIR,
    autoMerge: false,
    progress: null,
    steps: [],
    aiFills: [],
    failure: null,
    merge: null,
    resolutions: {},
    error: ""
  } as unknown as BoardTask
}

function state(over: Partial<DesignImage> = {}): DesignImage {
  return {
    dir: INPUTS,
    canvas: { width: 1280, height: 1024 },
    image: null,
    matches: false,
    groups: { path: INPUTS + "\\DemoPage.layout-groups.json", exists: false },
    ...over
  }
}

const IMAGE = { path: INPUTS + "\\DemoPage.design.png", name: "DemoPage.design.png", bytes: 2048, width: 1280, height: 1024 }

function stub(payload: DesignImage, hooks: { onSave?: (body: unknown) => void; save?: DesignImage | { code: string; message: string; hint: string } } = {}) {
  vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body))
      hooks.onSave?.(body)
      const result = hooks.save ?? payload
      if (result && "code" in result) {
        return Promise.resolve(new Response(JSON.stringify({ ok: false, error: result }), { status: 400 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, image: result }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, image: payload }), { status: 200 }))
  })
}

function pick(name: string) {
  const input = document.querySelector("input[type=file]") as HTMLInputElement
  const file = { name: name, size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } as unknown as File
  fireEvent.change(input, { target: { files: [file] } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("DesignImageCard", () => {
  it("没有图时：说清画板尺寸、图该放哪、分组表还没有", async () => {
    stub(state())
    render(<DesignImageCard task={task()} />)

    expect(await screen.findByText("没有图")).toBeTruthy()
    expect(screen.getByText("1280×1024")).toBeTruthy()
    expect(screen.getByText(/还没有。传上来的话放到/)).toBeTruthy()
    expect(screen.getByText("还没有", { selector: "span" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /选择位图/ })).toBeTruthy()
  })

  it("有图且与画板一致、分组表也在：三格事实都标出来", async () => {
    stub(state({ image: IMAGE, matches: true, groups: { path: "x", exists: true } }))
    render(<DesignImageCard task={task()} />)

    expect(await screen.findByText("有图")).toBeTruthy()
    expect(screen.getByText("尺寸一致")).toBeTruthy()
    expect(screen.getByText("DemoPage.design.png")).toBeTruthy()
    expect(screen.getByText("2 KB")).toBeTruthy()
    expect(screen.getByText("有")).toBeTruthy()
    expect(screen.getByRole("button", { name: /换一张/ })).toBeTruthy()
  })

  it("尺寸不一致、或漏了分组表：都当场说清（那两条判据是第 8 步的）", async () => {
    stub(state({ image: IMAGE, matches: false }))
    render(<DesignImageCard task={task()} />)

    expect(await screen.findByText("尺寸不一致")).toBeTruthy()
    expect(screen.getByText("缺分组表")).toBeTruthy()
  })

  it("选一张图：按 base64 传上去（不用传文件名，格式由内容定），界面换成新状态", async () => {
    let sent: { data?: string; target?: string } = {}
    stub(state(), {
      onSave: (body) => (sent = body as { data: string; target: string }),
      save: state({ image: IMAGE, matches: true, groups: { path: "x", exists: true } })
    })
    render(<DesignImageCard task={task()} />)
    await screen.findByText("没有图")

    pick("DemoPage.design.png")
    await waitFor(() => expect(sent.target).toBe("DemoPage"))
    expect(sent.target).toBe("DemoPage")
    expect(sent.data).toBe(Buffer.from([1, 2, 3, 4]).toString("base64"))
    expect(await screen.findByText("有图")).toBeTruthy()
  })

  it("后端按原话拒绝时：把那句话与它的修法显示出来", async () => {
    stub(state(), {
      save: { code: "SIZE_MISMATCH", message: "图与画板尺寸不一致：图 1280×1023，画板 1280×1024", hint: "按设计稿原始尺寸导出。" }
    })
    render(<DesignImageCard task={task()} />)
    await screen.findByText("没有图")

    pick("DemoPage.design.png")
    expect(await screen.findByText(/图与画板尺寸不一致：图 1280×1023，画板 1280×1024/)).toBeTruthy()
    expect(screen.getAllByText(/按设计稿原始尺寸导出。/).length).toBeGreaterThan(0)
  })
})
