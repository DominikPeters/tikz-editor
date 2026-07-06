import { LinebreakVisitor } from '@mathjax/src/cjs/output/common/LinebreakVisitor.js';

import {
  buildAlignmentProfile,
  DEFAULT_PARAGRAPH_ALIGNMENT,
  TEX_INTERWORD_SPACE_EM,
  normalizeParagraphAlignment,
  type ParagraphAlignment,
} from './alignment.js';
import { englishDefaults } from './languages/en.js';
import { applyBreaks, type AppliedBreak } from './paragraph/applyBreaks.js';
import { breakWithDp } from './paragraph/dp.js';
import { createEnglishHyphenator, type Hyphenator } from './paragraph/hyphenate.js';
import { runsToItems } from './paragraph/items.js';
import {
  createMeasurementService,
  type MeasurementService,
} from './paragraph/measure.js';
import {
  buildParagraphLayoutReport,
  type ParagraphLayoutReport,
} from './paragraph/report.js';
import { flattenParagraph } from './paragraph/tokenize.js';
import type { AnyWrapper, GreedyLine, MathJaxBBox, MathJaxWrapperFactoryLike, ParagraphRun } from './paragraph/types.js';
import type { KnuthPlassLayoutMode, WrappedTextGap } from './install.js';

// MathJax and TeX use different text metrics. A modest second-pass tolerance
// keeps TeX-valid paragraph shapes from falling into overfull recovery solely
// because a line measures slightly looser under MathJax.
const METRIC_COMPATIBILITY_TOLERANCE = 1600;

function widthOfRuns(runs: ParagraphRun[], runWidths: Map<number, number>): number {
  return runs.reduce((sum, run) => sum + (runWidths.get(run.runIndex) ?? 0), 0);
}

function singleLine(
  runs: ParagraphRun[],
  runWidths: Map<number, number>
): GreedyLine[] {
  if (!runs.length) {
    return [
      {
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: null,
        width: 0,
        break: null,
      },
    ];
  }

  return [
    {
      lineIndex: 0,
      startRun: 0,
      startTextOffset: 0,
      endRun: runs.length - 1,
      endTextOffset: null,
      width: widthOfRuns(runs, runWidths),
      break: null,
    },
  ];
}

function getWrapperPrototype(ctor: unknown): AnyWrapper | null {
  if (typeof ctor !== 'function') {
    return null;
  }
  const prototype = (ctor as { prototype?: unknown }).prototype;
  return prototype && typeof prototype === 'object'
    ? prototype as AnyWrapper
    : null;
}

function lineAlignmentOffset(
  alignment: ParagraphAlignment,
  targetWidth: number,
  naturalWidth: number
): number {
  const delta = Math.max(0, targetWidth - naturalWidth);
  if (alignment === 'center') {
    return delta / 2;
  }
  if (alignment === 'ragged-left') {
    return delta;
  }
  return 0;
}

interface ExplicitSegment {
  startRun: number;
  endRun: number;
  forcedBreakRun: number | null;
}

function isForcedBreakRun(run: ParagraphRun | undefined): boolean {
  return !!(
    run?.kind === 'space' &&
    run.breakRef.kind === 'mspace' &&
    run.breakRef.isForcedLineBreak
  );
}

function forcedBreakDecision(runIndex: number, run: ParagraphRun): GreedyLine['break'] {
  if (run.kind !== 'space' || run.breakRef.kind !== 'mspace') {
    return {
      kind: 'forced',
      runIndex,
      sourceOffset: run.sourceEnd,
      visibleHyphen: false,
    };
  }

  return {
    kind: 'forced',
    runIndex,
    sourceOffset: run.sourceEnd,
    visibleHyphen: false,
    lineLeading: run.breakRef.lineLeading,
  };
}

function collectExplicitSegments(runs: ParagraphRun[]): ExplicitSegment[] {
  const segments: ExplicitSegment[] = [];
  let startRun = 0;

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    if (!isForcedBreakRun(run)) {
      continue;
    }
    segments.push({
      startRun,
      endRun: runIndex - 1,
      forcedBreakRun: runIndex,
    });
    startRun = runIndex + 1;
  }

  segments.push({
    startRun,
    endRun: runs.length - 1,
    forcedBreakRun: null,
  });
  return segments;
}

function cloneRunsWithLocalIndices(runs: ParagraphRun[]): ParagraphRun[] {
  return runs.map((run, runIndex) => ({
    ...run,
    runIndex,
  }));
}

function mapBreakToGlobal(
  breakDecision: GreedyLine['break'],
  localRuns: ParagraphRun[]
): GreedyLine['break'] {
  if (!breakDecision) {
    return null;
  }

  const globalRun = localRuns.at(breakDecision.runIndex);
  if (!globalRun) {
    throw new Error(
      `Wrapped-explicit linebreak mapping failed: local break run ${breakDecision.runIndex} is missing.`
    );
  }

  return {
    ...breakDecision,
    runIndex: globalRun.runIndex,
  };
}

