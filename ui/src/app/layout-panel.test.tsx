import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LayoutPanel } from "@/app/layout-panel"
import type { DerivedLayout, LayoutControl, LayoutGroup } from "@/lib/api"
import { drive } from "@/lib/settings-fixtures"

/*
 * 布局确认面板：控件编号、分组、AI 辅助与「写入分组表并继续」这几件东西都在，且照后端说的渲染。
 * 判据（组名、成员、写回校验）在后端 lib/layout-groups.js，这里只验界面把清单摆出来、把分组交回去。
 */

const WORK_DIR = drive("D", "work", "task-1")

function control(ref: string, controlType: string, text: string): LayoutControl {
  return { ref: ref, controlType: controlType, text: text, absX: 0, absY: 0, w: 100, h: 40 }
}

const CONTROLS = [
  control("1:9", "IconButton", "确定"),
  control("1:10", "IconButton", "取消"),
  control("1:11", "TextBlock", "标题")
]

/*
 * 后端那几个接口：布局读 /api/layout-groups，开关读 /api/settings，写回走 /api/confirm。
 * confirmError 用来验「后端拒绝时把它的原话显示出来」（校验判据只在后端一处）。
 */
function stub(
  options: {
    controls?: LayoutControl[]
    groups?: LayoutGroup[]
    available?: boolean
    onConfirm?: (body: unknown) => void
    confirmError?: { code: string; message: string; hint: string }
    /** 「自动通过」的当前值：随布局读数一起给（面板不再另取设置）。 */
    autoPass?: boolean
    /** AI 候选：默认给一组，传 [] 验「模型一组没给」时的提示。 */
    suggestGroups?: LayoutGroup[]
    /** 画板尺寸；传 null 验「还没跑到固化快照那一步」时不画布。 */
    canvas?: { width: number; height: number } | null
    /** 这一页那张图的身份（空串＝没有图）；传 "" 验「画布只给编号、不给隐藏按钮」。 */
    imageStamp?: string
    /** 推导出来的布局；默认「还没跑过」。 */
    derived?: DerivedLayout
  } = {}
) {
  const available = options.available !== false
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("/api/confirm")) {
      options.onConfirm?.(JSON.parse(String(init?.body)))
      if (options.confirmError) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: options.confirmError }), { status: 400 })
        )
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, written: [], job: null }), { status: 200 }))
    }
    if (url.includes("/api/settings")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, settings: { layoutAutoPass: false, automation: "assist" } }), { status: 200 })
      )
    }
    if (url.includes("/api/ai/suggest")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, groups: options.suggestGroups ?? [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }] }), { status: 200 })
      )
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          layout: {
            available: available,
            reason: available ? "" : "还没有类型判定产物（流水线尚未跑到第 5 步的类型判定）",
            controls: options.controls ?? CONTROLS,
            // 画板尺寸：界面拿它把控件坐标换算成百分比（编号画到图上）；判据在后端。
            canvas: options.canvas === undefined ? { width: 1000, height: 500 } : options.canvas,
            imageStamp: options.imageStamp === undefined ? "2048-1" : options.imageStamp,
            derived: options.derived ?? { available: false, reason: "还没有推导产物", regions: [], unresolved: [] },
            groups: options.groups ?? [],
            hasGroups: (options.groups ?? []).length > 0,
            // 后端的口径：控件够不够问 AI 由它给（阈值在 lib/layout-groups.js），界面照它禁用按钮。
            canSuggest: (options.controls ?? CONTROLS).length >= 2,
            autoPass: options.autoPass === true
          }
        }),
        { status: 200 }
      )
    )
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function panel() {
  return (
    <LayoutPanel taskId="task-1" runId="job-1" resume projectRoot={WORK_DIR} target="DemoPage" updatedAt="" state="waiting" />
  )
}

