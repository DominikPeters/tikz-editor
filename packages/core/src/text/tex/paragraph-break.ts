import { englishDefaults } from "../knuth-plass/languages/en.js";
import { breakWithDp, type DpOptions } from "../knuth-plass/paragraph/dp.js";
import { createEnglishHyphenator, type Hyphenator } from "../knuth-plass/paragraph/hyphenate.js";
import { runsToItems } from "../knuth-plass/paragraph/items.js";
import type { MeasurementService } from "../knuth-plass/paragraph/measure.js";
import type { GreedyLine, ParagraphRun } from "../knuth-plass/paragraph/types.js";
import { computerModernTexMetricProvider } from "./fonts/computer-modern.js";
import type {
  ResolvedTexFont,
  ShapedTexTextRun,
  TexMetricProvider,
} from "./fonts/types.js";
import type { TexTextFontProfile } from "./fonts/text-profile.js";
import type { NodeTextGraphicsResolver } from "../types.js";
import type {
  TexAlignmentProfile,
  TexParagraphAlignment,
} from "./ir.js";
import type { TexMathBoxProvider } from "./layout-inline-items.js";
import type { TexParagraphBreakResult } from "./vlist/index.js";
import { texLength, type TexLength } from "./coordinates.js";

const LATEX_RAGGED_FINAL_HYPHEN_DEMERITS = 0;
const LATEX_PARBOX_SLOPPY_TOLERANCE = 9999;
const LATEX_PARBOX_SLOPPY_EMERGENCY_STRETCH_EM = 3;

export type TexParagraphRightskipStretchMode =
  | "default"
  | "ragged-right-infinite-otherwise-zero"
  | "ragged-right-infinite-center-zero";

export interface TexParagraphBreakScopePolicy {
  readonly leftMarginWidth: TexLength;
  readonly rightMarginWidth: TexLength;
  readonly automaticHyphenPenalty?: number;
  readonly finalHyphenDemerits?: number;
  readonly allowParagraphIndent: boolean;
  readonly allowForcedBreakIndent: boolean;
  readonly forceParfillStretch: boolean;
  readonly suppressRaggedLeftCenterLeftskipStretch: boolean;
  readonly rightskipStretchMode: TexParagraphRightskipStretchMode;
}

export const DEFAULT_TEX_PARAGRAPH_BREAK_SCOPE_POLICY: TexParagraphBreakScopePolicy = {
  leftMarginWidth: texLength(0),
  rightMarginWidth: texLength(0),
  allowParagraphIndent: true,
  allowForcedBreakIndent: true,
  forceParfillStretch: false,
  suppressRaggedLeftCenterLeftskipStretch: false,
  rightskipStretchMode: "default",
};

export interface TexParagraphBreakOptions {
  readonly width: TexLength;
  readonly font?: ResolvedTexFont;
  readonly metricProvider?: TexMetricProvider;
  readonly tolerance?: number;
  readonly pretolerance?: number;
  readonly parindent?: TexLength;
  readonly rightskipStretch?: TexLength;
  readonly tikzTextWidthNode?: boolean;
  readonly hyphenator?: Hyphenator | null;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
  readonly textFontProfile?: TexTextFontProfile;
}

