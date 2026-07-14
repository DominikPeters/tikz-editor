import type {
  BreakDecision,
  GreedyLine,
  ParagraphRun,
} from "../../knuth-plass/paragraph/types.js";
import type { ShapedTexTextRun } from "../fonts/types.js";
import type { SimpleTexParagraphSegment } from "../ir.js";
import type { TexLayoutLabel } from "../layout-inline-items.js";
import type { TexLength } from "../coordinates.js";
import { texVListPathKey } from "./paths.js";

export interface TexParagraphBreakResult {
  readonly lines: readonly GreedyLine[];
  readonly runs: readonly ParagraphRun[];
  readonly runWidths: ReadonlyMap<number, TexLength>;
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly errors: readonly string[];
  readonly linebreakingMode: "feasible" | "overfull";
}

export interface TexBrokenLayoutParagraphOwner {
  readonly blockIndex: number;
  readonly vlistPath: readonly number[];
  readonly forcedBreakAfter?: SimpleTexParagraphSegment["forcedBreakAfter"];
}

export interface TexBrokenLayoutParagraph {
  readonly paragraph: TexBrokenLayoutParagraphOwner;
  readonly broken: TexParagraphBreakResult;
  readonly label?: TexLayoutLabel;
}

export interface TexLineLabel {
  readonly label: TexLayoutLabel;
  readonly lineRunIndex: number;
}

export interface TexCombinedParagraphLineSpan {
  readonly blockIndex: number;
  readonly vlistPath: readonly number[];
  readonly lineIndices: readonly number[];
}

export interface TexCombinedParagraphBreaks {
  readonly runs: readonly ParagraphRun[];
  readonly lines: readonly GreedyLine[];
  readonly runWidths: ReadonlyMap<number, TexLength>;
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly lineLabels: ReadonlyMap<number, TexLineLabel>;
  readonly paragraphLineSpans: readonly TexCombinedParagraphLineSpan[];
  readonly errors: readonly string[];
  readonly linebreakingMode: "feasible" | "overfull";
}

export function combineTexBrokenLayoutParagraphs(params: {
  readonly entries: readonly TexBrokenLayoutParagraph[];
  readonly initialErrors?: readonly string[];
}): TexCombinedParagraphBreaks {
  const combinedRuns: ParagraphRun[] = [];
  const combinedLines: GreedyLine[] = [];
  const combinedRunWidths = new Map<number, TexLength>();
  const combinedShapedRuns = new Map<number, ShapedTexTextRun>();
  const combinedLineLabels = new Map<number, TexLineLabel>();
  const paragraphLineSpans: TexCombinedParagraphLineSpan[] = [];
  const errors = [...params.initialErrors ?? []];
  let linebreakingMode: "feasible" | "overfull" = "feasible";
  let runIndexOffset = 0;
  let lineIndexOffset = 0;

  for (const entry of params.entries) {
    const { paragraph, broken } = entry;
    for (const run of broken.runs) {
      combinedRuns.push(offsetRun(run, runIndexOffset));
    }
    for (const [runIndex, width] of broken.runWidths) {
      combinedRunWidths.set(runIndex + runIndexOffset, width);
    }
    for (const [runIndex, shaped] of broken.shapedRuns) {
      combinedShapedRuns.set(runIndex + runIndexOffset, shaped);
    }

    const blockLineIndices: number[] = [];
    for (const line of broken.lines) {
      const combinedLineIndex = line.lineIndex + lineIndexOffset;
      blockLineIndices.push(combinedLineIndex);
      const forcedBreak =
        paragraph.forcedBreakAfter && line.lineIndex === broken.lines.length - 1
          ? createForcedBreakDecision(
              line.endRun + runIndexOffset + 1,
              paragraph.forcedBreakAfter
            )
          : undefined;
      if (line.lineIndex === 0 && entry.label) {
        combinedLineLabels.set(combinedLineIndex, {
          label: entry.label,
          lineRunIndex: line.startRun + runIndexOffset,
        });
      }
      combinedLines.push(offsetLine(
        line,
        runIndexOffset,
        lineIndexOffset,
        forcedBreak
      ));
    }
    appendCombinedParagraphLineSpan(
      paragraphLineSpans,
      paragraph.blockIndex,
      paragraph.vlistPath,
      blockLineIndices
    );
    errors.push(...broken.errors);
    if (broken.linebreakingMode === "overfull") {
      linebreakingMode = "overfull";
    }
    runIndexOffset += broken.runs.length;
    lineIndexOffset += broken.lines.length;
  }

  return {
    runs: combinedRuns,
    lines: combinedLines,
    runWidths: combinedRunWidths,
    shapedRuns: combinedShapedRuns,
    lineLabels: combinedLineLabels,
    paragraphLineSpans,
    errors,
    linebreakingMode,
  };
}

function appendCombinedParagraphLineSpan(
  spans: TexCombinedParagraphLineSpan[],
  blockIndex: number,
  vlistPath: readonly number[],
  lineIndices: readonly number[]
): void {
  const pathKey = texVListPathKey(vlistPath);
  const existingIndex = spans.findIndex(
    (span) => texVListPathKey(span.vlistPath) === pathKey
  );
  if (existingIndex < 0) {
    spans.push({
      blockIndex,
      vlistPath: [...vlistPath],
      lineIndices: [...lineIndices],
    });
    return;
  }
  const existing = spans[existingIndex];
  if (!existing) {
    throw new Error(`Missing TeX combined paragraph line span for path ${pathKey}.`);
  }
  if (existing.blockIndex !== blockIndex) {
    throw new Error(
      `TeX combined paragraph line span block mismatch for path ${pathKey}.`
    );
  }
  spans[existingIndex] = {
    blockIndex,
    vlistPath: [...existing.vlistPath],
    lineIndices: [...existing.lineIndices, ...lineIndices],
  };
}

function offsetRun(run: ParagraphRun, runIndexOffset: number): ParagraphRun {
  if (run.kind === "text") {
    return {
      ...run,
      runIndex: run.runIndex + runIndexOffset,
      childIndex: run.childIndex + runIndexOffset,
    };
  }
  return {
    ...run,
    runIndex: run.runIndex + runIndexOffset,
  };
}

function offsetLine(
  line: GreedyLine,
  runIndexOffset: number,
  lineIndexOffset: number,
  breakOverride?: BreakDecision
): GreedyLine {
  return {
    ...line,
    lineIndex: line.lineIndex + lineIndexOffset,
    startRun: line.startRun + runIndexOffset,
    endRun: line.endRun + runIndexOffset,
    break: breakOverride ?? offsetBreakDecision(line.break, runIndexOffset),
  };
}

function offsetBreakDecision(
  breakDecision: BreakDecision | null,
  runIndexOffset: number
): BreakDecision | null {
  return breakDecision
    ? {
        ...breakDecision,
        runIndex: breakDecision.runIndex + runIndexOffset,
      }
    : null;
}

function createForcedBreakDecision(
  runIndex: number,
  forcedBreak: NonNullable<TexBrokenLayoutParagraphOwner["forcedBreakAfter"]>
): BreakDecision {
  return {
    kind: "forced",
    runIndex,
    sourceOffset: forcedBreak.sourceOffset,
    visibleHyphen: false,
    flagged: false,
    lineLeading: forcedBreak.lineLeading,
  };
}
