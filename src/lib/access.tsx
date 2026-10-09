import { createContext, useContext } from "react"

import { fields } from "@/lib/config"

/**
 * What the page draws for whoever is looking at it. A signed-in admin has all
 * three; an anonymous visitor has what the site's theme settings grant, which
 * by default is the round trips and the list.
 *
 * This decides what is drawn, not what is sent: `/api/nodes` answers an
 * anonymous caller with the same figures either way, and only the hub can
 * withhold them. Read theme-dev.md, "设置管显示，不管权限".
 */
export type Access = {
  /** The four cards an expanded row opens into, and what repeats them in a node's heading. */
  overview: boolean
  /** The chart page's CPU, memory, network and disk panels. */
  charts: boolean
  /** The list's live columns and the totals above them. */
  metrics: boolean
}

const FULL: Access = { overview: true, charts: true, metrics: true }

const KEYS: Record<keyof Access, string> = {
  overview: "guest_overview",
  charts: "guest_charts",
  metrics: "guest_metrics",
}

// The manifest's own defaults, for the frames before the saved settings arrive
// and for a hub that has none: a visitor is never shown more than the defaults
// grant while the answer is on its way.
const DEFAULTS = Object.fromEntries(fields.map((f) => [f.key, f.default]))

export function resolveAccess(authed: boolean, config: Record<string, unknown> | null): Access {
  if (authed) return FULL
  const granted = (key: string) => (config ?? DEFAULTS)[key] === true
  return { overview: granted(KEYS.overview), charts: granted(KEYS.charts), metrics: granted(KEYS.metrics) }
}

const AccessContext = createContext<Access>(FULL)

export const AccessProvider = AccessContext.Provider

export function useAccess() {
  return useContext(AccessContext)
}
