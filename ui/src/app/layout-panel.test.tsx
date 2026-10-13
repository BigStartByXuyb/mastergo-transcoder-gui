import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LayoutPanel } from "@/app/layout-panel"
import { bands, cell } from "@/lib/layout-fixtures"
import type { DerivedLayout, LayoutControl, LayoutGroup, LayoutGroups } from "@/lib/api"
import { drive } from "@/lib/settings-fixtures"

/*
 * 布局确认面板：控件编号、分组、AI 辅助与「写入分组表并继续」这几件东西都在，且照后端说的渲染。
 * 判据（组名、成员、写回校验）在后端 lib/layout-groups.js，这里只验界面把清单摆出来、把分组交回去。
 */

const WORK_DIR = drive("D", "work", "task-1")

/* 几种「不能问模型」的读数：后端 suggestBlocker 的原话（面板只显示，不反推）。 */
const NO_IMAGE_SUGGEST = {
  ready: false,
  code: "NO_IMAGE",
  reason: "这一步要对着设计稿位图判分组：这一页还没有传图，没有可判断的输入",
  hint: "先在「设计稿位图」那一栏传一张本页的图；这一页没有图时分组由机械判据决定，不必问模型。"
}
const NO_ENTRIES_SUGGEST = {
  ready: false,
  code: "NO_ENTRIES",
  reason: "这一层的条目凑不出分组（少于 2 条）：分组表里不声明任何组",
  hint: "这一层的分组结论不由模型给；直接写一张空表（空表是合法声明）。"
}
const NO_CANDIDATES_SUGGEST = {
  ready: false,
  code: "NO_CANDIDATES",
  reason: "还没有这一步的条目清单（Generated/_inputs/<页面>.layout-group-candidates.json）：作业A 第 8 步会把它落下来，它回答「分组表里能写哪些 ref」——先跑一次那一步",
  hint: "跑一次作业A 第 8 步（layout）之后再来问模型。"
}

