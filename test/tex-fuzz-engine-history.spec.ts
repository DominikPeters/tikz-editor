import { describe, expect, it } from "vitest";
import {
  caseFromTexFuzzAst, checkTexFuzzEngineHistory, createTexFuzzFreshEngine,
  generateFullySupportedTexFuzzCases,
} from "@tikz-editor/tex-fuzz";

const document = caseFromTexFuzzAst([
  { kind: "text", value: "Before" }, { kind: "paragraph-break", command: "par" },
  { kind: "environment", name: "itemize", children: [
    { kind: "item" }, { kind: "text", value: "Alpha" },
    { kind: "math", body: { kind: "script", base: { kind: "atom", value: "x" }, superscript: { kind: "atom", value: "2" } } },
    { kind: "item" }, { kind: "text", value: "Beta" },
  ] },
  { kind: "display-math", delimiter: "bracket", body: { kind: "fraction", command: "frac",
    numerator: { kind: "atom", value: "a" }, denominator: { kind: "atom", value: "b" } } },
  { kind: "text", value: "After" },
], { profile: "document" });

describe("production TeX engine fuzz histories", () => {
  it("preserves reports and visible snapshot identity through real eviction", async () => {
    expect(await checkTexFuzzEngineHistory(document, { churnRequests: 2100 })).toEqual([]);
  }, 30_000);

  it("matches independent engines across generated edits, source shifts, font and resolver changes", async () => {
    const engine = await createTexFuzzFreshEngine();
    for (const caseData of generateFullySupportedTexFuzzCases(73_001, { count: 8 }).cases) {
      expect(await checkTexFuzzEngineHistory(caseData, { engine }), caseData.source).toEqual([]);
    }
  }, 30_000);

  it("rejects an engine that paints cached output with a glyph silently removed", async () => {
    const actual = await createTexFuzzFreshEngine();
    const engine = { ...actual, renderFromCache: (key: string) => {
      const payload = actual.renderFromCache(key);
      return payload ? { ...payload, body: payload.body.replace(/<path\b[^>]*\/>/, "") } : null;
    } };
    const findings = await checkTexFuzzEngineHistory(caseFromTexFuzzAst([{ kind: "text", value: "Alpha" }]), { engine });
    expect(findings.map((finding) => finding.fingerprint.code)).toContain("engine-history-fresh-mismatch");
  });

  it("rejects missing editing reports even if metrics and SVG remain valid", async () => {
    const actual = await createTexFuzzFreshEngine();
    const findings = await checkTexFuzzEngineHistory(document, { engine: { ...actual, layoutContext: {} } });
    expect(findings.map((finding) => finding.fingerprint.code)).toContain("engine-history-missing-metadata");
  });
});
