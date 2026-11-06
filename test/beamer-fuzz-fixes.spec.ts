import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBeamerEditScopeAt } from "../packages/core/src/beamer/edit-scopes.js";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/beamer/fuzz-findings-v4/${name}.tex`, import.meta.url), "utf8");
describe("renderer fuzz findings", () => {
  it("executes local declarations and restores their enclosing scope", async () => {
    const result = await prepareBeamerDocument(fixture("local-macro-redefinition")).renderFrame();
    const text = result.layout.paragraphs.flatMap(p => p.report.lines.map(l => l.segments.map(s => s.text ?? "").join(""))).join("").replace(/\s/gu, "");
    expect(text).toContain("Before:12ms."); expect(text).toContain("Local:7ticks."); expect(text).toContain("Restored:11ms.");
    expect(result.svg.svg).not.toContain("data-tex-literal=");
    expect(result.diagnostics).toEqual([]);
  });
  it.each(["T", "t", "c", "b"])("composes columns inside a block (%s)", async alignment => {
    const source = fixture("columns-inside-block").replace("onlytextwidth,T", `onlytextwidth,${alignment}`);
    const result = await prepareBeamerDocument(source).renderFrame();
    expect(result.diagnostics).toEqual([]);
    expect(result.svg.svg).not.toContain("data-tex-literal=");
    expect(result.layout.paragraphs).toHaveLength(3);
    for (const text of ["Left input.", "Right result."]) {
      const scope = resolveBeamerEditScopeAt(result.layout.editScopes ?? [], source.indexOf(text));
      expect(scope?.kind).toBe("column");
    }
  });
});
