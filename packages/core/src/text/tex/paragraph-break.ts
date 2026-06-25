import { englishDefaults } from "../knuth-plass/languages/en.js";
import { breakWithDp, type DpOptions } from "../knuth-plass/paragraph/dp.js";
import { createEnglishHyphenator, type Hyphenator } from "../knuth-plass/paragraph/hyphenate.js";
import { runsToItems } from "../knuth-plass/paragraph/items.js";
import type { MeasurementService } from "../knuth-plass/paragraph/measure.js";
import type { ParagraphRun } from "../knuth-plass/paragraph/types.js";
import { computerModernTexMetricProvider } from "./fonts/computer-modern.js";
import type {
  ResolvedTexFont,
  ShapedTexTextRun,
  TexMetricProvider,
} from "./fonts/types.js";
import type { TexTextFontProfile } from "./fonts/text-profile.js";
import type {
  TexAlignmentProfile,
  TexParagraphAlignment,
} from "./ir.js";
import type { TexMathBoxProvider } from "./layout-inline-items.js";
import type { TexParagraphBreakResult } from "./vlist/index.js";

const LATEX_RAGGED_FINAL_HYPHEN_DEMERITS = 0;
const LATEX_PARBOX_SLOPPY_TOLERANCE = 9999;
const LATEX_PARBOX_SLOPPY_EMERGENCY_STRETCH_EM = 3;

export type TexParagraphRightskipStretchMode =
  | "default"
  | "ragged-right-infinite-otherwise-zero"
  | "ragged-right-infinite-center-zero";

export interface TexParagraphBreakScopePolicy {
  readonly leftMarginWidth: number;
  readonly rightMarginWidth: number;
  readonly automaticHyphenPenalty?: number;
  readonly allowParagraphIndent: boolean;
  readonly allowForcedBreakIndent: boolean;
  readonly forceParfillStretch: boolean;
  readonly suppressRaggedLeftCenterLeftskipStretch: boolean;
  readonly rightskipStretchMode: TexParagraphRightskipStretchMode;
}

export const DEFAULT_TEX_PARAGRAPH_BREAK_SCOPE_POLICY: TexParagraphBreakScopePolicy = {
  leftMarginWidth: 0,
  rightMarginWidth: 0,
  allowParagraphIndent: true,
  allowForcedBreakIndent: true,
  forceParfillStretch: false,
  suppressRaggedLeftCenterLeftskipStretch: false,
  rightskipStretchMode: "default",
};

export interface TexParagraphBreakOptions {
  readonly width: number;
  readonly font?: ResolvedTexFont;
  readonly metricProvider?: TexMetricProvider;
  readonly tolerance?: number;
  readonly pretolerance?: number;
  readonly parindent?: number;
  readonly rightskipStretch?: number;
  readonly tikzTextWidthNode?: boolean;
  readonly hyphenator?: Hyphenator | null;
  readonly mathBoxProvider?: TexMathBoxProvider;
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
  readonly firstLineIndentWidth?: number;
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
  });
  const pass1 = breakWithDp(pass1Model, params.options.width, {
    ...dpOptions,
    tolerance: params.options.pretolerance ?? englishDefaults.pretolerance,
  });

  let selectedModel = pass1Model;
  let selectedPass = pass1;
  if (!dpPassHasLines(selectedPass)) {
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
    const passConfigs: Array<DpOptions & { readonly tolerance: number }> = [
      { ...dpOptions, tolerance },
    ];
    if (emergencyStretch > 0) {
      passConfigs.push({ ...dpOptions, tolerance, emergencyStretch });
    }
    passConfigs.push({
      ...dpOptions,
      tolerance,
      emergencyStretch,
      allowLastResortOverfull: true,
    });
    for (const passOptions of passConfigs) {
      selectedPass = breakWithDp(pass2Model, params.options.width, passOptions);
      if (dpPassHasLines(selectedPass)) {
        break;
      }
    }
  }

  if (!dpPassHasLines(selectedPass)) {
    return null;
  }

  return {
    lines: selectedPass.lines,
    runs: params.runs,
    runWidths: selectedModel.runWidths,
    shapedRuns: params.shapedRuns,
    errors: [...selectedModel.errors, ...selectedPass.errors],
    linebreakingMode: selectedPass.mode,
  };
}

function dpPassHasLines(
  pass: ReturnType<typeof breakWithDp>
): pass is ReturnType<typeof breakWithDp> & { readonly canProceed: true } {
  return pass.canProceed && pass.lines.length > 0;
}

