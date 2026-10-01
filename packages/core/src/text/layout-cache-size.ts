import type { ParagraphLayoutReport } from "./knuth-plass/paragraph/report.js";
import type { TexVListLayout } from "./tex/vlist/types.js";

/** Conservative estimates of owned metadata, excluding shared font/asset data. */
export function estimateParagraphReportBytes(report: ParagraphLayoutReport): number {
  let bytes = 256 + report.paragraphId.length * 2;
  for (const run of report.runs) bytes += 128 + (run.text?.length ?? 0) * 256;
  for (const line of report.lines) {
    bytes += 256;
    for (const segment of line.segments) {
      bytes += 256 + (segment.text?.length ?? 0) * 2 +
        (segment.caretStops?.length ?? 0) * 8 +
        (segment.mathSvgBody?.length ?? 0) * 2 +
        (segment.mathCaretEntries?.length ?? 0) * 128 +
        (segment.mathConstructRanges?.length ?? 0) * 128 +
        (segment.mathBreakpoints?.length ?? 0) * 64 +
        (segment.graphics?.length ?? 0) * 512;
    }
  }
  return bytes;
}

export function estimateVListLayoutBytes(layout: TexVListLayout): number {
  let bytes = 256 + layout.items.length * 256 + layout.boxReport.items.length * 256 +
    layout.paragraphPlacements.length * 128 + layout.linePlacements.length * 128 +
    layout.graphicsPlacements.length * 512;
  for (const report of layout.reports) {
    if ("paragraphId" in report) bytes += estimateParagraphReportBytes(report);
  }
  return bytes;
}