export function breakTexParagraphRuns(params: {
  readonly runs: ParagraphRun[];
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly measurement: MeasurementService;
  readonly options: TexParagraphBreakOptions;
  readonly alignment: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly inheritedAlignment: TexParagraphAlignment;
  readonly inheritedAlignmentProfile?: TexAlignmentProfile;
  readonly noIndent: boolean;
  readonly firstLineIndentWidth?: TexLength;
  readonly forcedBreakIndentWidth?: TexLength;
  readonly scopePolicy: TexParagraphBreakScopePolicy;
}): TexParagraphBreakResult | null {
  const pass1Model = runsToItems(params.runs, params.measurement, {
    enableAutomaticHyphenation: false,
    hyphenator: null,
  });
  const dpOptions = texParagraphDpOptions({
    options: params.options,
    alignment: params.alignment,
    noIndent: params.noIndent,
    alignmentProfile: params.alignmentProfile,
    inheritedAlignment: params.inheritedAlignment,
    inheritedAlignmentProfile: params.inheritedAlignmentProfile,
    scopePolicy: params.scopePolicy,
    firstLineIndentWidth: params.firstLineIndentWidth,
    forcedBreakIndentWidth: params.forcedBreakIndentWidth,
  });
  const pass1 = breakWithDp(pass1Model, params.options.width, {
    ...dpOptions,
    tolerance: params.options.pretolerance ?? englishDefaults.pretolerance,
  });

  let selectedModel = pass1Model;
  let selectedPass = pass1.canProceed && pass1.lines.length > 0 ? pass1 : null;
  let selectedDpPassOptions: Partial<DpOptions> & { readonly tolerance: number } = {
    tolerance: params.options.pretolerance ?? englishDefaults.pretolerance,
  };
  if (selectedPass === null) {
    const pass2Model = runsToItems(params.runs, params.measurement, {
      hyphenator: params.options.hyphenator ?? createEnglishHyphenator(),
      enableAutomaticHyphenation: true,
      hyphenpenalty: params.scopePolicy.automaticHyphenPenalty ??
        englishDefaults.hyphenpenalty,
      exhyphenpenalty: englishDefaults.exhyphenpenalty,
    });
    selectedModel = pass2Model;
    const tolerance = params.options.tolerance ?? texParagraphTolerance();
    const emergencyStretch = texParagraphEmergencyStretch(params.options);
    const passConfigs: Array<Partial<DpOptions> & { readonly tolerance: number }> = [
      { tolerance },
    ];
    if (emergencyStretch > 0) {
      passConfigs.push({ tolerance, emergencyStretch });
    }
    passConfigs.push({
      tolerance,
      emergencyStretch,
      allowLastResortOverfull: true,
    });
    for (const passOptions of passConfigs) {
      const pass = breakWithDp(pass2Model, params.options.width, {
        ...dpOptions,
        ...passOptions,
      });
      if (pass.canProceed && pass.lines.length > 0) {
        selectedPass = pass;
        selectedDpPassOptions = passOptions;
        break;
      }
    }
  }

  if (!selectedPass) {
    return null;
  }

  let lines: readonly GreedyLine[] = selectedPass.lines;
  if (
    Number.isFinite(params.forcedBreakIndentWidth) &&
    params.forcedBreakIndentWidth !== undefined &&
    params.forcedBreakIndentWidth > 0
  ) {
    const unindentedPass = breakWithDp(selectedModel, params.options.width, {
      ...dpOptions,
      ...selectedDpPassOptions,
      forcedBreakIndentWidth: texLength(0),
    });
    if (unindentedPass.canProceed && unindentedPass.lines.length > 0) {
      lines = mergeForcedBreakIndentedSuffixLines(
        unindentedPass.lines,
        selectedPass.lines
      ) ?? lines;
    }
  }

  return {
    lines,
    runs: params.runs,
    runWidths: new Map(
      [...selectedModel.runWidths].map(([runIndex, width]) => [
        runIndex,
        texLength(width),
      ])
    ),
    shapedRuns: params.shapedRuns,
    errors: [...selectedModel.errors, ...selectedPass.errors],
    linebreakingMode: selectedPass.mode,
  };
}

function mergeForcedBreakIndentedSuffixLines(
  unindentedLines: readonly GreedyLine[],
  indentedLines: readonly GreedyLine[]
): readonly GreedyLine[] | null {
  const forcedLineIndex = unindentedLines.findIndex((line) =>
    line.break?.kind === "forced"
  );
  const forcedRunIndex = unindentedLines[forcedLineIndex]?.break?.runIndex;
  if (forcedLineIndex < 0 || forcedRunIndex === undefined) {
    return null;
  }
  const suffixStart = indentedLines.findIndex((line) =>
    line.startRun > forcedRunIndex
  );
  if (suffixStart < 0) {
    return null;
  }
  return [
    ...unindentedLines.slice(0, forcedLineIndex + 1),
    ...indentedLines.slice(suffixStart),
  ].map((line, lineIndex) => ({
    ...line,
    lineIndex,
  }));
}

