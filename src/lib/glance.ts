import { useEffect, useState } from "react"

import { api } from "@/lib/api"
import type { History } from "@/lib/history"

// The last hour of each probe's round trips, for the strip under a row on the
// list. Apart from the chart's history in history.ts: that one is fetched at
// the plot's own width when a reader opens a node, this one for every node on
// the page at once, so it asks for the fewest points the hub will bucket to.

export type Glance = {
  id: number
  name: string
  /** The latest round trip that answered, null when none did this hour. */
  ms: number | null
  /** Proportion of the hour the probe lost, as the hub counts it. */
  loss: number
  /** Every bucket in order, null where all of it timed out. */
  trend: (number | null)[]
}

// The hub builds at most four windows at once and answers a fifth with a 503.
// Three here leaves room for the one an opened row asks for, so a list of
// fifty nodes filling in does not cost the reader the chart they just opened.
const LIMIT = 3
let running = 0
const waiting: (() => void)[] = []

function acquire(): Promise<void> {
  if (running < LIMIT) {
    running++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(() => { running++; resolve() }))
}

function release() {
  running--
  waiting.shift()?.()
}

function summarise(data: History): Glance[] {
  const ping = data.ping ?? []
  return [...new Set(ping.map((p) => p.task_id))]
    .map((id) => {
      const points = ping.filter((p) => p.task_id === id).sort((a, b) => a.ts - b.ts)
      const trend = points.map((p) => p.latency)
      return {
        id,
        name: data.probes?.[id] ?? `探测 ${id}`,
        ms: trend.findLast((v) => v !== null) ?? null,
        loss: data.loss?.[id] ?? 0,
        trend,
      }
    })
    .filter((p) => p.trend.length > 0)
}

// As long as a probe's own interval: asked again sooner, the hour would come
// back the same. Held as the promise, as history.ts holds its windows, so a
// row unmounted by a filter and mounted again does not ask twice.
const TTL = 60_000
const cache = new Map<number, { at: number; promise: Promise<Glance[]> }>()

function fetchGlance(id: number): Promise<Glance[]> {
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < TTL) return hit.promise
  const promise = acquire()
    .then(() => api<History>(`/nodes/${id}/metrics?hours=1&points=60&series=ping`).finally(release))
    .then(summarise)
  cache.set(id, { at: Date.now(), promise })
  promise.catch(() => {
    if (cache.get(id)?.promise === promise) cache.delete(id)
  })
  return promise
}

/**
 * One node's probes over the last hour: null until the first answer, then
 * refreshed each minute while the page is on screen. A failure reads as no
 * probes, since a strip is not worth an error message under every row; the
 * next minute asks again.
 */
export function useGlance(id: number, enabled: boolean): Glance[] | null {
  const [state, setState] = useState<{ id: number; probes: Glance[] } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    const load = () => {
      if (document.visibilityState !== "visible") return
      fetchGlance(id)
        .then((probes) => { if (active) setState({ id, probes }) })
        .catch(() => { if (active) setState({ id, probes: [] }) })
    }
    load()
    const timer = setInterval(load, TTL)
    document.addEventListener("visibilitychange", load)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener("visibilitychange", load)
    }
  }, [id, enabled])

  return enabled && state !== null && state.id === id ? state.probes : null
}

/**
 * The probes a strip shows: the names the site listed, in the order listed,
 * and the first three of them this node has. A site that lists both its
 * domestic and its overseas probes therefore gets the domestic three on a node
 * that has them and the next ones down on a node that does not. With nothing
 * listed, the node's first three.
 */
export function pickProbes(probes: Glance[], lines: string): Glance[] {
  const wanted = [...new Set(lines.split("\n").map((s) => s.trim()).filter(Boolean))]
  if (wanted.length === 0) return probes.slice(0, 3)
  return wanted
    .map((name) => probes.find((p) => p.name === name))
    .filter((p): p is Glance => p !== undefined)
    .slice(0, 3)
}
