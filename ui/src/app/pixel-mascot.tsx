/*
 * 像素小狐狸：设计转码这家伙的门面 —— 加载时出现在中间，也是浏览器标签上的图标。
 *
 * 精灵用字符网格写：`.` 空、`#` 描边、`a` 毛、`b` 亮毛。改形象就改这几行字。
 * ui/public/favicon.svg 是同一张图（静态图标没法 import 模块，改这里以后照着重画一遍）。
 */

const FOX = [
  "................",
  "..##........##..",
  ".#aa#......#aa#.",
  ".#aaaa####aaaa#.",
  ".#aaaaaaaaaaaa#.",
  ".#aaaaaaaaaaaa#.",
  ".#aa##aaaa##aa#.",
  ".#aaaaaaaaaaaa#.",
  ".#aaaabbbbaaaa#.",
  ".#aaaab##baaaa#.",
  ".#aaaabbbbaaaa#.",
  ".#aaaaaaaaaaaa#.",
  "..#aaaaaaaaaa#..",
  "...##aaaaaa##...",
  "....##aaaa##....",
  ".....######....."
]

// 指着文字的那只手：一小块爪子 + 一截小臂，跟着当前那个字走。
const HAND = [".###.", "#aaa#", "#aaa#", ".#a#.", "..#.."]

const PALETTE: Record<string, string> = {
  "#": "var(--pixel-ink, #3f3f46)",
  a: "var(--pixel-fur, #f59e0b)",
  b: "var(--pixel-fur-light, #fde68a)"
}

function sprite(grid: string[], cell: number) {
  const rects = []
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const fill = PALETTE[grid[y][x]]
      if (fill) rects.push(<rect key={x + ":" + y} x={x} y={y} width={1} height={1} fill={fill} />)
    }
  }
  return (
    <svg
      width={grid[0].length * cell}
      height={grid.length * cell}
      viewBox={"0 0 " + grid[0].length + " " + grid.length}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rects}
    </svg>
  )
}

export function PixelMascot(props: { cell?: number; className?: string }) {
  return <span className={props.className}>{sprite(FOX, props.cell ?? 4)}</span>
}

export function PixelHand(props: { cell?: number }) {
  return sprite(HAND, props.cell ?? 3)
}