function mapLocalLinesToGlobal(
  localLines: GreedyLine[],
  localRuns: ParagraphRun[],
  lineIndexOffset: number,
  alignment: ParagraphAlignment,
  targetWidth: number,
  forcedBreak: GreedyLine['break']
): GreedyLine[] {
  const mapped = localLines.map((line, offset) => {
    const globalStartRun =
      line.startRun >= 0 && line.startRun < localRuns.length
        ? localRuns[line.startRun].runIndex
        : localRuns[0]?.runIndex ?? 0;
    const globalEndRun =
      line.endRun >= 0 && line.endRun < localRuns.length
        ? localRuns[line.endRun].runIndex
        : (localRuns[0]?.runIndex ?? 0) - 1;
    const naturalWidth = line.lineNaturalWidth ?? line.width;

    return {
      ...line,
      lineIndex: lineIndexOffset + offset,
      startRun: globalStartRun,
      endRun: globalEndRun,
      targetWidth,
      lineNaturalWidth: naturalWidth,
      xOffset:
        line.xOffset ?? lineAlignmentOffset(alignment, targetWidth, naturalWidth),
      break: mapBreakToGlobal(line.break, localRuns),
    };
  });

  if (mapped.length > 0) {
    mapped[mapped.length - 1] = {
      ...mapped[mapped.length - 1],
      break: forcedBreak,
    };
  }

  return mapped;
}

function buildFixedLines(
  runs: ParagraphRun[],
  runWidths: Map<number, number>,
  alignment: ParagraphAlignment
): GreedyLine[] {
  const rawLines: Array<{
    startRun: number;
    endRun: number;
    naturalWidth: number;
    breakDecision: GreedyLine['break'];
  }> = [];

  let startRun = 0;
  let naturalWidth = 0;

  const pushLine = (endRun: number, breakDecision: GreedyLine['break']) => {
    rawLines.push({
      startRun,
      endRun,
      naturalWidth,
      breakDecision,
    });
    startRun = endRun + 2;
    naturalWidth = 0;
  };

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    if (
      run.kind === 'space' &&
      run.breakRef.kind === 'mspace' &&
      run.breakRef.isForcedLineBreak
    ) {
      pushLine(runIndex - 1, {
        kind: 'forced',
        runIndex,
        sourceOffset: run.sourceEnd,
        visibleHyphen: false,
      });
      continue;
    }
    naturalWidth += runWidths.get(run.runIndex) ?? 0;
  }

  rawLines.push({
    startRun,
    endRun: runs.length - 1,
    naturalWidth,
    breakDecision: null,
  });

  const paragraphWidth = rawLines.reduce(
    (max, line) => Math.max(max, line.naturalWidth),
    0
  );

  return rawLines.map((line, lineIndex) => ({
    lineIndex,
    startRun: Math.max(0, line.startRun),
    startTextOffset: 0,
    endRun: line.endRun,
    endTextOffset: null,
    width: line.naturalWidth,
    targetWidth: paragraphWidth,
    lineNaturalWidth: line.naturalWidth,
    glueSetRatio: 0,
    badness: 0,
    spaceCount: 0,
    spaceDeltaPerGap: 0,
    xOffset: lineAlignmentOffset(alignment, paragraphWidth, line.naturalWidth),
    break: line.breakDecision,
  }));
}

