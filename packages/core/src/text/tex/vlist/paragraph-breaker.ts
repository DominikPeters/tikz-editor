import type {
  ShapedTexTextRun,
  ResolvedTexFont,
  TexMetricProvider,
} from "../fonts/types.js";
import type { GreedyLine, ParagraphRun } from "../../knuth-plass/paragraph/types.js";
import {
  breakTexParagraphRuns,
  type TexParagraphBreakOptions,
  type TexParagraphBreakScopePolicy,
} from "../paragraph-break.js";
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

    const breakOptions = breakContext.width !== undefined
      ? { ...params.options, width: breakContext.width }
      : params.options;
    const normalBreak = breakTexParagraphRuns({
      runs,
      shapedRuns: blockShapedRuns,
      measurement: runAdapter.measurement,
      options: breakOptions,
      alignment: plan.alignment,
      alignmentProfile: plan.alignmentProfile,
      inheritedAlignment: plan.inheritedAlignment,
      inheritedAlignmentProfile: plan.inheritedAlignmentProfile,
      noIndent: plan.segment.noIndent,
      firstLineIndentWidth: breakContext.firstLineIndentWidth,
      scopePolicy: breakContext.scopePolicy,
    });
    const broadOverfullTolerance = breakContext.width === undefined
      ? intertextBroadOverfullTolerance(runs)
      : 0;
    const overfullFallback = normalBreak && plan.overfullSingleLineFallback === true
      ? breakTexParagraphWithIntertextOverfullFallback({
          normalBreak,
          runs,
          shapedRuns: blockShapedRuns,
          measurement: runAdapter.measurement,
          width: breakOptions.width,
          scopePolicy: breakContext.scopePolicy,
          broadOverfullTolerance,
        })
      : null;
    const broken = overfullFallback ?? normalBreak;
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
  let totalShrink = 0;
  for (const run of params.runs) {
    const width = texParagraphRunWidth(run, params.measurement);
    runWidths.set(run.runIndex, width);
    naturalWidth += width;
    totalShrink += texParagraphRunShrink(run);
  }
  const lastRun = params.runs.at(-1);
  const rawDelta = params.width - naturalWidth;
  const glueSetRatio = rawDelta < 0 && totalShrink > 0
    ? Math.max(-1, rawDelta / totalShrink)
    : 0;
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
      glueSetRatio,
      badness: glueSetRatio < 0 ? Math.min(10_000, Math.round(100 * Math.abs(glueSetRatio) ** 3)) : 0,
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

function breakTexParagraphWithIntertextOverfullFallback(params: {
  readonly normalBreak: NonNullable<ReturnType<typeof breakTexParagraphRuns>>;
  readonly runs: ParagraphRun[];
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly measurement: ReturnType<typeof createTexParagraphRunAdapter>["measurement"];
  readonly width: number;
  readonly scopePolicy: TexParagraphBreakScopePolicy;
  readonly broadOverfullTolerance: number;
}): NonNullable<ReturnType<typeof breakTexParagraphRuns>> | null {
  if (shouldUseSingleLineOverfullFallback(
    params.normalBreak,
    params.width,
    params.scopePolicy
  )) {
    return breakTexParagraphAsSingleLine(params);
  }
  if (params.broadOverfullTolerance <= 0 || params.normalBreak.lines.length <= 1) {
    return null;
  }
  const greedy = breakTexParagraphAsGreedyOverfullLines({
    runs: params.runs,
    shapedRuns: params.shapedRuns,
    measurement: params.measurement,
    width: params.width,
    overfullTolerance: params.broadOverfullTolerance,
  });
  return greedy.lines.length < params.normalBreak.lines.length ? greedy : null;
}

