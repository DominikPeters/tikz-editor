import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { setVerticalShadowListener, type VerticalShadowBoundary, type VerticalShadowReport } from "../packages/core/src/text/tex/vlist/vertical-shadow.js";

// Compares the old skip planner with the VerticalListBuilder over every
// fidelity fixture (design/vertical-list-builder.md). Run on demand:
//   VLIST_SHADOW=1 npx vitest run test/vertical-shadow.spec.ts
// Optional SHADOW_ONLY=<fixture id substring>. Report: artifacts/vlist-shadow/.
it.skipIf(process.env.VLIST_SHADOW !== "1")("vertical-list builder shadow comparison", async () => {
  const root = new URL("./fixtures/beamer/", import.meta.url);
  type Row = (VerticalShadowBoundary & { fixture: string }) | { fixture: string; error: string };
  const rows: Row[] = [];
  let current = "";
  setVerticalShadowListener((report: VerticalShadowReport) => {
    for (const b of report.boundaries) rows.push({ fixture: current, ...b });
  });
  const only = process.env.SHADOW_ONLY;
  for (const dir of readdirSync(root)) {
    const m = existsSync(new URL(`${dir}/cases.json`, root)) ? "cases.json" : existsSync(new URL(`${dir}/closed-cases.json`, root)) ? "closed-cases.json" : null;
    if (!m) continue;
    const manifest = JSON.parse(readFileSync(new URL(`${dir}/${m}`, root), "utf8")) as { fidelity?: { id: string; file: string; frame: number }[] };
    for (const fx of manifest.fidelity ?? []) {
      if (only && !fx.id.includes(only)) continue;
      current = `${dir}/${fx.id}`;
      try {
        const source = readFileSync(new URL(`${dir}/${fx.file}`, root), "utf8");
        await prepareBeamerDocument(source).renderFramePages({ frameIndex: fx.frame - 1 });
      } catch (e) { rows.push({ fixture: current, error: String(e).slice(0, 200) }); }
    }
  }
  setVerticalShadowListener(undefined);
  mkdirSync("artifacts/vlist-shadow", { recursive: true });
  writeFileSync("artifacts/vlist-shadow/report.json", JSON.stringify(rows));
  const compared = rows.flatMap(row => "old" in row && !row.nearDisplay && !row.first ? [row] : []);
  const differing = compared.filter(row => Math.abs(row.old - row.builder) > 0.01);
  console.log(`vertical shadow: ${differing.length} of ${compared.length} compared boundaries differ, in ${new Set(differing.map(row => row.fixture)).size} fixtures`);
}, 3_600_000);
