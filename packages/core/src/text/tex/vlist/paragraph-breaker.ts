import type {
  ShapedTexTextRun,
  ResolvedTexFont,
  TexMetricProvider,
} from "../fonts/types.js";
import type { ParagraphRun } from "../../knuth-plass/paragraph/types.js";
import { breakTexParagraphRuns, type TexParagraphBreakOptions } from "../paragraph-break.js";
import { createTexParagraphRunAdapter } from "../paragraph-runs.js";
import {
  combineTexBrokenLayoutParagraphs,
  type TexBrokenLayoutParagraph,
} from "./combined-paragraph-breaks.js";
import { texLayoutItemsForParagraphPlan } from "./paragraph-items.js";
import type { TexLayoutParagraphPlan } from "./paragraph-plans.js";

export type TexLayoutParagraphBreakEntriesResult =
  | {
      readonly status: "broken";
      readonly entries: readonly TexBrokenLayoutParagraph[];
    }
  | {
      readonly status: "failed";
      readonly fallbackReason: string;
      readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
      readonly errors: readonly string[];
    };

export function breakSimpleTexLayoutDocumentParagraphs(params: {
  readonly layoutIr: { readonly paragraphPlans: readonly TexLayoutParagraphPlan[] };
  readonly font: ResolvedTexFont;
  readonly metricProvider: TexMetricProvider;
  readonly options: TexParagraphBreakOptions;
  readonly initialErrors?: readonly string[];
}): TexLayoutParagraphBreakEntriesResult {
  const runAdapter = createTexParagraphRunAdapter(params.font, params.metricProvider);
  const brokenEntries: TexBrokenLayoutParagraph[] = [];
  const initialErrors = [...params.initialErrors ?? []];

  for (let planIndex = 0; planIndex < params.layoutIr.paragraphPlans.length; planIndex += 1) {
    const plan = params.layoutIr.paragraphPlans[planIndex];
    if (!plan) {
      throw new Error(
        `TeX paragraph breaker expected paragraph plan at index ${planIndex}.`
      );
    }
    const breakContext = plan.breakContext;
    if (
      breakContext.blockIndex !== plan.blockIndex ||
      breakContext.segmentIndex !== plan.segmentIndex
    ) {
      throw new Error(
        `TeX paragraph breaker plan break context mismatch at index ${planIndex}.`
      );
    }
    if (
      plan.lineLabel &&
      (plan.lineLabel.blockIndex !== plan.blockIndex ||
        plan.lineLabel.segmentIndex !== plan.segmentIndex)
    ) {
      throw new Error(
        `TeX paragraph breaker plan line label mismatch at index ${planIndex}.`
      );
    }
    const { runs, shapedRuns: blockShapedRuns } = runAdapter.layoutItemsToRuns(
      texLayoutItemsForParagraphPlan(plan, {
        atPt: params.font.atPt,
        metricProvider: params.metricProvider,
        mathBoxProvider: params.options.mathBoxProvider,
        textFontProfile: params.options.textFontProfile,
      })
    );
    if (!runs.some((run) => run.kind === "text" || run.kind === "math")) {
      continue;
    }

    const normalBreak = breakTexParagraphRuns({
      runs,
      shapedRuns: blockShapedRuns,
      measurement: runAdapter.measurement,
      options: params.options,
      alignment: plan.alignment,
      alignmentProfile: plan.alignmentProfile,
      inheritedAlignment: plan.inheritedAlignment,
      inheritedAlignmentProfile: plan.inheritedAlignmentProfile,
      noIndent: plan.segment.noIndent,
      firstLineIndentWidth: breakContext.firstLineIndentWidth,
      scopePolicy: breakContext.scopePolicy,
    });
    const broken = normalBreak &&
        plan.overfullSingleLineFallback === true &&
        shouldUseSingleLineOverfullFallback(normalBreak, params.options)
      ? breakTexParagraphAsSingleLine({
          runs,
          shapedRuns: blockShapedRuns,
          measurement: runAdapter.measurement,
          width: params.options.width,
        })
      : normalBreak;
    if (!broken) {
      return {
        status: "failed",
        fallbackReason: "TeX paragraph breaker failed: no solution",
        shapedRuns: combineTexBrokenLayoutParagraphs({
          entries: brokenEntries,
          initialErrors,
        }).shapedRuns,
        errors: initialErrors,
      };
    }
    brokenEntries.push({
      paragraph: {
        blockIndex: plan.blockIndex,
        vlistPath: plan.vlistPath,
        forcedBreakAfter: plan.segment.forcedBreakAfter,
      },
      broken,
      label: plan.lineLabel?.label,
    });
  }

  return {
    status: "broken",
    entries: brokenEntries,
  };
}

function breakTexParagraphAsSingleLine(params: {
  readonly runs: ParagraphRun[];
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly measurement: ReturnType<typeof createTexParagraphRunAdapter>["measurement"];
  readonly width: number;
}): NonNullable<ReturnType<typeof breakTexParagraphRuns>> {
  params.measurement.primeRuns(params.runs);
  const runWidths = new Map<number, number>();
  let naturalWidth = 0;
  for (const run of params.runs) {
    const width = texParagraphRunWidth(run, params.measurement);
    runWidths.set(run.runIndex, width);
    naturalWidth += width;
  }
  const lastRun = params.runs.at(-1);
  return {
    lines: [{
      lineIndex: 0,
      startRun: params.runs[0]?.runIndex ?? 0,
      startTextOffset: 0,
      endRun: lastRun?.runIndex ?? 0,
      endTextOffset: null,
      width: params.width,
      targetWidth: params.width,
      lineNaturalWidth: naturalWidth,
      glueSetRatio: 0,
      badness: naturalWidth > params.width ? 10_000 : 0,
      spaceCount: params.runs.filter((run) => run.kind === "space").length,
      spaceDeltaPerGap: 0,
      xOffset: 0,
      break: null,
    }],
    runs: params.runs,
    runWidths,
    shapedRuns: params.shapedRuns,
    errors: [],
    linebreakingMode: naturalWidth > params.width ? "overfull" : "feasible",
  };
}

function shouldUseSingleLineOverfullFallback(
  broken: NonNullable<ReturnType<typeof breakTexParagraphRuns>>,
  options: TexParagraphBreakOptions
): boolean {
  if (broken.lines.length <= 1) {
    return false;
  }
  const naturalWidth = Array.from(broken.runWidths.values()).reduce(
    (sum, width) => sum + width,
    0
  );
  return naturalWidth > options.width && naturalWidth <= options.width + 15;
}

function texParagraphRunWidth(
  run: ParagraphRun,
  measurement: ReturnType<typeof createTexParagraphRunAdapter>["measurement"]
): number {
  if (run.kind === "text") {
    return measurement.measureText(run.text, run.wrapper);
  }
  if (run.kind === "math") {
    return measurement.measureMath(run.wrapper);
  }
  if (run.kind === "space") {
    return run.texGlue?.width ?? 0;
  }
  return 0;
}
