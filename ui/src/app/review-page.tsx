import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function ReviewPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>待确认</CardTitle>
          <CardDescription>
            流水线停在需要判断的步骤时（图标命名、译文、未登记的控件），清单会出现在这里，确认后从断点继续。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">当前没有待确认项。</p>
        </CardContent>
      </Card>
    </div>
  )
}
