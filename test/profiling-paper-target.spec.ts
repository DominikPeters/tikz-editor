import { describe, expect, it } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { resolvePaperTarget } from "../apps/web/profiling/helpers.js";

describe("paper profiling target selection", () => {
  it("resolves the drag target in the twelfth figure using the current parser option", () => {
    const target = resolvePaperTarget([
      String.raw`\draw[thick,->,magenta] (0.0, 0.0) -- (0.0, 4.5);`,
      String.raw`\draw[thick,->] (0.0, 0.0) -- (0.0, 4.5);`
    ]);
    expect(target.activeFigureNumber).toBe(12);
    const parsed = parseTikz(target.source, { activeFigureId: target.activeRootId });
    expect(parsed.activeFigureId).toBe(target.activeRootId);
    expect(target.targetOffset).toBeGreaterThanOrEqual(parsed.figure.span.from);
    expect(target.targetOffset).toBeLessThan(parsed.figure.span.to);
    expect(target.targetSourceId).toMatch(/^path:/);
    expect(target.source.slice(target.targetOffset)).toMatch(/^\\draw/);
  });
});
