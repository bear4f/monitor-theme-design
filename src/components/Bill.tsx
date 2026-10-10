import { useMemo, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react"

import { deployed, Dot, Flag } from "@/components/NodeMarks"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Node } from "@/lib/api"
import {
  addMonths, billOf, cny, hubToday, manualRates, parseRates, RATES_DATE, renewalsBetween, summarise, type Bill as NodeBill,
} from "@/lib/bill"
import { useLiveRates } from "@/lib/fx"
import { CYCLES, money } from "@/lib/format"
import { cn } from "@/lib/utils"

/** A node's price for one period as its owner entered it: `$99.00 / 年付`. */
function Price({ bill, className }: { bill: NodeBill; className?: string }) {
  if (bill.price <= 0) return <span className={cn("text-muted-foreground", className)}>免费</span>
  return (
    <span className={cn("tnum", className)}>
      {money(bill.price, bill.currency)}
      <span className="font-normal text-muted-foreground"> / {CYCLES[bill.node.billing_cycle] ?? "月付"}</span>
    </span>
  )
}

/** One figure of the summary: what it is, the figure, and what it was counted from. */
function Stat({ label, value, note, title }: { label: string; value: ReactNode; note: ReactNode; title?: string }) {
  return (
    <div title={title} className="min-w-0 rounded-lg border border-border/80 bg-card p-4 shadow-xs">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tnum mt-2 truncate text-2xl font-bold tracking-tight text-foreground max-sm:text-xl">{value}</div>
      <div className="mt-1.5 truncate text-xs text-muted-foreground">{note}</div>
    </div>
  )
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]

