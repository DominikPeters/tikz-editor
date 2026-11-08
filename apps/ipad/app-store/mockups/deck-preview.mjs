// Renders each slide of a deck through the web app, for checking a deck before capturing it.
// usage: node deck-preview.mjs deck/voting.tex deck/preview   (web dev server on port 5802)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [, , file, out] = process.argv;
fs.mkdirSync(out, { recursive: true });
const src = fs.readFileSync(file, "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:5802/");
await page.waitForFunction(() => window.__TIKZ_EDITOR_APP_TEST_API__);
await page.evaluate(s => window.__TIKZ_EDITOR_APP_TEST_API__.setSource(s), src);
await page.waitForTimeout(2500);
const thumbs = page.locator("button[type=button]").filter({ hasText: /^(Slide 1|\d+\. )/ });
const count = await thumbs.count();
for (let i = 0; i < count; i++) {
  await thumbs.nth(i).click();
  await page.waitForTimeout(1200);
  const slide = await page.evaluateHandle(() =>
    [...document.querySelectorAll("svg")].find(s => !s.getAttribute("class") && s.getBoundingClientRect().width > 300));
  const box = await slide.asElement().boundingBox();
  await page.screenshot({ path: path.join(out, `slide-${i + 1}.png`), clip: box });
}
await browser.close();
