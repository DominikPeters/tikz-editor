import type { ParagraphLayoutReport } from "./paragraph/report.js";
import { getTextLayoutReportProvider } from "../layout-context.js";
import { TexWeightedLruCache } from "../tex/cache.js";
import { estimateParagraphReportBytes } from "../layout-cache-size.js";

interface ParagraphReportProvider {
  linebreaks?: {
    getReports?(): ParagraphLayoutReport[];
  };
}

const reportsByLayoutContext =
  new WeakMap<object, TexWeightedLruCache<string, ParagraphLayoutReport>>();

// Standalone reports have bounded storage. Render/frame reports are owned by
// their entries and supplied through the layout context's provider.
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
  const owned = getTextLayoutReportProvider(layoutContext)?.getParagraphReports();
  if (owned) {
    const byId = new Map(reports.map((report) => [report.paragraphId, report]));
    for (const report of owned) byId.set(report.paragraphId, report);
    return [...byId.values()];
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
    new TexWeightedLruCache<string, ParagraphLayoutReport>(REPORT_REGISTRY_LIMIT, 32 * 1024 * 1024, { retainOversizedEntry: true });
  for (const report of reports) {
    existing.set(report.paragraphId, report, estimateParagraphReportBytes(report));
  }
  reportsByLayoutContext.set(layoutContext, existing);
}
