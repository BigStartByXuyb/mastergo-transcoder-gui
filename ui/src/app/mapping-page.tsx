import { useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ClampText } from "@/app/clamp-text"
import { PixelLoader } from "@/app/pixel-loader"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type MappingMatch, type MappingView } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 映射表展示：只读。
 *
 * 内容来自后端 /api/mapping —— 它复用插件自己的加载器，所以这里看到的就是流水线实际用的那一份
 * （共享类型表 + 本路线写入规则的合并结果）。页面只负责把它摊开，不做任何判定。
 */

// 匹配键的人话说明。键的种类以映射表各族自己的 match 为准，界面不另立清单。
function describeMatch(match: MappingMatch | null | undefined) {
  if (!match) return "未登记 match"
  if (match.structural) return "结构签名匹配（" + (match.structural.variant ?? "表格") + "）"
  if (match.property) return "按公开属性匹配：" + match.property
  if (match.componentSet) return "按组件集名匹配"
  if (match.componentName) return "按被引用组件的名字匹配"
  return "未登记的匹配键"
}

export function MappingPage() {
  const [mapping, setMapping] = useState<MappingView | null>(null)
  const [failure, setFailure] = useState("")
  const [query, setQuery] = useState("")

  useEffect(() => {
    api
      .mapping()
      .then((payload) => setMapping(payload.mapping))
      .catch((error) => setFailure(describeFailure(error)))
  }, [])

  const needle = query.trim().toLowerCase()
  const families = useMemo(() => {
    if (!mapping) return []
    if (!needle) return mapping.families
    return mapping.families
      .map((family) => ({
        ...family,
        variants: family.variants.filter(
          (variant) =>
            family.key.toLowerCase().includes(needle) || variant.name.toLowerCase().includes(needle)
        )
      }))
      .filter((family) => family.variants.length > 0 || family.key.toLowerCase().includes(needle))
  }, [mapping, needle])

  if (failure) {
    return (
      <Alert variant="destructive">
        <AlertTitle>读不到映射表</AlertTitle>
        <AlertDescription>
          <ClampText text={failure} />
        </AlertDescription>
      </Alert>
    )
  }
  if (!mapping) return <PixelLoader text="请稍等，正在读取映射表" className="py-6" />

  const bottomBar = mapping.layoutRules?.bottomBar
  const bottomBarVariants = Object.entries(bottomBar?.variants ?? {})
  // 搜索也覆盖底部栏变体：它们是 layoutRules 下的变体，不属于任何模板族，但用户按变体名找时
  // 并不知道这层区分（输入框提示词里就写着「底部栏」）。不覆盖就会出现「提示能搜、搜了全空」。
  const shownBottomBarVariants = needle
    ? bottomBarVariants.filter(([name]) => name.toLowerCase().includes(needle))
    : bottomBarVariants

  return (
    <div className="flex w-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>映射表</CardTitle>
          <CardDescription>
            只读。内容由插件自己的加载器合并（共享类型表 + 本路线写入规则），与流水线用的是同一份。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">插件 v{mapping.pluginVersion || "?"}</Badge>
            <Badge variant="outline">模板族 {mapping.families.length}</Badge>
            <Badge variant="outline">底部栏变体 {bottomBarVariants.length}</Badge>
            <Badge variant="outline">必写字段表 {Object.keys(mapping.requiredAttrs ?? {}).length}</Badge>
          </div>
          <div className="text-muted-foreground flex flex-col gap-1 font-mono text-xs break-all">
            <span>写入规则 {mapping.routePath}</span>
            <span>共享类型表 {mapping.sharedPath}</span>
          </div>
          <Input
            spellCheck={false}
            placeholder="搜族名或变体名，例如 选择框 / 底部栏 / 首页"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {mapping.warnings.length > 0 && (
            <div className="text-destructive text-xs">
              {mapping.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">组件模板族</CardTitle>
          <CardDescription>每族一个匹配键（键的种类以该族自己的 match 为准）。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border">
            {/* 列宽按比例给：键再长也只换行，不把整张表撑出容器。 */}
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[28%]">族</TableHead>
                  <TableHead className="w-[32%]">匹配键</TableHead>
                  <TableHead>变体</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {families.map((family) => (
                  <TableRow key={family.key}>
                    <TableCell className="font-mono text-xs break-all whitespace-normal">{family.key}</TableCell>
                    <TableCell className="text-xs whitespace-normal">{describeMatch(family.match)}</TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap gap-1">
                        {family.variants.map((variant) => (
                          <Badge key={variant.name} variant="outline" className="max-w-full" title={variant.name}>
                            {variant.name}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {families.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground py-6 text-center text-sm">
                      {shownBottomBarVariants.length > 0 ? "没有匹配的族（底部栏变体见下一张卡片）" : "没有匹配的族"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {bottomBar && (!needle || shownBottomBarVariants.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">布局规则：底部栏</CardTitle>
            <CardDescription>
              {describeMatch(bottomBar.match)}。未命中变体的实例会计入{" "}
              <span className="font-mono">unresolvedBottomBarItems</span>，非 0 时第 8 步拒绝生成。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {bottomBar.residentGroupPattern && (
                <span>
                  常驻分组匹配 <span className="font-mono">{bottomBar.residentGroupPattern}</span>
                </span>
              )}
              {bottomBar.fKeyPattern && (
                <span>
                  F 键 <span className="font-mono">{bottomBar.fKeyPattern}</span>
                </span>
              )}
              {bottomBar.decorativeNamePattern && (
                <span>
                  装饰名 <span className="font-mono">{bottomBar.decorativeNamePattern}</span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {shownBottomBarVariants.length === 0 && (
                <span className="text-muted-foreground">映射表里没有登记底部栏变体</span>
              )}
              {shownBottomBarVariants.map(([name, spec]) => (
                <Badge key={name} variant={spec?.topLeftContent === "text" ? "secondary" : "outline"}>
                  {name}
                  {spec?.topLeftContent === "text" ? " · 有 F 键槽位" : ""}
                </Badge>
              ))}
            </div>
            {(bottomBar.menuItemAlwaysWrittenAttrs ?? []).length > 0 && (
              <div className="text-muted-foreground text-xs">
                恒写属性 <span className="font-mono">{bottomBar.menuItemAlwaysWrittenAttrs?.join(" / ")}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ControlType 必写字段</CardTitle>
          <CardDescription>登记在映射表里的必须发射字段；没登记的 ControlType 不在此列。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[24%]">ControlType</TableHead>
                  <TableHead>必写字段</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(mapping.requiredAttrs ?? {}).map(([type, attrs]) => (
                  <TableRow key={type}>
                    <TableCell className="font-mono text-xs whitespace-normal">{type}</TableCell>
                    <TableCell className="font-mono text-xs break-all whitespace-normal">
                      {Array.isArray(attrs) ? attrs.join(" / ") : String(attrs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">其它规则键</CardTitle>
          <CardDescription>同在一份映射表里的固定口径（按钮族图标字段、换行策略、对齐口径等）。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {mapping.ruleKeys.map((rule) => (
            <Badge key={rule.key} variant="outline">
              {rule.key} · {rule.entries}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