describe("LayoutPanel", () => {
  it("控件按清单次序编号，未分组的都在等分组", async () => {
    stub()
    render(panel())

    expect(await screen.findByText("布局确认")).toBeTruthy()
    expect(screen.getByText("#1 IconButton · 确定")).toBeTruthy()
    expect(screen.getByText("#2 IconButton · 取消")).toBeTruthy()
    expect(screen.getByText("#3 TextBlock · 标题")).toBeTruthy()
    expect(screen.getByText("未分组控件（3）")).toBeTruthy()
    // 没有分组时给一句出路：空分组表就是「本页没有要声明的分组」。
    expect(screen.getByText(/写出空分组表/)).toBeTruthy()
  })

  it("画布：编号与清单同源，设计稿能盖掉只看编号", async () => {
    stub()
    render(panel())

    expect(await screen.findByText("画布")).toBeTruthy()
    // 号就是清单里的号（两处读同一份 controls 的次序）。
    expect(screen.getByText("1")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
    expect(screen.getByAltText("这一页的设计稿位图")).toBeTruthy()

    fireEvent.click(screen.getByText("隐藏设计稿"))
    expect(screen.queryByAltText("这一页的设计稿位图")).toBeNull()
    expect(screen.getByText("显示设计稿")).toBeTruthy()
  })

  it("画板尺寸还不知道时不给画布（固化快照那一步还没跑到）", async () => {
    stub({ canvas: null })
    render(panel())

    expect(await screen.findByText("布局确认")).toBeTruthy()
    expect(screen.queryByText("画布")).toBeNull()
  })

  it("这一页没传图时：画布照样给编号，但不给那颗「隐藏设计稿」", async () => {
    stub({ imageStamp: "" })
    render(panel())

    expect(await screen.findByText("画布")).toBeTruthy()
    expect(screen.getByText("1")).toBeTruthy()
    expect(screen.queryByText("隐藏设计稿")).toBeNull()
    expect(screen.queryByAltText("这一页的设计稿位图")).toBeNull()
  })

  it("点布局树上的一行：那一行盖住的控件在画布上被描出来，再点一下取消", async () => {
    stub({
      derived: {
        available: true,
        reason: "",
        regions: [
          {
            id: "work-area",
            name: "工作区",
            emit: true,
            cells: [{ ref: "1:9", row: 1, column: 1, rowSpan: 1, columnSpan: 1 }]
          }
        ],
        unresolved: []
      }
    })
    render(panel())
    await screen.findByText("画布")

    const marked = () => document.querySelector('[data-ref="1:9"][data-highlighted="true"]')
    expect(marked()).toBeNull()

    // 树上控件那一行按 value 显示（「确定」是这张夹具里 #1 的文本），末尾带号。
    fireEvent.click(screen.getByText("确定 · #1（第 1 列）"))
    expect(marked()).toBeTruthy()

    fireEvent.click(screen.getByText("确定 · #1（第 1 列）"))
    expect(marked()).toBeNull()
  })

  it("已有分组按组渲染成员编号，自动通过默认关", async () => {
    stub({ groups: [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }] })
    render(panel())

    expect(await screen.findByText("RightTools")).toBeTruthy()
    expect(screen.getByText("列")).toBeTruthy()
    expect(screen.getByText("2 个控件")).toBeTruthy()
    expect(screen.getByText("#1 IconButton · 确定")).toBeTruthy()
    expect(screen.getByText("未分组控件（1）")).toBeTruthy()
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false")
  })

  // 全局开关的当前值随布局读数一起回来：设置那一页读不到也照样显示（这里把 /api/settings 打掉）。
  it("「自动通过」的值随布局读数一起给，不依赖设置读得出来", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/settings")) return Promise.resolve(new Response("boom", { status: 500 }))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            layout: { available: true, reason: "", controls: CONTROLS, canvas: null, imageStamp: "", derived: { available: false, reason: "", regions: [], unresolved: [] }, groups: [], hasGroups: false, canSuggest: true, autoPass: true }
          }),
          { status: 200 }
        )
      )
    })
    render(panel())

    await screen.findByText("布局确认")
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true")
  })

  it("写入分组表并继续：把分组（ref）原样交给 /api/confirm，并从布局那一步续跑", async () => {
    let sent: { groups?: LayoutGroup[]; resume?: boolean; taskId?: string } = {}
    stub({
      groups: [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }],
      onConfirm: (body) => (sent = body as { groups: LayoutGroup[] })
    })
    render(panel())
    await screen.findByText("RightTools")

    screen.getByRole("button", { name: /写入分组表并继续/ }).click()
    await waitFor(() => expect(sent.resume).toBe(true))
    expect(sent.taskId).toBe("task-1")
    expect(sent.groups).toEqual([{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }])
    expect(await screen.findByText(/已确认，正在从布局推导继续/)).toBeTruthy()
  })

  it("后端拒绝时（例如组里只有 1 个控件）把它那句话原样显示", async () => {
    let sent: { groups?: LayoutGroup[] } = {}
    stub({
      groups: [{ id: "Half", kind: "row", members: ["1:9"] }],
      onConfirm: (body) => (sent = body as { groups: LayoutGroup[] }),
      confirmError: { code: "BAD_GROUP", message: "分组表第 1 项（Half）的 members 至少 2 个 ref", hint: "" }
    })
    render(panel())
    await screen.findByText("Half")

    screen.getByRole("button", { name: /写入分组表并继续/ }).click()
    // 前端不自己判一遍：照原样把这次编辑交出去，由后端的判据说不行。
    await waitFor(() => expect(sent.groups).toEqual([{ id: "Half", kind: "row", members: ["1:9"] }]))
    expect(await screen.findByText(/members 至少 2 个 ref/)).toBeTruthy()
  })

  it("AI 一组都没给时说一句（空表＝本页没有要声明的分组），不让人以为点了没反应", async () => {
    stub({ suggestGroups: [] })
    render(panel())
    await screen.findByText("布局确认")

    const button = screen.getByRole("button", { name: /AI 辅助/ })
    expect(button.hasAttribute("disabled")).toBe(false)
    button.click()
    expect(await screen.findByText(/模型没有给出分组/)).toBeTruthy()
  })

  it("还没有控件清单时：按后端给的原因说清，不给编辑入口", async () => {
    stub({ available: false })
    render(panel())

    expect(await screen.findByText(/还没有类型判定产物/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /写入分组表并继续/ })).toBeNull()
  })

  it("任务还在跑时：能改分组，但「写入分组表并继续」不给点（续跑会起第二次运行）", async () => {
    stub({ groups: [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }] })
    render(
      <LayoutPanel
        taskId="task-1"
        runId="job-1"
        resume
        projectRoot={WORK_DIR}
        target="DemoPage"
        updatedAt=""
        state="running"
      />
    )

    await screen.findByText("RightTools")
    expect(screen.getByRole("button", { name: /写入分组表并继续/ }).hasAttribute("disabled")).toBe(true)
    // 提示里说的按钮名要与本面板那个按钮一致（别指向待补全面板的「确认并继续」）。
    expect(screen.getByText(/流水线正在跑：等它停下来再点「写入分组表并继续」/)).toBeTruthy()
  })
})
