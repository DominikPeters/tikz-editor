import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { corpusGraphicsResolver } from "../scripts/lib/beamer-corpus.mjs";

const cases = [
  { package: "listings", file: "04-algorithms-dijkstra.tex", frames: [4] },
  { package: "listings", file: "10-distributed-timeout.tex", frames: [7] },
  { package: "listings", file: "12-numerical-debugging.tex", frames: [2, 7] },
  { package: "alltt", file: "12-numerical-debugging.tex", frames: [9] },
  { package: "siunitx", file: "05-fluid-channel.tex", frames: [6] },
  { package: "braket", file: "07-quantum-predict-observe.tex", frames: [2, 3, 4, 5, 6, 7] },
  { package: "subcaption", file: "11-ecology-restoration.tex", frames: [7] },
] as const;

describe("first package tranche in the unchanged breadth sources (coverage, not fidelity)", () => {
  for (const entry of cases) {
    for (const frame of entry.frames) {
      it(`${entry.package}: ${entry.file} frame ${frame}`, async () => {
        const input = new URL(`./fixtures/beamer/breadth-decks/${entry.file}`, import.meta.url);
        const source = readFileSync(input, "utf8");
        const temporary = mkdtempSync(join(tmpdir(), "beamer-package-breadth-"));
        try {
          const graphics = corpusGraphicsResolver(source, fileURLToPath(input), temporary);
          const pages = await prepareBeamerDocument(source).renderFramePages({ frameIndex: frame - 1, graphicsResolver: graphics.resolver });
          for (const page of pages.pages) {
            expect(page.diagnostics.filter(item => /^beamer-(?:listings|siunitx|subfigure)-unsupported/u.test(item.code ?? ""))).toEqual([]);
            const unsupported = page.layout.items.filter(item => item.kind === "unsupported");
            // Dirac macros inside a deferred circuit stay owned by that circuit.
            expect(unsupported.filter(item => entry.package !== "braket" || !item.message?.includes("quantikz"))).toEqual([]);
            if (entry.package === "listings" || entry.package === "alltt") expect(page.svg.svg).toContain('data-tex-font="lmmono');
            if (entry.package === "braket") expect(page.diagnostics.filter(item => /\\(?:ket|bra|braket)\b/u.test(item.message))).toEqual([]);
            if (entry.package === "subcaption") expect((page.svg.svg.match(/<image\b/gu) ?? []).length).toBe(2);
          }
        } finally {
          rmSync(temporary, { recursive: true, force: true });
        }
      });
    }
  }
});
