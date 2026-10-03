/** Evidence for human triage, not a visual-fidelity score. */
export function beamerReviewSignals(render, { expectedGraphics = 0, assets = [] } = {}) {
  const literals = render.layout.paragraphs.flatMap(paragraph =>
    paragraph.report.lines.flatMap(line => line.segments.filter(segment => segment.literal).map(segment => ({
      role: paragraph.role,
      reason: segment.literal.reason,
      detail: segment.literal.detail ?? null,
      text: segment.text ?? "",
      from: segment.sourceStartRaw ?? null,
      to: segment.sourceEndRaw ?? null,
    })))
  );
  const unsupportedItems = render.layout.items.filter(item => item.kind === "unsupported").map(item => ({ sourceSpan: item.sourceSpan, bounds: item.bounds }));
  const imageElements = (render.svg.svg.match(/<image\b/gu) ?? []).length;
  const flags = [];
  if (literals.length) flags.push("literal-fallback");
  if (unsupportedItems.length) flags.push("unsupported-flow");
  if (expectedGraphics > 0 && imageElements === 0) flags.push("possible-missing-graphic");
  if (assets.some(asset => asset.status === "missing" || asset.status === "unsupported")) flags.push("asset-resolution-gap");
  if (render.diagnostics.some(diagnostic => diagnostic.severity === "error")) flags.push("renderer-error-diagnostic");
  const bodyLiterals = literals.filter(literal => literal.role === "body" || literal.role === "block-body");
  const reportedUnsupported = render.diagnostics.some(diagnostic => /unsupported|literal|fallback/u.test(diagnostic.code));
  if (bodyLiterals.length && !reportedUnsupported) flags.push("body-fallback-without-diagnostic");
  return {
    flags,
    literalSegments: literals.length,
    literalDetails: [...new Set(literals.map(literal => literal.detail).filter(Boolean))],
    literals,
    unsupportedItems,
    expectedGraphics,
    imageElements,
    assets,
    caveat: "Flags shortlist suspicious renders. Hidden overlays can legitimately contain no images; a clean result does not prove that content was painted or placed correctly.",
  };
}
