import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  ArrowUp, ChartLine, ExternalLink, House, Mail, Monitor, Moon, Palette, ReceiptText, Send, Sparkles, Sun, UserRound, type LucideIcon,
} from "lucide-react"

import { NodePicker } from "@/components/NodePicker"
import { ServerTable, ServerTableSkeleton } from "@/components/ServerTable"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SEGMENT, Segmented } from "@/components/ui/segmented"
import { Skeleton } from "@/components/ui/skeleton"
import { AccessProvider, resolveAccess } from "@/lib/access"
import { api, useNodes } from "@/lib/api"
import { primeGlances, recallLines, rememberLines } from "@/lib/glance"
import { recordLive } from "@/lib/live"
import { Link, useBillRoute, useNodeRoute } from "@/lib/route"
import { THEMES } from "@/lib/themes"
import { loadConfig, saveConfig } from "@/lib/config"
import { parseFooterItems } from "@/lib/footer"
import { store, stored } from "@/lib/prefs"
import { cn } from "@/lib/utils"
// The name, author and repository the footer credits, read from the manifest
// the panel reads, so the two never disagree.
import theme from "../theme.json"

type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean }

// Split out because recharts is most of the bundle and the list draws no chart.
// Warmed as soon as the app starts, so the first chart opened does not wait on it.
const loadDetail = () => import("@/components/NodeDetail").then((m) => ({ default: m.NodeDetail }))
const NodeDetail = lazy(loadDetail)

// Its own chunk as well: most visits never open it, and on most sites a
// visitor cannot.
const Bill = lazy(() => import("@/components/Bill").then((m) => ({ default: m.Bill })))

const DARK_MEDIA = matchMedia("(prefers-color-scheme: dark)")

type Mode = "light" | "dark" | "system"

/**
 * What the key says, read as the pre-paint script in index.html reads it: one of
 * the two names is a choice, anything else is none.
 */
const savedMode = (): Mode => {
  const saved = stored("theme")
  return saved === "dark" || saved === "light" ? saved : "system"
}

/**
 * The visitor's own choice, or the system's while there is none. Only the switch
 * writes the choice down, and "system" is written as no key at all: persisting
 * the system's answer would pin it, leaving a visitor who never touched the
 * switch in whichever mode their system happened to be in that day. The panel at
 * `/admin/` shares this key on one origin and reads it the same way, so it has
 * to hold to the same rule -- one app writing on load pins the others.
 */
function useTheme() {
  const [mode, setMode] = useState(savedMode)
  const system = useSyncExternalStore(
    (notify) => {
      DARK_MEDIA.addEventListener("change", notify)
      return () => DARK_MEDIA.removeEventListener("change", notify)
    },
    () => DARK_MEDIA.matches,
  )
  const dark = mode === "system" ? system : mode === "dark"

  // Another tab, or the panel open in one, changed the key: follow it, so two
  // tabs of one site do not disagree.
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === null || e.key === "theme") setMode(savedMode())
    }
    addEventListener("storage", sync)
    return () => removeEventListener("storage", sync)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  return {
    mode,
    dark,
    choose: (next: Mode) => {
      store("theme", next === "system" ? null : next)
      setMode(next)
    },
  }
}

// The three positions, the system's between the two appearances it picks from.
const MODES = [
  { value: "light" as const, label: <Sun className="size-3.5" />, title: "浅色" },
  { value: "system" as const, label: <Monitor className="size-3.5" />, title: "跟随系统" },
  { value: "dark" as const, label: <Moon className="size-3.5" />, title: "深色" },
]

// Up to 2.7.1 the three below were written on every load, so a visitor who
// never touched them has the built-in value stored, and it read as a choice that
// kept the site's default from ever applying. Dropped once; a visitor who did
// pick the built-in value gets the site's default until they pick again.
const APPEARANCE_MIGRATED = "serverstatus:appearance-v2"
if (stored(APPEARANCE_MIGRATED) === null) {
  for (const [key, builtin] of [["theme-preset", "claude"], ["theme-grain-percent", "16"], ["theme-frosted-percent", "20"]])
    if (stored(key) === builtin) store(key, null)
  store(APPEARANCE_MIGRATED, "1")
}

const savedPreset = () => {
  const saved = stored("theme-preset")
  return THEMES.some((t) => t.id === saved) ? saved : null
}

const savedPercent = (key: string) => {
  const saved = stored(key)
  if (saved === null) return null
  const num = Number(saved)
  return !Number.isNaN(num) && num >= 0 && num <= 100 ? num : null
}

