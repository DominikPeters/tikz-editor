import { createTexNodeTextEngine } from "@tikz-editor/core/text/tex-node-text-engine.js";
import { defaultTexMathFontProfile } from "@tikz-editor/core/text/tex/math/font-profile.js";
import { createIdentityMappedText } from "@tikz-editor/core/text/source-map.js";
import { getParagraphLayoutReports } from "@tikz-editor/core/text/knuth-plass/report-registry.js";
import { getTexVListLayout } from "@tikz-editor/core/text/tex/vlist/registry.js";
import type { TextLayoutContext } from "@tikz-editor/core/text/layout-context.js";
import type { NodeTextEngine, NodeTextMeasureRequest, NodeTextMetrics } from "@tikz-editor/core/text/types.js";
import type { TexFuzzCase, TexFuzzObservation } from "./model.js";

/** A new profile identity creates a genuinely independent render/layout cache. */
export function createTexFuzzFreshEngine(): Promise<NodeTextEngine> {
  return createTexNodeTextEngine({ mathFontProfile: { ...defaultTexMathFontProfile } });
}

function canonicalSnapshot(value: unknown): string {
  return JSON.stringify(value, (key: string, current: unknown): unknown => {
    if (key === "paragraphId" || key === "cacheKey" || key === "renderKey") return;
    return typeof current === "string"
      ? current.replace(/data-paragraph-id="[^"]*"/g, 'data-paragraph-id="owned"') : current;
  });
}

function snapshot(engine: NodeTextEngine, metrics: NodeTextMetrics | null, context = engine.layoutContext) {
  if (!metrics) return null;
  return {
    metrics,
    payload: engine.renderFromCache(metrics.cacheKey),
    report: getParagraphLayoutReports(context).find((report) => report.paragraphId === metrics.paragraphId),
    vlist: getTexVListLayout(context, metrics.paragraphId),
  };
}

export interface TexFuzzEngineHistoryOptions {
  readonly engine?: NodeTextEngine;
  readonly createFreshEngine?: () => Promise<NodeTextEngine>;
  /** Only one history needs a full eviction working set in each runner invocation. */
  readonly churnRequests?: number;
}

/** Compare real render caches, SVG, reports, and retained snapshots with fresh engines. */
export async function checkTexFuzzEngineHistory(
  caseData: TexFuzzCase, options: TexFuzzEngineHistoryOptions = {}
): Promise<readonly TexFuzzObservation[]> {
  const fresh = options.createFreshEngine ?? createTexFuzzFreshEngine;
  const engine = options.engine ?? await fresh();
  const churnRequests = options.churnRequests ?? 0;
  if (!Number.isSafeInteger(churnRequests) || churnRequests < 0) throw new RangeError("Invalid engine-history churn count.");
  const findings: TexFuzzObservation[] = [];
  const add = (code: string, step: string, detail: Record<string, unknown> = {}) => findings.push({
    fingerprint: { version: 1 as const, resultClass: "hard-invariant" as const, code,
      featureTags: caseData.features, mode: "text" as const, structuralLocus: `engine-history/${step}` },
    detail: { step, churnRequests, ...detail },
  });
  const request = (text: string, offset = 0): NodeTextMeasureRequest => ({
    text, textWidthPt: 160, fontSizePt: 10, fontFamily: "serif", fontStyle: "normal", fontWeight: "normal",
    sourceMap: createIdentityMappedText(text, offset).sourceMap,
  });
  const initial = request(caseData.source);
  const scope = engine.createRenderScope?.();
  const visible = scope?.run(() => engine.measure(initial)) ?? engine.measure(initial);
  if (scope && visible) scope.retain([visible.cacheKey]);
  const capture = (metrics: NodeTextMetrics | null, context?: TextLayoutContext) => {
    const result = snapshot(engine, metrics, context);
    if (result && (!result.payload || !result.report || !result.vlist)) add("engine-history-missing-metadata", "capture");
    return result;
  };
  const expectedVisible = canonicalSnapshot(scope ? scope.run(() => capture(visible, scope.layoutContext)) : capture(visible));
  const compare = async (step: string, current: NodeTextMeasureRequest) => {
    const actual = capture(engine.measure(current));
    const oracle = await fresh();
    const expected = snapshot(oracle, oracle.measure(current));
    if (canonicalSnapshot(actual) !== canonicalSnapshot(expected)) {
      add("engine-history-fresh-mismatch", step, { request: { ...current, sourceMap: undefined } });
    }
  };
  await compare("repeat", initial);
  await compare("source-shift", request(caseData.source, 73));
  await compare("resize", { ...initial, textWidthPt: 80.0009765625 });
  await compare("font-change", { ...initial, fontFamily: "sans", fontWeight: "bold", fontSizePt: 12 });
  await compare("typing-prefix", request(caseData.source.slice(0, Math.floor(caseData.source.length / 2))));
  await compare("complete", initial);
  await compare("insert", request(`Prefix ${caseData.source}`));
  await compare("undo", initial);
  await compare("redo", request(`Prefix ${caseData.source}`));
  for (const [revision, color] of ["#102030", "#405060"].entries()) {
    await compare(`color-revision-${revision}`, { ...request(String.raw`\textcolor{fuzzColor}{Alpha}`),
      colorResolver: { cacheKey: `fuzz-color-${revision}`, resolve: () => color } });
  }
  for (let index = 0; index < churnRequests; index++) {
    engine.measure(request(`fuzz churn ${caseData.seed} ${index}`));
    // Keep one render hot while independently exercising report-registry churn.
    if (index % 32 === 0) engine.measure(initial);
  }
  await compare("after-churn", initial);
  await compare("evicted-source-projection", request(caseData.source, 73));
  // Fresh oracle calls deliberately interleave other engines with the retained scene.
  if (scope && visible) {
    const retained = scope.run(() => capture(visible, scope.layoutContext));
    if (canonicalSnapshot(retained) !== expectedVisible) add("engine-history-visible-snapshot-mismatch", "retained");
    const next = engine.createRenderScope!(scope.layoutContext);
    const inherited = next.run(() => engine.measure(initial));
    if (inherited?.paragraphId !== visible.paragraphId) add("engine-history-visible-identity-mismatch", "incremental-retain");
    next.retain(inherited ? [inherited.cacheKey] : []);
    if (canonicalSnapshot(next.run(() => capture(inherited, next.layoutContext))) !== expectedVisible) {
      add("engine-history-visible-snapshot-mismatch", "incremental-retain");
    }
  }
  return findings;
}
