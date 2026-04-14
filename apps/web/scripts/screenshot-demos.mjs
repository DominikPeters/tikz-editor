#!/usr/bin/env node
// Capture screenshots of each DemoPlayer at a few time offsets.
//
// Usage:
//   node apps/web/scripts/screenshot-demos.mjs [demoId] [...offsetsMs]
//
// Examples:
//   node apps/web/scripts/screenshot-demos.mjs
//   node apps/web/scripts/screenshot-demos.mjs drag-node
//   node apps/web/scripts/screenshot-demos.mjs drag-node 0 500 1500 3000
//
// Auto-starts `npm run dev` in apps/web if nothing is listening on port 5173.
// Override with DEMO_BASE_URL=... for an already-running server.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(WEB_ROOT, "demo-screenshots");
const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:5173/editor/";
const DEFAULT_OFFSETS = [0, 800, 1600, 2400, 3200];

async function waitForServer(url, timeoutMs = 4000) {
  const probeUrl = normalizeBaseUrl(url);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(probeUrl);
      if (r.status >= 200 && r.status < 500) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const baseUrl = normalizeBaseUrl(BASE_URL);
  let demos = [];
  let offsets = DEFAULT_OFFSETS;
  if (args.length > 0) {
    demos = [args[0]];
    if (args.length > 1) offsets = args.slice(1).map(Number).filter((n) => Number.isFinite(n));
  }

  let server = null;
  if (!(await waitForServer(baseUrl))) {
    console.log(`No dev server at ${baseUrl}; starting one...`);
    const parsed = new URL(baseUrl);
    const host = parsed.hostname || "localhost";
    const port = parsed.port ? Number(parsed.port) : 5173;
    server = spawn("npm", ["run", "dev", "--", "--host", host, "--port", String(port), "--strictPort"], {
      cwd: WEB_ROOT,
      stdio: "inherit"
    });
    const started = await waitForServer(baseUrl, 60_000);
    if (!started) {
      server.kill();
      throw new Error("Dev server did not come up in 60s");
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    if (demos.length === 0) {
      demos = await discoverDemos(browser, baseUrl);
      if (demos.length === 0) {
        throw new Error("No demos discovered. Pass a demo id explicitly, e.g. `npm run screenshots:demos -- drag-node`.");
      }
      console.log(`Discovered demos: ${demos.join(", ")}`);
    }
    for (const demoId of demos) {
      const url = `${baseUrl}?demo=${demoId}`;
      console.log(`\n${demoId}  →  ${url}`);
      for (const t of offsets) {
        // Fresh page per offset so each screenshot captures the demo at
        // exactly `t` ms from start. Simple and honest — no time scrubbing.
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForSelector('[data-testid="canvas-interaction-layer"]', { timeout: 3_000 }).catch(() => {
          console.warn(`  warning: canvas-interaction-layer not found within 3s for t=${t}`);
        });
        if (t > 0) await page.waitForTimeout(t);
        const file = resolve(OUT_DIR, `${demoId}-t${String(t).padStart(5, "0")}.png`);
        await page.screenshot({ path: file });
        console.log(`  t=${t}ms  →  ${file}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function discoverDemos(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const url = `${normalizeBaseUrl(baseUrl)}?demo=__missing__`;
    await page.goto(url, { waitUntil: "networkidle" });
    const demos = await page.$$eval("a[href*='?demo=']", (anchors) =>
      anchors
        .map((a) => {
          const href = a.getAttribute("href") ?? "";
          const match = href.match(/[?&]demo=([^&]+)/);
          return match ? decodeURIComponent(match[1]) : null;
        })
        .filter((id) => typeof id === "string" && id.length > 0)
    );
    return [...new Set(demos)];
  } finally {
    await page.close();
  }
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url : `${url}/`;
}