function buildWrappedExplicitLines(params: {
  runs: ParagraphRun[];
  measurement: MeasurementService;
  hyphenator: Hyphenator;
  targetWidth: number;
  alignment: ParagraphAlignment;
  resolved: ResolvedKnuthPlassOptions;
  commonDpOptions: {
    linepenalty: number;
    adjdemerits: number;
    doublehyphendemerits: number;
    finalhyphendemerits: number;
    leftskipWidth: number;
    leftskipStretch: number;
    leftskipShrink: number;
    rightskipWidth: number;
    rightskipStretch: number;
    rightskipShrink: number;
    parfillskipWidth: number;
    parfillskipStretch: number;
    parfillskipShrink: number;
    preventOverflow: boolean;
  };
  alignmentProfile: ReturnType<typeof buildAlignmentProfile>;
}): {
  lines: GreedyLine[];
  errors: string[];
  passLabel:
    | 'wrapped-explicit-pretolerance'
    | 'wrapped-explicit-tolerance';
  linebreakingMode: 'feasible' | 'overfull';
} {
  const {
    runs,
    measurement,
    hyphenator,
    targetWidth,
    alignment,
    resolved,
    commonDpOptions,
    alignmentProfile,
  } = params;
  const lines: GreedyLine[] = [];
  const errors: string[] = [];
  let passLabel:
    | 'wrapped-explicit-pretolerance'
    | 'wrapped-explicit-tolerance' = 'wrapped-explicit-pretolerance';
  let linebreakingMode: 'feasible' | 'overfull' = 'feasible';

  for (const [segmentIndex, segment] of collectExplicitSegments(runs).entries()) {
    const forcedBreak =
      segment.forcedBreakRun == null
        ? null
        : forcedBreakDecision(segment.forcedBreakRun, runs[segment.forcedBreakRun]);
    const segmentRuns = runs.slice(segment.startRun, segment.endRun + 1);
    if (segmentRuns.length === 0) {
      lines.push({
        lineIndex: lines.length,
        startRun: Math.max(0, segment.startRun),
        startTextOffset: 0,
        endRun: segment.startRun - 1,
        endTextOffset: null,
        width: 0,
        targetWidth,
        lineNaturalWidth: 0,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        xOffset: lineAlignmentOffset(alignment, targetWidth, 0),
        break: forcedBreak,
      });
      continue;
    }

    const localRuns = cloneRunsWithLocalIndices(segmentRuns);
    const pass1Model = runsToItems(localRuns, measurement, {
      enableAutomaticHyphenation: false,
      hyphenator: null,
      hyphenpenalty: resolved.hyphenpenalty,
      exhyphenpenalty: resolved.exhyphenpenalty,
      spaceStretch: alignmentProfile.interwordStretch,
      spaceShrink: alignmentProfile.interwordShrink,
    });
    const pass1Dp = breakWithDp(pass1Model, targetWidth, {
      ...commonDpOptions,
      tolerance: resolved.pretolerance,
    });

    let chosenLines: GreedyLine[];
    let pass2Model: ReturnType<typeof runsToItems> | null = null;
    let pass2Dp: ReturnType<typeof breakWithDp> | null = null;
    if (pass1Dp.canProceed && pass1Dp.lines.length) {
      chosenLines = pass1Dp.lines;
      linebreakingMode = pass1Dp.mode;
    } else {
      pass2Model = runsToItems(localRuns, measurement, {
        enableAutomaticHyphenation: true,
        hyphenator,
        hyphenpenalty: resolved.hyphenpenalty,
        exhyphenpenalty: resolved.exhyphenpenalty,
        spaceStretch: alignmentProfile.interwordStretch,
        spaceShrink: alignmentProfile.interwordShrink,
      });
      pass2Dp = breakWithDp(pass2Model, targetWidth, {
        ...commonDpOptions,
        tolerance: resolved.tolerance,
        allowInfeasible: alignment !== 'justified',
      });
      if (pass2Dp.canProceed && pass2Dp.lines.length) {
        chosenLines = pass2Dp.lines;
        linebreakingMode = pass2Dp.mode;
        if (passLabel === 'wrapped-explicit-pretolerance') {
          passLabel = 'wrapped-explicit-tolerance';
        }
      } else {
        throw new Error(
          `Wrapped-explicit segment ${segmentIndex} failed: ${[
            ...pass1Model.errors,
            ...pass1Dp.errors,
            ...pass2Model.errors,
            ...pass2Dp.errors,
          ].join('; ') || 'no solution'}`
        );
      }
    }

    if (!chosenLines.length) {
      throw new Error(
        `Wrapped-explicit segment ${segmentIndex} produced no lines.`
      );
    }

    errors.push(...pass1Model.errors);
    if (passLabel !== 'wrapped-explicit-pretolerance' && pass2Model && pass2Dp) {
      errors.push(...pass1Dp.errors, ...pass2Model.errors, ...pass2Dp.errors);
    }

    lines.push(
      ...mapLocalLinesToGlobal(
        chosenLines,
        segmentRuns,
        lines.length,
        alignment,
        targetWidth,
        forcedBreak
      )
    );
  }

  return {
    lines,
    errors,
    passLabel,
    linebreakingMode,
  };
}

function formatGapWidthEm(widthEm: number): string {
  return `${Number(widthEm.toFixed(6))}em`;
}

function applyWrappedTextGapWidths(
  runs: ParagraphRun[],
  wrappedTextGaps: WrappedTextGap[] | undefined
): void {
  const gapBySourceStart = new Map<number, WrappedTextGap>();
  for (const gap of wrappedTextGaps ?? []) {
    if (Number.isFinite(gap.widthEm) && gap.widthEm >= 0) {
      gapBySourceStart.set(gap.sourceStart, gap);
    }
  }

  for (const run of runs) {
    if (run.kind !== 'space' || run.breakRef.kind !== 'mspace') {
      continue;
    }
    if (run.breakRef.isForcedLineBreak) {
      continue;
    }
    const gap = gapBySourceStart.get(run.sourceStart);
    const widthEm = gap?.widthEm ?? TEX_INTERWORD_SPACE_EM;
    run.texGlue = {
      width: widthEm,
      stretch: gap?.stretchEm ?? 0,
      shrink: gap?.shrinkEm ?? 0,
      spaceFactor: gap?.spaceFactor,
    };
    const attrs = run.breakRef.wrapper.node?.attributes;
    if (!attrs || typeof attrs.set !== 'function') {
      continue;
    }
    attrs.set('width', formatGapWidthEm(widthEm));
    if (typeof run.breakRef.wrapper.setBreakStyle === 'function') {
      run.breakRef.wrapper.setBreakStyle('');
    }
    if (typeof run.breakRef.wrapper.invalidateBBox === 'function') {
      run.breakRef.wrapper.invalidateBBox();
    }
  }
}

interface KnuthPlassLinebreakOptions {
  alignment?: ParagraphAlignment;
  layoutMode?: KnuthPlassLayoutMode;
  wrappedTextGaps?: WrappedTextGap[];
  pretolerance?: number;
  tolerance?: number;
  linepenalty?: number;
  hyphenpenalty?: number;
  exhyphenpenalty?: number;
  adjdemerits?: number;
  doublehyphendemerits?: number;
  finalhyphendemerits?: number;
  lefthyphenmin?: number;
  righthyphenmin?: number;
}

