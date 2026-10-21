import {
  createTexDerivedInlineMathBoxProvider, layoutSimpleTexParagraph,
} from "@tikz-editor/core/text/tex/index.js";
import type { ParagraphLayoutReport } from "@tikz-editor/core/text/knuth-plass/paragraph/report.js";
import type { TexFuzzCase, TexFuzzObservation } from "./model.js";
import { checkTexFuzzLayoutResultInvariants } from "./invariants.js";

/** Probe measured wrapping/overfull boundaries instead of only round widths. */
export function texFuzzBoundaryWidths(report: ParagraphLayoutReport): readonly number[] {
  const thresholds = new Set<number>();
  for (const line of report.lines) {
    if (Number.isFinite(line.naturalWidth) && line.naturalWidth > 0.01 && line.naturalWidth < 4096) thresholds.add(Number(line.naturalWidth));
    for (const segment of line.segments) {
      if (segment.kind === "math" && Number.isFinite(segment.width) && segment.width > 0.01 && segment.width < 4096) thresholds.add(Number(segment.width));
    }
  }
  return [...thresholds].sort((a, b) => a - b).slice(0, 3)
    .flatMap((width) => [width - 1 / 1024, width, width + 1 / 1024]);
}

export function checkTexFuzzBoundaryInvariants(caseData: TexFuzzCase): readonly TexFuzzObservation[] {
  const provider = createTexDerivedInlineMathBoxProvider();
  const layout = (width: number) => layoutSimpleTexParagraph(caseData.source, {
    width, fallbackPolicy: "placeholder", hyphenator: { hyphenate: () => [] }, mathBoxProvider: provider,
  });
  const reference = layout(480);
  if (!reference.report) return [];
  return texFuzzBoundaryWidths(reference.report).flatMap((width) => {
    const findings = checkTexFuzzLayoutResultInvariants(caseData, width, layout(width));
    return findings.map((finding) => ({ ...finding, detail: { ...finding.detail, boundaryWidth: width } }));
  });
}
