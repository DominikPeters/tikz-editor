import { describe, expect, it } from "vitest";
import { scopePresentationSvg } from "../packages/app/src/presentation/svg.js";

describe("presentation SVG slots", () => {
  it("isolates clip paths and glyph references while preserving source metadata, colors, and external links", () => {
    const svg = `<svg><defs><clipPath id="clip"><rect width="10" height="20"/></clipPath><path id='glyph'/></defs><g data-source-id="object" clip-path="url(#clip)" fill="#fff"><use href='#glyph'/><a href="https://example.com/#clip"/></g></svg>`;
    const current = scopePresentationSvg(svg, "current"), next = scopePresentationSvg(svg, "next");
    expect(current).toContain('id="current-clip"');
    expect(current).toContain("href='#current-glyph'");
    expect(current).toContain('clip-path="url(#current-clip)"');
    expect(next).toContain('id="next-clip"');
    expect(current).toContain('data-source-id="object"');
    expect(current).toContain('fill="#fff"');
    expect(current).toContain('href="https://example.com/#clip"');
  });
});
