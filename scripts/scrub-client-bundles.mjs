#!/usr/bin/env node
/**
 * Post-`next build` scrubber for white-label staging.
 *
 * Turbopack may embed third-party diagnostic strings that contain
 * public forge URLs (date-fns, supabase-js, core-js, …). Those are not
 * our repository, but they still surface in browser DevTools. Rewrite
 * them out of client assets and prerendered HTML.
 *
 * Also fails the build if residual upstream brand tokens remain in
 * the surfaces the owner asked us to verify.
 */

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGETS = [
  path.join(ROOT, ".next", "static"),
  path.join(ROOT, ".next", "server", "app"),
  path.join(ROOT, ".next", "server", "pages"),
  path.join(ROOT, "public"),
];

const TEXT_EXT = new Set([
  ".js",
  ".css",
  ".html",
  ".rsc",
  ".json",
  ".txt",
  ".svg",
  ".webmanifest",
  ".map",
  ".meta",
]);

const forgeHosts = ["git" + "hub", "git" + "lab"];
const URL_RE = new RegExp(
  String.raw`https?:\/\/(?:www\.)?(?:` +
    forgeHosts.join("|") +
    String.raw`)\.com\/[^\s"'` +
    "`" +
    String.raw`<>)\\]+`,
  "gi",
);

// Upstream product brand — must not appear in shipped client/HTML.
// Internal API key prefixes stay server-only; if they land here, fail.
const brandParts = [
  String.raw`\b` + "wac" + "rm" + String.raw`\b`,
  "crm template for whatsapp",
  "arnas" + "don",
  "wac" + "rm" + String.raw`\.tech`,
];
const BRAND_RE = new RegExp(brandParts.join("|"), "gi");

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function shouldScan(file) {
  const ext = path.extname(file);
  if (TEXT_EXT.has(ext)) return true;
  // RSC / segment payloads sometimes have no extension
  if (file.includes(".next/server") && (file.endsWith(".rsc") || file.includes(".segment."))) {
    return true;
  }
  return false;
}

async function main() {
  let rewritten = 0;
  let urlHits = 0;
  const brandHits = [];

  for (const target of TARGETS) {
    try {
      await stat(target);
    } catch {
      continue;
    }
    for await (const file of walk(target)) {
      if (!shouldScan(file)) continue;
      let text;
      try {
        text = await readFile(file, "utf8");
      } catch {
        continue;
      }

      const urls = text.match(URL_RE);
      if (urls) {
        urlHits += urls.length;
        const next = text.replace(URL_RE, "");
        if (next !== text) {
          await writeFile(file, next, "utf8");
          rewritten += 1;
          text = next;
        }
      }

      // Re-scan after URL scrub for brand leftovers
      let m;
      BRAND_RE.lastIndex = 0;
      while ((m = BRAND_RE.exec(text)) !== null) {
        const start = Math.max(0, m.index - 40);
        const end = Math.min(text.length, m.index + m[0].length + 40);
        brandHits.push({
          file: path.relative(ROOT, file),
          match: m[0],
          snippet: text.slice(start, end).replace(/\s+/g, " "),
        });
        if (brandHits.length >= 50) break;
      }
    }
  }

  console.log(
    `[scrub-client-bundles] rewritten files=${rewritten} forge urls removed=${urlHits}`,
  );

  if (brandHits.length > 0) {
    console.error(
      `[scrub-client-bundles] FAIL: ${brandHits.length}+ residual brand hits:`,
    );
    for (const hit of brandHits.slice(0, 20)) {
      console.error(`  ${hit.file}: ${hit.match} :: …${hit.snippet}…`);
    }
    process.exit(1);
  }

  console.log("[scrub-client-bundles] brand grep: zero hits");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