// The grain as an older build stored it, before it was a percentage.
const savedLegacyGrain = () => ({ off: 0, subtle: 10, film: 35 } as Record<string, number>)[stored("theme-grain") ?? ""] ?? null

/**
 * Hook to manage dynamic tweakcn theme presets at runtime. Only the visitor's
 * own pick is stored; until there is one, the site's default stands in once the
 * settings arrive (`applyDefault`).
 */
function useThemePreset(dark: boolean) {
  const [themeId, setThemeId] = useState<string>(() => savedPreset() ?? "claude")

  const activeTheme = useMemo(() => THEMES.find((t) => t.id === themeId) ?? THEMES[0], [themeId])

  useEffect(() => {
    const vars = dark ? activeTheme.dark : activeTheme.light
    const root = document.documentElement
    for (const [key, val] of Object.entries(vars)) {
      root.style.setProperty(`--${key}`, String(val))
    }
  }, [activeTheme, dark])

  const choose = useCallback((id: string) => {
    store("theme-preset", id)
    setThemeId(id)
  }, [])
  const applyDefault = useCallback((id: string) => {
    if (savedPreset() === null && THEMES.some((t) => t.id === id)) setThemeId(id)
  }, [])

  return { themeId, choose, applyDefault, activeTheme }
}

/**
 * Hook to manage Zen Browser dual-parameter texture settings:
 * 1. Grain (Perlin noise intensity, 0-100%)
 * 2. Frosted Blur / Opacity (Container acrylic translucency, 0-100%)
 * Stored, like the preset, only when the visitor moves the slider.
 */
function useTextureSettings() {
  const [grainPercent, setGrainPercent] = useState<number>(
    () => savedPercent("theme-grain-percent") ?? savedLegacyGrain() ?? 16,
  )

  const [frostedPercent, setFrostedPercent] = useState<number>(
    () => savedPercent("theme-frosted-percent") ?? 20, // Default 20% frosted translucency
  )

  useEffect(() => {
    const root = document.documentElement
    // Scale card opacity smoothly from 1.0 (0% frosted) down to 0.08 (100% frosted)
    const cardAlpha = Math.max(0.08, 1 - (frostedPercent * 0.92) / 100)
    root.style.setProperty("--card-opacity", String(cardAlpha))
  }, [frostedPercent])

  const chooseGrain = useCallback((val: number) => {
    store("theme-grain-percent", String(val))
    setGrainPercent(val)
  }, [])
  const chooseFrosted = useCallback((val: number) => {
    store("theme-frosted-percent", String(val))
    setFrostedPercent(val)
  }, [])
  const applyDefaults = useCallback((grain: unknown, frosted: unknown) => {
    const inRange = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 100
    if (inRange(grain) && savedPercent("theme-grain-percent") === null && savedLegacyGrain() === null) setGrainPercent(grain)
    if (inRange(frosted) && savedPercent("theme-frosted-percent") === null) setFrostedPercent(frosted)
  }, [])

  return {
    grainPercent,
    chooseGrain,
    frostedPercent,
    chooseFrosted,
    applyDefaults,
  }
}

/**
 * Zen Browser-style theme & dual-parameter texture control popover.
 */
