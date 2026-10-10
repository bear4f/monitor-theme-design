import type { Node } from "./api.ts"

// What the bill page is worked out from: nothing but the price, currency,
// billing cycle and expiry each node already carries in `/api/nodes`. Dates are
// handled as the `YYYY-MM-DD` strings the hub sends and never as local times,
// so a visitor in another zone sees the same day the site owner entered.

/** A billing cycle in months. `once` is a purchase, not a cycle. */
export const CYCLE_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
  biennial: 24,
  triennial: 36,
  once: 0,
}

/**
 * What one unit of each currency is in yuan, as of `RATES_DATE`. The table the
 * totals fall back on where the day's rates (lib/fx.ts) are switched off or
 * cannot be had; a site can also fix any currency itself in the theme
 * settings, which wins over both.
 */
export const RATES_DATE = "2026-09-30"

export const DEFAULT_RATES: Record<string, number> = {
  CNY: 1,
  USD: 6.7179,
  EUR: 7.6172,
  GBP: 8.883,
  JPY: 0.0427,
  HKD: 0.8562,
  TWD: 0.211,
  SGD: 5.2585,
  AUD: 4.6909,
  CAD: 4.7351,
  RUB: 0.0795,
}

/** The rates a site wrote into its settings: `USD = 7.1`, one a line. Lines that are not one are passed over. */
export function manualRates(text: string): Record<string, number> {
  const rates: Record<string, number> = {}
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Za-z]{3})\s*[=:：＝]\s*([0-9]*\.?[0-9]+)\s*$/)
    if (!match) continue
    const rate = Number(match[2])
    if (rate > 0 && Number.isFinite(rate)) rates[match[1].toUpperCase()] = rate
  }
  return rates
}

/**
 * The rates the bill is worked out with: the built-in table, the day's rates
 * over it where there are any, and the site's own lines over both. A yuan is a
 * yuan whatever anyone says.
 */
export function parseRates(text: string, live: Record<string, number> = {}): Record<string, number> {
  return { ...DEFAULT_RATES, ...live, ...manualRates(text), CNY: 1 }
}

const DAY = 86_400_000
const stamp = (date: string) => Date.parse(`${date}T00:00:00Z`)
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const addDays = (date: string, days: number) => iso(stamp(date) + days * DAY)

/**
 * `months` after a date, on the same day of the month, or on the month's last
 * day where it has no such day: a plan bought on the 31st renews on the 30th
 * in a thirty-day month, and on the 31st again after it.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return iso(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)))
}

const VALID = /^\d{4}-\d{2}-\d{2}$/

/**
 * Today as the hub counts it. Each node says both the day it expires and how
 * many days that is from now by the hub's calendar, so the difference is the
 * hub's own date; a visitor's clock, in another zone or simply wrong, would
 * put renewals in the wrong thirty days. The browser's date only when no node
 * says.
 */
export function hubToday(nodes: Node[], fallback = new Date()): string {
  for (const node of nodes) {
    if (node.expires_at && VALID.test(node.expires_at) && typeof node.expires_in === "number") {
      return addDays(node.expires_at, -node.expires_in)
    }
  }
  const local = new Date(fallback.getTime() - fallback.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export type Bill = {
  node: Node
  currency: string
  /** One period's price in its own currency; 0 for a node with none entered. */
  price: number
  /** The cycle in months, 0 for a one-off purchase. */
  months: number
  /** One period's price in yuan, null with no price or no rate for the currency. */
  cny: number | null
  /** That spread over a month, null as above and for a one-off purchase. */
  monthly: number | null
  /** The day the current period ends, null when the node has no expiry. */
  due: string | null
  /** Days from the hub's today to `due`, negative once passed. */
  days: number | null
}

export function billOf(node: Node, rates: Record<string, number>, today: string): Bill {
  const currency = (node.currency || "").toUpperCase()
  const price = node.price > 0 ? node.price : 0
  // An unknown or empty cycle is read as monthly, the commonest, rather than
  // dropping the node from every total.
  const months = CYCLE_MONTHS[node.billing_cycle] ?? 1
  const rate = rates[currency]
  const cny = price > 0 && rate !== undefined ? price * rate : null
  const due = node.expires_at && VALID.test(node.expires_at) ? node.expires_at : null
  return {
    node,
    currency,
    price,
    months,
    cny,
    monthly: cny !== null && months > 0 ? cny / months : null,
    due,
    days: due === null ? null : Math.round((stamp(due) - stamp(today)) / DAY),
  }
}

export type Renewal = {
  date: string
  bill: Bill
  /** Not the period now running out but one after it, assuming the plan is kept. */
  projected: boolean
}

/**
 * Every renewal falling in `[from, to)`: each node's expiry, and for a node on
 * a cycle the same day every cycle after it. The later ones are projections --
 * the hub knows only the next date -- and are marked as such.
 */
export function renewalsBetween(bills: Bill[], from: string, to: string): Renewal[] {
  const found: Renewal[] = []
  for (const bill of bills) {
    if (!bill.due) continue
    // Stepped from the first date each time, not from the previous one, so a
    // day clamped in a short month does not stay clamped.
    for (let k = 0; ; k++) {
      const date = k === 0 ? bill.due : addMonths(bill.due, k * bill.months)
      if (date >= to) break
      if (date >= from) found.push({ date, bill, projected: k > 0 })
      if (bill.months === 0) break
    }
  }
  return found.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.bill.node.sort - b.bill.node.sort))
}

export type Summary = {
  /** Every priced node's cost spread to a month, in yuan. */
  monthly: number
  monthlyCount: number
  /** Renewals due in the next thirty days, in yuan, and how many. */
  next30: number
  next30Count: number
  /** Renewals due in the next year, counting each cycle a node goes through. */
  next365: number
  next365Count: number
  /** The node costing most per month. */
  top: Bill | null
  /** Currencies with a price entered and no rate: left out of every total. */
  unrated: string[]
}

export function summarise(bills: Bill[], today: string): Summary {
  const sum = (renewals: Renewal[]) => renewals.reduce((total, r) => total + (r.bill.cny ?? 0), 0)
  const priced = (renewals: Renewal[]) => renewals.filter((r) => r.bill.cny !== null)
  const soon = priced(renewalsBetween(bills, today, addDays(today, 31)))
  const year = priced(renewalsBetween(bills, today, addDays(today, 366)))
  const monthly = bills.filter((b) => b.monthly !== null)
  return {
    monthly: monthly.reduce((total, b) => total + b.monthly!, 0),
    monthlyCount: monthly.length,
    next30: sum(soon),
    next30Count: soon.length,
    next365: sum(year),
    next365Count: year.length,
    top: monthly.reduce<Bill | null>((best, b) => (best === null || b.monthly! > best.monthly! ? b : best), null),
    unrated: [...new Set(bills.filter((b) => b.price > 0 && b.cny === null).map((b) => b.currency || "未填"))].sort(),
  }
}

/** A yuan total. Grouped in threes: a sum in the thousands is otherwise counted digit by digit. */
export function cny(amount: number): string {
  return `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
