import type {
  ShapedTexTextRun,
  ResolvedTexFont,
  TexMetricProvider,
} from "./fonts/types.js";
import type { SimpleTexLayoutDocumentIr } from "./layout-ir.js";
import { texLayoutItemsForParagraphPlan } from "./layout-paragraph-items.js";
import { breakTexParagraphRuns, type TexParagraphBreakOptions } from "./paragraph-break.js";
import { createTexParagraphRunAdapter } from "./paragraph-runs.js";
import {
  combineTexBrokenLayoutParagraphs,
  type TexBrokenLayoutParagraph,
} from "./vlist/index.js";

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
  readonly layoutIr: Pick<SimpleTexLayoutDocumentIr, "paragraphPlans">;
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
      })
    );
    if (!runs.some((run) => run.kind === "text")) {
      continue;
    }

    const broken = breakTexParagraphRuns({
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
      leftMarginWidth: breakContext.leftMarginWidth,
      rightMarginWidth: breakContext.rightMarginWidth,
      quoteContextActive: breakContext.quoteContextActive,
      listContextActive: breakContext.listContextActive,
    });
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