function ThemeSettingsControl({
  themeId,
  onThemeChange,
  grainPercent,
  onGrainChange,
  frostedPercent,
  onFrostedChange,
  authed,
}: {
  themeId: string
  onThemeChange: (id: string) => void
  grainPercent: number
  onGrainChange: (val: number) => void
  frostedPercent: number
  onFrostedChange: (val: number) => void
  authed?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleSaveDefault = async () => {
    setSaving(true)
    setSaveStatus(null)
    try {
      await saveConfig({
        theme_preset: themeId,
        grain_percent: grainPercent,
        frosted_percent: frostedPercent,
      })
      setSaveStatus("已设为全站默认")
      setTimeout(() => setSaveStatus(null), 2500)
    } catch (e: unknown) {
      setSaveStatus(e instanceof Error ? e.message : "保存失败")
      setTimeout(() => setSaveStatus(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", handleClick)
    return () => document.removeEventListener("pointerdown", handleClick)
  }, [open])

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(!open)}
        className={cn(
          "size-8 rounded-md transition-colors max-sm:size-7",
          open ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
        )}
        title="主题配色与质感设置"
      >
        <Sparkles className="size-3.5 text-primary" />
        <span className="sr-only">主题与质感设置</span>
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-border/80 bg-popover p-3.5 text-popover-foreground shadow-xl backdrop-blur-md space-y-3.5">
          {/* Section 1: 主题配色 (tweakcn presets) */}
          <div>
            <div className="flex items-center justify-between pb-1.5 border-b border-border/60">
              <span className="text-xs font-semibold">主题配色 (tweakcn)</span>
              <span className="text-[10px] text-muted-foreground">实时换肤</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {THEMES.map((t) => {
                const active = themeId === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onThemeChange(t.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-all text-left cursor-pointer",
                      active
                        ? "border-primary bg-primary/10 text-foreground font-semibold shadow-2xs"
                        : "border-border/60 hover:bg-muted text-muted-foreground hover:text-foreground",
                    )}
                    title={t.desc}
                  >
                    <span
                      className="size-3 rounded-full shrink-0 border border-black/10 dark:border-white/20 shadow-xs"
                      style={{ backgroundColor: t.accentColor }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium leading-tight">{t.name}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Section 2: 参数 1 - 噪点强度 (Grain 0-100%) */}
          <div className="pt-1 border-t border-border/50 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">噪点强度 (Zen Grain)</span>
              <span className="font-mono text-xs font-bold text-primary">{grainPercent}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={grainPercent}
              onChange={(e) => onGrainChange(Number(e.target.value))}
              className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary focus:outline-hidden"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>0% 无</span>
              <span>20% 推荐</span>
              <span>50% 明显</span>
              <span>100% 极强</span>
            </div>
          </div>

          {/* Section 3: 参数 2 - 磨砂透光度 (Frosted 0-100%) */}
          <div className="pt-1 border-t border-border/50 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">磨砂透光 (Frosted Blur)</span>
              <span className="font-mono text-xs font-bold text-primary">{frostedPercent}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={frostedPercent}
              onChange={(e) => onFrostedChange(Number(e.target.value))}
              className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary focus:outline-hidden"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>0% 实心</span>
              <span>20% 磨砂</span>
              <span>50% 通透</span>
              <span>100% 极透</span>
            </div>
          </div>

          {/* Section 4: 站长保存为站点默认 */}
          {authed && (
            <div className="pt-2 border-t border-border/50">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-7.5 cursor-pointer"
                disabled={saving}
                onClick={handleSaveDefault}
              >
                {saveStatus ?? (saving ? "保存中…" : "保存为全站默认外观")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Back to the top of a long list, once it has been scrolled past. */
function BackToTop() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const sync = () => setScrolled(scrollY > 200)
    addEventListener("scroll", sync, { passive: true })
    return () => removeEventListener("scroll", sync)
  }, [])
  if (!scrolled) return null
  return (
    <Button
      variant="outline"
      size="icon"
      className="fixed right-6 bottom-6 z-30 rounded-full shadow-md max-md:right-4 max-md:bottom-4"
      title="回到顶部"
      onClick={() => scrollTo({ top: 0, behavior: "smooth" })}
    >
      <ArrowUp className="size-4" />
    </Button>
  )
}

/**
 * One page of the two, in the segmented shape the theme switch beside it wears.
 */
function NavTab({ href, active, icon: Icon, children }: { href: string; active: boolean; icon: LucideIcon; children: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={children}
      className={cn(SEGMENT.item, "text-xs max-sm:px-1.5", active ? SEGMENT.on : SEGMENT.off)}
    >
      <Icon className="size-3.5" />
      <span className="max-sm:sr-only">{children}</span>
    </Link>
  )
}

// Where the footer's two parts sit, by the site's setting: the row they share,
// and the row the links make among themselves. Centred, the links go above the
// text, as a signature block has them.
const FOOTER_LAYOUTS: Record<string, { row: string; links: string }> = {
  split: { row: "flex-wrap items-center justify-between gap-x-4", links: "" },
  center: { row: "flex-col items-center justify-center text-center", links: "order-first justify-center" },
  left: { row: "flex-wrap items-center justify-start gap-x-6", links: "" },
  right: { row: "flex-wrap items-center justify-end gap-x-6", links: "justify-end" },
}

// Unified layout measure across header, main, and footer: 1280px (max-w-7xl)
const CONTAINER_CLASS = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8"

export default function App() {
  const { mode, dark, choose } = useTheme()
  const { themeId, choose: chooseTheme, applyDefault: applyPresetDefault } = useThemePreset(dark)
  const { grainPercent, chooseGrain, frostedPercent, chooseFrosted, applyDefaults: applyTextureDefaults } = useTextureSettings()
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState("")
  const { nodes, error, closed } = useNodes()
  const open = useNodeRoute()
  const billRoute = useBillRoute()

  const loadMe = useCallback(() => {
    return api<Me>("/me")
      .then((next) => { setMe(next); setMeError("") })
      .catch((e: Error) => setMeError(e.message || "网络错误"))
  }, [])

  useEffect(() => {
    loadMe()
    primeGlances()
    loadConfig().then((cfg) => {
      setConfig(cfg)
      rememberLines(cfg.row_latency === true && typeof cfg.row_latency_lines === "string" ? cfg.row_latency_lines : null)
      if (typeof cfg.theme_preset === "string") applyPresetDefault(cfg.theme_preset)
      applyTextureDefaults(cfg.grain_percent, cfg.frosted_percent)
    }).catch(() => {})
    void loadDetail()
  }, [loadMe, applyPresetDefault, applyTextureDefaults])

  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])

  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/"
  }, [me])

  // Every snapshot is kept for the chart page's live window, whichever page
  // is up, so the window is not empty when a reader gets to it.
  useEffect(() => {
    if (nodes) recordLive(nodes)
  }, [nodes])

  const sorted = [...(nodes ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id)
  const selected = sorted.find((n) => n.id === open)
  const site = me?.site_name || "Monitor"
  const notice = typeof config?.notice === "string" ? config.notice.trim() : ""
  // The probes the list's strip shows, or null for no strip. Until the settings
  // arrive it is what the last visit read, so a returning visitor's strips are
  // drawn with the list; a first visit waits, so the rows do not start asking
  // for what the site turned off.
  const [recalled] = useState(recallLines)
  const rowLatency = !config
    ? recalled
    : config.row_latency === true && typeof config.row_latency_lines === "string" ? config.row_latency_lines : null
  // The footer as the site set it: its own line of text, its own links and
  // notes, and whether the two credits stay.
  const footerText = typeof config?.footer_text === "string" ? config.footer_text.trim() : ""
  const footerLinks = typeof config?.footer_links === "string" ? config.footer_links : ""
  const footerItems = useMemo(() => parseFooterItems(footerLinks), [footerLinks])
  const credit = config?.footer_credit === true
  const footerLayout = FOOTER_LAYOUTS[String(config?.footer_layout)] ?? FOOTER_LAYOUTS.split
  const authed = me?.authed === true
  const access = useMemo(() => resolveAccess(authed, config), [authed, config])
  // The bill page, for a reader who may see it. Anyone else at its address
  // gets the list, as they would at any address the theme does not know.
  const bill = billRoute && access.bill
  const billRates = typeof config?.bill_rates === "string" ? config.bill_rates : ""
  const billLive = config?.bill_live_rates === true

  useEffect(() => {
    document.title = [bill ? "账单" : selected?.name, site].filter(Boolean).join(" · ")
  }, [bill, selected?.name, site])

  if (!me) return (
    <div className="grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
      {meError ? (
        <div className="space-y-3 text-center">
          <p role="alert">加载失败：{meError}</p>
          <Button onClick={loadMe}>重试</Button>
        </div>
      ) : (
        "加载中…"
      )}
    </div>
  )

  if (!me.public_page && !me.authed) return null

  return (
    <AccessProvider value={access}>
    <div className="relative flex min-h-svh flex-col bg-background">
      {/* Zen Browser-style tactile grain overlay */}
      {grainPercent > 0 && (
        <div
          className="pointer-events-none fixed inset-0 z-50 select-none bg-noise transition-opacity duration-200"
          style={{
            opacity: Math.min(1, (grainPercent / 100) * (dark ? 0.95 : 0.88)),
          }}
          aria-hidden="true"
        />
      )}

      {/* Standard full-width sticky navigation bar aligned with page measure */}
      <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <div className={cn(CONTAINER_CLASS, "flex h-14 items-center justify-between gap-4 max-sm:gap-1.5")}>
          {/* Allowed to shrink, so that with three pages in the nav it is the
              site's name that gives way on a phone, by truncating, and not
              the sign-in link at the far end, by leaving the screen. */}
          <div className="flex min-w-0 items-center gap-6 max-sm:gap-2">
            <Link href="/" className="flex min-w-0 items-center gap-2.5 max-sm:gap-1.5 font-semibold tracking-tight text-foreground transition-colors hover:opacity-90">
              <img src="/favicon.svg" alt="" className="size-5 shrink-0" />
              <span className="truncate text-base font-bold max-sm:text-sm">{site}</span>
            </Link>
            <nav aria-label="页面" className={cn(SEGMENT.list, "shrink-0")}>
              <NavTab href="/" active={open === null && !bill} icon={House}>首页</NavTab>
              {sorted.length > 0 && (
                <NavTab href={`/node/${open ?? sorted[0].id}`} active={open !== null} icon={ChartLine}>监控</NavTab>
              )}
              {access.bill && sorted.length > 0 && (
                <NavTab href="/bill" active={bill} icon={ReceiptText}>账单</NavTab>
              )}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Segmented
              value={mode}
              onChange={choose}
              options={MODES}
              label="外观"
              className="max-sm:[&>button]:px-1.5"
            />
            <ThemeSettingsControl
              themeId={themeId}
              onThemeChange={chooseTheme}
              grainPercent={grainPercent}
              onGrainChange={chooseGrain}
              frostedPercent={frostedPercent}
              onFrostedChange={chooseFrosted}
              authed={me.authed}
            />
            <a
              href="/admin/"
              title={me.authed ? "后台" : "登录"}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground max-sm:size-7"
            >
              <UserRound className="size-4" />
              <span className="sr-only">{me.authed ? "后台" : "登录"}</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main body with unified container width */}
      <main className={cn(CONTAINER_CLASS, "flex-1 space-y-6 py-6 max-md:py-4")}>
        {notice ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground shadow-2xs">
            <span className="font-semibold text-primary shrink-0">公告</span>
            <div className="min-w-0 flex-1 whitespace-pre-wrap">{notice}</div>
          </div>
        ) : null}

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {!nodes ? (
          <ServerTableSkeleton />
        ) : bill ? (
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Bill nodes={sorted} rates={billRates} live={billLive} authed={authed} />
          </Suspense>
        ) : open === null ? (
          sorted.length === 0 ? (
            <Card className="py-16 text-center text-sm text-muted-foreground">还没有节点</Card>
          ) : (
            <ServerTable nodes={sorted} latency={rowLatency} />
          )
        ) : selected ? (
          <Card className="grid gap-6 p-5 md:grid-cols-[220px_minmax(0,1fr)] max-md:gap-4 max-md:p-3">
            <NodePicker nodes={sorted} selected={selected.id} />
            <div className="min-w-0">
              <Suspense fallback={<Skeleton className="h-96" />}>
                <NodeDetail node={selected} />
              </Suspense>
            </div>
          </Card>
        ) : (
          <Card className="py-16 text-center text-sm text-muted-foreground">
            节点不存在或未公开。<Link href="/" className="font-medium text-foreground hover:underline">返回列表</Link>
          </Card>
        )}
      </main>

      {/* Footer with matching measure */}
      <footer className="border-t border-border/60 bg-background/50">
        {/* Drawn once the settings are in, at the height it will have, so a
            footer the site rewrote does not show the default one first. */}
        <div className={cn(CONTAINER_CLASS, "flex min-h-14 gap-y-2 py-5 text-xs text-muted-foreground", footerLayout.row)}>
          {config && <>
          <span className="min-w-0 break-words">
            {footerText || site}
            {credit && (
              <>
                {" "}· Powered by{" "}
                <a href="https://github.com/monitor-probe/monitor" target="_blank" rel="noreferrer" className="font-medium hover:text-foreground">
                  monitor
                </a>
              </>
            )}
          </span>
          {(footerItems.length > 0 || credit) && (
          <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", footerLayout.links)}>
            {footerItems.map((item, i) => {
              if (!item.href) return <span key={i}>{item.label}</span>
              const mail = item.href.startsWith("mailto:")
              const Icon = mail ? Mail : /^https?:\/\/(t\.me|telegram\.me)\//.test(item.href) ? Send : ExternalLink
              return (
                <a
                  key={i}
                  href={item.href}
                  // A mail address opens the mail client; a new tab for it is a blank one left behind.
                  {...(mail ? {} : { target: "_blank", rel: "noreferrer" })}
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </a>
              )
            })}
            {credit && (
              <a href={theme.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Palette className="size-3.5" />
                主题 {theme.name} · {theme.author}
              </a>
            )}
          </div>
          )}
          </>}
        </div>
      </footer>

      <BackToTop />
    </div>
    </AccessProvider>
  )
}
