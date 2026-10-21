import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { corpusGraphicsResolver } from "../scripts/lib/beamer-corpus.mjs";

const root = new URL("./fixtures/beamer/breadth-decks/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8")) as {
  decks: { id: string; file: string; theme: string; pedagogy: string; sourceFrames: number; expectedNativePages: number }[];
};

describe("original Beamer breadth decks (discovery and crash smoke checks, not fidelity)", () => {
  it("keeps twelve distinct themes and presentation approaches", () => {
    expect(manifest.decks).toHaveLength(12);
    expect(new Set(manifest.decks.map(deck => deck.theme)).size).toBe(12);
    expect(new Set(manifest.decks.map(deck => deck.pedagogy)).size).toBe(12);
  });

  for (const deck of manifest.decks) {
    it(`discovers every authored frame and renders all overlays/continuations: ${deck.id}`, async () => {
      const path = fileURLToPath(new URL(deck.file, root));
      const source = readFileSync(path, "utf8");
      const prepared = prepareBeamerDocument(source);
      expect(prepared.document.frames).toHaveLength(deck.sourceFrames);
      const temporary = mkdtempSync(join(tmpdir(), "beamer-breadth-"));
      try {
        const graphics = corpusGraphicsResolver(source, path, temporary);
        let pages = 0;
        for (let frameIndex = 0; frameIndex < deck.sourceFrames; frameIndex++) {
          const rendered = await prepared.renderFramePages({ frameIndex, graphicsResolver: graphics.resolver });
          pages += rendered.pageCount;
          for (const page of rendered.pages) {
            expect(page.svg.svg).toContain("<svg");
            expect(Number.isFinite(page.svg.viewBox.width) && page.svg.viewBox.width > 0).toBe(true);
            expect(Number.isFinite(page.svg.viewBox.height) && page.svg.viewBox.height > 0).toBe(true);
          }
        }
        // Counts come from the complete TeX decks, excluding their six automatic
        // modern-theme section frames, which the scanner does not yet discover.
        // Unsupported package diagnostics intentionally remain visible in census
        // reports; successful SVG production must never be counted as fidelity.
        expect(pages).toBe(deck.expectedNativePages);
        expect(graphics.report().every(asset => asset.status === "resolved")).toBe(true);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }, 30_000);
  }
});
