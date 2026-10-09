import { useSyncExternalStore } from "react"

import type { Node } from "@/lib/api"
import type { Point } from "@/lib/history"

// The last ten minutes of every node's reports, kept from the snapshots the
// list is already drawn from. History's shortest window is an hour bucketed to
// about a minute, which is the wrong instrument for watching a speed test or a
// burst as it happens; this is each report as it arrived. It costs the hub
// nothing, and holds only what this page has seen since it opened.

export const LIVE_SECONDS = 600

const samples = new Map<number, Point[]>()
const listeners = new Set<() => void>()
let version = 0

/**
 * Called with each snapshot. Recorded for every node, not only the one on the
 * chart page, so switching to another node or to the live window finds the
 * minutes since the page opened already drawn.
 *
 * A point is stamped with the second the hub last heard from the node rather
 * than the second the snapshot arrived: the hub pushes more often than an
 * agent reports, and stamped on arrival the same report would be drawn as two
 * or three points and a flat step between them.
 */
export function recordLive(nodes: Node[]) {
  const now = Date.now() / 1000
  let changed = false
  for (const node of nodes) {
    const m = node.online ? node.metrics : null
    if (!m) continue
    const kept = samples.get(node.id) ?? []
    const ts = node.last_seen || now
    if (kept.length > 0 && ts <= kept[kept.length - 1].ts) continue
    // A new array each time: the chart memoises on its identity.
    const next = kept.filter((p) => ts - p.ts <= LIVE_SECONDS)
    next.push({ ts, cpu: m.cpu, mem_used: m.mem_used, disk_used: m.disk_used, net_rx: m.net_rx, net_tx: m.net_tx })
    samples.set(node.id, next)
    changed = true
  }
  if (!changed) return
  version++
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const NONE: Point[] = []

/** One node's reports over the last ten minutes, oldest first. */
export function useLive(id: number): Point[] {
  useSyncExternalStore(subscribe, () => version)
  return samples.get(id) ?? NONE
}
