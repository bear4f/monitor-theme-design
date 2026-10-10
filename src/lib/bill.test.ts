/// <reference types="node" />
import assert from "node:assert/strict"
import type { Node } from "./api.ts"
import { addMonths, billOf, hubToday, parseRates, renewalsBetween, summarise } from "./bill.ts"

assert.equal(addMonths("2026-01-31", 1), "2026-02-28")
assert.equal(addMonths("2026-01-31", 2), "2026-03-31")
assert.equal(addMonths("2026-11-21", 12), "2027-11-21")
assert.equal(addMonths("2024-02-29", 12), "2025-02-28")

const rates = parseRates("usd = 7\nCAD：5\nnonsense\nEUR = 0\n")
assert.equal(rates.USD, 7)
assert.equal(rates.CAD, 5)
assert.equal(rates.CNY, 1)
assert.ok(rates.EUR > 0, "a zero rate is ignored, not taken")

const node = (id: number, price: number, currency: string, billing_cycle: string, expires_at: string | null, expires_in?: number | null) =>
  ({ id, sort: id, name: `n${id}`, price, currency, billing_cycle, expires_at, expires_in }) as Node
const nodes = [
  node(1, 12, "USD", "monthly", "2026-11-01", 22),
  node(2, 120, "USD", "yearly", "2026-11-27", 48),
  node(3, 0, "CNY", "once", "2035-12-16", 3354),
  node(4, 100, "XXX", "yearly", "2027-01-01", 83),
  node(5, 300, "CNY", "yearly", null, null),
]
const today = hubToday(nodes)
assert.equal(today, "2026-10-10")
const bills = nodes.map((n) => billOf(n, rates, today))
assert.equal(bills[0].monthly, 84)
assert.equal(bills[1].monthly, 70)
assert.equal(bills[1].days, 48)
assert.equal(bills[2].cny, null, "no price entered is not a price of zero")
assert.equal(bills[3].cny, null, "a currency with no rate is left out")
assert.equal(bills[4].due, null)

// November: the monthly plan on the 1st, the yearly one on the 27th.
const november = renewalsBetween(bills, "2026-11-01", "2026-12-01")
assert.deepEqual(november.map((r) => [r.date, r.bill.node.id, r.projected]), [["2026-11-01", 1, false], ["2026-11-27", 2, false]])
// December has only the monthly plan's next period, which is a projection.
assert.deepEqual(renewalsBetween(bills, "2026-12-01", "2027-01-01").map((r) => [r.date, r.bill.node.id, r.projected]), [["2026-12-01", 1, true]])
// A one-off purchase ends once and does not recur.
assert.equal(renewalsBetween(bills, "2035-01-01", "2037-01-01").filter((r) => r.bill.node.id === 3).length, 1)

const summary = summarise(bills, today)
assert.equal(summary.monthly, 84 + 70 + 25)
assert.equal(summary.monthlyCount, 3)
assert.equal(summary.next30, 84)
assert.equal(summary.next30Count, 1)
// A year: twelve months of the monthly plan and one renewal of the yearly one.
assert.equal(summary.next365, 84 * 12 + 840)
assert.equal(summary.top?.node.id, 1)
assert.deepEqual(summary.unrated, ["XXX"])
console.log("bills, renewals and totals add up")
