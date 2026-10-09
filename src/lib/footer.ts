// The footer's custom items, as the site wrote them in the theme settings.

export type FooterItem = { label: string; href?: string }

const MAX_ITEMS = 8

/**
 * A link the footer will follow: a web address or a mail address. Anything
 * else a settings value might hold -- `javascript:`, a custom scheme, a typo
 * -- is not made a link, and its line is shown as plain text instead.
 */
function safeHref(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * One item per line, `name | address`, the bar half- or full-width. A line with
 * no address is a note, shown as text. A line that is only an address is
 * labelled with its host.
 */
export function parseFooterItems(text: string): FooterItem[] {
  const items: FooterItem[] = []
  for (const line of text.split("\n")) {
    const at = line.search(/[|｜]/)
    const label = (at < 0 ? line : line.slice(0, at)).trim()
    const href = at < 0 ? safeHref(label) : safeHref(line.slice(at + 1).trim())
    if (at < 0 && href) items.push({ label: href.startsWith("mailto:") ? href.slice(7) : new URL(href).host, href })
    else if (label) items.push({ label, href })
    if (items.length === MAX_ITEMS) break
  }
  return items
}
