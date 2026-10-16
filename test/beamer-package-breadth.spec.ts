import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { corpusGraphicsResolver } from "../scripts/lib/beamer-corpus.mjs";

const inventory = JSON.parse(readFileSync(new URL("../design/beamer-package-support-inventory.json", import.meta.url), "utf8")) as {
  packages: { package: string; occurrences: { source: string; frame: number; span: { from: number; to: number } }[] }[];
};

describe("first package tranche in the unchanged breadth sources (coverage, not fidelity)", () => {
  for (const entry of inventory.packages.filter(entry => ["listings", "alltt", "siunitx", "braket", "subcaption"].includes(entry.package))) {
    for (const occurrence of entry.occurrences) {
      it(`${entry.package}: ${occurrence.source} frame ${occurrence.frame}`, async () => {
        const input = new URL(`../${occurrence.source}`, import.meta.url);
        const source = readFileSync(input, "utf8");
        const temporary = mkdtempSync(join(tmpdir(), "beamer-package-breadth-"));
        try {
          const graphics = corpusGraphicsResolver(source, fileURLToPath(input), temporary);
          const pages = await prepareBeamerDocument(source).renderFramePages({ frameIndex: occurrence.frame - 1, graphicsResolver: graphics.resolver });
          for (const page of pages.pages) {
            expect(page.diagnostics.filter(item => /^beamer-(?:listings|siunitx|subfigure)-unsupported/u.test(item.code ?? ""))).toEqual([]);
            const unsupported = page.layout.items.filter(item => item.kind === "unsupported").filter(item => item.sourceSpan.from < occurrence.span.to && occurrence.span.from < item.sourceSpan.to);
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
