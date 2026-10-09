import { Skeleton } from "@/components/ui/skeleton"
import type { Glance } from "@/lib/glance"
import { cn } from "@/lib/utils"

const W = 100
const H = 16

/**
 * An hour of one probe as a line, with no axis and nothing to hover: the shape
 * is the whole message. A timeout breaks the line rather than being bridged.
 *
 * The scale is the probe's own range, but never narrower than 20 ms or a
 * quarter of its level. Fitted exactly, a route steady at 29 ms and wobbling
 * by two would fill the strip as tall as one swinging by two hundred, and the
 * reader could not tell the calm row from the troubled one.
 */
function Sparkline({ values, className }: { values: (number | null)[]; className?: string }) {
  const answered = values.filter((v): v is number => v !== null)
  if (answered.length < 2) return <span className={className} />
  const low = Math.min(...answered)
  const high = Math.max(...answered)
  const span = Math.max(high - low, 20, low / 4)
  // Centred in the widened span, so a steady line runs through the middle.
  const base = low - (span - (high - low)) / 2
  const x = (i: number) => (i * W) / (values.length - 1)
  const y = (v: number) => H - 1.5 - ((v - base) / span) * (H - 3)
  const runs: string[][] = [[]]
  values.forEach((v, i) => {
    if (v === null) runs.push([])
    else runs[runs.length - 1].push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
      {runs.filter((run) => run.length > 1).map((run, i) => (
        <polyline
          key={i}
          points={run.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

/**
 * What a row says about its routes without being opened: up to three probes
 * side by side, each its name, its latest round trip, the hour's shape and the
 * share it lost. Quiet on purpose -- the row above is the subject, and only a
 * route that is losing packets is given a colour.
 */
export function RowLatency({ probes }: { probes: Glance[] | null }) {
  return (
    <div className="grid grid-cols-3 gap-x-8 pb-2 pl-[4.75rem] pr-4 text-[11px] leading-4 @max-3xl:gap-x-2 @max-3xl:pb-1.5 @max-3xl:pl-[7%] @max-3xl:pr-1 @max-3xl:text-[9px]">
      {probes === null
        ? [0, 1, 2].map((i) => <Skeleton key={i} className="my-0.5 h-3 w-full max-w-40 rounded-sm opacity-50" />)
        : probes.map((p) => (
            <div
              key={p.id}
              className="flex min-w-0 items-center gap-2 @max-3xl:gap-1"
              title={`${p.name} · 最近一小时${p.ms === null ? "全部超时" : ` · 最新 ${p.ms} ms`} · 丢包 ${p.loss.toFixed(1)}%`}
            >
              <span className="w-16 shrink-0 truncate text-left text-muted-foreground @max-3xl:w-auto @max-3xl:max-w-12">{p.name}</span>
              <span className={cn("tnum w-11 shrink-0 text-right font-medium @max-3xl:w-auto", p.ms === null ? "text-destructive" : "text-foreground/80")}>
                {p.ms === null ? "超时" : `${p.ms} ms`}
              </span>
              <Sparkline values={p.trend} className="h-4 min-w-0 flex-1 text-primary/55 @max-3xl:hidden" />
              <span
                className={cn(
                  "tnum w-9 shrink-0 text-right @max-3xl:hidden",
                  p.loss >= 5 ? "font-medium text-destructive" : p.loss >= 1 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/70",
                )}
              >
                {p.loss > 0 && p.loss < 0.1 ? "<0.1" : p.loss.toFixed(1)}%
              </span>
            </div>
          ))}
    </div>
  )
}
