import { useEffect, useState } from "react"

// Today's exchange rates for the bill page, from public services that need no
// key and answer any origin. The page is the only thing that asks, and only
// when a reader opens it: by default that is the site's owner. The answer is
// kept in the browser for half a day, so one reader costs a service two
// requests a day at most.

export type LiveRates = {
  /** What one unit of each currency is in yuan, by upper-case code. */
  rates: Record<string, number>
  /** The day the rates are for, as the service states it. */
  date: string
  /** Who published them, named on the page. */
  source: { name: string; url: string }
}

type Source = {
  name: string
  url: string
  endpoint: string
  /** The service's answer as yuan per unit, or a throw if it is not one. */
  read: (body: unknown) => { date: string; perYuan: Record<string, number> }
}

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) throw new Error("not an object")
  return value as Record<string, unknown>
}

// Asked in this order, the next only when one fails. All three quote how much
// of each currency one yuan buys, which `invert` turns round. The first covers
// every currency a hosting bill is likely to be in; the second is a static
// file on a CDN, for when the first cannot be reached; the third is the
// European Central Bank's own table, shorter but independent of both.
export const SOURCES: Source[] = [
  {
    name: "ExchangeRate-API",
    url: "https://www.exchangerate-api.com",
    endpoint: "https://open.er-api.com/v6/latest/CNY",
    read: (body) => {
      const data = record(body)
      if (data.result !== "success") throw new Error("refused")
      return {
        date: new Date(Number(data.time_last_update_unix) * 1_000).toISOString().slice(0, 10),
        perYuan: record(data.rates) as Record<string, number>,
      }
    },
  },
  {
    name: "currency-api",
    url: "https://github.com/fawazahmed0/exchange-api",
    endpoint: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json",
    read: (body) => {
      const data = record(body)
      return { date: String(data.date), perYuan: record(data.cny) as Record<string, number> }
    },
  },
  {
    name: "Frankfurter (ECB)",
    url: "https://frankfurter.dev",
    endpoint: "https://api.frankfurter.dev/v1/latest?base=CNY",
    read: (body) => {
      const data = record(body)
      return { date: String(data.date), perYuan: record(data.rates) as Record<string, number> }
    },
  },
]

/**
 * A service's answer as the bill wants it. Refused unless it has a dated,
 * plausible dollar in it: a totals page drawn from a malformed table would be
 * wrong with no sign of it, where falling back to the next source is not.
 */
export function invert(read: { date: string; perYuan: Record<string, number> }): { date: string; rates: Record<string, number> } {
  const rates: Record<string, number> = {}
  for (const [code, perYuan] of Object.entries(read.perYuan)) {
    if (typeof perYuan === "number" && Number.isFinite(perYuan) && perYuan > 0) rates[code.toUpperCase()] = 1 / perYuan
  }
  rates.CNY = 1
  if (!/^\d{4}-\d{2}-\d{2}$/.test(read.date)) throw new Error("undated")
  if (!(rates.USD > 1 && rates.USD < 100)) throw new Error("implausible")
  return { date: read.date, rates }
}

const KEY = "serverstatus:fx"
// Daily figures: asked for again after half a day, so a page left open over
// midnight picks up the new ones without asking on every visit.
const FRESH_MS = 12 * 3600_000
// Past this a kept answer is not used at all, and the built-in table stands in
// until a service answers: both are approximations, but this one no longer has
// a date a reader would accept as current.
const KEEP_MS = 7 * 24 * 3600_000
const TIMEOUT_MS = 4_000

type Kept = LiveRates & { at: number }

function recall(): Kept | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as Kept | null
    return kept && typeof kept.at === "number" && Date.now() - kept.at < KEEP_MS && kept.rates?.USD > 0 ? kept : null
  } catch {
    return null
  }
}

async function ask(source: Source): Promise<LiveRates> {
  const res = await fetch(source.endpoint, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(String(res.status))
  return { ...invert(source.read(await res.json())), source: { name: source.name, url: source.url } }
}

let inflight: Promise<LiveRates> | null = null

/** The first source to give a usable answer. One request for the page, however many ask. */
function fetchRates(): Promise<LiveRates> {
  inflight ??= (async () => {
    for (const source of SOURCES) {
      try {
        const live = await ask(source)
        try {
          localStorage.setItem(KEY, JSON.stringify({ ...live, at: Date.now() }))
        } catch {
          // Storage full or disabled: asked for again on the next visit.
        }
        return live
      } catch {
        // Unreachable, slow or malformed: the next one.
      }
    }
    throw new Error("no source answered")
  })().finally(() => { inflight = null })
  return inflight
}

/**
 * Today's rates, or null while there are none: before the first answer on a
 * first visit, where `enabled` is off, and where no service can be reached --
 * the last of which `failed` tells apart, so the page can say its figures are
 * not the day's. The caller has a table of its own for all three. A kept
 * answer is returned at once, and replaced when it is more than half a day old.
 */
export function useLiveRates(enabled: boolean): { live: LiveRates | null; failed: boolean } {
  const [live, setLive] = useState<LiveRates | null>(() => (enabled ? recall() : null))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const kept = recall()
    if (kept && Date.now() - kept.at < FRESH_MS) return
    let active = true
    fetchRates().then(
      (next) => { if (active) { setLive(next); setFailed(false) } },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [enabled])

  return enabled ? { live, failed } : { live: null, failed: false }
}