const monthLabel = (month: string) => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`

/**
 * A month as the calendar lays it out: the weekday its first falls on, counted
 * from Monday, and how many days it has. In UTC, as every date here is.
 */
function monthShape(month: string) {
  const [y, m] = month.split("-").map(Number)
  return {
    lead: (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7,
    days: new Date(Date.UTC(y, m, 0)).getUTCDate(),
  }
}

/**
 * How long a node has left, in the words and the colour its urgency calls for:
 * past due in red, inside a week in amber, otherwise plain.
 */
function Remaining({ days }: { days: number | null }) {
  if (days === null) return null
  if (days < 0) return <Badge variant="destructive" className="px-1.5 py-0 text-[10px] font-normal">已过期 {-days} 天</Badge>
  if (days <= 7) return <Badge variant="warning" className="px-1.5 py-0 text-[10px] font-normal">剩余 {days} 天</Badge>
  return <span className={cn("tnum text-xs", days <= 30 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>剩余 {days} 天</span>
}

type SortKey = "due" | "monthly"

/**
 * What the fleet costs and when it next has to be paid for: the totals, a
 * calendar of renewals a month at a time, and each node's own line. Everything
 * is worked out from the price, cycle and expiry the nodes already carry, so
 * the page asks the hub for nothing.
 */
export function Bill({ nodes, rates: rateLines, live: liveOn }: { nodes: Node[]; rates: string; live: boolean }) {
  const { live, failed } = useLiveRates(liveOn)
  const rates = useMemo(() => parseRates(rateLines, live?.rates), [rateLines, live])
  const fixed = useMemo(() => manualRates(rateLines), [rateLines])
  const today = useMemo(() => hubToday(nodes), [nodes])
  const bills = useMemo(() => nodes.map((n) => billOf(n, rates, today)), [nodes, rates, today])
  const summary = useMemo(() => summarise(bills, today), [bills, today])

  const thisMonth = today.slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  // The day picked on the calendar, to narrow the month's list to it.
  const [day, setDay] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "due", desc: false })

  const renewals = useMemo(
    () => renewalsBetween(bills, `${month}-01`, addMonths(`${month}-01`, 1)),
    [bills, month],
  )
  const dueOn = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of renewals) map.set(r.date, (map.get(r.date) ?? 0) + 1)
    return map
  }, [renewals])
  const listed = day ? renewals.filter((r) => r.date === day) : renewals
  const listedTotal = listed.reduce((total, r) => total + (r.bill.cny ?? 0), 0)

  const turn = (by: number) => {
    setMonth(addMonths(`${month}-01`, by).slice(0, 7))
    setDay(null)
  }

  const rows = useMemo(() => {
    // Nodes with nothing to sort by go last whichever way the column runs.
    const value = (b: NodeBill) => (sort.key === "due" ? b.days : b.monthly)
    return [...bills].sort((a, b) => {
      const [x, y] = [value(a), value(b)]
      if (x === null || y === null) return x === y ? a.node.sort - b.node.sort : x === null ? 1 : -1
      return (sort.desc ? y - x : x - y) || a.node.sort - b.node.sort
    })
  }, [bills, sort])
  const grouped = nodes.some((n) => n.group)

  // The rates the totals were made with, for whoever wonders why the sum is
  // not the one their bank would give. Only the currencies actually in use.
  const used = [...new Set(bills.filter((b) => b.cny !== null && b.currency !== "CNY").map((b) => b.currency))].sort()
  // Where each of them came from: the site's own line, the day's rates, or
  // the built-in table for a currency neither has.
  const byHand = used.filter((c) => fixed[c] !== undefined)
  const byDay = used.filter((c) => fixed[c] === undefined && live?.rates[c] !== undefined)
  const builtIn = used.filter((c) => fixed[c] === undefined && live?.rates[c] === undefined)
  const some = (codes: string[]) => (codes.length === used.length ? "" : `${codes.join("、")} `)

  const { lead, days } = monthShape(month)
  const share = summary.top && summary.monthly > 0 ? (summary.top.monthly! / summary.monthly) * 100 : 0
  const head = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === "monthly" }))}
      className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
    >
      {label}
      {sort.key === key && (sort.desc ? <ArrowDown className="size-3 text-primary" /> : <ArrowUp className="size-3 text-primary" />)}
    </button>
  )

  return (
    <div className="space-y-6 max-md:space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">费用指标</CardTitle>
          <CardDescription>合计以人民币计，只统计填了价格的节点</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="月均成本"
              value={cny(summary.monthly)}
              note={`折合每年 ${cny(summary.monthly * 12)} · ${summary.monthlyCount} 台`}
              title="每个节点的一期费用摊到每个月后相加；一次性买断的不计"
            />
            <Stat
              label="未来 30 天续费"
              value={cny(summary.next30)}
              note={summary.next30Count > 0 ? `${summary.next30Count} 台到期` : "没有到期的节点"}
              title="从今天起 30 天内到期的节点，各自一期的费用之和"
            />
            <Stat
              label="未来 12 个月续费"
              value={cny(summary.next365)}
              note={`${summary.next365Count} 次续费，按到期日累计`}
              title="从今天起一年内的每一次续费：月付的节点算 12 次，年付的算 1 次"
            />
            <Stat
              label="最高花费节点"
              value={<span className="text-xl max-sm:text-lg">{summary.top?.node.name ?? "—"}</span>}
              note={summary.top ? `月均 ${cny(summary.top.monthly!)} · 占比 ${share.toFixed(1)}%` : "还没有填了价格的节点"}
            />
          </div>
          {(used.length > 0 || summary.unrated.length > 0) && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {used.length > 0 && (
                <>
                  外币折算：{used.map((c) => `1 ${c} = ¥${Number(rates[c].toFixed(4))}`).join("，")}。
                  {byDay.length > 0 && live && (
                    <>
                      {some(byDay)}按 {live.date} 的汇率，来源{" "}
                      <a href={live.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                        {live.source.name}
                      </a>
                      。
                    </>
                  )}
                  {builtIn.length > 0 && `${some(builtIn)}${failed ? "没能取到当天的汇率，暂按" : "按"}内置参考汇率（${RATES_DATE}）。`}
                  {byHand.length > 0 && `${some(byHand)}按主题设置里填写的汇率。`}
                </>
              )}
              {summary.unrated.length > 0 && `${summary.unrated.join("、")} 没有汇率，未计入合计。`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">续费日历</CardTitle>
          <CardDescription>每个月哪些节点到期、续费多少；之后各期按当前价格与周期推算</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] max-md:gap-4">
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" className="cursor-pointer px-2" onClick={() => turn(-1)}>
                <ChevronLeft className="size-4" />
                上个月
              </Button>
              <button
                type="button"
                onClick={() => { setMonth(thisMonth); setDay(null) }}
                title={month === thisMonth ? undefined : "回到本月"}
                className={cn("tnum text-sm font-bold text-foreground", month !== thisMonth && "cursor-pointer hover:text-primary")}
              >
                {monthLabel(month)}
              </button>
              <Button variant="ghost" size="sm" className="cursor-pointer px-2" onClick={() => turn(1)}>
                下个月
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1.5 text-center">
              {WEEKDAYS.map((w) => (
                <div key={w} className="pb-1 text-[11px] text-muted-foreground">{w}</div>
              ))}
              {Array.from({ length: lead }, (_, i) => <div key={`lead${i}`} />)}
              {Array.from({ length: days }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, "0")}`
                const count = dueOn.get(date) ?? 0
                const picked = day === date
                const cell = cn(
                  "flex h-12 flex-col items-start rounded-lg border px-1.5 py-1 text-left text-xs transition-colors",
                  count > 0 ? "border-primary/30 bg-primary/8" : "border-border/60",
                  date === today && "ring-2 ring-primary/40",
                  picked && "border-primary bg-primary text-primary-foreground",
                )
                const body = (
                  <>
                    <span className={cn("tnum font-semibold", date < today && count === 0 && "text-muted-foreground/60")}>{i + 1}</span>
                    {count > 0 && (
                      <span className={cn("tnum text-[10px] font-medium", picked ? "text-primary-foreground/90" : "text-primary")}>{count} 台</span>
                    )}
                  </>
                )
                // Only a day with something due is a control: the rest have nothing to show.
                return count > 0 ? (
                  <button key={date} type="button" aria-pressed={picked} onClick={() => setDay(picked ? null : date)} className={cn(cell, "cursor-pointer hover:border-primary")}>
                    {body}
                  </button>
                ) : (
                  <div key={date} className={cell}>{body}</div>
                )
              })}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h4 className="text-sm font-semibold text-foreground">
                {day ? `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日` : monthLabel(month)}到期
                <span className="ml-2 font-normal text-muted-foreground">{listed.length} 台</span>
              </h4>
              <div className="flex items-center gap-3 text-xs">
                {day && (
                  <button type="button" onClick={() => setDay(null)} className="cursor-pointer text-primary hover:underline">
                    显示全月
                  </button>
                )}
                {listed.length > 0 && (
                  <span className="text-muted-foreground">
                    合计 <span className="tnum font-semibold text-foreground">≈ {cny(listedTotal)}</span>
                  </span>
                )}
              </div>
            </div>
            {listed.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">这个月没有到期的节点</p>
            ) : (
              <ul className="divide-y divide-border/60 rounded-lg border border-border/80 bg-card shadow-xs">
                {listed.map((r) => (
                  <li key={`${r.bill.node.id}/${r.date}`} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                    <span className="tnum w-9 shrink-0 text-center text-xs font-semibold text-primary">{Number(r.date.slice(8))} 日</span>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate font-medium text-foreground">{r.bill.node.name}</span>
                      <Flag code={r.bill.node.country} showCode={false} className="shrink-0" />
                      {r.projected && (
                        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground" title="不是当前这一期的到期日，而是按周期往后推算的续费">
                          推算
                        </Badge>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <Price bill={r.bill} className="text-xs font-medium" />
                      {r.bill.cny !== null && r.bill.currency !== "CNY" && (
                        <div className="tnum text-[11px] text-muted-foreground">≈ {cny(r.bill.cny)}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="@container gap-0 overflow-hidden py-0">
        <CardHeader className="border-b border-border/60 py-3.5">
          <CardTitle className="text-base">节点费用明细</CardTitle>
          <CardDescription>每个节点当期的费用、折算到每月的成本与到期时间</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="bg-muted/20 hover:bg-transparent">
                <TableHead className="h-9 pl-5 max-sm:pl-3">节点</TableHead>
                {grouped && <TableHead className="h-9 @max-3xl:hidden">分组</TableHead>}
                <TableHead className="h-9 @max-xl:hidden">状态</TableHead>
                <TableHead className="h-9 text-right @max-xl:hidden">当期费用</TableHead>
                <TableHead className="h-9 text-right">{head("monthly", "月均成本")}</TableHead>
                <TableHead className="h-9 pr-5 text-right max-sm:pr-3">{head("due", "到期时间")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_td]:py-2.5">
              {rows.map((b) => (
                <TableRow key={b.node.id} className="hover:bg-muted/40">
                  <TableCell className="max-w-56 pl-5 @max-xl:max-w-36 max-sm:pl-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Dot node={b.node} className="size-2" />
                      <span className="truncate font-medium" title={b.node.name}>{b.node.name}</span>
                      <Flag code={b.node.country} showCode={false} className="shrink-0 @max-xl:hidden" />
                    </div>
                    {/* On a phone the price has no column of its own and sits under the name. */}
                    <Price bill={b} className="hidden pl-4 text-xs @max-xl:block" />
                  </TableCell>
                  {grouped && <TableCell className="text-muted-foreground @max-3xl:hidden">{b.node.group || "—"}</TableCell>}
                  <TableCell className="@max-xl:hidden">
                    <Badge variant={b.node.online ? "success" : deployed(b.node) ? "destructive" : "secondary"} className="px-1.5 py-0 text-[11px] font-normal">
                      {b.node.online ? "在线" : deployed(b.node) ? "离线" : "未接入"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right @max-xl:hidden"><Price bill={b} /></TableCell>
                  <TableCell className="tnum text-right font-medium">{b.monthly === null ? <span className="font-normal text-muted-foreground">—</span> : cny(b.monthly)}</TableCell>
                  <TableCell className="pr-5 text-right max-sm:pr-3">
                    <div className="tnum">{b.due ?? <span className="text-muted-foreground">长期有效</span>}</div>
                    <Remaining days={b.days} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