interface TexParagraphDpOptionParams {
  readonly options: TexParagraphBreakOptions;
  readonly alignment: TexParagraphAlignment;
  readonly noIndent: boolean;
  readonly firstLineIndentWidth?: number;
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
  const skipStretch = 2 * (
    options.font?.atPt ??
    options.metricProvider?.resolveFont().atPt ??
    computerModernTexMetricProvider.resolveFont().atPt
  );
  const inheritedParfillStretch =
    inheritedAlignment === undefined
      ? Number.POSITIVE_INFINITY
      : texParfillStretchForAlignment(inheritedAlignment, inheritedAlignmentProfile);
  return {
    linepenalty: englishDefaults.linepenalty,
    adjdemerits: englishDefaults.adjdemerits,
    doublehyphendemerits: englishDefaults.doublehyphendemerits,
    finalhyphendemerits: latexDeclaration || latexRagged || inheritedLatexRagged
      ? LATEX_RAGGED_FINAL_HYPHEN_DEMERITS
      : englishDefaults.finalhyphendemerits,
    leftskipWidth: scopePolicy.leftMarginWidth,
    leftskipStretch:
      texDeclarationLeftskipStretch(
        alignment,
        latexDeclaration,
        scopePolicy,
        skipStretch
      ),
    leftskipShrink: 0,
    rightskipWidth: scopePolicy.rightMarginWidth,
    rightskipStretch: Number.isFinite(options.rightskipStretch)
      ? Math.max(0, options.rightskipStretch ?? 0)
      : texDeclarationRightskipStretch(
        alignment,
        latexDeclaration,
        latexQuote,
        scopePolicy,
        skipStretch
      ),
    rightskipShrink: 0,
    firstLineIndentWidth:
      Number.isFinite(firstLineIndentWidth)
        ? firstLineIndentWidth
        : !noIndent &&
            scopePolicy.allowParagraphIndent &&
            Number.isFinite(options.parindent) &&
            options.parindent &&
            options.parindent > 0
          ? options.parindent
          : 0,
    forcedBreakIndentWidth:
      Number.isFinite(firstLineIndentWidth) && scopePolicy.allowForcedBreakIndent
        ? firstLineIndentWidth
        : options.tikzTextWidthNode === true &&
              alignment !== "justified" &&
              scopePolicy.allowForcedBreakIndent &&
              Number.isFinite(options.parindent) &&
              options.parindent &&
              options.parindent > 0
            ? options.parindent
            : 0,
    forcedBreakUsesParfill: true,
    forcedBreakTerminalDemerits: true,
    parfillskipWidth: 0,
    parfillskipStretch: texParfillStretchForAlignment(
      alignment,
      alignmentProfile,
      options.tikzTextWidthNode === true,
      inheritedParfillStretch,
      scopePolicy
    ),
    parfillskipShrink: 0,
    preventOverflow: false,
  };
}

function texDeclarationLeftskipStretch(
  alignment: TexParagraphAlignment,
  latexDeclaration: boolean,
  scopePolicy: TexParagraphBreakScopePolicy,
  fallbackStretch: number
): number {
  if (
    scopePolicy.suppressRaggedLeftCenterLeftskipStretch &&
    (alignment === "ragged-left" || alignment === "center")
  ) {
    return 0;
  }
  if (latexDeclaration && (alignment === "ragged-left" || alignment === "center")) {
    return Number.POSITIVE_INFINITY;
  }
  return alignment === "ragged-left" || alignment === "center" ? fallbackStretch : 0;
}

function texDeclarationRightskipStretch(
  alignment: TexParagraphAlignment,
  latexDeclaration: boolean,
  latexQuote: boolean,
  scopePolicy: TexParagraphBreakScopePolicy,
  fallbackStretch: number
): number {
  if (scopePolicy.rightskipStretchMode === "ragged-right-infinite-otherwise-zero") {
    return alignment === "ragged-right" ? Number.POSITIVE_INFINITY : 0;
  }
  if (scopePolicy.rightskipStretchMode === "ragged-right-infinite-center-zero") {
    if (alignment === "ragged-right") {
      return Number.POSITIVE_INFINITY;
    }
    if (alignment === "center") {
      return 0;
    }
  }
  if (
    (latexDeclaration || latexQuote) &&
    (alignment === "ragged-right" || alignment === "center")
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return alignment === "ragged-right" || alignment === "center" ? fallbackStretch : 0;
}

function texParfillStretchForAlignment(
  alignment: TexParagraphAlignment,
  alignmentProfile?: TexAlignmentProfile,
  tikzTextWidthNode = false,
  inheritedParfillStretch = Number.POSITIVE_INFINITY,
  scopePolicy: TexParagraphBreakScopePolicy = DEFAULT_TEX_PARAGRAPH_BREAK_SCOPE_POLICY
): number {
  if (scopePolicy.forceParfillStretch) {
    return Number.POSITIVE_INFINITY;
  }
  if (alignmentProfile === "latex-declaration") {
    if (alignment === "center" || alignment === "ragged-left") {
      return 0;
    }
    if (alignment === "ragged-right") {
      if (tikzTextWidthNode) {
        return Number.POSITIVE_INFINITY;
      }
      return inheritedParfillStretch;
    }
  }
  return alignment === "ragged-right" || alignment === "justified"
    ? Number.POSITIVE_INFINITY
    : 0;
}

function texParagraphTolerance(): number {
  // TikZ text-width nodes are built in a LaTeX minipage. LaTeX's
  // \@arrayparboxrestore applies \sloppy before TikZ installs the alignment
  // action. TikZ's justify action restores finite left/right skips but does
  // not reset \tolerance, so the effective tolerance remains sloppy.
  return LATEX_PARBOX_SLOPPY_TOLERANCE;
}

function texParagraphEmergencyStretch(options: TexParagraphBreakOptions): number {
  const font = options.font ?? options.metricProvider?.resolveFont() ?? computerModernTexMetricProvider.resolveFont();
  return LATEX_PARBOX_SLOPPY_EMERGENCY_STRETCH_EM * font.atPt;
}