interface ResolvedKnuthPlassOptions {
  alignment: ParagraphAlignment;
  layoutMode: KnuthPlassLayoutMode;
  pretolerance: number;
  tolerance: number;
  linepenalty: number;
  hyphenpenalty: number;
  exhyphenpenalty: number;
  adjdemerits: number;
  doublehyphendemerits: number;
  finalhyphendemerits: number;
  lefthyphenmin: number;
  righthyphenmin: number;
}

export class KnuthPlassVisitor extends LinebreakVisitor<
  // MathJax's CJS LinebreakVisitor type requires its full mutually recursive
  // wrapper generic family. This subclass is loaded dynamically by MathJax, so
  // we keep the vendor boundary at `any` and type the wrapper surface below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
> {
  private static readonly patchedWrapperPrototypes = new WeakSet<object>();
  private static readonly patchedMrowPlaceLinePrototypes = new WeakSet<object>();
  private static configuredOptions: KnuthPlassLinebreakOptions = {};

  public static configure(options: KnuthPlassLinebreakOptions | null | undefined): void {
    if (!options || typeof options !== 'object') {
      return;
    }
    KnuthPlassVisitor.configuredOptions = {
      ...KnuthPlassVisitor.configuredOptions,
      ...options,
    };
  }

  public static getConfiguredOptions(): KnuthPlassLinebreakOptions {
    return { ...KnuthPlassVisitor.configuredOptions };
  }

  private readonly reportByWrapper = new WeakMap<object, ParagraphLayoutReport>();
  private readonly paragraphIdByWrapper = new WeakMap<object, string>();
  private readonly originalMtextTextByWrapper = new WeakMap<object, string[]>();
  private readonly originalMspaceWidthByWrapper = new WeakMap<object, string | undefined>();
  private nextParagraphNumber = 1;

  public readonly reports: ParagraphLayoutReport[] = [];

  // MathJax instantiates this class with its concrete wrapper factory type,
  // whose CJS generic surface is not useful at our local boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public constructor(factory: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    super(factory);
    const wrapperFactory = factory as MathJaxWrapperFactoryLike;
    this.patchMpaddedWrapperComputeBBox(wrapperFactory);
    this.patchMrowWrapperPlaceLines(wrapperFactory);
  }

  public getReports(): ParagraphLayoutReport[] {
    return [...this.reports];
  }

  private patchMpaddedWrapperComputeBBox(factory: MathJaxWrapperFactoryLike): void {
    const nodeMap = factory.nodeMap;
    const MpaddedWrapperCtor = nodeMap?.get('mpadded');
    const proto = getWrapperPrototype(MpaddedWrapperCtor);
    if (!proto || KnuthPlassVisitor.patchedWrapperPrototypes.has(proto)) {
      return;
    }

    if (typeof proto.computeBBox !== 'function') {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalComputeBBox: NonNullable<AnyWrapper['computeBBox']> = proto.computeBBox;

    const visitorClass = KnuthPlassVisitor;
    proto.computeBBox = function patchedComputeBBox(this: AnyWrapper | null | undefined, bbox: MathJaxBBox, recompute = false): void {
      const overflow = this?.node?.attributes?.get('data-overflow');
      if (overflow !== 'linebreak') {
        originalComputeBBox.call(this, bbox, recompute);
        return;
      }

      const child = this?.childNodes?.[0];
      if (!child || typeof child.breakToWidth !== 'function') {
        originalComputeBBox.call(this, bbox, recompute);
        return;
      }

      const linebreaks = this.jax?.linebreaks;
      if (!(linebreaks instanceof visitorClass)) {
        originalComputeBBox.call(this, bbox, recompute);
        return;
      }

      if (
        typeof linebreaks.isEligibleParboxParagraph === 'function' &&
        !linebreaks.isEligibleParboxParagraph(child)
      ) {
        originalComputeBBox.call(this, bbox, recompute);
        return;
      }

      const rawWidthAttr = this.node?.attributes?.get('width');
      const configuredWidth =
        typeof rawWidthAttr === 'string'
          ? Number.parseFloat(rawWidthAttr)
          : Number.NaN;
      const initialWidth = Number(this.containerWidth);
      const targetWidth =
        initialWidth > 0
          ? initialWidth
          : configuredWidth > 0
            ? configuredWidth
            : Number.NaN;
      if (!(targetWidth > 0)) {
        originalComputeBBox.call(this, bbox, recompute);
        const width = Number(bbox.w ?? this.containerWidth);
        if (!(width > 0)) {
          return;
        }
        child.breakToWidth(width);
        if (typeof this.setBBoxDimens === 'function') {
          this.setBBoxDimens(bbox);
        }
        if (typeof this.setChildPWidths === 'function') {
          this.setChildPWidths(recompute, width);
        }
        return;
      }

      child.breakToWidth(targetWidth);
      originalComputeBBox.call(this, bbox, recompute);
    };

    KnuthPlassVisitor.patchedWrapperPrototypes.add(proto);
  }

  private patchMrowWrapperPlaceLines(factory: MathJaxWrapperFactoryLike): void {
    const nodeMap = factory.nodeMap;
    const MrowWrapperCtor = nodeMap?.get('mrow');
    const proto = getWrapperPrototype(MrowWrapperCtor);
    if (!proto || KnuthPlassVisitor.patchedMrowPlaceLinePrototypes.has(proto)) {
      return;
    }

    if (typeof proto.placeLines !== 'function') {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPlaceLines: NonNullable<AnyWrapper['placeLines']> = proto.placeLines;
    const visitorClass = KnuthPlassVisitor;

    proto.placeLines = function patchedPlaceLines(this: AnyWrapper | null | undefined, parents: unknown[]): void {
      if (!this) {
        originalPlaceLines.call(this, parents);
        return;
      }

      const paragraphId = this.parent?.node?.attributes?.get('data-paragraph-id');
      if (!paragraphId) {
        originalPlaceLines.call(this, parents);
        return;
      }

      const lines = this.lineBBox;
      if (!Array.isArray(lines) || !Array.isArray(parents)) {
        originalPlaceLines.call(this, parents);
        return;
      }
      const linebreaks = this.jax?.linebreaks;
      const report =
        linebreaks instanceof visitorClass &&
        typeof linebreaks.getReportFor === 'function'
          ? linebreaks.getReportFor(this)
          : null;
      const reportLines = Array.isArray(report?.lines) ? report.lines : null;

      let y = Number(this.dh) || 0;
      for (const k of parents.keys()) {
        const lbox = lines.at(k);
        if (!lbox) {
          continue;
        }
        const reportLine = reportLines?.[k];
        const lineX =
          reportLine && Number.isFinite(reportLine.xStart)
            ? reportLine.xStart
            : lbox.L ?? 0;
        this.place?.(lineX, y, parents[k]);
        y -=
          Math.max(0.25, lbox.d ?? 0) +
          (Number.isFinite(lbox.lineLeading) ? lbox.lineLeading ?? 0 : 0) +
          Math.max(0.75, lines[k + 1]?.h ?? 0);
      }
    };

    KnuthPlassVisitor.patchedMrowPlaceLinePrototypes.add(proto);
  }

  public getLatestReport(): ParagraphLayoutReport | null {
    return this.reports.length ? this.reports[this.reports.length - 1] : null;
  }

  public getReportFor(wrapper: AnyWrapper | null | undefined): ParagraphLayoutReport | null {
    if (!wrapper || typeof wrapper !== 'object') {
      return null;
    }
    return this.reportByWrapper.get(wrapper) ?? null;
  }

  public override breakToWidth(wrapper: AnyWrapper, width: number): void {
    if (!this.isEligibleParboxParagraph(wrapper)) {
      super.breakToWidth(wrapper, width);
      return;
    }

    this.restoreParagraphWrapperState(wrapper);

    const options = this.getKnuthPlassOptions(wrapper);
    const resolved = this.resolveKnuthPlassOptions(options);
    const hyphenator: Hyphenator = createEnglishHyphenator({
      leftMin: resolved.lefthyphenmin,
      rightMin: resolved.righthyphenmin,
    });
    const measurement = createMeasurementService();
    const { runs, errors, unsupportedKinds } = flattenParagraph(wrapper);
    const emptyRunWidths = new Map<number, number>();

    if (!runs.length) {
      this.saveReport(
        wrapper,
        width,
        runs,
        emptyRunWidths,
        singleLine(runs, emptyRunWidths),
        [],
        [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          `alignment=${resolved.alignment}`,
          `layoutMode=${resolved.layoutMode}`,
          'pass=empty',
        ],
        undefined,
        'canonical',
        null,
        false,
        'unknown',
        resolved.alignment,
        resolved.layoutMode
      );
      return;
    }

    this.captureOriginalMtextStateFromRuns(runs);
    applyWrappedTextGapWidths(runs, options.wrappedTextGaps);
    this.captureOriginalMspaceStateFromRuns(runs);

    const alignmentProfile = buildAlignmentProfile(resolved.alignment);

    const pass1Model = runsToItems(runs, measurement, {
      enableAutomaticHyphenation: false,
      hyphenator: null,
      hyphenpenalty: resolved.hyphenpenalty,
      exhyphenpenalty: resolved.exhyphenpenalty,
      spaceStretch: alignmentProfile.interwordStretch,
      spaceShrink: alignmentProfile.interwordShrink,
    });

    const commonDpOptions = {
      linepenalty: resolved.linepenalty,
      adjdemerits: resolved.adjdemerits,
      doublehyphendemerits: resolved.doublehyphendemerits,
      finalhyphendemerits: resolved.finalhyphendemerits,
      leftskipWidth: alignmentProfile.leftskip.width,
      leftskipStretch: alignmentProfile.leftskip.stretch,
      leftskipShrink: alignmentProfile.leftskip.shrink,
      rightskipWidth: alignmentProfile.rightskip.width,
      rightskipStretch: alignmentProfile.rightskip.stretch,
      rightskipShrink: alignmentProfile.rightskip.shrink,
      parfillskipWidth: alignmentProfile.parfillskip.width,
      parfillskipStretch: alignmentProfile.parfillskip.stretch,
      parfillskipShrink: alignmentProfile.parfillskip.shrink,
      preventOverflow: alignmentProfile.preventOverflow,
    };

    if (resolved.layoutMode === 'fixed-lines') {
      const lines = buildFixedLines(runs, pass1Model.runWidths, resolved.alignment);
      const paragraphId = this.getParagraphId(wrapper);
      const targetWidth =
        lines.reduce(
          (max, line) => Math.max(max, line.targetWidth ?? line.width),
          0
        ) || width;
      const applyResult = applyBreaks(wrapper, runs, lines, {
        originalMtextTextByWrapper: this.originalMtextTextByWrapper,
        originalMspaceWidthByWrapper: this.originalMspaceWidthByWrapper,
        alignment: resolved.alignment,
        targetWidth,
        paragraphId,
        wrappedTextGaps: options.wrappedTextGaps,
      });
      if (!applyResult.canProceed) {
        throw new Error(
          `Fixed-lines paragraph mutation failed: ${applyResult.errors.join('; ') || 'unknown error'}`
        );
      }
      const stats = measurement.getStats();
      this.saveReport(
        wrapper,
        targetWidth,
        runs,
        pass1Model.runWidths,
        lines,
        applyResult.appliedBreaks,
        [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          ...applyResult.errors,
          `alignment=${resolved.alignment}`,
          `layoutMode=${resolved.layoutMode}`,
          'pass=fixed-lines',
          'dpMode=feasible',
          'dpCost=0',
          `measurement: textCache=${stats.textCacheEntries}, prefixCache=${stats.wordPrefixEntries}, mathCache=${stats.mathCacheEntries}`,
          'internalMode=canonical',
          'internalDegradeReason=none',
        ],
        measurement,
        'canonical',
        null,
        false,
        'feasible',
        resolved.alignment,
        resolved.layoutMode
      );
      return;
    }

    if (resolved.layoutMode === 'wrapped-explicit') {
      const wrappedExplicit = buildWrappedExplicitLines({
        runs,
        measurement,
        hyphenator,
        targetWidth: width,
        alignment: resolved.alignment,
        resolved,
        commonDpOptions,
        alignmentProfile,
      });
      const paragraphId = this.getParagraphId(wrapper);
      const applyResult = applyBreaks(wrapper, runs, wrappedExplicit.lines, {
        originalMtextTextByWrapper: this.originalMtextTextByWrapper,
        originalMspaceWidthByWrapper: this.originalMspaceWidthByWrapper,
        alignment: resolved.alignment,
        targetWidth: width,
        paragraphId,
        wrappedTextGaps: options.wrappedTextGaps,
      });
      if (!applyResult.canProceed) {
        const diagnostics = [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          ...wrappedExplicit.errors,
          ...applyResult.errors,
        ];
        throw new Error(
          `Knuth-Plass wrapped-explicit layout failed: ${diagnostics.join('; ') || 'no solution'}`
        );
      }
      const stats = measurement.getStats();
      this.saveReport(
        wrapper,
        width,
        runs,
        pass1Model.runWidths,
        wrappedExplicit.lines,
        applyResult.appliedBreaks,
        [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          ...wrappedExplicit.errors,
          ...applyResult.errors,
          `alignment=${resolved.alignment}`,
          `layoutMode=${resolved.layoutMode}`,
          `pass=${wrappedExplicit.passLabel}`,
          `dpMode=${wrappedExplicit.linebreakingMode}`,
          'dpCost=0',
          `measurement: textCache=${stats.textCacheEntries}, prefixCache=${stats.wordPrefixEntries}, mathCache=${stats.mathCacheEntries}`,
          'internalMode=canonical',
          'internalDegradeReason=none',
        ],
        measurement,
        'canonical',
        null,
        false,
        wrappedExplicit.linebreakingMode,
        resolved.alignment,
        resolved.layoutMode
      );
      return;
    }

    const pass1Dp = breakWithDp(pass1Model, width, {
      ...commonDpOptions,
      tolerance: resolved.pretolerance,
    });

    const pass2Model = runsToItems(runs, measurement, {
      enableAutomaticHyphenation: true,
      hyphenator,
      hyphenpenalty: resolved.hyphenpenalty,
      exhyphenpenalty: resolved.exhyphenpenalty,
      spaceStretch: alignmentProfile.interwordStretch,
      spaceShrink: alignmentProfile.interwordShrink,
    });

    const pass2Dp = breakWithDp(pass2Model, width, {
      ...commonDpOptions,
      tolerance: Math.max(resolved.tolerance, METRIC_COMPATIBILITY_TOLERANCE),
    });

    const overfullDp =
      pass2Dp.canProceed && pass2Dp.lines.length
        ? null
        : breakWithDp(pass2Model, width, {
            ...commonDpOptions,
            tolerance: Math.max(resolved.tolerance, METRIC_COMPATIBILITY_TOLERANCE),
            allowInfeasible: true,
          });

    let chosenModel = pass1Model;
    let chosenDp = pass1Dp;
    let passLabel = 'pretolerance';

    if (!pass1Dp.canProceed || !pass1Dp.lines.length) {
      chosenModel = pass2Model;
      chosenDp = pass2Dp;
      passLabel = 'tolerance';
    }

    if ((!chosenDp.canProceed || !chosenDp.lines.length) && overfullDp) {
      chosenModel = pass2Model;
      chosenDp = overfullDp;
      passLabel = 'overfull';
    }

    if (!chosenDp.canProceed || !chosenDp.lines.length) {
      const diagnostics = [
        ...errors,
        unsupportedKinds.length
          ? `flattenWarnings=${unsupportedKinds.join(', ')}`
          : 'flattenWarnings=none',
        ...pass1Model.errors,
        ...pass1Dp.errors,
        ...pass2Model.errors,
        ...pass2Dp.errors,
      ];
      throw new Error(
        `Knuth-Plass ${resolved.layoutMode} layout failed: ${diagnostics.join('; ') || 'no solution'}`
      );
    }

    const paragraphId = this.getParagraphId(wrapper);
    const applyResult = applyBreaks(wrapper, runs, chosenDp.lines, {
      originalMtextTextByWrapper: this.originalMtextTextByWrapper,
      originalMspaceWidthByWrapper: this.originalMspaceWidthByWrapper,
      alignment: resolved.alignment,
      targetWidth: width,
      paragraphId,
      wrappedTextGaps: options.wrappedTextGaps,
    });
    if (!applyResult.canProceed) {
      throw new Error(
        `Paragraph mutation failed: ${applyResult.errors.join('; ') || 'unknown error'}`
      );
    }

    const stats = measurement.getStats();
    this.saveReport(
      wrapper,
      width,
      runs,
      chosenModel.runWidths,
      chosenDp.lines,
      applyResult.appliedBreaks,
      [
        ...errors,
        unsupportedKinds.length
          ? `flattenWarnings=${unsupportedKinds.join(', ')}`
          : 'flattenWarnings=none',
        ...pass1Model.errors,
        ...pass1Dp.errors,
        ...pass2Model.errors,
        ...pass2Dp.errors,
        ...applyResult.errors,
        `alignment=${resolved.alignment}`,
        `layoutMode=${resolved.layoutMode}`,
        `pass=${passLabel}`,
        `dpMode=${chosenDp.mode}`,
        `dpCost=${chosenDp.totalCost}`,
        `measurement: textCache=${stats.textCacheEntries}, prefixCache=${stats.wordPrefixEntries}, mathCache=${stats.mathCacheEntries}`,
        'internalMode=canonical',
        'internalDegradeReason=none',
      ],
      measurement,
      'canonical',
      null,
      false,
      chosenDp.mode,
      resolved.alignment,
      resolved.layoutMode
    );
  }

  private getKnuthPlassOptions(wrapper: AnyWrapper | null | undefined): KnuthPlassLinebreakOptions {
    const jax = wrapper?.jax;
    const raw = jax?.knuthPlassOptions;
    const configured = KnuthPlassVisitor.getConfiguredOptions();
    const fromRuntime =
      raw && typeof raw === 'object' ? (raw as KnuthPlassLinebreakOptions) : {};

    return {
      ...configured,
      ...fromRuntime,
    };
  }

  private resolveKnuthPlassOptions(
    options: KnuthPlassLinebreakOptions
  ): ResolvedKnuthPlassOptions {
    return {
      alignment: normalizeParagraphAlignment(options.alignment),
      layoutMode: options.layoutMode ?? 'wrap',
      pretolerance: options.pretolerance ?? englishDefaults.pretolerance,
      tolerance: options.tolerance ?? englishDefaults.tolerance,
      linepenalty: options.linepenalty ?? englishDefaults.linepenalty,
      hyphenpenalty: options.hyphenpenalty ?? englishDefaults.hyphenpenalty,
      exhyphenpenalty: options.exhyphenpenalty ?? englishDefaults.exhyphenpenalty,
      adjdemerits: options.adjdemerits ?? englishDefaults.adjdemerits,
      doublehyphendemerits:
        options.doublehyphendemerits ?? englishDefaults.doublehyphendemerits,
      finalhyphendemerits:
        options.finalhyphendemerits ?? englishDefaults.finalhyphendemerits,
      lefthyphenmin: options.lefthyphenmin ?? englishDefaults.lefthyphenmin,
      righthyphenmin: options.righthyphenmin ?? englishDefaults.righthyphenmin,
    };
  }

  private captureOriginalMtextStateFromRuns(runs: ParagraphRun[]): void {
    const wrappers = new Set<AnyWrapper>();
    for (const run of runs) {
      if (run.kind === 'text') {
        wrappers.add(run.wrapper);
      }
    }

    for (const wrapper of wrappers) {
      this.captureOriginalMtextState(wrapper);
    }
  }

  private captureOriginalMspaceStateFromRuns(runs: ParagraphRun[]): void {
    for (const run of runs) {
      if (
        run.kind !== 'space' ||
        run.breakRef.kind !== 'mspace' ||
        this.originalMspaceWidthByWrapper.has(run.breakRef.wrapper)
      ) {
        continue;
      }
      const width = run.breakRef.wrapper.node?.attributes?.get('width');
      this.originalMspaceWidthByWrapper.set(
        run.breakRef.wrapper,
        typeof width === 'string' ? width : undefined
      );
    }
  }

  private captureOriginalMtextState(wrapper: AnyWrapper | null | undefined): void {
    if (!wrapper || typeof wrapper !== 'object') return;
    if (!wrapper.node?.isKind?.('mtext')) return;
    if (this.originalMtextTextByWrapper.has(wrapper)) return;

    const childNodes = Array.isArray(wrapper.childNodes) ? wrapper.childNodes : [];
    const snapshot = childNodes.map((child) => {
      if (!child.node?.isKind?.('text')) return '';
      return String(child.node.getText?.() ?? '');
    });
    this.originalMtextTextByWrapper.set(wrapper, snapshot);
  }

  private restoreParagraphWrapperState(paragraphWrapper: AnyWrapper): void {
    const stack: AnyWrapper[] = [paragraphWrapper];
    const seen = new Set<object>();

    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (seen.has(current)) continue;
      seen.add(current);

      if (current.node?.isKind?.('mtext')) {
        this.restoreMtextWrapper(current);
      } else if (current.node?.isKind?.('mspace')) {
        this.restoreMspaceWrapper(current);
      }

      const children = Array.isArray(current.childNodes) ? current.childNodes : [];
      for (const child of children) {
        stack.push(child);
      }
    }
  }

  private restoreMtextWrapper(wrapper: AnyWrapper): void {
    const snapshot = this.originalMtextTextByWrapper.get(wrapper);
    if (!snapshot) return;

    const children = Array.isArray(wrapper.childNodes) ? wrapper.childNodes : [];
    for (let i = 0; i < children.length; i++) {
      const child = children.at(i);
      if (!child?.node?.isKind?.('text')) continue;
      if (typeof child.node.setText !== 'function') continue;
      const text = snapshot.at(i);
      if (text === undefined) continue;
      child.node.setText(text);
      if (typeof child.invalidateBBox === 'function') {
        child.invalidateBBox();
      }
    }

    if (typeof wrapper.clearBreakPoints === 'function') {
      wrapper.clearBreakPoints();
    }
    if (typeof wrapper.invalidateBBox === 'function') {
      wrapper.invalidateBBox();
    }
  }

  private restoreMspaceWrapper(wrapper: AnyWrapper | null | undefined): void {
    if (!wrapper) {
      return;
    }
    const originalWidth = this.originalMspaceWidthByWrapper.get(wrapper);
    if (!wrapper.node?.attributes || typeof wrapper.node.attributes.set !== 'function') {
      return;
    }
    wrapper.node.attributes.set('width', originalWidth ?? '');
    if (typeof wrapper.setBreakStyle === 'function') {
      wrapper.setBreakStyle('');
    }
    if (typeof wrapper.invalidateBBox === 'function') {
      wrapper.invalidateBBox();
    }
  }

  private saveReport(
    wrapper: AnyWrapper,
    width: number,
    runs: ParagraphRun[],
    runWidths: Map<number, number>,
    lines: GreedyLine[],
    appliedBreaks: AppliedBreak[],
    errors: string[],
    measurement?: MeasurementService,
    internalMode: 'canonical' | 'degraded' = 'canonical',
    internalDegradeReason: string | null = null,
    externalFallbackUsed = false,
    linebreakingMode: 'feasible' | 'overfull' | 'unknown' = 'unknown',
    alignment: ParagraphAlignment = DEFAULT_PARAGRAPH_ALIGNMENT,
    layoutMode: KnuthPlassLayoutMode = 'wrap'
  ) {
    const paragraphId = this.getParagraphId(wrapper);
    const lineMetrics = this.readLineMetrics(wrapper, lines.length);
    const report = buildParagraphLayoutReport({
      paragraphId,
      width,
      alignment,
      layoutMode,
      runs,
      runWidths,
      lines,
      appliedBreaks,
      measurement,
      errors,
      internalMode,
      internalDegradeReason,
      externalFallbackUsed,
      linebreakingMode,
      lineMetrics,
    });

    this.reports.push(report);
    this.reportByWrapper.set(wrapper, report);

  }

  private getParagraphId(wrapper: AnyWrapper | null | undefined): string {
    if (!wrapper || typeof wrapper !== 'object') {
      return `paragraph-${this.nextParagraphNumber++}`;
    }

    const existing = this.paragraphIdByWrapper.get(wrapper);
    if (existing) {
      return existing;
    }

    const id = `paragraph-${this.nextParagraphNumber++}`;
    this.paragraphIdByWrapper.set(wrapper, id);
    return id;
  }

  private readLineMetrics(
    wrapper: AnyWrapper,
    lineCount: number
  ): Array<{ ascent: number; descent: number }> {
    const metrics: Array<{ ascent: number; descent: number }> = [];
    const lineWrapper = Array.isArray(wrapper.childNodes)
      ? wrapper.childNodes[0]
      : null;

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      const bbox =
        lineWrapper?.lineBBox?.[lineIndex] ?? null;
      const ascent = Number(bbox?.h);
      const descent = Number(bbox?.d);
      metrics.push({
        ascent: Number.isFinite(ascent) ? ascent : 0,
        descent: Number.isFinite(descent) ? descent : 0,
      });
    }

    return metrics;
  }

  private isEligibleParboxParagraph(wrapper: AnyWrapper): boolean {
    let current = wrapper.parent;
    while (current && typeof current === 'object') {
      const currentNode = current.node;
      if (currentNode?.isKind?.('mpadded')) {
        const overflow = currentNode.attributes?.get('data-overflow');
        const width = currentNode.attributes?.get('width');
        return overflow === 'linebreak' && typeof width === 'string' && width.trim().length > 0;
      }
      current = current.parent;
    }
    return false;
  }
}