interface TexParagraphDpOptionParams {
  readonly options: TexParagraphBreakOptions;
  readonly alignment: TexParagraphAlignment;
  readonly noIndent: boolean;
  readonly firstLineIndentWidth?: TexLength;
  readonly forcedBreakIndentWidth?: TexLength;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly inheritedAlignment?: TexParagraphAlignment;
  readonly inheritedAlignmentProfile?: TexAlignmentProfile;
  readonly scopePolicy: TexParagraphBreakScopePolicy;
}

function texParagraphDpOptions(params: TexParagraphDpOptionParams): DpOptions {
  const {
    options,
    alignment,
    noIndent,
    firstLineIndentWidth,
    forcedBreakIndentWidth,
    alignmentProfile,
    inheritedAlignment,
    inheritedAlignmentProfile,
    scopePolicy,
  } = params;
  const latexRagged = alignment === "ragged-right" || alignment === "ragged-left";
  const inheritedLatexRagged =
    inheritedAlignment === "ragged-right" || inheritedAlignment === "ragged-left";
  const latexDeclaration = alignmentProfile === "latex-declaration";
  const latexQuote = alignmentProfile === "latex-quote";
  const skipStretch = texLength(2 * (
    options.font?.atPt ??
    options.metricProvider?.resolveFont().atPt ??
    computerModernTexMetricProvider.resolveFont().atPt
  ));
  const inheritedParfillStretch =
    inheritedAlignment === undefined
      ? texLength(Number.POSITIVE_INFINITY)
      : texParfillStretchForAlignment(inheritedAlignment, inheritedAlignmentProfile);
  return {
    linepenalty: englishDefaults.linepenalty,
    adjdemerits: englishDefaults.adjdemerits,
    doublehyphendemerits: englishDefaults.doublehyphendemerits,
    finalhyphendemerits: scopePolicy.finalHyphenDemerits ??
      (latexDeclaration || latexRagged || inheritedLatexRagged
        ? LATEX_RAGGED_FINAL_HYPHEN_DEMERITS
        : englishDefaults.finalhyphendemerits),
    leftskipWidth: scopePolicy.leftMarginWidth,
    leftskipStretch:
      texDeclarationLeftskipStretch(
        alignment,
        latexDeclaration,
        scopePolicy,
        skipStretch
      ),
    leftskipShrink: texLength(0),
    rightskipWidth: scopePolicy.rightMarginWidth,
    rightskipStretch: Number.isFinite(options.rightskipStretch)
      ? texLength(Math.max(0, options.rightskipStretch ?? texLength(0)))
      : texDeclarationRightskipStretch(
        alignment,
        latexDeclaration,
        latexQuote,
        scopePolicy,
        skipStretch
      ),
    rightskipShrink: texLength(0),
    firstLineIndentWidth:
      Number.isFinite(firstLineIndentWidth)
        ? firstLineIndentWidth
        : !noIndent &&
            scopePolicy.allowParagraphIndent &&
            Number.isFinite(options.parindent) &&
            options.parindent &&
            options.parindent > 0
          ? options.parindent
          : texLength(0),
    forcedBreakIndentWidth:
      Number.isFinite(forcedBreakIndentWidth) && scopePolicy.allowForcedBreakIndent
        ? forcedBreakIndentWidth
        : Number.isFinite(firstLineIndentWidth) && scopePolicy.allowForcedBreakIndent
        ? firstLineIndentWidth
        : options.tikzTextWidthNode === true &&
              alignment !== "justified" &&
              scopePolicy.allowForcedBreakIndent &&
              Number.isFinite(options.parindent) &&
              options.parindent &&
              options.parindent > 0
            ? options.parindent
            : texLength(0),
    forcedBreakUsesParfill: true,
    forcedBreakTerminalDemerits: true,
    parfillskipWidth: texLength(0),
    parfillskipStretch: texParfillStretchForAlignment(
      alignment,
      alignmentProfile,
      options.tikzTextWidthNode === true,
      inheritedParfillStretch,
      scopePolicy
    ),
    parfillskipShrink: texLength(0),
    preventOverflow: false,
  };
}

