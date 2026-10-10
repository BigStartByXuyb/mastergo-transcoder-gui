import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BoardNewTaskDialog } from "@/app/board-new-task-dialog"
import type { BoardTaskForm } from "@/lib/board-form"
import type { useIdentityFill } from "@/app/use-identity-fill"

/*
 * 创建任务弹窗：一行一个链接＝一行一个页面，所以走 A 路线时每行各有一个选图框（一行配一张图）。
 * 选图只交「哪一行选了哪一份文件」，暂存与尺寸核对在任务建出来之后（ui/src/lib/stage-design-images.ts）。
 */

const LINK = "https://mastergo.com/goto/x?file=1&layer_id=2:3"
const OTHER = "https://mastergo.com/goto/y?file=1&layer_id=4:5"

/* 弹窗里的补全面板由 useIdentityFill 驱动：这一组用例与它无关，给一份不动的壳。 */
const IDENTITY = {
  busy: "",
  rows: [],
  run: async () => undefined,
  reset: () => undefined,
  take: async () => undefined
} as unknown as ReturnType<typeof useIdentityFill>

function form(patch: Partial<BoardTaskForm> = {}): BoardTaskForm {
  return { projectRoot: "", ui: "", mode: "A", autoMerge: true, overwrite: false, stopAfter: "", links: LINK, ...patch }
}

function show(patch: Partial<Parameters<typeof BoardNewTaskDialog>[0]> = {}) {
  const onPickImage = vi.fn()
  // 弹窗挂在自己的门户上，所以文件框从 document 上取（不在 render 的容器里）。
  render(
    <BoardNewTaskDialog
      open={true}
      form={form()}
      images={{}}
      busy={false}
      automation="assist"
      identity={IDENTITY}
      identityFailure=""
      onChange={() => undefined}
      onPickImage={onPickImage}
      onOpenChange={() => undefined}
      onSubmit={() => undefined}
      onFill={() => undefined}
      {...patch}
    />
  )
  return {
    onPickImage,
    inputs: Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[]
  }
}

describe("BoardNewTaskDialog 的选图", () => {
  it("走 A 路线：一行一个选图框", () => {
    const { inputs } = show({ form: form({ links: LINK + "\n" + OTHER }) })
    expect(inputs.length).toBe(2)
    expect(screen.getByText("第 1 行")).toBeTruthy()
    expect(screen.getByText("第 2 行")).toBeTruthy()
  })

  it("选的是哪一行的那一份：按链接交出去", () => {
    const file = new File(["x"], "Second.design.png", { type: "image/png" })
    const { onPickImage, inputs } = show({ form: form({ links: LINK + "\n" + OTHER }) })
    fireEvent.change(inputs[1], { target: { files: [file] } })
    expect(onPickImage).toHaveBeenCalledWith(OTHER, file)
  })

  it("只有一行时也照给（Target 空着不影响）", () => {
    const { inputs } = show({ form: form({ links: LINK }) })
    expect(inputs.length).toBe(1)
    expect(screen.getByText("第 1 行")).toBeTruthy()
  })

  it("不跑 A 路线就不给选图", () => {
    const { inputs } = show({ form: form({ mode: "B" }) })
    expect(inputs.length).toBe(0)
    expect(screen.queryByText("第 1 行")).toBeNull()
  })

  it("行还没写时说明一行配一张", () => {
    show({ form: form({ links: "" }) })
    expect(screen.getByText(/一行一个页面，一行配一张图/)).toBeTruthy()
  })
})
