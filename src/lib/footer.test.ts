/// <reference types="node" />
import assert from "node:assert/strict"
import { parseFooterItems } from "./footer.ts"

assert.deepEqual(parseFooterItems(""), [])
assert.deepEqual(
  parseFooterItems("TG | https://t.me/example\nNS｜https://www.nodeseek.com/space/1\n\n 备案号 123 \n邮箱 | mailto:a@example.com"),
  [
    { label: "TG", href: "https://t.me/example" },
    { label: "NS", href: "https://www.nodeseek.com/space/1" },
    { label: "备案号 123", href: undefined },
    { label: "邮箱", href: "mailto:a@example.com" },
  ],
)
// Not a web or mail address: shown as text, never as a link.
for (const bad of ["javascript:alert(1)", "tg://resolve?domain=x", "data:text/html,x", "not a url"]) {
  assert.deepEqual(parseFooterItems(`点我 | ${bad}`), [{ label: "点我", href: undefined }])
}
// An address alone is labelled with where it goes.
assert.deepEqual(parseFooterItems("https://example.com/a/b"), [{ label: "example.com", href: "https://example.com/a/b" }])
assert.equal(parseFooterItems(Array(20).fill("a | https://example.com").join("\n")).length, 8)
console.log("footer items parse, and only web and mail addresses become links")
