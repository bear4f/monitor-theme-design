// The requests index.html starts before this bundle has downloaded, keyed by
// the URL they were made to. On a first visit the bundle is the slowest thing
// the page waits for, so the hub's answers are asked for alongside it rather
// than after it, and are usually in hand by the time the app first renders.

declare global {
  interface Window {
    __preload?: Record<string, Promise<unknown> | undefined>
  }
}

/**
 * The answer already on its way for this URL, if index.html asked for it.
 * Handed out once: the page's later requests for the same URL -- the poll, a
 * retry, the next minute's round -- have to reach the hub, not find the
 * answer the page opened with.
 */
export function preloaded<T>(url: string): Promise<T> | undefined {
  const early = globalThis.window?.__preload?.[url]
  if (early) delete window.__preload![url]
  return early as Promise<T> | undefined
}
