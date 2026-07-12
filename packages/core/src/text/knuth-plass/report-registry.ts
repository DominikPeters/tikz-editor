import type { ParagraphLayoutReport } from './paragraph/report.js';

interface MathJaxOutputJaxReportsLike {
  linebreaks?: {
    getReports?(): ParagraphLayoutReport[];
  };
}

const supplementalReportsByOutputJax = new WeakMap<object, Map<string, ParagraphLayoutReport>>();

// Paragraph ids derive from position-anchored cache keys, so edits and drag
// frames register fresh ids continually; cap the registry (evicting the least
// recently registered ids) instead of growing for the session lifetime.
const SUPPLEMENTAL_REPORT_REGISTRY_LIMIT = 4096;

export function getKnuthPlassReportsFromOutputJax(
  outputJax: unknown
): ParagraphLayoutReport[] {
  if (!outputJax || typeof outputJax !== 'object') {
    return [];
  }

  const target = outputJax as MathJaxOutputJaxReportsLike;
  const fromVisitor = target.linebreaks?.getReports?.();
  const reports = Array.isArray(fromVisitor) ? [...fromVisitor] : [];
  const supplemental = supplementalReportsByOutputJax.get(outputJax);
  if (supplemental) {
    const seen = new Set(reports.map((report) => report.paragraphId));
    for (const report of supplemental.values()) {
      if (!seen.has(report.paragraphId)) {
        reports.push(report);
      }
    }
  }
  return reports;
}

export function registerKnuthPlassReportsOnOutputJax(
  outputJax: unknown,
  reports: readonly ParagraphLayoutReport[]
): void {
  if (!outputJax || typeof outputJax !== 'object' || reports.length === 0) {
    return;
  }
  const existing =
    supplementalReportsByOutputJax.get(outputJax) ??
    new Map<string, ParagraphLayoutReport>();
  for (const report of reports) {
    existing.delete(report.paragraphId);
    existing.set(report.paragraphId, report);
  }
  while (existing.size > SUPPLEMENTAL_REPORT_REGISTRY_LIMIT) {
    const oldest = existing.keys().next();
    if (oldest.done) {
      break;
    }
    existing.delete(oldest.value);
  }
  supplementalReportsByOutputJax.set(outputJax, existing);
}
