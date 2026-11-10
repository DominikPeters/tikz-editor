import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTexFuzzGraphicsResolver } from "@tikz-editor/tex-fuzz";
import { computerModernTexMetricProvider, createTexDerivedInlineMathBoxProvider, layoutSimpleTexParagraph, renderTexParagraphSvgBody, texLength } from "../packages/core/src/text/tex/index.js";
import { compareTexFuzzImagePaint } from "../scripts/lib/tex-fuzz-image-paint.mjs";
import { stageFuzzGraphicsAssets } from "../scripts/lib/fuzz-graphics-assets.mjs";
import { commandExists } from "../scripts/lib/tex-fuzz-oracle.mjs";

const cases = [
  { id: "case-002", width: 200, parindent: 15, alignment: "right" },
  { id: "case-004", width: 150, parindent: 10, alignment: "justify" },
  { id: "case-007", width: 120, parindent: 10, alignment: "center" },
  { id: "case-008", width: 200, parindent: 15, alignment: "justify" },
  { id: "case-009", width: 100, parindent: 15, alignment: "left" },
  { id: "case-010", width: 120, parindent: 15, alignment: "right" },
  { id: "case-011", width: 320, parindent: 10, alignment: "center" },
  { id: "case-014", width: 200, parindent: 15, alignment: "right" },
  { id: "case-016", width: 200, parindent: 0, alignment: "justify" },
] as const;
const fixtures = new URL("./fixtures/graphics-fuzz/article-findings/", import.meta.url);
const hasTools = process.env.TEX_FUZZ_ORACLE_TESTS === "1" && ["lualatex", "rsvg-convert", "magick"].every(commandExists)
  && spawnSync("mutool", ["-v"]).status === 0 && spawnSync("pdftoppm", ["-v"]).status === 0;

describe("independent image paint regression oracle", () => {
  it("uses the app's default 144-dpi PDF proxy without changing natural dimensions", () => {
    const result = createTexFuzzGraphicsResolver().resolve({ filename: "fuzz-images/pages.pdf", options: { raw: "" }, source: "", sourceStart: 0, sourceEnd: 0 });
    if (result.status !== "resolved") throw new Error("Missing controlled PDF");
    const png = Buffer.from(result.dataBase64, "base64");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([48, 32]);
    expect(result.naturalWidthPt).toBeCloseTo(24 * 72.27 / 72, 8);
    expect(result.naturalHeightPt).toBeCloseTo(16 * 72.27 / 72, 8);
  });

  it.runIf(hasTools)("replays all nine original sources and rejects missing, shifted, flipped and uncropped paint", () => {
    const saved = process.env.TEX_FUZZ_IMAGE_PAINT_OUT;
    const directory = saved ? resolve(saved) : mkdtempSync(join(tmpdir(), "tex-image-paint-"));
    mkdirSync(directory, { recursive: true });
    const reports: { id: string; interiorDisagreement: number[]; popplerControl: number[]; mutations: Record<string, number[]> }[] = [];
    try {
      for (const entry of cases) {
        const source = readFileSync(new URL(`${entry.id}.tex`, fixtures), "utf8");
        const oracle = readFileSync(new URL(`${entry.id}.oracle.tex`, fixtures), "utf8");
        const out = join(directory, entry.id);
        mkdirSync(out, { recursive: true });
        stageFuzzGraphicsAssets(out);
        const pdfPath = join(out, "case.pdf");
        writeFileSync(join(out, "case.tex"), oracle);
        // The reference document invokes this only to dump node metadata.
        writeFileSync(join(out, "trace.lua"), "");
        execFileSync("lualatex", ["--interaction=batchmode", "--halt-on-error", "case.tex"], { cwd: out, stdio: "ignore", timeout: 30_000,
          env: { ...process.env, TEXMFVAR: tmpdir(), TEXMFCACHE: tmpdir() } });
        const layout = layoutSimpleTexParagraph(source, { width: entry.width, parindent: entry.parindent, tikzTextWidthNode: true,
          alignment: { left: "ragged-right", right: "ragged-left", center: "center", justify: "justified" }[entry.alignment] as "ragged-right" | "ragged-left" | "center" | "justified",
          mathBoxProvider: createTexDerivedInlineMathBoxProvider(), graphicsResolver: createTexFuzzGraphicsResolver(source) });
        if (!layout.report) throw new Error("Missing native paragraph");
        const body = renderTexParagraphSvgBody(layout.report, { lineHeightPt: texLength(12), metricProvider: computerModernTexMetricProvider,
          ...(layout.vlistLayout ? { vlistLayout: layout.vlistLayout } : {}) });
        const render = (name: string, content: string) => {
          const path = join(out, name);
          writeFileSync(path + ".svg", `<svg xmlns="http://www.w3.org/2000/svg" width="360pt" height="180pt" viewBox="0 0 360 180">${content}</svg>`);
          execFileSync("rsvg-convert", ["-w", "1440", "-h", "720", "-b", "white", "-o", path + ".png", path + ".svg"]);
          return path + ".png";
        };
        const compare = (nativePngPath: string) => compareTexFuzzImagePaint({ pdfPath, nativePngPath, directory: out, width: 1440, height: 720 });
        const result = compare(render("native", body));
        const report = { id: entry.id, interiorDisagreement: result.masks.map(mask => mask.interiorDisagreement),
          popplerControl: result.popplerControl.map(mask => mask.interiorDisagreement), mutations: {} as Record<string, number[]> };
        reports.push(report);
        expect(report.interiorDisagreement, entry.id).toEqual([0, 0, 0, 0]);
        if (entry.id === "case-007") {
          const mutations = {
            missing: body.replace(/<image\b[^>]*\/>/gu, ""),
            shifted: `<g transform="translate(2 0)">${body}</g>`,
            flipped: body.replace(/<image\b[^>]*>/gu, tag => tag.replace("<image", `<image transform="translate(${/\bwidth="([^"]+)"/u.exec(tag)?.[1]} 0) scale(-1 1)"`)),
            uncropped: body.replace(/(<svg\b[^>]*\bviewBox=")[^"]+("[^>]*>)/u, (_, start: string, end: string) => `${start}0 0 2409 1606${end}`),
          };
          for (const [name, content] of Object.entries(mutations)) {
            const mismatch = compare(render(name, content)).masks.map(mask => mask.interiorDisagreement);
            report.mutations[name] = mismatch;
            expect(mismatch.some(value => value > 0), name).toBe(true);
          }
        }
      }
    } finally {
      writeFileSync(join(directory, "report.json"), JSON.stringify(reports, null, 2) + "\n");
      if (!saved) rmSync(directory, { recursive: true, force: true });
    }
  }, 90_000);
});
