import { describe, expect, it } from "vitest";

import { BUILT_IN_BEAMER_THEMES } from "../scripts/lib/beamer-built-in-themes.mjs";
import { renderBeamerThemeGallery } from "../scripts/lib/beamer-theme-gallery.mjs";

describe("Beamer theme comparison gallery", () => {
  it("catalogs the 28 shipped presentation themes without compatibility aliases", () => {
    expect(BUILT_IN_BEAMER_THEMES).toHaveLength(28);
    expect(BUILT_IN_BEAMER_THEMES.map(({ label }) => label)).toEqual(
      expect.arrayContaining([
        "Default",
        "AnnArbor",
        "CambridgeUS",
        "Madrid",
        "Warsaw",
      ])
    );
    expect(BUILT_IN_BEAMER_THEMES.map(({ label }) => label)).not.toContain(
      "compatibility"
    );
    expect(
      BUILT_IN_BEAMER_THEMES.find(({ id }) => id === "madrid")?.variant
    ).toEqual({
      theme: "Madrid",
      colorTheme: false,
    });
  });

  it("embeds navigation data and escapes source text in a standalone HTML artifact", () => {
    const html = renderBeamerThemeGallery({
      formatVersion: 2,
      decks: ["conformance"],
      variants: ["default"],
      variantCatalog: [{ id: "default", label: "Default" }],
      raster: true,
      passed: 1,
      failed: 0,
      results: [{
        deck: "conformance",
        variant: "default",
        frame: 1,
        frameTitle: "</script><script>alert(1)</script>",
        status: "passed",
        report: "frame/report.json",
        diagnostics: [],
        summary: {
          maxAbsoluteGlyphDxPt: 0,
          maxAbsoluteGlyphDyPt: 0,
          comparedGlyphs: 12,
        },
        visuals: {
          renderer: "frame/renderer.png",
          oracle: "frame/oracle.png",
          overlay: "frame/overlay.png",
          difference: "frame/difference.png",
        },
      }],
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('data-mode="wipe"');
    expect(html).toContain("frame/renderer.png");
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("</script><script>alert(1)</script>");
  });
});
