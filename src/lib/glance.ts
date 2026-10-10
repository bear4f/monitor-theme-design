import { useEffect, useSyncExternalStore } from "react"

import { api } from "@/lib/api"
import type { History } from "@/lib/history"
import { preloaded } from "@/lib/preload"

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
  /** When each bucket of `trend` was, in epoch seconds, for the reader pointing at one. */
  times: number[]
}

// How many windows are asked for at once. The hub builds only a few at a time
// and answers the next with a 503, but an hour of pings at sixty points is
// quick work for it: measured against a hub of seventeen nodes, all seventeen
// asked together came back inside a second, and of thirty-four together one
// was refused. Ten keeps under that, fills such a list in two waves, and a
// refusal is asked for once more.
const LIMIT = 10
const RETRY_MS = 600
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
        times: points.map((p) => p.ts),
      }
    })
    .filter((p) => p.trend.length > 0)
}

// The same URL, to the character, that index.html asks for ahead of the
// bundle: it is the key the early answer is found under.
const path = (id: number) => `/nodes/${id}/metrics?hours=1&points=60&series=ping`
const ask = (id: number) => api<History>(path(id))
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// As long as a probe's own interval: asked again sooner, the hour would come
// back the same. Held as the promise, as history.ts holds its windows, so the
// request started before the list has drawn is the one the list then waits on.
const TTL = 60_000
const inflight = new Map<number, { at: number; promise: Promise<Glance[]> }>()

function fetchGlance(id: number): Promise<Glance[]> {
  const hit = inflight.get(id)
  if (hit && Date.now() - hit.at < TTL) return hit.promise
  const queued = () => acquire().then(() => ask(id).catch(() => pause(RETRY_MS).then(() => ask(id))).finally(release))
  // One index.html already asked for is not queued behind the others: it is
  // in flight, and most likely answered. If it failed it takes its turn.
  const early = preloaded<History>(`/api${path(id)}`)
  const promise = (early ? early.catch(queued) : queued()).then(summarise)
  inflight.set(id, { at: Date.now(), promise })
  promise.catch(() => {
    if (inflight.get(id)?.promise === promise) inflight.delete(id)
  })
  return promise
}

// What the strips draw, by node. Filled three ways, each so that the reader
// sees the whole list's strips at once rather than one row after another:
//
// - from storage as the script loads, so a returning visitor's strips are in
//   the first frame the list is, a minute or a day old, and are replaced a
//   moment later;
// - by `primeGlances`, which asks for the nodes of the last visit before this
//   visit's node list has even arrived;
// - by a round of requests whose answers are held back and shown together.
const KEY = "serverstatus:glance"
// Past this the stored strips are not shown: a week-old hour drawn as the
// current one, even for a second, says something untrue about the route.
const KEEP_MS = 24 * 3600_000
// A round is shown complete, or after this long with what has arrived, so one
// slow node does not hold up every other row's strip.
const ROUND_MS = 2500

const shown = new Map<number, Glance[]>()
// Nodes whose entry came from storage and has not yet been confirmed by an
// answer. A failed request drops these rather than leave old figures standing
// as if they were the hour just gone.
const stale = new Set<number>()
const listeners = new Set<() => void>()
let stamp = 0

const notify = () => {
  stamp++
  listeners.forEach((listener) => listener())
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { at: number; nodes: Record<string, Glance[]> } | null
    if (!saved || typeof saved.at !== "number" || Date.now() - saved.at > KEEP_MS) return
    for (const [id, probes] of Object.entries(saved.nodes ?? {})) {
      // An entry an older build stored has no times; a line that cannot say
      // when its points were is not drawn from it.
      if (!Array.isArray(probes) || !probes.every((p) => Array.isArray(p.trend) && Array.isArray(p.times) && p.times.length === p.trend.length)) continue
      shown.set(Number(id), probes)
      stale.add(Number(id))
    }
  } catch {
    // Storage disabled or holding another build's shape: start empty.
  }
}
restore()

/** `keep` is the node list as the page has it; a node no longer on it is forgotten. */
function persist(keep?: number[]) {
  if (keep) for (const id of [...shown.keys()]) if (!keep.includes(id)) shown.delete(id)
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), nodes: Object.fromEntries(shown) }))
  } catch {
    // Storage full or disabled: the next visit starts from placeholders.
  }
}

/**
 * Ask for every node's hour and show the answers together: when the last has
 * arrived, or at the deadline with those that have. A node that fails keeps
 * the answer it had from this visit, and otherwise reads as having no probe,
 * since a strip is not worth an error message under every row; the next round
 * asks again. `listed` says the ids are the page's own node list rather than
 * the last visit's.
 */
function refresh(ids: number[], listed = false) {
  const settled = new Map<number, Glance[] | null>()
  let open = true
  const flush = () => {
    for (const [id, probes] of settled) {
      if (probes) shown.set(id, probes)
      else if (stale.has(id) || !shown.has(id)) shown.set(id, [])
      stale.delete(id)
    }
    settled.clear()
    notify()
  }
  const close = () => {
    if (!open) return
    open = false
    flush()
  }
  const round = ids.map((id) =>
    fetchGlance(id)
      .then((probes) => settled.set(id, probes), () => settled.set(id, null))
      // A straggler past the deadline is shown as it lands.
      .then(() => { if (!open) flush() }),
  )
  const deadline = setTimeout(close, ROUND_MS)
  void Promise.all(round).then(() => {
    clearTimeout(deadline)
    close()
    persist(listed ? ids : undefined)
  })
}

// The site's choice of probes as the last visit read it, so the strips of a
// returning visitor are drawn with the list instead of after the settings
// request. `null` is the site having turned them off.
const LINES_KEY = "serverstatus:glance-lines"

export function recallLines(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LINES_KEY) ?? "null") as unknown
    return typeof saved === "string" ? saved : null
  } catch {
    return null
  }
}

export function rememberLines(lines: string | null) {
  try {
    localStorage.setItem(LINES_KEY, JSON.stringify(lines))
  } catch {
    // The next visit waits for the settings, as a first one does.
  }
}

/**
 * Started as the app starts, alongside the requests for the node list and the
 * settings rather than after them: the last visit's nodes are asked for now,
 * and the list, once it has drawn, finds the answers already on their way.
 * Nothing is asked on a first visit or where the site shows no strips.
 */
export function primeGlances() {
  if (recallLines() === null || shown.size === 0) return
  if (document.visibilityState === "visible") refresh([...shown.keys()])
}

/**
 * Keeps the strips of these nodes current while the list is on screen: a
 * round now and one each minute, skipped while the page is hidden and caught
 * up when it returns.
 */
export function useGlances(ids: number[], enabled: boolean) {
  const key = ids.join(",")
  useEffect(() => {
    if (!enabled || key === "") return
    const wanted = key.split(",").map(Number)
    const load = () => {
      if (document.visibilityState === "visible") refresh(wanted, true)
    }
    load()
    const timer = setInterval(load, TTL)
    document.addEventListener("visibilitychange", load)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", load)
    }
  }, [key, enabled])
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** One node's probes over the last hour, or null while nothing is known of it. */
export function useGlance(id: number): Glance[] | null {
  useSyncExternalStore(subscribe, () => stamp)
  return shown.get(id) ?? null
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
