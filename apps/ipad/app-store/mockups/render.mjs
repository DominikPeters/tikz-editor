import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
const dir = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(dir, process.argv[3] || "screenshots"); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2752, height: 2064 }, deviceScaleFactor: 1 });
await page.goto("file://" + path.join(dir, process.argv[2] || "frames.html"));
await page.waitForLoadState("networkidle");
await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
for (const id of await page.$$eval(".frame", els => els.map(e => e.id))) {
  await page.locator(`[id="${id}"]`).screenshot({ path: path.join(out, id + ".png") });
}
await browser.close();
