import { describe, expect, it } from "vitest";
import { layoutSimpleTexParagraph } from "../packages/core/src/text/tex/index.js";
import { sourceOffsetForSpace } from "../packages/core/src/text/source-coordinates.js";
import {
  applyTexFuzzMutations,
  caseFromTexFuzzAst,
  checkTexFuzzMetamorphicInvariants,
  deriveTexFuzzMetamorphicPairs,
  mutateTexFuzzCase,
  shrinkTexFuzzCase,
  texFuzzPrefixDamage,
  texFuzzPrefixDamageCases,
  texFuzzMalformedMutations,
  texFuzzShrinkCandidates,
  type TexFuzzObservation,
  sameTexFuzzFailureClass,
} from "@tikz-editor/tex-fuzz";

const observation: TexFuzzObservation = {
  fingerprint: {
    version: 1,
    resultClass: "hard-invariant",
    code: "mutation-canary",
    featureTags: [],
    mode: "text",
    structuralLocus: "source",
  },
};

describe("TeX fuzz mutations and relations", () => {
  it("shrinks real failure classes after unrelated features and indexed loci disappear", async () => {
    const original = caseFromTexFuzzAst([
      { kind: "font", command: "textbf", children: [{ kind: "text", value: "Alpha" }] },
      { kind: "text", value: "Beta" },
    ]);
    const diagnostic = (caseData: typeof original): TexFuzzObservation => ({ fingerprint: {
      ...observation.fingerprint, featureTags: caseData.features,
      structuralLocus: `root/${caseData.ast.length - 1}`,
    } });
    const result = await shrinkTexFuzzCase(original, diagnostic(original), async (candidates) =>
      candidates.map((candidate) => candidate.source.includes("Beta") ? diagnostic(candidate) : null)
    );
    expect(result.minimizedCase.source).toBe("Beta");
    expect(sameTexFuzzFailureClass(diagnostic(original).fingerprint, diagnostic(result.minimizedCase).fingerprint)).toBe(true);
  });

  it("offers reductions inside scripts, fractions, and matrix cells", () => {
    const original = caseFromTexFuzzAst([{ kind: "display-math", delimiter: "bracket", body: {
      kind: "fraction", command: "frac", numerator: { kind: "script", base: { kind: "atom", value: "a" },
        superscript: { kind: "atom", value: "2" } },
      denominator: { kind: "matrix", environment: "matrix", cells: [[{ kind: "atom", value: "b" }, { kind: "atom", value: "c" }]] },
    } }]);
    const sources = texFuzzShrinkCandidates(original).map((candidate) => candidate.source);
    expect(sources).toContain(String.raw`\[\frac{a}{\begin{matrix}b&c\end{matrix}}\]`);
    expect(sources).toContain(String.raw`\[\frac{{a}^{2}}{b}\]`);
  });

  it("records every typing prefix and labels command and argument boundaries", () => {
    const original = caseFromTexFuzzAst([{
      kind: "font",
      command: "textbf",
      children: [{ kind: "text", value: "Alpha" }],
    }]);
    const damaged = texFuzzPrefixDamage(original);

    expect(texFuzzPrefixDamageCases(original).map((item) => item.source)).toEqual(
      Array.from({ length: original.source.length + 1 }, (_, offset) => original.source.slice(0, offset))
    );
    expect(damaged).toContainEqual(expect.objectContaining({ boundaryKind: "command", offset: 4 }));
    expect(damaged).toContainEqual(expect.objectContaining({ boundaryKind: "delimiter-before", offset: 7 }));
    expect(damaged).toContainEqual(expect.objectContaining({ boundaryKind: "delimiter-after", offset: 8 }));
    expect(damaged.every((item) => item.case.mutations.at(-1)?.kind === "truncate")).toBe(true);
    expect(damaged.every((item) => item.case.sourceMap.every((span) => span.end <= item.case.source.length))).toBe(true);
  });

  it("applies sequential raw truncations to the current source", () => {
    const original = caseFromTexFuzzAst([{ kind: "text", value: "abcdef" }]);
    const first = mutateTexFuzzCase(original, { kind: "truncate", offset: 5 });
    const second = mutateTexFuzzCase(first, { kind: "truncate", offset: 2 });
    expect(second.source).toBe("ab");
    expect(second.mutations).toEqual([
      { kind: "truncate", offset: 5 },
      { kind: "truncate", offset: 2 },
    ]);
  });

  it("replays insert, delete, replace, and truncate in recorded order", () => {
    const mutations = [
      { kind: "insert", offset: 1, text: "X" },
      { kind: "delete", start: 2, end: 3 },
      { kind: "replace", start: 0, end: 1, text: "Y" },
      { kind: "truncate", offset: 2 },
    ] as const;
    expect(applyTexFuzzMutations("abc", mutations)).toBe("YX");

    let caseData = caseFromTexFuzzAst([{ kind: "text", value: "abc" }]);
    for (const mutation of mutations) caseData = mutateTexFuzzCase(caseData, mutation);
    expect(caseData.source).toBe("YX");
    expect(caseData.mutations).toEqual(mutations);
    expect(caseData.sourceMap.every((span) => span.start >= 0 && span.end <= caseData.source.length)).toBe(true);
  });

  it("enumerates and exactly replays diverse malformed edit classes", () => {
    const original = caseFromTexFuzzAst([{
      kind: "text",
      value: "{[\\textbf{cafe\u0301 😀 $x_i^2$}]} \\begin{align}a&b\\\\c&d\\end{align}",
    }]);
    const candidates = texFuzzMalformedMutations(original);
    expect(texFuzzMalformedMutations(original)).toEqual(candidates);
    const kinds = new Set(candidates.map((candidate) => candidate.mutationKind));
    expect(kinds).toEqual(new Set([
      "delimiter-duplicate",
      "delimiter-remove",
      "delimiter-swap",
      "control-word-corrupt",
      "script-duplicate",
      "environment-end-mismatch",
      "alignment-insert",
      "row-break-insert",
      "grapheme-split",
      "whitespace-insert",
      "comment-insert",
      "unsupported-command-splice",
    ]));
    expect(candidates.every(({ case: mutated }) =>
      applyTexFuzzMutations(original.source, mutated.mutations) === mutated.source
    )).toBe(true);
    expect(candidates.every(({ case: mutated }) =>
      mutated.sourceMap.every((span) => span.start >= 0 && span.start <= span.end && span.end <= mutated.source.length)
    )).toBe(true);
    expect(candidates.some(({ mutationKind, mutation }) =>
      mutationKind === "delimiter-remove" && mutation.kind === "delete"
    )).toBe(true);
    expect(candidates.some(({ mutationKind, mutation }) =>
      mutationKind === "unsupported-command-splice"
        && mutation.kind === "insert"
        && mutation.text.includes("Unsupported")
    )).toBe(true);
  });

  it("offers generic AST and raw-string reductions", () => {
    const astCase = caseFromTexFuzzAst([
      { kind: "text", value: "Alpha" },
      { kind: "font", command: "textbf", children: [{ kind: "text", value: "Beta" }] },
    ]);
    expect(texFuzzShrinkCandidates(astCase).map((item) => item.source)).toContain("Alpha");

    const malformed = mutateTexFuzzCase(astCase, { kind: "truncate", offset: astCase.source.length - 1 });
    const rawCandidates = texFuzzShrinkCandidates(malformed);
    expect(rawCandidates.some((item) => item.source.length < malformed.source.length)).toBe(true);
    expect(rawCandidates.every((item) => item.sourceMap.every((span) => span.end <= item.source.length))).toBe(true);
  });

  it("declares domains, exceptions, calibration, and observables for relations", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "text", value: "Alpha" },
      { kind: "space", nonBreaking: false },
      { kind: "text", value: "Beta" },
    ]);
    const pairs = deriveTexFuzzMetamorphicPairs(caseData);
    expect(pairs).toContainEqual(expect.objectContaining({
      relationId: "repeat-render-determinism",
      expectedRelation: "equal",
      calibrationRequired: false,
    }));
    expect(pairs).toContainEqual(expect.objectContaining({
      relationId: "tie-removes-breakpoint",
      transformedSource: "Alpha~Beta",
      expectedRelation: "no-new-breakpoint",
      calibrationRequired: true,
      knownExceptions: expect.arrayContaining([expect.stringContaining("geometry")]),
      observables: ["supported-classification", "line-break-opportunities"],
    }));
  });

  it("executes repeat-render and tie relations against renderer observations", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "text", value: "Alpha" },
      { kind: "space", nonBreaking: false },
      { kind: "text", value: "Beta" },
    ]);
    const actual = checkTexFuzzMetamorphicInvariants(caseData, { widths: [20, 40] });
    expect(actual).toMatchObject({ pairCount: 3, checks: 6, findings: [] });

    const sabotaged = checkTexFuzzMetamorphicInvariants(caseData, {
      widths: [20],
      layout: (source, width) => {
        const result = layoutSimpleTexParagraph(source, {
          width,
          hyphenator: { hyphenate: () => [] },
        });
        if (source.includes("~") && result.report?.lines[0]) {
          result.report.lines[0].break = {
            kind: "space",
            runIndex: 1,
            sourceOffset: sourceOffsetForSpace(
              source.indexOf("~") + 1,
              result.report.sourceCoordinateSpace
            ),
            visibleHyphen: false,
          };
        }
        return result;
      },
    });
    expect(sabotaged.findings.some((finding) =>
      finding.fingerprint.code === "metamorphic-tie-breakpoint"
    )).toBe(true);
  });

  it("accounts local candidates independently from external oracle evaluations", async () => {
    const original = caseFromTexFuzzAst([
      { kind: "text", value: "Alpha" },
      { kind: "text", value: "Beta" },
    ]);
    const local = await shrinkTexFuzzCase(original, observation, async (candidates) =>
      candidates.map((candidate) => candidate.source.includes("x") ? observation : null)
    );
    expect(local.candidatesEvaluated).toBeGreaterThan(0);
    expect(local.oracleEvaluations).toBe(0);

    const external = await shrinkTexFuzzCase(original, observation, async (candidates, context) => ({
      observations: candidates.map(() => null),
      oracleEvaluations: Math.min(2, context.maxOracleEvaluations),
    }), { maxOracleEvaluations: 2 });
    expect(external.oracleEvaluations).toBe(2);
    expect(external.termination).toBe("oracle-budget");
  });

  it("does no candidate construction when shrinking is disabled for a resource failure", async () => {
    const original = caseFromTexFuzzAst([{ kind: "text", value: "Alpha" }]);
    const guarded = { ...original, get ast(): typeof original.ast { throw new Error("Candidate construction must not inspect the AST."); } };
    const result = await shrinkTexFuzzCase(guarded, observation, async () => {
      throw new Error("Disabled shrinking must not evaluate candidates.");
    }, { maxCandidates: 0 });
    expect(result.minimizedCase).toBe(guarded);
    expect(result).toMatchObject({ candidatesEvaluated: 0, termination: "candidate-budget" });
  });

  it("interrupts a hung shrink batch and exposes cancellation to its work", async () => {
    const original = caseFromTexFuzzAst([{ kind: "text", value: "Alpha" }]);
    let cancelled = false;
    const result = await shrinkTexFuzzCase(original, observation, async (_candidates, context) => {
      expect(context.deadline).toBeGreaterThan(performance.now());
      context.signal.addEventListener("abort", () => { cancelled = true; }, { once: true });
      return new Promise(() => {});
    }, { maxTimeMs: 100 });
    expect(result).toMatchObject({ termination: "time-budget", minimizedCase: original });
    expect(cancelled).toBe(true);
  });

  it("retains the previous reduction when a later batch exhausts the shared deadline", async () => {
    const original = caseFromTexFuzzAst([
      { kind: "text", value: "Alpha" }, { kind: "text", value: "Beta" },
    ]);
    const deadlines: number[] = [];
    let retained: typeof original | undefined;
    const result = await shrinkTexFuzzCase(original, observation, async (candidates, context) => {
      deadlines.push(context.deadline);
      if (deadlines.length === 1) {
        retained = candidates.find((candidate) => candidate.source === "Beta");
        return candidates.map((candidate) => candidate === retained ? observation : null);
      }
      return new Promise(() => {});
    }, { maxTimeMs: 100 });
    expect(deadlines).toHaveLength(2);
    expect(deadlines[1]).toBe(deadlines[0]);
    expect(result).toMatchObject({ termination: "time-budget", minimizedCase: retained });
  });

  it("does not suppress predicate failures before the deadline", async () => {
    const original = caseFromTexFuzzAst([{ kind: "text", value: "Alpha" }]);
    await expect(shrinkTexFuzzCase(original, observation, async () => {
      throw new Error("predicate defect");
    })).rejects.toThrow("predicate defect");
  });

  it("rejects predicates that overspend the oracle budget", async () => {
    const original = caseFromTexFuzzAst([{ kind: "text", value: "Alpha" }]);
    await expect(shrinkTexFuzzCase(original, observation, async (candidates) => ({
      observations: candidates.map(() => null),
      oracleEvaluations: 2,
    }), { maxOracleEvaluations: 1 })).rejects.toThrow("only 1 remaining");
  });
});
