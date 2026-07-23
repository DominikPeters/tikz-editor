import type { ParagraphLayoutReport } from "./paragraph/report.js";

interface ParagraphReportProvider {
  linebreaks?: {
    getReports?(): ParagraphLayoutReport[];
  };
}

const reportsByLayoutContext =
  new WeakMap<object, Map<string, ParagraphLayoutReport>>();

// Paragraph ids derive from position-anchored cache keys, so edits and drag
// frames register fresh ids continually; cap the registry instead of growing
// for the session lifetime.
const REPORT_REGISTRY_LIMIT = 4096;

export function getParagraphLayoutReports(
  layoutContext: unknown
): ParagraphLayoutReport[] {
  if (!layoutContext || typeof layoutContext !== "object") {
    return [];
  }
  const provided = (layoutContext as ParagraphReportProvider).linebreaks
    ?.getReports?.();
  const reports = Array.isArray(provided) ? [...provided] : [];
  const registered = reportsByLayoutContext.get(layoutContext);
  if (registered) {
    const seen = new Set(reports.map((report) => report.paragraphId));
    for (const report of registered.values()) {
      if (!seen.has(report.paragraphId)) {
        reports.push(report);
      }
    }
  }
  return reports;
}

export function registerParagraphLayoutReports(
  layoutContext: unknown,
  reports: readonly ParagraphLayoutReport[]
): void {
  if (
    !layoutContext ||
    typeof layoutContext !== "object" ||
    reports.length === 0
  ) {
    return;
  }
  const existing =
    reportsByLayoutContext.get(layoutContext) ??
    new Map<string, ParagraphLayoutReport>();
  for (const report of reports) {
    existing.delete(report.paragraphId);
    existing.set(report.paragraphId, report);
  }
  while (existing.size > REPORT_REGISTRY_LIMIT) {
    const oldest = existing.keys().next();
    if (oldest.done) {
      break;
    }
    existing.delete(oldest.value);
  }
  reportsByLayoutContext.set(layoutContext, existing);
}