function control(ref: string, controlType: string, text: string): LayoutControl {
  return { ref: ref, controlType: controlType, text: text, absX: 0, absY: 0, w: 100, h: 40, citable: true }
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
    /** 这一层的条目清单；不给就按控件清单那一拨条目给（可引用 ref 与控件一致）。 */
    candidates?: LayoutGroups["candidates"]
    /** 「能不能问模型」那份读数（后端 suggestBlocker 的原话）；不给按「能问」算。 */
    suggest?: LayoutGroups["suggest"]
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
            derived: options.derived ?? { available: false, reason: "还没有推导产物", regions: [], unplaced: [], singles: [] },
            groups: options.groups ?? [],
            hasGroups: (options.groups ?? []).length > 0,
            // 这一层的可引用条目：不给就按控件清单那一拨（ref / 类型 / 文本）拼一份。
            candidates:
              options.candidates ??
              {
                available: true,
                reason: "",
                pageTarget: "DemoPage",
                entries: (options.controls ?? CONTROLS).map((item) => ({
                  ref: item.ref,
                  controlType: item.controlType,
                  text: item.text
                }))
              },
            // 后端的口径：能不能问模型、不能问是哪一件事都由它给（lib/layout-groups.js 的 suggestBlocker 一处算）。
            suggest: options.suggest ?? { ready: true, code: "", reason: "", hint: "" },
            hasImage: options.imageStamp !== "",
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
    expect(screen.getByText("未分组条目（3）")).toBeTruthy()
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
            bands: bands(1, 1),
            cells: [cell("1:9", "IconButton")]
          }
        ],
        unplaced: [],
        singles: []
      }
    })
    render(panel())
    await screen.findByText("画布")

    const marked = () => document.querySelector('[data-ref="1:9"][data-highlighted="true"]')
    expect(marked()).toBeNull()

    // 树上控件那一行：清单里的号 + 它的 value（「确定」是这张夹具里 #1 的文本）。
    fireEvent.click(screen.getByText("#1 确定"))
    expect(marked()).toBeTruthy()

    fireEvent.click(screen.getByText("#1 确定"))
    expect(marked()).toBeNull()
  })

  /*
   * 读数刷新（同一页重跑布局那一步）之后，树上那一行盖住的控件可能已经变了：
   * 画布要按当前读数描，不能拿点当时那一份。选中态只存 key，翻成 refs 只有 treeLinesOf 一处。
   */
  it("读数刷新后：那一行的高亮跟着当前读数走（不留点当时那一份）", async () => {
    const options: { derived: DerivedLayout } = {
      derived: {
        available: true,
        reason: "",
        unplaced: [],
        singles: [],
        regions: [
          { id: "work-area", name: "工作区", emit: true, bands: bands(1, 1), cells: [cell("1:9", "IconButton")] }
        ]
      }
    }
    stub(options)
    const view = render(
      <LayoutPanel taskId="task-1" runId="job-1" resume projectRoot={WORK_DIR} target="DemoPage" updatedAt="" state="waiting" />
    )
    await screen.findByText("画布")

    fireEvent.click(screen.getByText("工作区 · 发射 · 1 行 × 1 列"))
    expect(document.querySelector('[data-ref="1:9"][data-highlighted="true"]')).toBeTruthy()

    // 同一页重跑：这一行里换成了另一个控件（读数的触发点是 updatedAt）。
    options.derived = {
      ...options.derived,
      regions: [
        { id: "work-area", name: "工作区", emit: true, bands: bands(1, 1), cells: [cell("1:10", "IconButton")] }
      ]
    }
    view.rerender(
      <LayoutPanel taskId="task-1" runId="job-1" resume projectRoot={WORK_DIR} target="DemoPage" updatedAt="t1" state="waiting" />
    )

    await waitFor(() => expect(document.querySelector('[data-ref="1:10"][data-highlighted="true"]')).toBeTruthy())
    expect(document.querySelector('[data-ref="1:9"][data-highlighted="true"]')).toBeNull()
  })

  it("已有分组按组渲染成员编号，自动通过默认关", async () => {
    stub({ groups: [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }] })
    render(panel())

    expect(await screen.findByText("RightTools")).toBeTruthy()
    expect(screen.getByText("垂直布局")).toBeTruthy()
    expect(screen.getByText("2 个条目")).toBeTruthy()
    expect(screen.getByText("#1 IconButton · 确定")).toBeTruthy()
    expect(screen.getByText("未分组条目（1）")).toBeTruthy()
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
            layout: {
              available: true,
              reason: "",
              controls: CONTROLS,
              canvas: null,
              imageStamp: "",
              derived: { available: false, reason: "", regions: [], unplaced: [], singles: [] },
              candidates: {
                available: true,
                reason: "",
                pageTarget: "DemoPage",
                entries: CONTROLS.map((item) => ({ ref: item.ref, controlType: item.controlType, text: item.text }))
              },
              groups: [],
              hasGroups: false,
              suggest: { ready: false, code: "NO_IMAGE", reason: "这一步要对着设计稿位图判分组：这一页还没有传图", hint: "" },
              hasImage: false,
              autoPass: true
            }
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

  /*
   * 这一层能写哪些 ref 由「条目清单」定（插件第 8 步的产物）：
   * 清单不在 → 说清是哪一件事、不给写回；清单为空 → 这一层不参与分组，只写空表；
   * 清单外的控件 → 列出来但不给拖（拖了插件也会拒）。
   */
  it("条目清单不在时：照后端那句说清，写入与 AI 辅助都不给点", async () => {
    stub({
      suggest: NO_CANDIDATES_SUGGEST,
      candidates: {
        available: false,
        reason: "还没有这一步的条目清单（Generated/_inputs/<页面>.layout-group-candidates.json）：作业A 第 8 步会把它落下来，它回答「分组表里能写哪些 ref」——先跑一次那一步。",
        pageTarget: "",
        entries: []
      }
    })
    render(panel())

    expect(await screen.findByText(/还没有这一步的条目清单/)).toBeTruthy()
    expect(screen.getByRole("button", { name: /写入分组表并继续/ }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: /AI 辅助/ }).hasAttribute("disabled")).toBe(true)
    /* 清单不在 ≠ 这些条目写不进去：这时不分拨、也不逐个列名，只说清是哪一件事。 */
    expect(screen.queryByText(/不在这一层条目里、不能写进分组表/)).toBeNull()
  })

  it("条目清单为空时：说清「这一层不参与分组」，写入照样能给（写空表）", async () => {
    let sent: { groups?: LayoutGroup[] } = {}
    stub({
      suggest: NO_ENTRIES_SUGGEST,
      onConfirm: (body) => (sent = body as { groups: LayoutGroup[] }),
      candidates: { available: true, reason: "", pageTarget: "DemoPage", entries: [] }
    })
    render(panel())

    /* 这句是后端 suggestBlocker 的原话（NO_ENTRIES）：面板只显示，不自己推「为什么不能问」。 */
    expect(await screen.findByText(/这一层的条目凑不出分组（少于 2 条）：分组表里不声明任何组/)).toBeTruthy()
    const button = screen.getByRole("button", { name: /写入分组表并继续/ })
    expect(button.hasAttribute("disabled")).toBe(false)
    button.click()
    await waitFor(() => expect(sent.groups).toEqual([]))
  })

  it("清单外的控件列出来但不给拖：只有这一层的可引用条目能写进表", async () => {
    /* 后端的结论（`citable`）与实际清单一致：前两条在本层条目里，第三条不在（别层的控件）。 */
    const CONTROLS_WITH_ONE_OUTSIDE = [
      control("1:9", "IconButton", "确定"),
      control("1:10", "IconButton", "取消"),
      { ...control("1:11", "TextBlock", "标题"), citable: false }
    ]
    stub({
      suggest: NO_IMAGE_SUGGEST,
      controls: CONTROLS_WITH_ONE_OUTSIDE,
      candidates: {
        available: true,
        reason: "",
        pageTarget: "DemoPage",
        entries: [
          { ref: "1:9", controlType: "IconButton", text: "确定" },
          { ref: "1:10", controlType: "IconButton", text: "取消" }
        ]
      }
    })
    render(panel())

    expect(await screen.findByText("未分组条目（2）")).toBeTruthy()
    expect(screen.getByText(/不在这一层条目里、不能写进分组表（1）/)).toBeTruthy()
    expect(screen.getByText(/#3 TextBlock · 标题/)).toBeTruthy()
    // 可引用的那两条能拖（draggable），清单外的那条不能。
    const draggable = [...document.querySelectorAll("[draggable='true']")].map((node) => node.textContent)
    expect(draggable.join("、")).toContain("#1 IconButton · 确定")
    expect(draggable.join("、")).not.toContain("#3 TextBlock · 标题")
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