function texDeclarationLeftskipStretch(
  alignment: TexParagraphAlignment,
  latexDeclaration: boolean,
  scopePolicy: TexParagraphBreakScopePolicy,
  fallbackStretch: TexLength
): TexLength {
  if (
    scopePolicy.suppressRaggedLeftCenterLeftskipStretch &&
    !latexDeclaration &&
    (alignment === "ragged-left" || alignment === "center")
  ) {
    return texLength(0);
  }
  if (latexDeclaration && (alignment === "ragged-left" || alignment === "center")) {
    return texLength(Number.POSITIVE_INFINITY);
  }
  return alignment === "ragged-left" || alignment === "center"
    ? fallbackStretch
    : texLength(0);
}

function texDeclarationRightskipStretch(
  alignment: TexParagraphAlignment,
  latexDeclaration: boolean,
  latexQuote: boolean,
  scopePolicy: TexParagraphBreakScopePolicy,
  fallbackStretch: TexLength
): TexLength {
  if (scopePolicy.rightskipStretchMode === "ragged-right-infinite-otherwise-zero") {
    return alignment === "ragged-right"
      ? texLength(Number.POSITIVE_INFINITY)
      : texLength(0);
  }
  if (scopePolicy.rightskipStretchMode === "ragged-right-infinite-center-zero") {
    if (alignment === "ragged-right") {
      return texLength(Number.POSITIVE_INFINITY);
    }
    if (alignment === "center" && !latexDeclaration) {
      return texLength(0);
    }
  }
  if (
    (latexDeclaration || latexQuote) &&
    (alignment === "ragged-right" || alignment === "center")
  ) {
    return texLength(Number.POSITIVE_INFINITY);
  }
  return alignment === "ragged-right" || alignment === "center"
    ? fallbackStretch
    : texLength(0);
}

function texParfillStretchForAlignment(
  alignment: TexParagraphAlignment,
  alignmentProfile?: TexAlignmentProfile,
  tikzTextWidthNode = false,
  inheritedParfillStretch: TexLength = texLength(Number.POSITIVE_INFINITY),
  scopePolicy: TexParagraphBreakScopePolicy = DEFAULT_TEX_PARAGRAPH_BREAK_SCOPE_POLICY
): TexLength {
  if (alignmentProfile === "latex-declaration") {
    if (alignment === "center" || alignment === "ragged-left") {
      return texLength(0);
    }
    if (alignment === "ragged-right") {
      if (tikzTextWidthNode) {
        return texLength(Number.POSITIVE_INFINITY);
      }
      return inheritedParfillStretch;
    }
  }
  if (scopePolicy.forceParfillStretch) {
    return texLength(Number.POSITIVE_INFINITY);
  }
  return alignment === "ragged-right" || alignment === "justified"
    ? texLength(Number.POSITIVE_INFINITY)
    : texLength(0);
}

function texParagraphTolerance(): number {
  // TikZ text-width nodes are built in a LaTeX minipage. LaTeX's
  // \@arrayparboxrestore applies \sloppy before TikZ installs the alignment
  // action. TikZ's justify action restores finite left/right skips but does
  // not reset \tolerance, so the effective tolerance remains sloppy.
  return LATEX_PARBOX_SLOPPY_TOLERANCE;
}

function texParagraphEmergencyStretch(options: TexParagraphBreakOptions): TexLength {
  const font = options.font ?? options.metricProvider?.resolveFont() ?? computerModernTexMetricProvider.resolveFont();
  return texLength(LATEX_PARBOX_SLOPPY_EMERGENCY_STRETCH_EM * font.atPt);
}