function breakTexParagraphAsGreedyOverfullLines(params: {
  readonly runs: ParagraphRun[];
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly measurement: ReturnType<typeof createTexParagraphRunAdapter>["measurement"];
  readonly width: number;
  readonly overfullTolerance: number;
}): NonNullable<ReturnType<typeof breakTexParagraphRuns>> {
  params.measurement.primeRuns(params.runs);
  const runWidths = new Map<number, number>();
  for (const run of params.runs) {
    runWidths.set(run.runIndex, texParagraphRunWidth(run, params.measurement));
  }

  const lines: GreedyLine[] = [];
  let startRun = nextNonSpaceRunIndex(params.runs, 0);
  while (startRun < params.runs.length) {
    let cursor = startRun;
    let candidateEnd = startRun;
    let candidateWidth = runWidths.get(params.runs[startRun]?.runIndex ?? startRun) ?? 0;
    let currentWidth = 0;
    while (cursor < params.runs.length) {
      const run = params.runs[cursor];
      if (!run) {
        break;
      }
      currentWidth += runWidths.get(run.runIndex) ?? 0;
      if (run.kind !== "space") {
        if (
          currentWidth <= params.width + params.overfullTolerance ||
          candidateEnd === startRun
        ) {
          candidateEnd = cursor;
          candidateWidth = currentWidth;
        } else {
          break;
        }
      }
      cursor += 1;
    }

    lines.push(greedyOverfullLine({
      lineIndex: lines.length,
      runs: params.runs,
      runWidths,
      startRun,
      endRun: candidateEnd,
      width: params.width,
      naturalWidth: candidateWidth,
    }));
    startRun = nextNonSpaceRunIndex(params.runs, candidateEnd + 1);
  }

  return {
    lines,
    runs: params.runs,
    runWidths,
    shapedRuns: params.shapedRuns,
    errors: [],
    linebreakingMode: lines.some((line) => (line.lineNaturalWidth ?? 0) > params.width)
      ? "overfull"
      : "feasible",
  };
}

function greedyOverfullLine(params: {
  readonly lineIndex: number;
  readonly runs: readonly ParagraphRun[];
  readonly runWidths: ReadonlyMap<number, number>;
  readonly startRun: number;
  readonly endRun: number;
  readonly width: number;
  readonly naturalWidth: number;
}): NonNullable<ReturnType<typeof breakTexParagraphRuns>>["lines"][number] {
  const runs = params.runs.slice(params.startRun, params.endRun + 1);
  const stretch = runs.reduce((sum, run) => sum + texParagraphRunStretch(run), 0);
  const shrink = runs.reduce((sum, run) => sum + texParagraphRunShrink(run), 0);
  const rawDelta = params.width - params.naturalWidth;
  const glueSetRatio = rawDelta > 0 && stretch > 0
    ? rawDelta / stretch
    : rawDelta < 0 && shrink > 0
      ? Math.max(-1, rawDelta / shrink)
      : 0;
  return {
    lineIndex: params.lineIndex,
    startRun: params.runs[params.startRun]?.runIndex ?? params.startRun,
    startTextOffset: 0,
    endRun: params.runs[params.endRun]?.runIndex ?? params.endRun,
    endTextOffset: null,
    width: params.width,
    targetWidth: params.width,
    lineNaturalWidth: params.naturalWidth,
    glueSetRatio,
    badness: Math.min(10_000, Math.round(100 * Math.abs(glueSetRatio) ** 3)),
    spaceCount: runs.filter((run) => run.kind === "space").length,
    spaceDeltaPerGap: 0,
    xOffset: 0,
    break: null,
  };
}

function nextNonSpaceRunIndex(runs: readonly ParagraphRun[], start: number): number {
  let index = start;
  while (runs[index]?.kind === "space") {
    index += 1;
  }
  return index;
}

function intertextBroadOverfullTolerance(runs: readonly ParagraphRun[]): number {
  const mathRuns = runs.filter((run) => run.kind === "math");
  if (mathRuns.length === 0) {
    return 15;
  }
  return mathRuns.every(isTextHeightMathRun) ? 6 : 0;
}

function isTextHeightMathRun(run: ParagraphRun): boolean {
  if (run.kind !== "math") {
    return true;
  }
  const box = run.wrapper.getBBox?.();
  if (!box) {
    return false;
  }
  return (box.h ?? 0) <= 7.2 && (box.d ?? 0) <= 2.1;
}

function shouldUseSingleLineOverfullFallback(
  broken: NonNullable<ReturnType<typeof breakTexParagraphRuns>>,
  width: number,
  scopePolicy: TexParagraphBreakScopePolicy
): boolean {
  if (broken.lines.length <= 1) {
    return false;
  }
  const naturalWidth = Array.from(broken.runWidths.values()).reduce(
    (sum, width) => sum + width,
    0
  );
  const totalShrink = broken.runs.reduce(
    (sum, run) => sum + texParagraphRunShrink(run),
    0
  );
  const fallbackWidth = Math.max(
    0,
    width - scopePolicy.leftMarginWidth - scopePolicy.rightMarginWidth
  );
  return naturalWidth > fallbackWidth &&
    naturalWidth <= fallbackWidth + totalShrink + 0.001;
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

function texParagraphRunShrink(run: ParagraphRun): number {
  return (run.kind === "space" || run.kind === "math")
    ? run.texGlue?.shrink ?? 0
    : 0;
}

function texParagraphRunStretch(run: ParagraphRun): number {
  return (run.kind === "space" || run.kind === "math")
    ? run.texGlue?.stretch ?? 0
    : 0;
}
