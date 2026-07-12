import {
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
  type TexParagraphLayoutResult,
} from "@tikz-editor/core/text/tex/index.js";
import type { TexFuzzCase, TexFuzzNode, TexFuzzObservation } from "./model.js";
import { printTexFuzzAst } from "./print.js";

export type TexFuzzMetamorphicObservable =
  | "supported-classification"
  | "line-break-opportunities"
  | "structural-trace"
  | "geometry"
  | "paint";

export interface TexFuzzMetamorphicRelation {
  readonly id: string;
  readonly description: string;
  readonly expectedRelation: "equal" | "no-new-breakpoint";
  readonly observables: readonly TexFuzzMetamorphicObservable[];
  readonly knownExceptions: readonly string[];
  readonly calibrationRequired: boolean;
  readonly domain: (caseData: TexFuzzCase) => boolean;
  readonly transform: (caseData: TexFuzzCase) => string | null;
}

function mapFirstBreakingSpace(nodes: readonly TexFuzzNode[]): readonly TexFuzzNode[] | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.kind === "space" && !node.nonBreaking) {
      return [...nodes.slice(0, index), { kind: "space", nonBreaking: true }, ...nodes.slice(index + 1)];
    }
    if ("children" in node) {
      const children = mapFirstBreakingSpace(node.children);
      if (children) {
        return [...nodes.slice(0, index), { ...node, children }, ...nodes.slice(index + 1)];
      }
    }
  }
  return null;
}

export const TEX_FUZZ_METAMORPHIC_RELATIONS: readonly TexFuzzMetamorphicRelation[] = [
  {
    id: "repeat-render-determinism",
    description: "Rendering identical complete input twice produces identical output.",
    expectedRelation: "equal",
    observables: ["supported-classification", "structural-trace", "geometry", "paint"],
    knownExceptions: ["Exclude nondeterministic external resources and time-, random-, or shell-dependent macros."],
    calibrationRequired: false,
    domain: () => true,
    transform: (caseData) => caseData.source,
  },
  {
    id: "tie-removes-breakpoint",
    description: "Replacing one ordinary generated space with a TeX tie cannot introduce a breakpoint there.",
    expectedRelation: "no-new-breakpoint",
    observables: ["supported-classification", "line-break-opportunities"],
    knownExceptions: [
      "This relation does not assert equal geometry or line count.",
      "Apply only to generator-owned text spaces, not spaces inside raw macro arguments or math.",
    ],
    calibrationRequired: true,
    domain: (caseData) => caseData.ast.some(function containsBreakingSpace(node): boolean {
      return (node.kind === "space" && !node.nonBreaking)
        || ("children" in node && node.children.some(containsBreakingSpace));
    }),
    transform: (caseData) => {
      const transformed = mapFirstBreakingSpace(caseData.ast);
      return transformed ? printTexFuzzAst(transformed).source : null;
    },
  },
] as const;

export interface TexFuzzMetamorphicPair {
  readonly relationId: string;
  readonly originalSource: string;
  readonly transformedSource: string;
  readonly expectedRelation: TexFuzzMetamorphicRelation["expectedRelation"];
  readonly observables: readonly TexFuzzMetamorphicObservable[];
  readonly knownExceptions: readonly string[];
  readonly calibrationRequired: boolean;
}

export function deriveTexFuzzMetamorphicPairs(caseData: TexFuzzCase): readonly TexFuzzMetamorphicPair[] {
  return TEX_FUZZ_METAMORPHIC_RELATIONS.flatMap((relation) => {
    if (!relation.domain(caseData)) {
      return [];
    }
    const transformedSource = relation.transform(caseData);
    return transformedSource === null ? [] : [{
      relationId: relation.id,
      originalSource: caseData.source,
      transformedSource,
      expectedRelation: relation.expectedRelation,
      observables: relation.observables,
      knownExceptions: relation.knownExceptions,
      calibrationRequired: relation.calibrationRequired,
    }];
  });
}

export interface TexFuzzMetamorphicRun {
  readonly pairCount: number;
  readonly checks: number;
  readonly findings: readonly TexFuzzObservation[];
}

export type TexFuzzMetamorphicLayout = (source: string, width: number) => TexParagraphLayoutResult;

function defaultMetamorphicLayout(source: string, width: number): TexParagraphLayoutResult {
  return layoutSimpleTexParagraph(source, {
    width,
    fallbackPolicy: "placeholder",
    hyphenator: { hyphenate: () => [] },
    mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
  });
}

function firstDifference(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let offset = 0;
  while (offset < limit && left[offset] === right[offset]) offset += 1;
  return offset;
}

/** Execute calibrated renderer-level relations instead of merely enumerating them. */
export function checkTexFuzzMetamorphicInvariants(
  caseData: TexFuzzCase,
  options: { readonly widths?: readonly number[]; readonly layout?: TexFuzzMetamorphicLayout } = {}
): TexFuzzMetamorphicRun {
  const widths = options.widths ?? [40, 80, 120, 160, 240];
  const layout = options.layout ?? defaultMetamorphicLayout;
  const findings: TexFuzzObservation[] = [];
  const pairs = deriveTexFuzzMetamorphicPairs(caseData);
  let checks = 0;
  for (const pair of pairs) {
    for (const width of widths) {
      checks += 1;
      const original = layout(pair.originalSource, width);
      const transformed = layout(pair.transformedSource, width);
      if (pair.relationId === "repeat-render-determinism") {
        if (JSON.stringify(original.report) !== JSON.stringify(transformed.report)
          || original.supported !== transformed.supported
          || original.fallbackReason !== transformed.fallbackReason) {
          findings.push({
            fingerprint: {
              version: 1,
              resultClass: "hard-invariant",
              code: "metamorphic-repeat-render",
              featureTags: caseData.features,
              mode: "text",
              structuralLocus: `metamorphic/${pair.relationId}/width-${width}`,
            },
          });
        }
        continue;
      }
      if (pair.relationId === "tie-removes-breakpoint" && transformed.report) {
        const changedOffset = firstDifference(pair.originalSource, pair.transformedSource);
        const forbiddenBreakOffset = changedOffset + 1;
        if (transformed.report.lines.some((line) => line.break?.sourceOffset === forbiddenBreakOffset)) {
          findings.push({
            fingerprint: {
              version: 1,
              resultClass: "hard-invariant",
              code: "metamorphic-tie-breakpoint",
              featureTags: caseData.features,
              mode: "text",
              structuralLocus: `metamorphic/${pair.relationId}/width-${width}`,
            },
            detail: { changedOffset, forbiddenBreakOffset },
          });
        }
      }
    }
  }
  return { pairCount: pairs.length, checks, findings };
}
