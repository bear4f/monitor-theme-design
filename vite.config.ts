import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { readFileSync } from "node:fs"

// index.html asks the hub for this theme's settings before any module has
// loaded, so the short name it needs is written into the page at build time.
const short: string = JSON.parse(readFileSync(import.meta.dirname + "/theme.json", "utf8")).short

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    { name: "theme-short", transformIndexHtml: (html) => html.replaceAll("%THEME_SHORT%", short) },
  ],
  // import.meta.dirname rather than new URL(...).pathname: the latter is
  // URL-encoded, so a checkout under a path containing a space or a non-ASCII
  // name resolves to %20 and the alias silently points nowhere.
  resolve: { alias: { "@": import.meta.dirname + "/src" } },
  build: {
    chunkSizeWarningLimit: 900,
    // Flags stay files. Vite would inline every one under 4 KiB as a data URL,
    // and because the page imports the whole set, all of them would ship in the
    // entry chunk whichever flags a hub's nodes need.
    assetsInlineLimit: (file) => (file.includes("/flag-icons/") ? false : undefined),
  },
  // MONITOR_HUB points the dev server at a running hub with its public page
  // open, as theme-dev.md describes; unset, a hub on this machine.
  server: {
    proxy: {
      "/api": { target: process.env.MONITOR_HUB || "http://127.0.0.1:9911", ws: true, changeOrigin: true },
    },
  },
})
