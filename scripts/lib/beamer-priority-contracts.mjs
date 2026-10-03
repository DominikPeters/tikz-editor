import { structuralContractFailures } from "../compare-beamer-frame.mjs";
import { paintContractFailures } from "./beamer-paint-compare.mjs";

/** The same exact contract as the single-frame comparator, never a baseline of known bugs. */
export function priorityFidelityFailures(report, fixture, imageCount = 0) {
  const failures = [];
  if (report.oracle.page.pageCount !== fixture.pages) failures.push(`oracle pages=${report.oracle.page.pageCount}, fixture expects ${fixture.pages}`);
  const nativePageCount = report.input.pageCount ?? report.input.overlayStepCount;
  if (nativePageCount !== fixture.pages) failures.push(`native pages/states=${nativePageCount}, fixture expects ${fixture.pages}`);
  if (report.structural) failures.push(...structuralContractFailures(report.structural.summary));
  else failures.push("No valid page correspondence; exact glyph comparison withheld.");
  failures.push(...paintContractFailures(report.paint));
  for (const probe of fixture.paintProbes ?? []) {
    if (!report.paint?.samples.some(sample => sample.id === probe.id)) failures.push(`Required paint probe ${probe.id} was not measured (use raster comparison).`);
  }
  if (fixture.images != null && imageCount !== fixture.images) failures.push(`SVG images=${imageCount}, expected ${fixture.images}`);
  return failures;
}

/** Catch vacuous oracle success (empty frame, wrong frame, missing continuation). */
export function priorityOracleFailures(oracle, fixture) {
  const failures = [];
  const pages = oracle.pageTrace.pages.map(page => page.glyphs.map(g => String.fromCodePoint(g.code)).join(""));
  const all = pages.join("");
  for (const text of fixture.oracleText ?? []) if (!all.includes(text)) failures.push(`oracle is missing witness ${text}`);
  for (const [index, required] of (fixture.oracleTextByPage ?? []).entries()) {
    for (const text of required) if (!pages[index]?.includes(text)) failures.push(`oracle page ${index + 1} is missing witness ${text}`);
  }
  if (oracle.pdf.pageCount !== fixture.pages) failures.push(`oracle pages=${oracle.pdf.pageCount}, fixture expects ${fixture.pages}`);
  return failures;
}

/** Unsupported code is a recognition/source-preservation contract, not a TeX visual match. */
export function unsupportedCodeFailures({ source, span, render, trace, requiredText }) {
  const failures = [];
  const cards = render.layout.items.filter(item => item.kind === "unsupported");
  const matching = cards.filter(item => item.sourceSpan.from === span.from && item.sourceSpan.to === span.to);
  if (matching.length !== 1 || cards.length !== 1) failures.push("Expected one unsupported card confined to the complete code environment.");
  if (matching.some(card => card.bounds.height <= 0 || card.bounds.height > 54)) failures.push("Unsupported source preview must be visible and bounded.");
  if (!render.diagnostics.some(d => /unsupported/u.test(d.code) && d.span?.from === span.from && d.span?.to === span.to)) failures.push("Missing unsupported-environment diagnostic with the complete source span.");
  if (!render.svg.svg.includes("data-beamer-placeholder=")) failures.push("Missing visible unsupported source placeholder.");
  const body = trace.lines.filter(line => line.role !== "frame-title").map(line => line.text).join("");
  for (const text of requiredText) if (!body.includes(text)) failures.push(`Supported sibling text is missing: ${text}`);
  if (render.layout.stepCount !== 1) failures.push("Commands printed inside code changed the overlay count.");
  if (!source.slice(span.from, span.to).startsWith("\\begin{")) failures.push("Invalid recognition fixture source span.");
  return failures;
}
