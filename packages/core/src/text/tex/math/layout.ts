import { roundTexPt, tfmToPt } from "../fonts/units.js";
import type {
  GeneratedTexExtensibleRecipe,
  GeneratedTexCharMetric,
  ResolvedTexFont,
  TexShapedItem,
} from "../fonts/types.js";
import {
  defaultTexMathFontProfile,
  luaLatexAmsMathFontProfile,
  type TexMathFontFamily,
  type TexMathFontProfile,
} from "./font-profile.js";
import type {
  TexMathAtom,
  TexMathAccentCommand,
  TexMathAlphabetCommand,
  TexMathAlphabetNucleus,
  TexMathAlignedIntertext,
  TexMathAlignedNucleus,
  TexMathAlignedRow,
  TexMathArrayColumnAlignment,
  TexMathArrayNucleus,
  TexMathCasesNucleus,
  TexMathDelimiter,
  TexMathExtensibleArrowNucleus,
  TexMathGlyphNucleus,
  TexMathLineNucleus,
  TexMathList,
  TexMathMatrixEnvironment,
  TexMathMatrixNucleus,
  TexMathNucleus,
  TexMathOperatorCommand,
  TexMathOperatorLimits,
  TexMathOperatorNameNucleus,
  TexMathSmallMatrixNucleus,
  TexMathSourceSpan,
  TexMathStyle,
  TexMathSizedDelimiterNucleus,
  TexMathSubarrayNucleus,
  TexMathSubstackNucleus,
  TexMathTextNucleus,
} from "./ir.js";
import {
  normalizeTexMathAtomClasses,
  resolveExplicitMathGlue,
  spaceTexMathList,
  texMathSpacingBetween,
  type TexMathResolvedGlue,
} from "./spacing.js";

export type TexMathHListItem =
  | TexMathGlyphLayoutItem
  | TexMathGlueLayoutItem
  | TexMathKernLayoutItem
  | TexMathRuleLayoutItem
  | TexMathChildHListLayoutItem;

export interface TexMathGlyphLayoutItem {
  readonly kind: "glyph";
  readonly fontId: string;
  readonly atPt: number;
  readonly family: TexMathFontFamily | "alphabet" | "text";
  readonly code: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly italicCorrection: number;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathGlueLayoutItem {
  readonly kind: "glue";
  readonly x: number;
  readonly width: number;
  readonly mu: number;
  readonly stretch: number;
  readonly shrink: number;
  readonly source: TexMathResolvedGlue["source"];
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathKernLayoutItem {
  readonly kind: "kern";
  readonly x: number;
  readonly width: number;
  readonly reason: "fraction-kern" | "italic-correction" | "operator-kern" | "text-kern";
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathRuleLayoutItem {
  readonly kind: "rule";
  readonly role: "fraction-rule" | "radical-rule" | "overline-rule" | "underline-rule";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathChildHListLayoutItem {
  readonly kind: "hlist";
  readonly role:
    | "nucleus"
    | "superscript"
    | "subscript"
    | "limit-superscript"
    | "limit-subscript"
    | "aligned-row"
    | "aligned-cell"
    | "substack-row"
    | "substack-cell"
    | "subarray-row"
    | "subarray-cell"
    | "array-row"
    | "array-cell"
    | "cases-row"
    | "cases-cell"
    | "matrix-row"
    | "matrix-cell"
    | "smallmatrix-row"
    | "smallmatrix-cell";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly sourceSpan: TexMathSourceSpan;
  readonly items: readonly TexMathHListItem[];
  readonly multlineShove?: "left" | "right";
  readonly intertextsBefore?: readonly TexMathAlignedIntertext[];
}

export interface TexMathHList {
  readonly kind: "math-hlist";
  readonly style: TexMathStyle;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly sourceSpan: TexMathSourceSpan;
  readonly items: readonly TexMathHListItem[];
}

export interface TexMathLayoutOptions {
  readonly style?: TexMathStyle;
  readonly cramped?: boolean;
  readonly fontProfile?: TexMathFontProfile;
  readonly baseAtPt?: number;
  readonly alphabet?: TexMathAlphabetCommand;
}

export interface TexMathLayoutError {
  readonly message: string;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathLayoutResult =
  | {
      readonly supported: true;
      readonly hlist: TexMathHList;
      readonly errors: readonly TexMathLayoutError[];
    }
  | {
      readonly supported: false;
      readonly hlist: null;
      readonly errors: readonly TexMathLayoutError[];
    };

export interface ResolvedMathGlyph {
  readonly kind: "glyph";
  readonly family: TexMathFontFamily | "alphabet";
  readonly font: ResolvedTexFont;
  readonly code: number;
  readonly text: string;
  readonly xOffset: number;
  readonly advance: number;
  readonly sourceSpan: TexMathSourceSpan;
}

type MathGlyphSpec = {
  readonly kind?: "glyph";
  readonly family: TexMathFontFamily;
  readonly code: number;
  readonly xOffset?: number;
  readonly advance?: number;
} | {
  readonly kind: "kern";
  readonly width: number;
  readonly xOffset?: number;
};

type ResolvedMathSymbolPart = ResolvedMathGlyph | {
  readonly kind: "kern";
  readonly width: number;
  readonly xOffset: number;
  readonly sourceSpan: TexMathSourceSpan;
};

const TEX_SCRIPT_SPACE_PT = 0.5;
const TEX_NULL_DELIMITER_SPACE_PT = 1.2;
const TEX_LATEX_STRUT_HEIGHT_PT = 8.39996;
const TEX_LATEX_STRUT_DEPTH_PT = 3.60004;
const TEX_DELIMITER_FACTOR = 901;
const TEX_DELIMITER_SHORTFALL_PT = 5;
const TEX_SP_PER_PT = 65536;
const TEX_DEFAULT_SKEW_CHAR = 127;

interface TexMathAtomLayout {
  readonly items: readonly TexMathHListItem[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly italicCorrection: number;
  readonly isCharacterNucleus: boolean;
  readonly scriptShiftsAsCharacter?: boolean;
  readonly scriptBaseWidth?: number;
  readonly scriptSuperscriptOffset?: number;
  readonly sourceSpan: TexMathSourceSpan;
}

interface TexMathDelimiterLayout {
  readonly items: readonly TexMathGlyphLayoutItem[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export function layoutTexMathList(
  list: TexMathList,
  options: TexMathLayoutOptions = {}
): TexMathLayoutResult {
  const style = options.style ?? "text";
  const cramped = options.cramped ?? false;
  let currentStyle = style;
  let currentCramped = cramped;
  const fontProfile = options.fontProfile ?? resolveDefaultTexMathFontProfileForList(list);
  const baseAtPt = options.baseAtPt ?? 10;
  const alphabet = options.alphabet;
  const spaced = spaceTexMathList(list, { style });
  const items: TexMathHListItem[] = [];
  const errors: TexMathLayoutError[] = [];
  let cursor = 0;
  let height = 0;
  let depth = 0;

  for (const item of spaced.items) {
    if (item.kind === "resolved-glue") {
      const width = muToPt(fontProfile, currentStyle, baseAtPt, item.mu);
      const stretch = muToPt(fontProfile, currentStyle, baseAtPt, item.stretchMu);
      const shrink = muToPt(fontProfile, currentStyle, baseAtPt, item.shrinkMu);
      items.push({
        kind: "glue",
        x: roundTexPt(cursor),
        width,
        mu: item.mu,
        stretch,
        shrink,
        source: item.source,
        sourceSpan: item.sourceSpan,
      });
      cursor = roundTexPt(cursor + width);
      continue;
    }
    if (item.kind === "style-change") {
      currentStyle = item.style;
      currentCramped = false;
      continue;
    }
    if (item.kind === "unsupported") {
      errors.push({
        message: `Unsupported TeX math item ${item.command}.`,
        sourceSpan: item.sourceSpan,
      });
      continue;
    }
    const atomLayout = layoutAtom(item, fontProfile, currentStyle, currentCramped, baseAtPt, alphabet);
    if (!atomLayout) {
      errors.push({
        message: "Only simple glyph math atoms are supported by the initial math hlist layout.",
        sourceSpan: item.sourceSpan,
      });
      continue;
    }
    for (const atomItem of atomLayout.items) {
      items.push(offsetMathLayoutItem(atomItem, cursor));
    }
    cursor = roundTexPt(cursor + atomLayout.width);
    height = Math.max(height, atomLayout.height);
    depth = Math.max(depth, atomLayout.depth);
  }

  if (errors.length > 0) {
    return {
      supported: false,
      hlist: null,
      errors,
    };
  }

  const hlist = {
    kind: "math-hlist",
    style,
    width: roundTexPt(cursor),
    height: roundTexPt(height),
    depth: roundTexPt(depth),
    sourceSpan: list.sourceSpan,
    items,
  } satisfies TexMathHList;
  return {
    supported: true,
    hlist: alphabet ? normalizeAlphabetHList(hlist, alphabet) : hlist,
    errors: [],
  };
}

export function setTexMathHListWidth(
  hlist: TexMathHList,
  targetWidth: number
): TexMathHList {
  if (!Number.isFinite(targetWidth)) {
    return hlist;
  }
  const roundedTargetWidth = roundTexPt(targetWidth);
  const delta = roundTexPt(roundedTargetWidth - hlist.width);
  if (delta === 0) {
    return hlist.width === roundedTargetWidth
      ? hlist
      : { ...hlist, width: roundedTargetWidth };
  }
  const sign = delta > 0 ? "stretch" : "shrink";
  const total = hlist.items.reduce((sum, item) => {
    if (item.kind !== "glue") {
      return sum;
    }
    return sum + Math.max(0, sign === "stretch" ? item.stretch : item.shrink);
  }, 0);
  if (total <= 0) {
    return { ...hlist, width: roundedTargetWidth };
  }
  const ratio = sign === "stretch"
    ? delta / total
    : Math.min(-delta / total, 1);
  let offset = 0;
  const items = hlist.items.map((item) => {
    const shifted = {
      ...item,
      x: roundTexPt(item.x + offset),
    };
    if (item.kind !== "glue") {
      return shifted;
    }
    const adjustment = (sign === "stretch" ? item.stretch : -item.shrink) * ratio;
    const adjustedWidth = roundTexPt(item.width + adjustment);
    offset = roundTexPt(offset + adjustedWidth - item.width);
    return {
      ...shifted,
      width: adjustedWidth,
    };
  });
  return {
    ...hlist,
    width: roundedTargetWidth,
    items,
  };
}

export function resolveDefaultTexMathFontProfileForList(list: TexMathList): TexMathFontProfile {
  return texMathListNeedsAmsMath(list) ? luaLatexAmsMathFontProfile : defaultTexMathFontProfile;
}

function texMathListNeedsAmsMath(list: TexMathList): boolean {
  return list.items.some((item) => {
    if (item.kind === "unsupported") {
      return false;
    }
    if (item.kind !== "atom") {
      return false;
    }
    return texMathAtomNeedsAmsMath(item);
  });
}

function texMathAtomNeedsAmsMath(atom: TexMathAtom): boolean {
  return texMathNucleusNeedsAmsMath(atom.nucleus) ||
    (atom.subscript ? texMathListNeedsAmsMath(atom.subscript.list) : false) ||
    (atom.superscript ? texMathListNeedsAmsMath(atom.superscript.list) : false);
}

function texMathNucleusNeedsAmsMath(nucleus: TexMathNucleus): boolean {
  if (nucleus.kind === "glyph" && amsMathSymbolCommand(nucleus.text)) {
    return true;
  }
  if (
    nucleus.kind === "text" ||
    nucleus.kind === "aligned" ||
    nucleus.kind === "matrix" ||
    nucleus.kind === "substack" ||
    nucleus.kind === "subarray" ||
    nucleus.kind === "cases" ||
    nucleus.kind === "smallmatrix" ||
    nucleus.kind === "operator-name"
  ) {
    return true;
  }
  if (nucleus.kind === "array") {
    return nucleus.rows.some((row) =>
      row.cells.some((cell) => texMathListNeedsAmsMath(cell.list))
    );
  }
  if (nucleus.kind === "list") {
    if (nucleus.role === "ellipsis") {
      return true;
    }
    return texMathListNeedsAmsMath(nucleus.list);
  }
  if (nucleus.kind === "fraction") {
    if (
      amsMathDelimiter(nucleus.leftDelimiter) ||
      amsMathDelimiter(nucleus.rightDelimiter)
    ) {
      return true;
    }
    if (nucleus.leftDelimiter !== undefined || nucleus.rightDelimiter !== undefined || nucleus.style !== undefined) {
      return true;
    }
    return texMathListNeedsAmsMath(nucleus.numerator) || texMathListNeedsAmsMath(nucleus.denominator);
  }
  if (nucleus.kind === "radical") {
    return texMathListNeedsAmsMath(nucleus.radicand);
  }
  if (nucleus.kind === "line") {
    return texMathListNeedsAmsMath(nucleus.body);
  }
  if (nucleus.kind === "accent") {
    return texMathListNeedsAmsMath(nucleus.base);
  }
  if (nucleus.kind === "alphabet") {
    return texMathListNeedsAmsMath(nucleus.list);
  }
  if (nucleus.kind === "left-right") {
    if (amsMathDelimiter(nucleus.leftDelimiter) || amsMathDelimiter(nucleus.rightDelimiter)) {
      return true;
    }
    return texMathListNeedsAmsMath(nucleus.body);
  }
  return false;
}

function amsMathSymbolCommand(text: string): boolean {
  const command = text.startsWith("\\") ? text.slice(1) : text;
  switch (command) {
    case "approxeq":
    case "Bbbk":
    case "blacksquare":
    case "boxdot":
    case "circleddash":
    case "digamma":
    case "dotplus":
    case "geqslant":
    case "gtrsim":
    case "leqslant":
    case "lesssim":
    case "ngeqslant":
    case "nleqslant":
    case "nVdash":
    case "square":
    case "Subset":
    case "Supset":
    case "thickapprox":
    case "ulcorner":
    case "urcorner":
    case "varnothing":
    case "Vdash":
      return true;
    default:
      return false;
  }
}

function amsMathDelimiter(delimiter: TexMathDelimiter | undefined): boolean {
  return delimiter === "ulcorner" || delimiter === "urcorner";
}

function layoutAtom(
  atom: TexMathAtom,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const nucleus = layoutNucleus(atom.nucleus, fontProfile, style, cramped, baseAtPt, alphabet);
  if (!nucleus) {
    return null;
  }

  if (shouldUseOperatorLimits(atom, style)) {
    return layoutOperatorLimitsAtom(atom, nucleus, fontProfile, style, cramped, baseAtPt, alphabet);
  }

  if (!atom.subscript && !atom.superscript) {
    return nucleus.isCharacterNucleus
      ? appendTrailingItalicCorrection(nucleus, nucleus.italicCorrection, nucleus.sourceSpan)
      : nucleus;
  }

  const items: TexMathHListItem[] = [...nucleus.items];
  const hasSubscript = Boolean(atom.subscript);
  let scriptStartX = hasSubscript && nucleus.scriptBaseWidth !== undefined
    ? nucleus.scriptBaseWidth
    : nucleus.width;
  let atomWidth = scriptStartX;
  let height = nucleus.height;
  let depth = nucleus.depth;
  const delta = atom.subscript
    ? nucleus.scriptSuperscriptOffset ?? (nucleus.isCharacterNucleus ? nucleus.italicCorrection : 0)
    : 0;
  if (!atom.subscript && nucleus.isCharacterNucleus && nucleus.italicCorrection !== 0) {
    items.push({
      kind: "kern",
      x: nucleus.width,
      width: nucleus.italicCorrection,
      reason: "italic-correction",
      sourceSpan: nucleus.sourceSpan,
    });
    scriptStartX = roundTexPt(scriptStartX + nucleus.italicCorrection);
    atomWidth = scriptStartX;
  } else if (
    !atom.subscript &&
    atom.superscript &&
    nucleus.scriptSuperscriptOffset !== undefined &&
    nucleus.scriptSuperscriptOffset !== 0
  ) {
    items.push({
      kind: "kern",
      x: nucleus.scriptBaseWidth ?? nucleus.width,
      width: nucleus.scriptSuperscriptOffset,
      reason: "italic-correction",
      sourceSpan: nucleus.sourceSpan,
    });
  }

  const sup = atom.superscript
    ? layoutScriptList(atom.superscript.list, fontProfile, supStyle(style), cramped, baseAtPt, alphabet)
    : null;
  const sub = atom.subscript
    ? layoutScriptList(atom.subscript.list, fontProfile, subStyle(style), true, baseAtPt, alphabet)
    : null;
  if ((atom.superscript && !sup) || (atom.subscript && !sub)) {
    return null;
  }

  const baseShifts = initialScriptShifts(nucleus, style, fontProfile, baseAtPt);
  if (sup && !sub) {
    const shiftUp = superscriptShiftUp(sup, baseShifts.shiftUp, style, cramped, fontProfile, baseAtPt);
    const child = childHList("superscript", scriptStartX, -shiftUp, sup, atom.superscript?.sourceSpan ?? nucleus.sourceSpan);
    items.push(child);
    atomWidth = roundTexPt(scriptStartX + child.width);
    height = Math.max(height, -child.y + child.height);
    depth = Math.max(depth, child.y + child.depth);
  } else if (sub && !sup) {
    const shiftDown = subscriptShiftDown(sub, baseShifts.shiftDown, false, style, fontProfile, baseAtPt);
    const child = childHList("subscript", scriptStartX, shiftDown, sub, atom.subscript?.sourceSpan ?? nucleus.sourceSpan);
    items.push(child);
    atomWidth = roundTexPt(scriptStartX + child.width);
    height = Math.max(height, -child.y + child.height);
    depth = Math.max(depth, child.y + child.depth);
  } else if (sup && sub) {
    const shifts = combinedScriptShifts(sup, sub, baseShifts, style, cramped, fontProfile, baseAtPt);
    const supChild = childHList("superscript", roundTexPt(scriptStartX + delta), -shifts.shiftUp, sup, atom.superscript?.sourceSpan ?? nucleus.sourceSpan);
    const subChild = childHList("subscript", scriptStartX, shifts.shiftDown, sub, atom.subscript?.sourceSpan ?? nucleus.sourceSpan);
    items.push(supChild, subChild);
    atomWidth = roundTexPt(scriptStartX + Math.max(delta + sup.width, sub.width));
    height = Math.max(height, -supChild.y + supChild.height, -subChild.y + subChild.height);
    depth = Math.max(depth, supChild.y + supChild.depth, subChild.y + subChild.depth);
  }

  return {
    items,
    width: atomWidth,
    height: roundTexPt(height),
    depth: roundTexPt(Math.max(0, depth)),
    italicCorrection: nucleus.italicCorrection,
    isCharacterNucleus: nucleus.isCharacterNucleus,
    sourceSpan: nucleus.sourceSpan,
  };
}

function shouldUseOperatorLimits(
  atom: TexMathAtom,
  style: TexMathStyle
): boolean {
  if ((atom.nucleus.kind !== "operator" && atom.nucleus.kind !== "operator-name") || (!atom.subscript && !atom.superscript)) {
    return false;
  }
  const limits = atom.limits ?? (
    atom.nucleus.kind === "operator"
      ? defaultOperatorLimits(atom.nucleus.command)
      : "nolimits"
  );
  if (limits === "nolimits") {
    return false;
  }
  return limits === "limits" || style === "display";
}

function defaultOperatorLimits(command: TexMathOperatorCommand): TexMathOperatorLimits {
  if (
    command === "int" ||
    command === "oint" ||
    command === "idotsint" ||
    command === "iint" ||
    command === "iiint" ||
    command === "iiiint"
  ) {
    return "nolimits";
  }
  return "display";
}

function layoutOperatorLimitsAtom(
  atom: TexMathAtom,
  nucleus: TexMathAtomLayout,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const sup = atom.superscript
    ? layoutLimitList(atom.superscript.list, fontProfile, supStyle(style), cramped, baseAtPt, alphabet)
    : null;
  const sub = atom.subscript
    ? layoutLimitList(atom.subscript.list, fontProfile, subStyle(style), true, baseAtPt, alphabet)
    : null;
  if ((atom.superscript && !sup) || (atom.subscript && !sub)) {
    return null;
  }

  const width = roundTexPt(Math.max(nucleus.width, sup?.width ?? 0, sub?.width ?? 0));
  const delta = nucleus.italicCorrection;
  const operatorX = roundTexPt((width - nucleus.width) / 2);
  const items: TexMathHListItem[] = nucleus.items.map((item) => offsetMathLayoutItem(item, operatorX));
  let height = nucleus.height;
  let depth = nucleus.depth;

  if (sup) {
    const shiftUp = roundTexPt(Math.max(
      mathExtensionParameterToPt(fontProfile, "bigOpSpacing3", style, baseAtPt) - sup.depth,
      mathExtensionParameterToPt(fontProfile, "bigOpSpacing1", style, baseAtPt)
    ));
    const child = childHList(
      "limit-superscript",
      (width - sup.width) / 2 + delta / 2,
      -(nucleus.height + shiftUp + sup.depth),
      sup,
      atom.superscript?.sourceSpan ?? nucleus.sourceSpan
    );
    items.unshift(child);
    height = roundTexPt(nucleus.height +
      mathExtensionParameterToPt(fontProfile, "bigOpSpacing5", style, baseAtPt) +
      sup.height +
      sup.depth +
      shiftUp);
  }

  if (sub) {
    const shiftDown = roundTexPt(Math.max(
      mathExtensionParameterToPt(fontProfile, "bigOpSpacing4", style, baseAtPt) - sub.height,
      mathExtensionParameterToPt(fontProfile, "bigOpSpacing2", style, baseAtPt)
    ));
    const child = childHList(
      "limit-subscript",
      (width - sub.width) / 2 - delta / 2,
      nucleus.depth + shiftDown + sub.height,
      sub,
      atom.subscript?.sourceSpan ?? nucleus.sourceSpan
    );
    items.push(child);
    depth = roundTexPt(nucleus.depth +
      shiftDown +
      sub.height +
      sub.depth +
      mathExtensionParameterToPt(fontProfile, "bigOpSpacing5", style, baseAtPt));
  }

  return {
    items,
    width,
    height: roundTexPt(height),
    depth: roundTexPt(Math.max(0, depth)),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: atom.sourceSpan,
  };
}

function layoutNucleus(
  nucleus: TexMathNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  if (nucleus.kind === "glyph") {
    return layoutGlyphNucleus(nucleus, fontProfile, style, baseAtPt, alphabet);
  }
  if (nucleus.kind === "sized-delimiter") {
    return layoutSizedDelimiterNucleus(nucleus, fontProfile, style, baseAtPt);
  }
  if (nucleus.kind === "list") {
    const unwrapped = layoutSingleAtomGroupNucleus(nucleus.list, fontProfile, style, cramped, baseAtPt, alphabet);
    if (unwrapped) {
      return {
        ...unwrapped,
        sourceSpan: nucleus.sourceSpan,
      };
    }
    const result = layoutTexMathList(nucleus.list, { fontProfile, style, cramped, baseAtPt, alphabet });
    if (!result.supported) {
      return null;
    }
    const child = childHList("nucleus", 0, 0, result.hlist, nucleus.sourceSpan);
    return {
      items: [child],
      width: child.width,
      height: child.height,
      depth: child.depth,
      italicCorrection: 0,
      isCharacterNucleus: false,
      sourceSpan: nucleus.sourceSpan,
    };
  }
  if (nucleus.kind === "fraction") {
    return layoutFractionNucleus(nucleus, fontProfile, style, cramped, baseAtPt, alphabet);
  }
  if (nucleus.kind === "radical") {
    return layoutRadicalNucleus(nucleus, fontProfile, style, cramped, baseAtPt, alphabet);
  }
  if (nucleus.kind === "line") {
    return layoutLineNucleus(nucleus, fontProfile, style, cramped, baseAtPt, alphabet);
  }
  if (nucleus.kind === "accent") {
    return layoutAccentNucleus(nucleus, fontProfile, style, cramped, baseAtPt, alphabet);
  }
  if (nucleus.kind === "alphabet") {
    return layoutAlphabetNucleus(nucleus, fontProfile, style, cramped, baseAtPt);
  }
  if (nucleus.kind === "text") {
    return layoutTextNucleus(nucleus, fontProfile, style, baseAtPt);
  }
  if (nucleus.kind === "operator") {
    return layoutOperatorNucleus(nucleus, fontProfile, style, baseAtPt);
  }
  if (nucleus.kind === "operator-name") {
    return layoutOperatorNameNucleus(nucleus, fontProfile, style, baseAtPt);
  }
  if (nucleus.kind === "extensible-arrow") {
    return layoutExtensibleArrowNucleus(nucleus, fontProfile, style, baseAtPt, alphabet);
  }
  if (nucleus.kind === "left-right") {
    return layoutLeftRightNucleus(nucleus, fontProfile, style, cramped, baseAtPt, alphabet);
  }
  if (nucleus.kind === "aligned") {
    return layoutAlignedNucleus(nucleus, fontProfile, style, baseAtPt, alphabet);
  }
  if (nucleus.kind === "substack") {
    return layoutSubstackNucleus(nucleus, fontProfile, style, baseAtPt, alphabet);
  }
  if (nucleus.kind === "subarray") {
    return layoutSubarrayNucleus(nucleus, fontProfile, style, baseAtPt, alphabet);
  }
  if (nucleus.kind === "array") {
    return layoutArrayNucleus(nucleus, fontProfile, baseAtPt, alphabet);
  }
  if (nucleus.kind === "cases") {
    return layoutCasesNucleus(nucleus, fontProfile, style, baseAtPt, alphabet);
  }
  if (nucleus.kind === "smallmatrix") {
    return layoutSmallMatrixNucleus(nucleus, fontProfile, style, baseAtPt, alphabet);
  }
  if (nucleus.kind === "matrix") {
    return layoutMatrixNucleus(nucleus, fontProfile, style, baseAtPt, alphabet);
  }
  return null;
}

function layoutSingleAtomGroupNucleus(
  list: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  if (list.items.length !== 1) {
    return null;
  }
  const item = list.items[0];
  if (
    item?.kind !== "atom" ||
    item.subscript ||
    item.superscript ||
    item.limits
  ) {
    return null;
  }
  return layoutNucleus(item.nucleus, fontProfile, style, cramped, baseAtPt, alphabet);
}

function layoutSizedDelimiterNucleus(
  nucleus: TexMathSizedDelimiterNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  const delimiterStyle = delimiterSizeStyle(style);
  const axis = mathParameterToPt(fontProfile, "axisHeight", delimiterStyle, baseAtPt);
  const delimiter = layoutMathDelimiter(
    nucleus.delimiter,
    fontProfile,
    delimiterStyle,
    baseAtPt,
    sizedDelimiterTargetHeight(nucleus.command),
    axis,
    nucleus.delimiterSourceSpan
  );
  if (!delimiter) {
    return null;
  }
  return {
    items: delimiter.items,
    width: delimiter.width,
    height: sizedDelimiterBoxHeight(nucleus.command),
    depth: sizedDelimiterBoxDepth(nucleus.command),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function sizedDelimiterTargetHeight(command: TexMathSizedDelimiterNucleus["command"]): number {
  switch (command) {
    case "big":
      return 12;
    case "Big":
      return 18;
    case "bigg":
      return 24;
    case "Bigg":
      return 30;
  }
}

function sizedDelimiterBoxHeight(command: TexMathSizedDelimiterNucleus["command"]): number {
  switch (command) {
    case "big":
      return 8.5;
    case "Big":
      return 11.5;
    case "bigg":
      return 14.5;
    case "Bigg":
      return 17.5;
  }
}

function sizedDelimiterBoxDepth(command: TexMathSizedDelimiterNucleus["command"]): number {
  switch (command) {
    case "big":
      return 3.5;
    case "Big":
      return 6.5;
    case "bigg":
      return 9.5;
    case "Bigg":
      return 12.5;
  }
}

function layoutTextNucleus(
  nucleus: TexMathTextNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  const font = fontProfile.textFontProfile.resolveTextFont(
    fontProfile.textFontProfile.defaultFontState,
    textStyleAtPt(style, baseAtPt),
    fontProfile.metricProvider
  );
  const items: TexMathHListItem[] = [];
  let cursor = 0;
  let height = 0;
  let depth = 0;

  const appendTextRun = (text: string, sourceStart: number): boolean => {
    if (!text) {
      return true;
    }
    let shaped: ReturnType<typeof fontProfile.metricProvider.shapeText>;
    try {
      shaped = fontProfile.metricProvider.shapeText(text, font, { sourceStart });
    } catch {
      return false;
    }
    for (const item of shaped.items) {
      const layoutItem = textShapedItemToMathLayoutItem(item, font, cursor);
      items.push(layoutItem);
      cursor = roundTexPt(cursor + layoutItem.width);
      if (layoutItem.kind === "glyph") {
        height = Math.max(height, layoutItem.height);
        depth = Math.max(depth, layoutItem.depth);
      }
    }
    return true;
  };

  for (const part of nucleus.parts ?? [{
    kind: "text" as const,
    text: nucleus.text,
    sourceSpan: nucleus.textSourceSpan,
  }]) {
    if (part.kind === "text") {
      if (!appendTextRun(part.text, part.sourceSpan.start)) {
        return null;
      }
      continue;
    }
    const math = layoutTexMathList(part.list, { fontProfile, style, baseAtPt });
    if (!math.supported) {
      return null;
    }
    const child = childHList("nucleus", cursor, 0, math.hlist, part.sourceSpan);
    items.push(child);
    cursor = roundTexPt(cursor + child.width);
    height = Math.max(height, child.height);
    depth = Math.max(depth, child.depth);
  }

  return {
    items,
    width: cursor,
    height: roundTexPt(height),
    depth: roundTexPt(depth),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function textShapedItemToMathLayoutItem(
  item: TexShapedItem,
  font: ResolvedTexFont,
  x: number,
  family: TexMathGlyphLayoutItem["family"] = "text"
): TexMathGlyphLayoutItem | TexMathKernLayoutItem {
  if (item.kind === "kern") {
    return {
      kind: "kern",
      x,
      width: item.width,
      reason: "text-kern",
      sourceSpan: {
        start: item.sourceStart,
        end: item.sourceEnd,
      },
    };
  }
  return {
    kind: "glyph",
    fontId: font.id,
    atPt: font.atPt,
    family,
    code: item.code,
    text: String.fromCharCode(item.code),
    x,
    y: 0,
    width: item.width,
    height: item.height,
    depth: item.depth,
    italicCorrection: item.italicCorrection,
    sourceSpan: {
      start: item.sourceStart,
      end: item.sourceEnd,
    },
  };
}

function textStyleAtPt(style: TexMathStyle, baseAtPt: number): number {
  if (style === "script") {
    return baseAtPt * 0.7;
  }
  if (style === "scriptscript") {
    return baseAtPt * 0.5;
  }
  return baseAtPt;
}

function layoutAlphabetNucleus(
  nucleus: TexMathAlphabetNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number
): TexMathAtomLayout | null {
  const result = layoutTexMathList(nucleus.list, {
    fontProfile,
    style,
    cramped,
    baseAtPt,
    alphabet: nucleus.alphabet,
  });
  if (!result.supported) {
    return null;
  }
  const hlist = normalizeAlphabetHList(result.hlist, nucleus.alphabet);
  const child = childHList("nucleus", 0, 0, hlist, nucleus.sourceSpan);
  return {
    items: [child],
    width: child.width,
    height: child.height,
    depth: child.depth,
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function normalizeAlphabetHList(
  hlist: TexMathHList,
  alphabet: TexMathAlphabetCommand
): TexMathHList {
  if (alphabet !== "mathit") {
    return hlist;
  }
  return collapseInternalMathitItalicKerns(hlist);
}

function collapseInternalMathitItalicKerns(hlist: TexMathHList): TexMathHList {
  let removedWidth = 0;
  const items: TexMathHListItem[] = [];
  for (let index = 0; index < hlist.items.length; index += 1) {
    const item = hlist.items[index];
    if (
      item?.kind === "kern" &&
      item.reason === "italic-correction" &&
      hlist.items[index + 1]?.kind === "glyph"
    ) {
      removedWidth = roundTexPt(removedWidth + item.width);
      continue;
    }
    if (item) {
      items.push(offsetMathLayoutItem(item, -removedWidth));
    }
  }
  if (removedWidth === 0) {
    return omitScriptAlphabetTrailingItalicKern(hlist);
  }
  return omitScriptAlphabetTrailingItalicKern({
    ...hlist,
    width: roundTexPt(hlist.width - removedWidth),
    items,
  });
}

function omitScriptAlphabetTrailingItalicKern(hlist: TexMathHList): TexMathHList {
  if (hlist.style !== "script" && hlist.style !== "scriptscript") {
    return hlist;
  }
  const last = hlist.items.at(-1);
  if (last?.kind !== "kern" || last.reason !== "italic-correction") {
    return hlist;
  }
  return {
    ...hlist,
    items: hlist.items.slice(0, -1),
  };
}

const TEX_ALIGNED_ROW_HEIGHT_PT = 8.399963;
const TEX_ALIGNED_ROW_DEPTH_PT = 3.600037;
const TEX_AMSMATH_JOT_PT = 3;
const TEX_AMSMATH_ALIGNMENT_PAIR_GAP_PT = 10;
const TEX_ALIGNED_BASELINE_SKIP_PT = 12;
const TEX_ALIGNED_LINE_SKIP_LIMIT_PT = 0;
const TEX_ALIGNED_LINE_SKIP_PT = 1;
const TEX_MATRIX_ARRAY_COL_SEP_PT = 5;
const TEX_CASES_ARRAY_STRETCH = 1.2;
const TEX_CASES_COLUMN_GAP_PT = 10;
const TEX_SMALLMATRIX_BASELINE_SKIP_PT = 6;
const TEX_SMALLMATRIX_LINE_SKIP_PT = 1.5;
const TEX_SUBSTACK_STYLE: TexMathStyle = "script";

interface TexMathAlignedCellLayout {
  readonly hlist: TexMathHList;
  readonly sourceSpan: TexMathSourceSpan;
}

interface TexMathAlignedRowLayout {
  readonly cells: readonly TexMathAlignedCellLayout[];
  readonly sourceSpan: TexMathSourceSpan;
  readonly height: number;
  readonly depth: number;
  readonly intertextsBefore?: readonly TexMathAlignedIntertext[];
  readonly multlineShove?: "left" | "right";
}

function layoutAlignedNucleus(
  nucleus: TexMathAlignedNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const rows = nucleus.rows.map((row) =>
    layoutAlignedRow(row, nucleus.columnSeparation, fontProfile, style, baseAtPt, alphabet)
  );
  if (rows.some((row): row is null => row === null)) {
    return null;
  }
  const concreteRows = rows as readonly TexMathAlignedRowLayout[];
  if (concreteRows.length === 0) {
    return {
      items: [],
      width: 0,
      height: 0,
      depth: 0,
      italicCorrection: 0,
      isCharacterNucleus: false,
      sourceSpan: nucleus.sourceSpan,
    };
  }

  const columnCount = Math.max(...concreteRows.map((row) => row.cells.length));
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(0, ...concreteRows.map((row) => row.cells[columnIndex]?.hlist.width ?? 0))
  ).map(roundTexPt);
  const width = roundTexPt(
    columnWidths.reduce((sum, columnWidth) => sum + columnWidth, 0) +
    alignedPairGapCount(columnCount, nucleus.columnSeparation) * TEX_AMSMATH_ALIGNMENT_PAIR_GAP_PT +
    alignedTrailingWidth(concreteRows.length, nucleus.columnSeparation)
  );
  const baselineOffsets = alignedRowBaselineOffsets(concreteRows);
  const lastRow = concreteRows[concreteRows.length - 1];
  const naturalHeight = roundTexPt(
    concreteRows[0].height +
    (baselineOffsets[baselineOffsets.length - 1] ?? 0) +
    lastRow.depth
  );
  const axis = mathParameterToPt(fontProfile, "axisHeight", style, baseAtPt);
  const height = roundTexPt(naturalHeight / 2 + axis);
  const depth = roundTexPt(naturalHeight - height);
  let baselineY = roundTexPt(-height + concreteRows[0].height);
  const rowItems: TexMathChildHListLayoutItem[] = [];

  for (const [rowIndex, row] of concreteRows.entries()) {
    const rowChildren: TexMathHListItem[] = [];
    let cursor = 0;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const columnWidth = columnWidths[columnIndex] ?? 0;
      const cell = row.cells[columnIndex];
      if (!cell) {
        cursor = roundTexPt(cursor + columnWidth);
        continue;
      }
      const alignRight = nucleus.columnSeparation !== "gather" &&
        nucleus.columnSeparation !== "multline" &&
        columnIndex % 2 === 0;
      rowChildren.push(childHList(
        "aligned-cell",
        nucleus.columnSeparation === "multline"
          ? cursor
          : nucleus.columnSeparation === "gather"
          ? roundTexPt(cursor + (columnWidth - cell.hlist.width) / 2)
          : alignRight
            ? roundTexPt(cursor + columnWidth - cell.hlist.width)
            : cursor,
        0,
        cell.hlist,
        cell.sourceSpan
      ));
      cursor = roundTexPt(cursor + columnWidth);
      if (shouldInsertAlignedPairGap(columnIndex, columnCount, nucleus.columnSeparation)) {
        cursor = roundTexPt(cursor + TEX_AMSMATH_ALIGNMENT_PAIR_GAP_PT);
      }
    }
    rowItems.push({
      kind: "hlist",
      role: "aligned-row",
      x: 0,
      y: baselineY,
      width,
      height: row.height,
      depth: row.depth,
      sourceSpan: row.sourceSpan,
      items: rowChildren,
      ...(row.intertextsBefore ? { intertextsBefore: row.intertextsBefore } : {}),
      ...(row.multlineShove ? { multlineShove: row.multlineShove } : {}),
    });
    baselineY = roundTexPt(-height + concreteRows[0].height + (baselineOffsets[rowIndex + 1] ?? 0));
  }

  return {
    items: rowItems,
    width,
    height,
    depth,
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutAlignedRow(
  row: TexMathAlignedRow,
  columnSeparation: TexMathAlignedNucleus["columnSeparation"],
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAlignedRowLayout | null {
  const cellStyle = alignedCellStyle();
  const cells = row.cells.map((cell, columnIndex) => {
    const result = layoutTexMathList(cell.list, { fontProfile, style: cellStyle, baseAtPt, alphabet });
    return result.supported
      ? {
          hlist: alignCellHList(
            columnSeparation === "multline"
              ? addMultlineLeadingEmptyOrdGlue(result.hlist, cell.list, fontProfile, cellStyle, baseAtPt)
              : result.hlist,
            cell.list,
            columnIndex,
            fontProfile,
            cellStyle,
            baseAtPt
          ),
          sourceSpan: cell.sourceSpan,
        }
      : null;
  });
  if (cells.some((cell): cell is null => cell === null)) {
    return null;
  }
  const concreteCells = cells as readonly TexMathAlignedCellLayout[];
  return {
    cells: concreteCells,
    sourceSpan: row.sourceSpan,
    height: roundTexPt(Math.max(TEX_ALIGNED_ROW_HEIGHT_PT, ...concreteCells.map((cell) => cell.hlist.height))),
    depth: roundTexPt(Math.max(TEX_ALIGNED_ROW_DEPTH_PT, ...concreteCells.map((cell) => cell.hlist.depth))),
    ...(row.intertextsBefore ? { intertextsBefore: row.intertextsBefore } : {}),
    ...(row.multlineShove ? { multlineShove: row.multlineShove } : {}),
  };
}

function addMultlineLeadingEmptyOrdGlue(
  hlist: TexMathHList,
  list: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathHList {
  const firstItem = normalizeTexMathAtomClasses(list).items[0];
  if (firstItem?.kind !== "atom") {
    return hlist;
  }
  const leadingGlue = texMathSpacingBetween({
    kind: "atom",
    atomClass: "ord",
    nucleus: { kind: "glyph", text: "", sourceSpan: { start: list.sourceSpan.start, end: list.sourceSpan.start } },
    sourceSpan: { start: list.sourceSpan.start, end: list.sourceSpan.start },
  }, firstItem, style);
  if (!leadingGlue) {
    return hlist;
  }
  const width = muToPt(fontProfile, style, baseAtPt, leadingGlue.mu);
  if (Math.abs(width) < 1e-9) {
    return hlist;
  }
  return {
    ...hlist,
    width: roundTexPt(hlist.width + width),
    items: [
      {
        kind: "glue",
        x: 0,
        width,
        mu: leadingGlue.mu,
        stretch: muToPt(fontProfile, style, baseAtPt, leadingGlue.stretchMu),
        shrink: muToPt(fontProfile, style, baseAtPt, leadingGlue.shrinkMu),
        source: leadingGlue.source,
        sourceSpan: leadingGlue.sourceSpan,
      },
      ...hlist.items.map((item) => offsetMathLayoutItem(item, width)),
    ],
  };
}

function alignedCellStyle(): TexMathStyle {
  return "display";
}

function alignedRowBaselineOffsets(rows: readonly TexMathAlignedRowLayout[]): readonly number[] {
  const offsets = [0];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const previous = rows[rowIndex - 1];
    const current = rows[rowIndex];
    offsets.push(roundTexPt(
      offsets[rowIndex - 1] +
      alignedRowBaselineDistance(previous, current)
    ));
  }
  return offsets;
}

function alignedRowBaselineDistance(
  previous: TexMathAlignedRowLayout,
  current: TexMathAlignedRowLayout
): number {
  const naturalDistance = roundTexPt(previous.depth + current.height);
  const interlineGlue = TEX_ALIGNED_BASELINE_SKIP_PT - naturalDistance >= TEX_ALIGNED_LINE_SKIP_LIMIT_PT
    ? roundTexPt(TEX_ALIGNED_BASELINE_SKIP_PT - naturalDistance)
    : TEX_ALIGNED_LINE_SKIP_PT;
  return roundTexPt(naturalDistance + interlineGlue + TEX_AMSMATH_JOT_PT);
}

function shouldInsertAlignedPairGap(
  columnIndex: number,
  columnCount: number,
  columnSeparation: TexMathAlignedNucleus["columnSeparation"]
): boolean {
  if (columnSeparation === "none" || columnSeparation === "multline") {
    return false;
  }
  return columnIndex % 2 === 1 && columnIndex < columnCount - 1;
}

function alignedPairGapCount(
  columnCount: number,
  columnSeparation: TexMathAlignedNucleus["columnSeparation"]
): number {
  if (columnSeparation === "none" || columnSeparation === "multline") {
    return 0;
  }
  return Math.max(0, Math.ceil(columnCount / 2) - 1);
}

function alignedTrailingWidth(
  rowCount: number,
  columnSeparation: TexMathAlignedNucleus["columnSeparation"]
): number {
  if (columnSeparation === "none" || columnSeparation === "multline") {
    return 0;
  }
  return rowCount === 1 ? TEX_AMSMATH_ALIGNMENT_PAIR_GAP_PT : 0;
}

function layoutSubstackNucleus(
  nucleus: TexMathSubstackNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const rows = nucleus.rows.map((row) =>
    layoutSubstackRow(row, fontProfile, baseAtPt, alphabet)
  );
  if (rows.some((row): row is null => row === null)) {
    return null;
  }
  const concreteRows = rows as readonly TexMathAlignedRowLayout[];
  if (concreteRows.length === 0) {
    return {
      items: [],
      width: 0,
      height: 0,
      depth: 0,
      italicCorrection: 0,
      isCharacterNucleus: false,
      sourceSpan: nucleus.sourceSpan,
    };
  }

  const width = roundTexPt(Math.max(...concreteRows.map((row) => row.cells[0]?.hlist.width ?? 0)));
  const baselineOffsets = substackRowBaselineOffsets(concreteRows, fontProfile, baseAtPt);
  const lastRow = concreteRows[concreteRows.length - 1];
  const naturalHeight = roundTexPt(
    concreteRows[0].height +
    (baselineOffsets[baselineOffsets.length - 1] ?? 0) +
    lastRow.depth
  );
  const axis = mathParameterToPt(fontProfile, "axisHeight", style, baseAtPt);
  const height = roundTexPt(naturalHeight / 2 + axis);
  const depth = roundTexPt(naturalHeight - height);
  let baselineY = roundTexPt(-height + concreteRows[0].height);
  const rowItems: TexMathChildHListLayoutItem[] = [];

  for (const [rowIndex, row] of concreteRows.entries()) {
    const cell = row.cells[0];
    const rowChildren = cell
      ? [childHList(
          "substack-cell",
          roundTexPt((width - cell.hlist.width) / 2),
          0,
          cell.hlist,
          cell.sourceSpan
        )]
      : [];
    rowItems.push({
      kind: "hlist",
      role: "substack-row",
      x: 0,
      y: baselineY,
      width,
      height: row.height,
      depth: row.depth,
      sourceSpan: row.sourceSpan,
      items: rowChildren,
    });
    baselineY = roundTexPt(-height + concreteRows[0].height + (baselineOffsets[rowIndex + 1] ?? 0));
  }

  return {
    items: rowItems,
    width,
    height,
    depth,
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutSubstackRow(
  row: TexMathAlignedRow,
  fontProfile: TexMathFontProfile,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAlignedRowLayout | null {
  const cell = row.cells[0];
  const result = cell
    ? layoutTexMathList(cell.list, { fontProfile, style: TEX_SUBSTACK_STYLE, baseAtPt, alphabet })
    : null;
  if (!result?.supported) {
    return null;
  }
  return {
    cells: [{
      hlist: result.hlist,
      sourceSpan: cell.sourceSpan,
    }],
    sourceSpan: row.sourceSpan,
    height: result.hlist.height,
    depth: result.hlist.depth,
  };
}

function layoutSubarrayNucleus(
  nucleus: TexMathSubarrayNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const rows = nucleus.rows.map((row) =>
    layoutSubstackRow(row, fontProfile, baseAtPt, alphabet)
  );
  if (rows.some((row): row is null => row === null)) {
    return null;
  }
  const concreteRows = rows as readonly TexMathAlignedRowLayout[];
  if (concreteRows.length === 0) {
    return {
      items: [],
      width: 0,
      height: 0,
      depth: 0,
      italicCorrection: 0,
      isCharacterNucleus: false,
      sourceSpan: nucleus.sourceSpan,
    };
  }

  const width = roundTexPt(Math.max(...concreteRows.map((row) => row.cells[0]?.hlist.width ?? 0)));
  const baselineOffsets = substackRowBaselineOffsets(concreteRows, fontProfile, baseAtPt);
  const lastRow = concreteRows[concreteRows.length - 1];
  const naturalHeight = roundTexPt(
    concreteRows[0].height +
    (baselineOffsets[baselineOffsets.length - 1] ?? 0) +
    lastRow.depth
  );
  const axis = mathParameterToPt(fontProfile, "axisHeight", style, baseAtPt);
  const height = roundTexPt(naturalHeight / 2 + axis);
  const depth = roundTexPt(naturalHeight - height);
  let baselineY = roundTexPt(-height + concreteRows[0].height);
  const rowItems: TexMathChildHListLayoutItem[] = [];

  for (const [rowIndex, row] of concreteRows.entries()) {
    const cell = row.cells[0];
    const cellX = cell
      ? subarrayCellX(nucleus.columnAlignment, width, cell.hlist.width)
      : 0;
    const rowChildren = cell
      ? [childHList(
          "subarray-cell",
          cellX,
          0,
          cell.hlist,
          cell.sourceSpan
        )]
      : [];
    rowItems.push({
      kind: "hlist",
      role: "subarray-row",
      x: 0,
      y: baselineY,
      width,
      height: row.height,
      depth: row.depth,
      sourceSpan: row.sourceSpan,
      items: rowChildren,
    });
    baselineY = roundTexPt(-height + concreteRows[0].height + (baselineOffsets[rowIndex + 1] ?? 0));
  }

  return {
    items: rowItems,
    width,
    height,
    depth,
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function subarrayCellX(
  alignment: TexMathSubarrayNucleus["columnAlignment"],
  width: number,
  cellWidth: number
): number {
  return alignment === "center" ? roundTexPt((width - cellWidth) / 2) : 0;
}

function substackRowBaselineOffsets(
  rows: readonly TexMathAlignedRowLayout[],
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): readonly number[] {
  const baselineSkip = roundTexPt(
    mathStyleParameterToPt(fontProfile, "stackNumUp", TEX_SUBSTACK_STYLE, baseAtPt) +
    mathStyleParameterToPt(fontProfile, "stackDenomDown", TEX_SUBSTACK_STYLE, baseAtPt)
  );
  const lineSkip = mathStyleParameterToPt(fontProfile, "stackVGap", TEX_SUBSTACK_STYLE, baseAtPt);
  const offsets = [0];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const previous = rows[rowIndex - 1];
    const current = rows[rowIndex];
    const naturalDistance = roundTexPt(previous.depth + current.height);
    const baselineDistance = baselineSkip - naturalDistance >= lineSkip
      ? baselineSkip
      : roundTexPt(naturalDistance + lineSkip);
    offsets.push(roundTexPt((offsets[rowIndex - 1] ?? 0) + baselineDistance));
  }
  return offsets;
}

function layoutMatrixNucleus(
  nucleus: TexMathMatrixNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const body = layoutMatrixBody(nucleus, fontProfile, baseAtPt, alphabet);
  if (!body) {
    return null;
  }
  if (nucleus.environment === "matrix") {
    return body;
  }
  return wrapMatrixWithDelimiters(body, nucleus.environment, fontProfile, style, baseAtPt, nucleus);
}

function layoutCasesNucleus(
  nucleus: TexMathCasesNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const body = layoutCasesBody(nucleus, fontProfile, baseAtPt, alphabet);
  if (!body) {
    return null;
  }
  return wrapCasesWithDelimiters(body, nucleus, fontProfile, style, baseAtPt);
}

function layoutCasesBody(
  nucleus: TexMathCasesNucleus,
  fontProfile: TexMathFontProfile,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const rowHeight = roundTexPt(TEX_ALIGNED_ROW_HEIGHT_PT * TEX_CASES_ARRAY_STRETCH);
  const rowDepth = roundTexPt(TEX_ALIGNED_ROW_DEPTH_PT * TEX_CASES_ARRAY_STRETCH);
  const rows = nucleus.rows.map((row) =>
    layoutMatrixRow(row, fontProfile, baseAtPt, alphabet, rowHeight, rowDepth)
  );
  if (
    rows.some((row): row is null => row === null) ||
    nucleus.rows.some((row) => row.cells.length > 2)
  ) {
    return null;
  }
  const concreteRows = rows as readonly TexMathAlignedRowLayout[];
  if (concreteRows.length === 0) {
    return {
      items: [],
      width: 0,
      height: 0,
      depth: 0,
      italicCorrection: 0,
      isCharacterNucleus: false,
      sourceSpan: nucleus.sourceSpan,
    };
  }

  const firstColumnWidth = roundTexPt(Math.max(0, ...concreteRows.map((row) => row.cells[0]?.hlist.width ?? 0)));
  const secondColumnWidth = roundTexPt(Math.max(0, ...concreteRows.map((row) => row.cells[1]?.hlist.width ?? 0)));
  const hasSecondColumn = concreteRows.some((row) => row.cells.length > 1);
  const width = roundTexPt(firstColumnWidth + (hasSecondColumn ? TEX_CASES_COLUMN_GAP_PT + secondColumnWidth : 0));
  const baselineOffsets = matrixRowBaselineOffsets(concreteRows);
  const lastRow = concreteRows[concreteRows.length - 1];
  const naturalHeight = roundTexPt(
    concreteRows[0].height +
    (baselineOffsets[baselineOffsets.length - 1] ?? 0) +
    lastRow.depth
  );
  const axis = mathParameterToPt(fontProfile, "axisHeight", "text", baseAtPt);
  const height = roundTexPt(naturalHeight / 2 + axis);
  const depth = roundTexPt(naturalHeight - height);
  let baselineY = roundTexPt(-height + concreteRows[0].height);
  const rowItems: TexMathChildHListLayoutItem[] = [];

  for (const [rowIndex, row] of concreteRows.entries()) {
    const rowChildren: TexMathHListItem[] = [];
    const firstCell = row.cells[0];
    const secondCell = row.cells[1];
    if (firstCell) {
      rowChildren.push(childHList(
        "cases-cell",
        0,
        0,
        firstCell.hlist,
        firstCell.sourceSpan
      ));
    }
    if (secondCell) {
      rowChildren.push(childHList(
        "cases-cell",
        roundTexPt(firstColumnWidth + TEX_CASES_COLUMN_GAP_PT),
        0,
        secondCell.hlist,
        secondCell.sourceSpan
      ));
    }
    rowItems.push({
      kind: "hlist",
      role: "cases-row",
      x: 0,
      y: baselineY,
      width,
      height: row.height,
      depth: row.depth,
      sourceSpan: row.sourceSpan,
      items: rowChildren,
    });
    baselineY = roundTexPt(-height + concreteRows[0].height + (baselineOffsets[rowIndex + 1] ?? 0));
  }

  return {
    items: rowItems,
    width,
    height,
    depth,
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutArrayNucleus(
  nucleus: TexMathArrayNucleus,
  fontProfile: TexMathFontProfile,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const rows = nucleus.rows.map((row) =>
    layoutMatrixRow(row, fontProfile, baseAtPt, alphabet)
  );
  if (
    rows.some((row): row is null => row === null) ||
    nucleus.rows.some((row) => row.cells.length > nucleus.columnAlignments.length)
  ) {
    return null;
  }
  const concreteRows = rows as readonly TexMathAlignedRowLayout[];
  if (concreteRows.length === 0 || nucleus.columnAlignments.length === 0) {
    return {
      items: [],
      width: 0,
      height: 0,
      depth: 0,
      italicCorrection: 0,
      isCharacterNucleus: false,
      sourceSpan: nucleus.sourceSpan,
    };
  }

  const columnCount = nucleus.columnAlignments.length;
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(0, ...concreteRows.map((row) => row.cells[columnIndex]?.hlist.width ?? 0))
  ).map(roundTexPt);
  const width = roundTexPt(
    columnWidths.reduce((sum, columnWidth) => sum + columnWidth, 0) +
    columnCount * 2 * TEX_MATRIX_ARRAY_COL_SEP_PT
  );
  const baselineOffsets = matrixRowBaselineOffsets(concreteRows);
  const lastRow = concreteRows[concreteRows.length - 1];
  const naturalHeight = roundTexPt(
    concreteRows[0].height +
    (baselineOffsets[baselineOffsets.length - 1] ?? 0) +
    lastRow.depth
  );
  const axis = mathParameterToPt(fontProfile, "axisHeight", "text", baseAtPt);
  const height = roundTexPt(naturalHeight / 2 + axis);
  const depth = roundTexPt(naturalHeight - height);
  let baselineY = roundTexPt(-height + concreteRows[0].height);
  const rowItems: TexMathChildHListLayoutItem[] = [];

  for (const [rowIndex, row] of concreteRows.entries()) {
    const rowChildren: TexMathHListItem[] = [];
    let cursor = 0;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const columnWidth = columnWidths[columnIndex] ?? 0;
      const cell = row.cells[columnIndex];
      cursor = roundTexPt(cursor + TEX_MATRIX_ARRAY_COL_SEP_PT);
      if (cell) {
        rowChildren.push(childHList(
          "array-cell",
          roundTexPt(cursor + arrayCellOffset(
            nucleus.columnAlignments[columnIndex] ?? "center",
            columnWidth,
            cell.hlist.width
          )),
          0,
          cell.hlist,
          cell.sourceSpan
        ));
      }
      cursor = roundTexPt(cursor + columnWidth + TEX_MATRIX_ARRAY_COL_SEP_PT);
    }
    rowItems.push({
      kind: "hlist",
      role: "array-row",
      x: 0,
      y: baselineY,
      width,
      height: row.height,
      depth: row.depth,
      sourceSpan: row.sourceSpan,
      items: rowChildren,
    });
    baselineY = roundTexPt(-height + concreteRows[0].height + (baselineOffsets[rowIndex + 1] ?? 0));
  }

  return {
    items: rowItems,
    width,
    height,
    depth,
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutSmallMatrixNucleus(
  nucleus: TexMathSmallMatrixNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const rows = nucleus.rows.map((row) =>
    layoutSmallMatrixRow(row, fontProfile, baseAtPt, alphabet)
  );
  if (rows.some((row): row is null => row === null)) {
    return null;
  }
  const concreteRows = rows as readonly TexMathAlignedRowLayout[];
  const outerGap = muToPt(fontProfile, style, baseAtPt, 3);
  if (concreteRows.length === 0) {
    return {
      items: [],
      width: roundTexPt(outerGap * 2),
      height: 0,
      depth: 0,
      italicCorrection: 0,
      isCharacterNucleus: false,
      sourceSpan: nucleus.sourceSpan,
    };
  }

  const columnCount = Math.max(...concreteRows.map((row) => row.cells.length));
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(0, ...concreteRows.map((row) => row.cells[columnIndex]?.hlist.width ?? 0))
  ).map(roundTexPt);
  const columnGap = muToPt(fontProfile, style, baseAtPt, 5);
  const bodyWidth = roundTexPt(
    columnWidths.reduce((sum, columnWidth) => sum + columnWidth, 0) +
    Math.max(0, columnCount - 1) * columnGap
  );
  const width = roundTexPt(outerGap + bodyWidth + outerGap);
  const baselineOffsets = smallMatrixRowBaselineOffsets(concreteRows);
  const lastRow = concreteRows[concreteRows.length - 1];
  const naturalHeight = roundTexPt(
    concreteRows[0].height +
    (baselineOffsets[baselineOffsets.length - 1] ?? 0) +
    lastRow.depth
  );
  const axis = mathParameterToPt(fontProfile, "axisHeight", style, baseAtPt);
  const height = roundTexPt(naturalHeight / 2 + axis);
  const depth = roundTexPt(naturalHeight - height);
  let baselineY = roundTexPt(-height + concreteRows[0].height);
  const items: TexMathHListItem[] = [{
    kind: "glue",
    x: 0,
    width: outerGap,
    mu: 3,
    stretch: 0,
    shrink: 0,
    source: "explicit",
    sourceSpan: nucleus.beginSourceSpan,
  }];

  for (const [rowIndex, row] of concreteRows.entries()) {
    const rowChildren: TexMathHListItem[] = [];
    let cursor = outerGap;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const columnWidth = columnWidths[columnIndex] ?? 0;
      const cell = row.cells[columnIndex];
      if (cell) {
        rowChildren.push(childHList(
          "smallmatrix-cell",
          roundTexPt(cursor - outerGap + (columnWidth - cell.hlist.width) / 2),
          0,
          cell.hlist,
          cell.sourceSpan
        ));
      }
      cursor = roundTexPt(cursor + columnWidth);
      if (columnIndex < columnCount - 1) {
        cursor = roundTexPt(cursor + columnGap);
      }
    }
    items.push({
      kind: "hlist",
      role: "smallmatrix-row",
      x: outerGap,
      y: baselineY,
      width: bodyWidth,
      height: row.height,
      depth: row.depth,
      sourceSpan: row.sourceSpan,
      items: rowChildren,
    });
    baselineY = roundTexPt(-height + concreteRows[0].height + (baselineOffsets[rowIndex + 1] ?? 0));
  }

  items.push({
    kind: "glue",
    x: roundTexPt(outerGap + bodyWidth),
    width: outerGap,
    mu: 3,
    stretch: 0,
    shrink: 0,
    source: "explicit",
    sourceSpan: nucleus.endSourceSpan ?? nucleus.sourceSpan,
  });

  return {
    items,
    width,
    height,
    depth,
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutMatrixBody(
  nucleus: TexMathMatrixNucleus,
  fontProfile: TexMathFontProfile,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const rows = nucleus.rows.map((row) =>
    layoutMatrixRow(row, fontProfile, baseAtPt, alphabet)
  );
  if (rows.some((row): row is null => row === null)) {
    return null;
  }
  const concreteRows = rows as readonly TexMathAlignedRowLayout[];
  if (concreteRows.length === 0) {
    return {
      items: [],
      width: 0,
      height: 0,
      depth: 0,
      italicCorrection: 0,
      isCharacterNucleus: false,
      sourceSpan: nucleus.sourceSpan,
    };
  }

  const columnCount = Math.max(...concreteRows.map((row) => row.cells.length));
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(0, ...concreteRows.map((row) => row.cells[columnIndex]?.hlist.width ?? 0))
  ).map(roundTexPt);
  const width = roundTexPt(
    columnWidths.reduce((sum, columnWidth) => sum + columnWidth, 0) +
    Math.max(0, columnCount - 1) * 2 * TEX_MATRIX_ARRAY_COL_SEP_PT
  );
  const baselineOffsets = matrixRowBaselineOffsets(concreteRows);
  const lastRow = concreteRows[concreteRows.length - 1];
  const naturalHeight = roundTexPt(
    concreteRows[0].height +
    (baselineOffsets[baselineOffsets.length - 1] ?? 0) +
    lastRow.depth
  );
  const axis = mathParameterToPt(fontProfile, "axisHeight", "text", baseAtPt);
  const height = roundTexPt(naturalHeight / 2 + axis);
  const depth = roundTexPt(naturalHeight - height);
  let baselineY = roundTexPt(-height + concreteRows[0].height);
  const rowItems: TexMathChildHListLayoutItem[] = [];

  for (const [rowIndex, row] of concreteRows.entries()) {
    const rowChildren: TexMathHListItem[] = [];
    let cursor = 0;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const columnWidth = columnWidths[columnIndex] ?? 0;
      const cell = row.cells[columnIndex];
      if (cell) {
        rowChildren.push(childHList(
          "matrix-cell",
          roundTexPt(cursor + (columnWidth - cell.hlist.width) / 2),
          0,
          cell.hlist,
          cell.sourceSpan
        ));
      }
      cursor = roundTexPt(cursor + columnWidth);
      if (columnIndex < columnCount - 1) {
        cursor = roundTexPt(cursor + 2 * TEX_MATRIX_ARRAY_COL_SEP_PT);
      }
    }
    rowItems.push({
      kind: "hlist",
      role: "matrix-row",
      x: 0,
      y: baselineY,
      width,
      height: row.height,
      depth: row.depth,
      sourceSpan: row.sourceSpan,
      items: rowChildren,
    });
    baselineY = roundTexPt(-height + concreteRows[0].height + (baselineOffsets[rowIndex + 1] ?? 0));
  }

  return {
    items: rowItems,
    width,
    height,
    depth,
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutSmallMatrixRow(
  row: TexMathAlignedRow,
  fontProfile: TexMathFontProfile,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAlignedRowLayout | null {
  const cells = row.cells.map((cell) => {
    const result = layoutTexMathList(cell.list, { fontProfile, style: "script", baseAtPt, alphabet });
    return result.supported
      ? {
          hlist: result.hlist,
          sourceSpan: cell.sourceSpan,
        }
      : null;
  });
  if (cells.some((cell): cell is null => cell === null)) {
    return null;
  }
  const concreteCells = cells as readonly TexMathAlignedCellLayout[];
  return {
    cells: concreteCells,
    sourceSpan: row.sourceSpan,
    height: roundTexPt(Math.max(0, ...concreteCells.map((cell) => cell.hlist.height))),
    depth: roundTexPt(Math.max(0, ...concreteCells.map((cell) => cell.hlist.depth))),
  };
}

function smallMatrixRowBaselineOffsets(rows: readonly TexMathAlignedRowLayout[]): readonly number[] {
  const offsets = [0];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const previous = rows[rowIndex - 1];
    const current = rows[rowIndex];
    const naturalDistance = roundTexPt(previous.depth + current.height);
    const baselineDistance = TEX_SMALLMATRIX_BASELINE_SKIP_PT - naturalDistance >= TEX_SMALLMATRIX_LINE_SKIP_PT
      ? TEX_SMALLMATRIX_BASELINE_SKIP_PT
      : roundTexPt(naturalDistance + TEX_SMALLMATRIX_LINE_SKIP_PT);
    offsets.push(roundTexPt((offsets[rowIndex - 1] ?? 0) + baselineDistance));
  }
  return offsets;
}

function arrayCellOffset(
  alignment: TexMathArrayColumnAlignment,
  columnWidth: number,
  cellWidth: number
): number {
  switch (alignment) {
    case "left":
      return 0;
    case "right":
      return columnWidth - cellWidth;
    case "center":
      return (columnWidth - cellWidth) / 2;
  }
}

function layoutMatrixRow(
  row: TexMathAlignedRow,
  fontProfile: TexMathFontProfile,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand,
  minimumHeight = TEX_ALIGNED_ROW_HEIGHT_PT,
  minimumDepth = TEX_ALIGNED_ROW_DEPTH_PT
): TexMathAlignedRowLayout | null {
  const cellStyle: TexMathStyle = "text";
  const cells = row.cells.map((cell) => {
    const result = layoutTexMathList(cell.list, { fontProfile, style: cellStyle, baseAtPt, alphabet });
    return result.supported
      ? {
          hlist: result.hlist,
          sourceSpan: cell.sourceSpan,
        }
      : null;
  });
  if (cells.some((cell): cell is null => cell === null)) {
    return null;
  }
  const concreteCells = cells as readonly TexMathAlignedCellLayout[];
  return {
    cells: concreteCells,
    sourceSpan: row.sourceSpan,
    height: roundTexPt(Math.max(minimumHeight, ...concreteCells.map((cell) => cell.hlist.height))),
    depth: roundTexPt(Math.max(minimumDepth, ...concreteCells.map((cell) => cell.hlist.depth))),
  };
}

function matrixRowBaselineOffsets(rows: readonly TexMathAlignedRowLayout[]): readonly number[] {
  const offsets = [0];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const previous = rows[rowIndex - 1];
    const current = rows[rowIndex];
    offsets.push(roundTexPt(
      offsets[rowIndex - 1] +
      previous.depth +
      current.height
    ));
  }
  return offsets;
}

function wrapMatrixWithDelimiters(
  body: TexMathAtomLayout,
  environment: TexMathMatrixEnvironment,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  nucleus: TexMathMatrixNucleus
): TexMathAtomLayout | null {
  const delimiters = matrixDelimiters(environment);
  if (!delimiters) {
    return body;
  }
  const delimiterStyle = delimiterSizeStyle(style);
  const axis = mathParameterToPt(fontProfile, "axisHeight", delimiterStyle, baseAtPt);
  const targetHeight = leftRightDelimiterTarget(body.height, body.depth, axis);
  const left = layoutMathDelimiter(
    delimiters.left,
    fontProfile,
    delimiterStyle,
    baseAtPt,
    targetHeight,
    axis,
    nucleus.beginSourceSpan
  );
  const right = layoutMathDelimiter(
    delimiters.right,
    fontProfile,
    delimiterStyle,
    baseAtPt,
    targetHeight,
    axis,
    nucleus.endSourceSpan ?? nucleus.sourceSpan
  );
  if (!left || !right) {
    return null;
  }

  const bodyHList: TexMathHList = {
    kind: "math-hlist",
    style: "text",
    items: body.items,
    width: body.width,
    height: body.height,
    depth: body.depth,
    sourceSpan: nucleus.sourceSpan,
  };
  const bodyChild = childHList("nucleus", left.width, 0, bodyHList, nucleus.sourceSpan);
  const shiftedRight = offsetDelimiterItems(right.items, roundTexPt(left.width + body.width), 0);
  const items = [
    ...left.items,
    bodyChild,
    ...shiftedRight,
  ];
  const width = roundTexPt(left.width + body.width + right.width);
  const height = Math.max(
    body.height,
    ...left.items.map((item) => -item.y + item.height),
    ...shiftedRight.map((item) => -item.y + item.height)
  );
  const depth = Math.max(
    body.depth,
    ...left.items.map((item) => item.y + item.depth),
    ...shiftedRight.map((item) => item.y + item.depth)
  );

  return {
    items,
    width,
    height: roundTexPt(height),
    depth: roundTexPt(Math.max(0, depth)),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function wrapCasesWithDelimiters(
  body: TexMathAtomLayout,
  nucleus: TexMathCasesNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  const delimiterStyle = delimiterSizeStyle(style);
  const axis = mathParameterToPt(fontProfile, "axisHeight", delimiterStyle, baseAtPt);
  const targetHeight = leftRightDelimiterTarget(body.height, body.depth, axis);
  const left = layoutMathDelimiter(
    "lbrace",
    fontProfile,
    delimiterStyle,
    baseAtPt,
    targetHeight,
    axis,
    nucleus.beginSourceSpan
  );
  const right = layoutMathDelimiter(
    ".",
    fontProfile,
    delimiterStyle,
    baseAtPt,
    targetHeight,
    axis,
    nucleus.endSourceSpan ?? nucleus.sourceSpan
  );
  if (!left || !right) {
    return null;
  }

  const bodyHList: TexMathHList = {
    kind: "math-hlist",
    style: "text",
    items: body.items,
    width: body.width,
    height: body.height,
    depth: body.depth,
    sourceSpan: nucleus.sourceSpan,
  };
  const bodyChild = childHList("nucleus", left.width, 0, bodyHList, nucleus.sourceSpan);
  const shiftedRight = offsetDelimiterItems(right.items, roundTexPt(left.width + body.width), 0);
  const items = [
    ...left.items,
    bodyChild,
    ...shiftedRight,
  ];
  const width = roundTexPt(left.width + body.width + right.width);
  const height = Math.max(
    body.height,
    ...left.items.map((item) => -item.y + item.height),
    ...shiftedRight.map((item) => -item.y + item.height)
  );
  const depth = Math.max(
    body.depth,
    ...left.items.map((item) => item.y + item.depth),
    ...shiftedRight.map((item) => item.y + item.depth)
  );

  return {
    items,
    width,
    height: roundTexPt(height),
    depth: roundTexPt(Math.max(0, depth)),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function matrixDelimiters(
  environment: TexMathMatrixEnvironment
): { left: TexMathDelimiter; right: TexMathDelimiter } | null {
  switch (environment) {
    case "matrix":
      return null;
    case "pmatrix":
      return { left: "(", right: ")" };
    case "bmatrix":
      return { left: "[", right: "]" };
    case "Bmatrix":
      return { left: "lbrace", right: "rbrace" };
    case "vmatrix":
      return { left: "vert", right: "vert" };
    case "Vmatrix":
      return { left: "Vert", right: "Vert" };
  }
}

function alignCellHList(
  hlist: TexMathHList,
  list: TexMathList,
  columnIndex: number,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathHList {
  if (columnIndex % 2 === 0) {
    return hlist;
  }
  const firstAtom = list.items.find((item): item is TexMathAtom => item.kind === "atom");
  if (!firstAtom) {
    return hlist;
  }
  const emptyOrd: TexMathAtom = {
    kind: "atom",
    atomClass: "ord",
    nucleus: {
      kind: "list",
      list: emptyListForSpan(firstAtom.sourceSpan),
      sourceSpan: firstAtom.sourceSpan,
    },
    sourceSpan: {
      start: firstAtom.sourceSpan.start,
      end: firstAtom.sourceSpan.start,
    },
  };
  const glue = texMathSpacingBetween(emptyOrd, firstAtom, style);
  if (!glue) {
    return hlist;
  }
  const width = muToPt(fontProfile, style, baseAtPt, glue.mu);
  return {
    ...hlist,
    width: roundTexPt(hlist.width + width),
    items: [
      {
        kind: "glue",
        x: 0,
        width,
        mu: glue.mu,
        stretch: muToPt(fontProfile, style, baseAtPt, glue.stretchMu),
        shrink: muToPt(fontProfile, style, baseAtPt, glue.shrinkMu),
        source: glue.source,
        sourceSpan: glue.sourceSpan,
      },
      ...hlist.items.map((item) => offsetMathLayoutItem(item, width)),
    ],
  };
}

function emptyListForSpan(sourceSpan: TexMathSourceSpan): TexMathList {
  return {
    kind: "math-list",
    items: [],
    sourceSpan: {
      start: sourceSpan.start,
      end: sourceSpan.start,
    },
  };
}

function layoutFractionNucleus(
  nucleus: Extract<TexMathNucleus, { readonly kind: "fraction" }>,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const fractionStyle = nucleus.style ?? style;
  const fractionCramped = nucleus.style ? false : cramped;
  const numerator = layoutFractionList(
    nucleus.numerator,
    fontProfile,
    numeratorStyle(fractionStyle),
    fractionCramped,
    baseAtPt,
    alphabet
  );
  const denominator = layoutFractionList(
    nucleus.denominator,
    fontProfile,
    denominatorStyle(fractionStyle),
    true,
    baseAtPt,
    alphabet
  );
  if (!numerator || !denominator) {
    return null;
  }

  const numeratorWithStrut = nucleus.continued
    ? hlistWithMinimumHeightDepth(
      numerator,
      TEX_LATEX_STRUT_HEIGHT_PT * (baseAtPt / 10),
      TEX_LATEX_STRUT_DEPTH_PT * (baseAtPt / 10)
    )
    : numerator;
  const fractionWidth = roundTexPt(Math.max(numeratorWithStrut.width, denominator.width));
  const leftDelimiter = nucleus.leftDelimiter ?? ".";
  const rightDelimiter = nucleus.rightDelimiter ?? ".";
  const hasVisibleDelimiters = leftDelimiter !== "." || rightDelimiter !== ".";
  const bodyX = hasVisibleDelimiters ? 0 : TEX_NULL_DELIMITER_SPACE_PT;
  const defaultRuleThickness = mathExtensionParameterToPt(fontProfile, "defaultRuleThickness", fractionStyle, baseAtPt);
  const thickness = nucleus.ruleThickness ?? defaultRuleThickness;
  const axis = mathParameterToPt(fontProfile, "axisHeight", fractionStyle, baseAtPt);
  let shiftUp: number;
  let shiftDown: number;
  if (fractionStyle === "display") {
    shiftUp = mathParameterToPt(fontProfile, "num1", fractionStyle, baseAtPt);
    shiftDown = mathParameterToPt(fontProfile, "denom1", fractionStyle, baseAtPt);
  } else {
    shiftUp = mathParameterToPt(fontProfile, thickness === 0 ? "num3" : "num2", fractionStyle, baseAtPt);
    shiftDown = mathParameterToPt(fontProfile, "denom2", fractionStyle, baseAtPt);
  }

  if (thickness === 0) {
    const clearance = fractionStyle === "display" ? 7 * defaultRuleThickness : 3 * defaultRuleThickness;
    const delta = (clearance - ((shiftUp - numeratorWithStrut.depth) - (denominator.height - shiftDown))) / 2;
    if (delta > 0) {
      shiftUp += delta;
      shiftDown += delta;
    }
  } else {
    const halfThickness = thickness / 2;
    const clearance = fractionStyle === "display" ? 3 * thickness : thickness;
    const delta1 = clearance - ((shiftUp - numeratorWithStrut.depth) - (axis + halfThickness));
    const delta2 = clearance - ((axis - halfThickness) - (denominator.height - shiftDown));
    if (delta1 > 0) {
      shiftUp += delta1;
    }
    if (delta2 > 0) {
      shiftDown += delta2;
    }
  }

  const reboxedNumerator = reboxSingleCharacterItalicCorrection(numeratorWithStrut, fractionWidth);
  const reboxedDenominator = reboxSingleCharacterItalicCorrection(denominator, fractionWidth);
  const numeratorX = numeratorAlignmentOffset(
    nucleus.continued?.numeratorAlignment ?? "center",
    fractionWidth,
    numeratorWithStrut.width
  );

  const numeratorChild = childHList(
    "nucleus",
    bodyX + numeratorX,
    -shiftUp,
    reboxedNumerator,
    numeratorWithStrut.sourceSpan
  );
  const denominatorChild = childHList(
    "nucleus",
    bodyX + (fractionWidth - denominator.width) / 2,
    shiftDown,
    reboxedDenominator,
    denominator.sourceSpan
  );
  const bodyItems: TexMathHListItem[] = [numeratorChild];
  if (thickness !== 0) {
    bodyItems.push({
      kind: "rule",
      role: "fraction-rule",
      x: bodyX,
      y: roundTexPt(-(axis + thickness / 2)),
      width: fractionWidth,
      height: roundTexPt(thickness),
      sourceSpan: nucleus.sourceSpan,
    } satisfies TexMathRuleLayoutItem);
  }
  bodyItems.push(denominatorChild);

  const bodyWidth = roundTexPt(fractionWidth + (hasVisibleDelimiters ? 0 : 2 * TEX_NULL_DELIMITER_SPACE_PT));
  const height = roundTexPt(shiftUp + numeratorWithStrut.height);
  const depth = roundTexPt(denominator.depth + shiftDown);

  if (hasVisibleDelimiters) {
    return wrapFractionWithDelimiters({
      items: bodyItems,
      width: bodyWidth,
      height,
      depth,
      leftDelimiter,
      rightDelimiter,
      fontProfile,
      style: fractionStyle,
      baseAtPt,
      sourceSpan: nucleus.sourceSpan,
    });
  }

  if (nucleus.continued) {
    bodyItems.push({
      kind: "kern",
      x: bodyWidth,
      width: -TEX_NULL_DELIMITER_SPACE_PT,
      reason: "fraction-kern",
      sourceSpan: nucleus.sourceSpan,
    });
  }

  return {
    items: bodyItems,
    width: roundTexPt(bodyWidth + (nucleus.continued ? -TEX_NULL_DELIMITER_SPACE_PT : 0)),
    height,
    depth,
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function wrapFractionWithDelimiters(params: {
  readonly items: readonly TexMathHListItem[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly leftDelimiter: TexMathDelimiter;
  readonly rightDelimiter: TexMathDelimiter;
  readonly fontProfile: TexMathFontProfile;
  readonly style: TexMathStyle;
  readonly baseAtPt: number;
  readonly sourceSpan: TexMathSourceSpan;
}): TexMathAtomLayout | null {
  const delimiterStyle = delimiterSizeStyle(params.style);
  const targetHeight = mathParameterToPt(
    params.fontProfile,
    params.style === "display" ? "delim1" : "delim2",
    params.style,
    params.baseAtPt
  );
  const axis = mathParameterToPt(params.fontProfile, "axisHeight", params.style, params.baseAtPt);
  const left = layoutMathDelimiter(
    params.leftDelimiter,
    params.fontProfile,
    delimiterStyle,
    params.baseAtPt,
    targetHeight,
    axis,
    params.sourceSpan
  );
  const right = layoutMathDelimiter(
    params.rightDelimiter,
    params.fontProfile,
    delimiterStyle,
    params.baseAtPt,
    targetHeight,
    axis,
    params.sourceSpan
  );
  if (!left || !right) {
    return null;
  }

  const bodyHList: TexMathHList = {
    kind: "math-hlist",
    style: params.style,
    items: params.items,
    width: params.width,
    height: params.height,
    depth: params.depth,
    sourceSpan: params.sourceSpan,
  };
  const bodyChild = childHList("nucleus", left.width, 0, bodyHList, params.sourceSpan);
  const shiftedRight = offsetDelimiterItems(right.items, roundTexPt(left.width + params.width), 0);
  const items = [
    ...left.items,
    bodyChild,
    ...shiftedRight,
  ];
  const width = roundTexPt(left.width + params.width + right.width);
  const height = Math.max(
    params.height,
    ...left.items.map((item) => -item.y + item.height),
    ...shiftedRight.map((item) => -item.y + item.height)
  );
  const depth = Math.max(
    params.depth,
    ...left.items.map((item) => item.y + item.depth),
    ...shiftedRight.map((item) => item.y + item.depth)
  );

  return {
    items,
    width,
    height: roundTexPt(height),
    depth: roundTexPt(Math.max(0, depth)),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: params.sourceSpan,
  };
}

function layoutFractionList(
  list: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathHList | null {
  const result = layoutTexMathList(list, { fontProfile, style, cramped, baseAtPt, alphabet });
  return result.supported ? omitSingleCharacterCleanBoxItalicCorrection(result.hlist, list) : null;
}

function hlistWithMinimumHeightDepth(
  hlist: TexMathHList,
  minHeight: number,
  minDepth: number
): TexMathHList {
  return {
    ...hlist,
    height: roundTexPt(Math.max(hlist.height, minHeight)),
    depth: roundTexPt(Math.max(hlist.depth, minDepth)),
  };
}

function numeratorAlignmentOffset(
  alignment: "left" | "center" | "right",
  fractionWidth: number,
  numeratorWidth: number
): number {
  if (alignment === "left") {
    return 0;
  }
  if (alignment === "right") {
    return roundTexPt(fractionWidth - numeratorWidth);
  }
  return roundTexPt((fractionWidth - numeratorWidth) / 2);
}

function layoutRadicalNucleus(
  nucleus: Extract<TexMathNucleus, { readonly kind: "radical" }>,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  _cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const radicand = layoutRadicandList(nucleus.radicand, fontProfile, style, true, baseAtPt, alphabet);
  if (!radicand) {
    return null;
  }

  const thickness = mathExtensionParameterToPt(fontProfile, "defaultRuleThickness", style, baseAtPt);
  let clearance = radicalInitialClearance(fontProfile, style, baseAtPt, thickness);
  const targetHeight = radicand.height + radicand.depth + clearance + thickness;
  const delimiter = selectRadicalDelimiter(fontProfile, style, baseAtPt, targetHeight, nucleus.sourceSpan);
  if (!delimiter) {
    return null;
  }
  const delta = delimiter.depth - (radicand.height + radicand.depth + clearance);
  if (delta > 0) {
    clearance += delta / 2;
  }
  const overbarThickness = delimiter.height;
  const radicalY = roundTexPt(-(radicand.height + clearance));
  const ruleY = roundTexPt(radicalY - overbarThickness);
  const radicalItems = delimiter.items.map((item) => ({
    ...item,
    y: roundTexPt(item.y + radicalY),
  })) satisfies readonly TexMathGlyphLayoutItem[];
  const rule = {
    kind: "rule",
    role: "radical-rule",
    x: delimiter.width,
    y: ruleY,
    width: radicand.width,
    height: roundTexPt(overbarThickness),
    sourceSpan: nucleus.sourceSpan,
  } satisfies TexMathRuleLayoutItem;
  const radicandChild = childHList(
    "nucleus",
    delimiter.width,
    0,
    radicand,
    nucleus.radicand.sourceSpan
  );
  const height = Math.max(
    radicand.height,
    ...radicalItems.map((item) => -item.y + item.height),
    -rule.y + rule.height
  );
  const depth = Math.max(
    radicand.depth,
    ...radicalItems.map((item) => item.y + item.depth)
  );

  return {
    items: [...radicalItems, rule, radicandChild],
    width: roundTexPt(delimiter.width + radicand.width),
    height: roundTexPt(height),
    depth: roundTexPt(Math.max(0, depth)),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutRadicandList(
  list: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathHList | null {
  const result = layoutTexMathList(list, { fontProfile, style, cramped, baseAtPt, alphabet });
  return result.supported ? omitSingleCharacterCleanBoxItalicCorrection(result.hlist, list) : null;
}

function layoutLineNucleus(
  nucleus: TexMathLineNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const thickness = mathExtensionParameterToPt(fontProfile, "defaultRuleThickness", style, baseAtPt);
  if (nucleus.command === "overline") {
    return layoutOverlineNucleus(nucleus, fontProfile, style, baseAtPt, thickness, alphabet);
  }
  return layoutUnderlineNucleus(nucleus, fontProfile, style, cramped, baseAtPt, thickness, alphabet);
}

function layoutOverlineNucleus(
  nucleus: TexMathLineNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  thickness: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const body = layoutLineBody(nucleus.body, fontProfile, style, true, baseAtPt, alphabet);
  if (!body) {
    return null;
  }
  const ruleY = roundTexPt(-(body.height + 4 * thickness));
  const height = roundTexPt(body.height + 5 * thickness);
  const rule = {
    kind: "rule",
    role: "overline-rule",
    x: 0,
    y: ruleY,
    width: body.width,
    height: roundTexPt(thickness),
    sourceSpan: nucleus.commandSourceSpan,
  } satisfies TexMathRuleLayoutItem;
  const bodyChild = childHList("nucleus", 0, 0, body, nucleus.body.sourceSpan);
  return {
    items: [rule, bodyChild],
    width: body.width,
    height,
    depth: body.depth,
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutUnderlineNucleus(
  nucleus: TexMathLineNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  thickness: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const body = layoutLineBody(nucleus.body, fontProfile, style, cramped, baseAtPt, alphabet);
  if (!body) {
    return null;
  }
  const ruleY = roundTexPt(body.depth + 3 * thickness);
  const rule = {
    kind: "rule",
    role: "underline-rule",
    x: 0,
    y: ruleY,
    width: body.width,
    height: roundTexPt(thickness),
    sourceSpan: nucleus.commandSourceSpan,
  } satisfies TexMathRuleLayoutItem;
  const bodyChild = childHList("nucleus", 0, 0, body, nucleus.body.sourceSpan);
  return {
    items: [bodyChild, rule],
    width: body.width,
    height: body.height,
    depth: roundTexPt(body.depth + 5 * thickness),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutLineBody(
  list: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathHList | null {
  const result = layoutTexMathList(list, { fontProfile, style, cramped, baseAtPt, alphabet });
  return result.supported ? omitSingleCharacterCleanBoxItalicCorrection(result.hlist, list) : null;
}

function layoutAccentBase(
  list: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathHList | null {
  const item = list.items.length === 1 ? list.items[0] : null;
  if (
    item?.kind === "atom" &&
    !item.subscript &&
    !item.superscript &&
    item.nucleus.kind === "glyph"
  ) {
    const nucleus = layoutGlyphNucleus(item.nucleus, fontProfile, style, baseAtPt, alphabet);
    if (!nucleus) {
      return null;
    }
    return {
      kind: "math-hlist",
      style,
      width: roundTexPt(nucleus.width + nucleus.italicCorrection),
      height: nucleus.height,
      depth: nucleus.depth,
      sourceSpan: list.sourceSpan,
      items: nucleus.items,
    };
  }

  const result = layoutTexMathList(list, { fontProfile, style, cramped, baseAtPt, alphabet });
  return result.supported ? result.hlist : null;
}

function layoutAccentNucleus(
  nucleus: Extract<TexMathNucleus, { readonly kind: "accent" }>,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  _cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  if (nucleus.command === "dddot" || nucleus.command === "ddddot") {
    return layoutMultiDotAccentNucleus(nucleus, fontProfile, style, baseAtPt, alphabet);
  }
  const base = layoutAccentBase(nucleus.base, fontProfile, style, true, baseAtPt, alphabet);
  if (!base) {
    return null;
  }
  const accent = resolveMathAccent(nucleus.command, fontProfile, style, baseAtPt, nucleus.commandSourceSpan);
  if (!accent) {
    return null;
  }

  const metric = selectAccentMetric(accent.font, accent.code, base.width);
  const accentWidth = roundTexPt(tfmToPt(accent.font, metric.width));
  const accentCenterWidth = roundTexPt(accentWidth + tfmToPt(accent.font, metric.italicCorrection));
  const accentHeight = roundTexPt(tfmToPt(accent.font, metric.height));
  const accentDepth = roundTexPt(tfmToPt(accent.font, metric.depth));
  const accentItalicCorrection = roundTexPt(tfmToPt(accent.font, metric.italicCorrection));
  const skew = accentBaseSkew(nucleus.base, fontProfile, style, baseAtPt, alphabet);
  const singleGlyphBase = accentBaseSingleGlyphMetrics(nucleus.base, fontProfile, style, baseAtPt, alphabet);
  const delta = Math.min(base.height, accentXHeight(accent.font));
  const accentX = roundTexPt(skew + (base.width - accentCenterWidth) / 2);
  const accentY = roundTexPt(delta - base.height);
  const accentItem = {
    kind: "glyph",
    fontId: accent.font.id,
    atPt: accent.font.atPt,
    family: accent.family,
    code: metric.code,
    text: `\\${nucleus.command}`,
    x: accentX,
    y: accentY,
    width: accentWidth,
    height: accentHeight,
    depth: accentDepth,
    italicCorrection: accentItalicCorrection,
    sourceSpan: nucleus.commandSourceSpan,
  } satisfies TexMathGlyphLayoutItem;
  const baseChild = childHList("nucleus", 0, 0, base, nucleus.base.sourceSpan);

  return {
    items: [accentItem, baseChild],
    width: base.width,
    height: roundTexPt(Math.max(base.height, -accentY + accentHeight)),
    depth: base.depth,
    italicCorrection: singleGlyphBase?.italicCorrection ?? 0,
    isCharacterNucleus: false,
    scriptShiftsAsCharacter: singleGlyphBase !== null,
    ...(singleGlyphBase ? {
      scriptBaseWidth: singleGlyphBase.width,
      scriptSuperscriptOffset: singleGlyphBase.italicCorrection,
    } : {}),
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutMultiDotAccentNucleus(
  nucleus: Extract<TexMathNucleus, { readonly kind: "accent" }>,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const base = layoutAccentBase(nucleus.base, fontProfile, style, true, baseAtPt, alphabet);
  if (!base) {
    return null;
  }
  const font = fontProfile.resolveMathFont({ family: "operators", style, baseAtPt });
  const dotMetric = requiredCharMetric(font, 46);
  const dotWidth = roundTexPt(tfmToPt(font, dotMetric.width));
  const dotHeight = roundTexPt(tfmToPt(font, dotMetric.height));
  const dotDepth = roundTexPt(tfmToPt(font, dotMetric.depth));
  const leadingThinSpace = muToPt(fontProfile, style, baseAtPt, 3);
  const dotCount = nucleus.command === "ddddot" ? 4 : 3;
  const accentWidth = roundTexPt(leadingThinSpace + dotWidth * dotCount);
  const skew = accentBaseSkew(nucleus.base, fontProfile, style, baseAtPt, alphabet);
  const singleGlyphBase = accentBaseSingleGlyphMetrics(nucleus.base, fontProfile, style, baseAtPt, alphabet);
  const delta = Math.min(base.height, accentXHeight(font));
  const accentX = roundTexPt(skew + (base.width - accentWidth) / 2);
  const accentY = roundTexPt(delta - base.height);
  const items: TexMathHListItem[] = [];
  items.push({
    kind: "kern",
    x: accentX,
    width: leadingThinSpace,
    reason: "operator-kern",
    sourceSpan: nucleus.commandSourceSpan,
  });
  for (let index = 0; index < dotCount; index++) {
    items.push({
      kind: "glyph",
      fontId: font.id,
      atPt: font.atPt,
      family: "operators",
      code: 46,
      text: `\\${nucleus.command}`,
      x: roundTexPt(accentX + leadingThinSpace + dotWidth * index),
      y: accentY,
      width: dotWidth,
      height: dotHeight,
      depth: dotDepth,
      italicCorrection: roundTexPt(tfmToPt(font, dotMetric.italicCorrection)),
      sourceSpan: nucleus.commandSourceSpan,
    });
  }
  const baseChild = childHList("nucleus", 0, 0, base, nucleus.base.sourceSpan);

  return {
    items: [...items, baseChild],
    width: base.width,
    height: roundTexPt(Math.max(base.height, -accentY + dotHeight)),
    depth: base.depth,
    italicCorrection: singleGlyphBase?.italicCorrection ?? 0,
    isCharacterNucleus: false,
    scriptShiftsAsCharacter: singleGlyphBase !== null,
    ...(singleGlyphBase ? {
      scriptBaseWidth: singleGlyphBase.width,
      scriptSuperscriptOffset: singleGlyphBase.italicCorrection,
    } : {}),
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutOperatorNucleus(
  nucleus: Extract<TexMathNucleus, { readonly kind: "operator" }>,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  if (nucleus.command === "lim") {
    return layoutTextOperatorNucleus(nucleus, fontProfile, style, baseAtPt, "lim");
  }
  return layoutLargeOperatorNucleus(nucleus, fontProfile, style, baseAtPt);
}

function layoutTextOperatorNucleus(
  nucleus: Extract<TexMathNucleus, { readonly kind: "operator" }>,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  text: string
): TexMathAtomLayout | null {
  const font = fontProfile.resolveMathFont({ family: "operators", style, baseAtPt });
  const items: TexMathGlyphLayoutItem[] = [];
  let cursor = 0;
  let height = 0;
  let depth = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    const metric = requiredCharMetric(font, code);
    const width = roundTexPt(tfmToPt(font, metric.width));
    const item = {
      kind: "glyph",
      fontId: font.id,
      atPt: font.atPt,
      family: "operators",
      code,
      text: char,
      x: cursor,
      y: 0,
      width,
      height: roundTexPt(tfmToPt(font, metric.height)),
      depth: roundTexPt(tfmToPt(font, metric.depth)),
      italicCorrection: roundTexPt(tfmToPt(font, metric.italicCorrection)),
      sourceSpan: nucleus.sourceSpan,
    } satisfies TexMathGlyphLayoutItem;
    items.push(item);
    cursor = roundTexPt(cursor + width);
    height = Math.max(height, item.height);
    depth = Math.max(depth, item.depth);
  }
  return {
    items,
    width: cursor,
    height: roundTexPt(height),
    depth: roundTexPt(depth),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutOperatorNameNucleus(
  nucleus: TexMathOperatorNameNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  const font = fontProfile.resolveMathFont({ family: "operators", style, baseAtPt });
  const items: TexMathHListItem[] = [];
  let cursor = 0;
  let height = 0;
  let depth = 0;
  let textRun = "";
  let textRunSourceStart = 0;

  const flushTextRun = (): boolean => {
    if (!textRun) {
      return true;
    }
    let shaped: ReturnType<typeof fontProfile.metricProvider.shapeText>;
    try {
      shaped = fontProfile.metricProvider.shapeText(textRun, font, {
        sourceStart: textRunSourceStart,
      });
    } catch {
      return false;
    }
    for (const shapedItem of shaped.items) {
      const layoutItem = textShapedItemToMathLayoutItem(shapedItem, font, cursor, "operators");
      items.push(layoutItem);
      cursor = roundTexPt(cursor + layoutItem.width);
      if (layoutItem.kind === "glyph") {
        height = Math.max(height, layoutItem.height);
        depth = Math.max(depth, layoutItem.depth);
      }
    }
    textRun = "";
    textRunSourceStart = 0;
    return true;
  };

  for (const part of nucleus.parts) {
    if (part.kind === "spacing") {
      if (!flushTextRun()) {
        return null;
      }
      const previous = items.at(-1);
      if (previous?.kind === "glyph" && previous.italicCorrection !== 0) {
        items.push({
          kind: "kern",
          x: cursor,
          width: previous.italicCorrection,
          reason: "italic-correction",
          sourceSpan: previous.sourceSpan,
        });
        cursor = roundTexPt(cursor + previous.italicCorrection);
      }
      const dimensions = resolveExplicitMathGlue({
        kind: "glue",
        command: part.command,
        sourceSpan: part.sourceSpan,
      });
      if (!dimensions) {
        return null;
      }
      const width = muToPt(fontProfile, style, baseAtPt, dimensions.mu);
      items.push({
        kind: "glue",
        x: cursor,
        width,
        mu: dimensions.mu,
        stretch: muToPt(fontProfile, style, baseAtPt, dimensions.stretchMu),
        shrink: muToPt(fontProfile, style, baseAtPt, dimensions.shrinkMu),
        source: "explicit",
        sourceSpan: part.sourceSpan,
      });
      cursor = roundTexPt(cursor + width);
      continue;
    }
    if (!textRun) {
      textRunSourceStart = part.sourceSpan.start;
    }
    textRun += part.text;
  }
  if (!flushTextRun()) {
    return null;
  }
  const previous = items.at(-1);
  if (previous?.kind === "glyph" && previous.italicCorrection !== 0) {
    items.push({
      kind: "kern",
      x: cursor,
      width: previous.italicCorrection,
      reason: "italic-correction",
      sourceSpan: previous.sourceSpan,
    });
    cursor = roundTexPt(cursor + previous.italicCorrection);
  }
  return {
    items,
    width: cursor,
    height: roundTexPt(height),
    depth: roundTexPt(depth),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutExtensibleArrowNucleus(
  nucleus: TexMathExtensibleArrowNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const above = layoutLimitList(nucleus.above, fontProfile, "script", false, baseAtPt, alphabet);
  const below = nucleus.below
    ? layoutLimitList(nucleus.below, fontProfile, "script", true, baseAtPt, alphabet)
    : null;
  if (!above || (nucleus.below && !below)) {
    return null;
  }
  const padding = extensibleArrowPadding(nucleus.command, fontProfile, "script", baseAtPt);
  const targetWidth = roundTexPt(Math.max(
    extensibleArrowMinimumWidth(fontProfile, "display", baseAtPt),
    above.width + padding.measureLeft + padding.measureRight,
    (below?.width ?? 0) + padding.measureLeft + padding.measureRight
  ));
  const body = layoutExtensibleArrowBody(nucleus.command, fontProfile, "display", baseAtPt, targetWidth, nucleus.commandSourceSpan);
  const width = roundTexPt(Math.max(
    body.width,
    above.width + padding.limitLeft + padding.limitRight,
    (below?.width ?? 0) + padding.limitLeft + padding.limitRight
  ));
  const bodyX = roundTexPt((width - body.width) / 2);
  const items: TexMathHListItem[] = body.items.map((item) => offsetMathLayoutItem(item, bodyX));

  const aboveShift = roundTexPt(Math.max(
    mathExtensionParameterToPt(fontProfile, "bigOpSpacing3", style, baseAtPt) - above.depth,
    mathExtensionParameterToPt(fontProfile, "bigOpSpacing1", style, baseAtPt)
  ));
  items.unshift(childHList(
    "limit-superscript",
    roundTexPt((width - above.width + padding.limitLeft - padding.limitRight) / 2),
    roundTexPt(-(body.height + aboveShift + above.depth)),
    above,
    nucleus.aboveSourceSpan
  ));
  const height = roundTexPt(body.height +
    mathExtensionParameterToPt(fontProfile, "bigOpSpacing5", style, baseAtPt) +
    above.height +
    above.depth +
    aboveShift);

  const belowShift = below
    ? roundTexPt(Math.max(
      mathExtensionParameterToPt(fontProfile, "bigOpSpacing4", style, baseAtPt) - below.height,
      mathExtensionParameterToPt(fontProfile, "bigOpSpacing2", style, baseAtPt)
    ))
    : 0;
  if (below) {
    items.push(childHList(
      "limit-subscript",
      roundTexPt((width - below.width + padding.limitLeft - padding.limitRight) / 2),
      roundTexPt(body.depth + belowShift + below.height),
      below,
      nucleus.belowSourceSpan ?? nucleus.sourceSpan
    ));
  }
  const depth = below
    ? roundTexPt(body.depth +
      belowShift +
      below.height +
      below.depth +
      mathExtensionParameterToPt(fontProfile, "bigOpSpacing5", style, baseAtPt))
    : body.depth;

  return {
    items,
    width,
    height,
    depth: roundTexPt(depth),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutLargeOperatorNucleus(
  nucleus: Extract<TexMathNucleus, { readonly kind: "operator" }>,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  const spec = largeOperatorSpec(nucleus.command);
  if (!spec) {
    return null;
  }
  const font = fontProfile.resolveMathFont({ family: "extension", style, baseAtPt });
  const axis = mathParameterToPt(fontProfile, "axisHeight", style, baseAtPt);
  const items: TexMathHListItem[] = [];
  let cursor = 0;
  let height = 0;
  let depth = 0;
  let italicCorrection = 0;
  for (const part of spec.parts) {
    if (part.kind === "kern") {
      const width = multiIntegralKernPt(fontProfile, style, baseAtPt);
      items.push({
        kind: "kern",
        x: cursor,
        width,
        reason: "operator-kern",
        sourceSpan: nucleus.sourceSpan,
      });
      cursor = roundTexPt(cursor + width);
      continue;
    }
    if (part.kind === "dots") {
      const dotExtent = appendIntegralDots(items, fontProfile, style, baseAtPt, nucleus.sourceSpan, cursor);
      cursor = roundTexPt(cursor + dotExtent.width);
      height = Math.max(height, dotExtent.height);
      depth = Math.max(depth, dotExtent.depth);
      continue;
    }
    const code = largeOperatorCode(font, part.code, style);
    const metric = requiredCharMetric(font, code);
    const glyphWidth = roundTexPt(tfmToPt(font, metric.width));
    const glyphItalicCorrection = roundTexPt(tfmToPt(font, metric.italicCorrection));
    const glyphHeight = roundTexPt(tfmToPt(font, metric.height));
    const glyphDepth = roundTexPt(tfmToPt(font, metric.depth));
    const y = roundTexPt((glyphHeight - glyphDepth) / 2 - axis);
    items.push({
      kind: "glyph",
      fontId: font.id,
      atPt: font.atPt,
      family: "extension",
      code,
      text: `\\${nucleus.command}`,
      x: cursor,
      y,
      width: glyphWidth,
      height: glyphHeight,
      depth: glyphDepth,
      italicCorrection: glyphItalicCorrection,
      sourceSpan: nucleus.sourceSpan,
    } satisfies TexMathGlyphLayoutItem);
    cursor = roundTexPt(cursor + glyphWidth);
    height = Math.max(height, Math.max(0, -y + glyphHeight));
    depth = Math.max(depth, Math.max(0, y + glyphDepth));
    italicCorrection = glyphItalicCorrection;
  }
  return {
    items,
    width: roundTexPt(cursor + italicCorrection),
    height: roundTexPt(height),
    depth: roundTexPt(depth),
    italicCorrection,
    isCharacterNucleus: false,
    scriptBaseWidth: roundTexPt(cursor),
    scriptSuperscriptOffset: italicCorrection,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutLeftRightNucleus(
  nucleus: Extract<TexMathNucleus, { readonly kind: "left-right" }>,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const body = layoutLeftRightBody(nucleus.body, fontProfile, style, cramped, baseAtPt, alphabet);
  if (!body) {
    return null;
  }
  const delimiterStyle = delimiterSizeStyle(style);
  const axis = mathParameterToPt(fontProfile, "axisHeight", delimiterStyle, baseAtPt);
  const targetHeight = leftRightDelimiterTarget(body.height, body.depth, axis);
  const left = layoutMathDelimiter(
    nucleus.leftDelimiter,
    fontProfile,
    delimiterStyle,
    baseAtPt,
    targetHeight,
    axis,
    nucleus.leftDelimiterSourceSpan
  );
  const right = layoutMathDelimiter(
    nucleus.rightDelimiter,
    fontProfile,
    delimiterStyle,
    baseAtPt,
    targetHeight,
    axis,
    nucleus.rightDelimiterSourceSpan
  );
  if (!left || !right) {
    return null;
  }

  const bodyChild = childHList("nucleus", left.width, 0, body, nucleus.body.sourceSpan);
  const shiftedRight = offsetDelimiterItems(right.items, roundTexPt(left.width + body.width), 0);
  const items = [
    ...left.items,
    bodyChild,
    ...shiftedRight,
  ];
  const width = roundTexPt(left.width + body.width + right.width);
  const height = Math.max(
    body.height,
    ...left.items.map((item) => -item.y + item.height),
    ...shiftedRight.map((item) => -item.y + item.height)
  );
  const depth = Math.max(
    body.depth,
    ...left.items.map((item) => item.y + item.depth),
    ...shiftedRight.map((item) => item.y + item.depth)
  );

  return {
    items,
    width,
    height: roundTexPt(height),
    depth: roundTexPt(Math.max(0, depth)),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutLeftRightBody(
  list: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathHList | null {
  const result = layoutTexMathList(list, { fontProfile, style, cramped, baseAtPt, alphabet });
  return result.supported ? result.hlist : null;
}

function selectRadicalDelimiter(
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  targetHeight: number,
  sourceSpan: TexMathSourceSpan
): TexMathDelimiterLayout | null {
  const small = fontProfile.resolveMathFont({
    family: "symbols",
    style,
    baseAtPt,
  });
  const smallCandidate = selectDelimiterFromChain(small, "symbols", 112, targetHeight, sourceSpan);
  if (smallCandidate?.largeEnough) {
    return smallCandidate.delimiter;
  }

  const large = fontProfile.resolveMathFont({
    family: "extension",
    style: "text",
    baseAtPt,
  });
  const largeCandidate = selectDelimiterFromChain(large, "extension", 112, targetHeight, sourceSpan);
  return largeCandidate?.delimiter ?? smallCandidate?.delimiter ?? null;
}

function layoutMathDelimiter(
  delimiter: TexMathDelimiter,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  targetHeight: number,
  _axis: number,
  sourceSpan: TexMathSourceSpan
): TexMathDelimiterLayout | null {
  if (delimiter === ".") {
    return {
      items: [],
      width: TEX_NULL_DELIMITER_SPACE_PT,
      height: 0,
      depth: 0,
    };
  }
  const spec = delimiterSpec(delimiter);
  if (!spec) {
    return null;
  }
  const probeStyles = delimiterProbeStyles(style);
  const smallCandidate = selectDelimiterFromStyleLadder(
    fontProfile,
    spec.smallFamily,
    spec.smallCode,
    probeStyles,
    baseAtPt,
    targetHeight,
    sourceSpan
  );
  const selected = smallCandidate?.largeEnough
    ? smallCandidate
    : largestDelimiterCandidate(
      smallCandidate,
      spec.largeCode === null
        ? null
        : selectDelimiterFromStyleLadder(
          fontProfile,
          "extension",
          spec.largeCode,
          probeStyles,
          baseAtPt,
          targetHeight,
          sourceSpan
        )
    ) ?? smallCandidate;
  if (!selected) {
    return null;
  }
  const shiftAxis = mathParameterToPt(fontProfile, "axisHeight", selected.style, baseAtPt);
  const shift = roundTexPt((selected.delimiter.height - selected.delimiter.depth) / 2 - shiftAxis);
  return {
    ...selected.delimiter,
    items: offsetDelimiterItems(selected.delimiter.items, 0, shift),
  };
}

function selectDelimiterFromStyleLadder(
  fontProfile: TexMathFontProfile,
  family: TexMathFontFamily,
  code: number,
  styles: readonly TexMathStyle[],
  baseAtPt: number,
  targetHeight: number,
  sourceSpan: TexMathSourceSpan
): {
  readonly delimiter: TexMathDelimiterLayout;
  readonly largeEnough: boolean;
  readonly style: TexMathStyle;
} | null {
  let best: {
    readonly delimiter: TexMathDelimiterLayout;
    readonly largeEnough: boolean;
    readonly style: TexMathStyle;
  } | null = null;
  for (const style of styles) {
    const candidate = selectDelimiterFromChain(
      fontProfile.resolveMathFont({ family, style, baseAtPt }),
      family,
      code,
      targetHeight,
      sourceSpan
    );
    if (!candidate) {
      continue;
    }
    const styledCandidate = { ...candidate, style };
    if (candidate.largeEnough) {
      return styledCandidate;
    }
    best = largestDelimiterCandidate(best, styledCandidate);
  }
  return best;
}

function largestDelimiterCandidate(
  left: {
    readonly delimiter: TexMathDelimiterLayout;
    readonly largeEnough: boolean;
    readonly style: TexMathStyle;
  } | null | undefined,
  right: {
    readonly delimiter: TexMathDelimiterLayout;
    readonly largeEnough: boolean;
    readonly style: TexMathStyle;
  } | null | undefined
): {
  readonly delimiter: TexMathDelimiterLayout;
  readonly largeEnough: boolean;
  readonly style: TexMathStyle;
} | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return delimiterTotalHeight(right.delimiter) > delimiterTotalHeight(left.delimiter) ? right : left;
}

function delimiterTotalHeight(delimiter: TexMathDelimiterLayout): number {
  return delimiter.height + delimiter.depth;
}

function delimiterProbeStyles(style: TexMathStyle): readonly TexMathStyle[] {
  if (style === "scriptscript") {
    return ["scriptscript", "script", "text"];
  }
  if (style === "script") {
    return ["script", "text"];
  }
  return ["text"];
}

function delimiterSpec(
  delimiter: Exclude<TexMathDelimiter, ".">
): {
  readonly smallFamily: TexMathFontFamily;
  readonly smallCode: number;
  readonly largeCode: number | null;
} | null {
  switch (delimiter) {
    case "(":
      return { smallFamily: "operators", smallCode: 40, largeCode: 0 };
    case ")":
      return { smallFamily: "operators", smallCode: 41, largeCode: 1 };
    case "[":
      return { smallFamily: "operators", smallCode: 91, largeCode: 2 };
    case "]":
      return { smallFamily: "operators", smallCode: 93, largeCode: 3 };
    case "lfloor":
      return { smallFamily: "symbols", smallCode: 98, largeCode: 4 };
    case "rfloor":
      return { smallFamily: "symbols", smallCode: 99, largeCode: 5 };
    case "lceil":
      return { smallFamily: "symbols", smallCode: 100, largeCode: 6 };
    case "rceil":
      return { smallFamily: "symbols", smallCode: 101, largeCode: 7 };
    case "ulcorner":
      return { smallFamily: "amsSymbolsA", smallCode: 0x70, largeCode: null };
    case "urcorner":
      return { smallFamily: "amsSymbolsA", smallCode: 0x71, largeCode: null };
    case "lbrace":
      return { smallFamily: "symbols", smallCode: 102, largeCode: 8 };
    case "rbrace":
      return { smallFamily: "symbols", smallCode: 103, largeCode: 9 };
    case "langle":
      return { smallFamily: "symbols", smallCode: 104, largeCode: 10 };
    case "rangle":
      return { smallFamily: "symbols", smallCode: 105, largeCode: 11 };
    case "vert":
      return { smallFamily: "symbols", smallCode: 106, largeCode: 12 };
    case "Vert":
      return { smallFamily: "symbols", smallCode: 107, largeCode: 13 };
    case "slash":
      return { smallFamily: "operators", smallCode: 47, largeCode: 14 };
    case "backslash":
      return { smallFamily: "symbols", smallCode: 110, largeCode: 15 };
  }
  return null;
}

function largeOperatorSpec(
  command: TexMathOperatorCommand
): {
  readonly parts: readonly (
    | { readonly kind: "glyph"; readonly code: number }
    | { readonly kind: "dots" }
    | { readonly kind: "kern" }
  )[];
} | null {
  switch (command) {
    case "bigcap":
      return { parts: [{ kind: "glyph", code: 84 }] };
    case "bigcup":
      return { parts: [{ kind: "glyph", code: 83 }] };
    case "coprod":
      return { parts: [{ kind: "glyph", code: 96 }] };
    case "idotsint":
      return { parts: [{ kind: "glyph", code: 82 }, { kind: "dots" }, { kind: "glyph", code: 82 }] };
    case "iint":
      return multiIntegralSpec(2);
    case "iiint":
      return multiIntegralSpec(3);
    case "iiiint":
      return multiIntegralSpec(4);
    case "int":
      return { parts: [{ kind: "glyph", code: 82 }] };
    case "oint":
      return { parts: [{ kind: "glyph", code: 72 }] };
    case "prod":
      return { parts: [{ kind: "glyph", code: 81 }] };
    case "sum":
      return { parts: [{ kind: "glyph", code: 80 }] };
    case "lim":
      return null;
  }
  return null;
}

function multiIntegralSpec(count: 2 | 3 | 4): NonNullable<ReturnType<typeof largeOperatorSpec>> {
  const parts: Array<
    | { readonly kind: "glyph"; readonly code: number }
    | { readonly kind: "dots" }
    | { readonly kind: "kern" }
  > = [];
  for (let index = 0; index < count; index += 1) {
    if (index > 0) {
      parts.push({ kind: "kern" });
    }
    parts.push({ kind: "glyph", code: 82 });
  }
  return { parts };
}

function multiIntegralKernPt(
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): number {
  const extraDisplayMu = style === "display" ? -3 : 0;
  return muToPt(fontProfile, style, baseAtPt, -6 + extraDisplayMu);
}

function appendIntegralDots(
  items: TexMathHListItem[],
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  sourceSpan: TexMathSourceSpan,
  startX: number
): { readonly width: number; readonly height: number; readonly depth: number } {
  const font = fontProfile.resolveMathFont({ family: "symbols", style, baseAtPt });
  const dotMetric = requiredCharMetric(font, 1);
  const dotWidth = roundTexPt(tfmToPt(font, dotMetric.width));
  const dotHeight = roundTexPt(tfmToPt(font, dotMetric.height));
  const dotDepth = roundTexPt(tfmToPt(font, dotMetric.depth));
  const dotItalicCorrection = roundTexPt(tfmToPt(font, dotMetric.italicCorrection));
  const kernMu = style === "display" ? 3 : style === "text" ? 1.5 : 1;
  const kernWidth = muToPt(fontProfile, style, baseAtPt, kernMu);
  let cursor = startX;
  for (let index = 0; index < 3; index += 1) {
    items.push({
      kind: "glyph",
      fontId: font.id,
      atPt: font.atPt,
      family: "symbols",
      code: 1,
      text: String.raw`\idotsint`,
      x: cursor,
      y: 0,
      width: dotWidth,
      height: dotHeight,
      depth: dotDepth,
      italicCorrection: dotItalicCorrection,
      sourceSpan,
    });
    cursor = roundTexPt(cursor + dotWidth);
    if (index < 2) {
      items.push({
        kind: "kern",
        x: cursor,
        width: kernWidth,
        reason: "operator-kern",
        sourceSpan,
      });
      cursor = roundTexPt(cursor + kernWidth);
    }
  }
  return {
    width: roundTexPt(cursor - startX),
    height: dotHeight,
    depth: dotDepth,
  };
}

function extensibleArrowPadding(
  command: TexMathExtensibleArrowNucleus["command"],
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): {
  readonly measureLeft: number;
  readonly measureRight: number;
  readonly limitLeft: number;
  readonly limitRight: number;
} {
  if (command === "xleftarrow") {
    return {
      measureLeft: muToPt(fontProfile, style, baseAtPt, 9),
      measureRight: muToPt(fontProfile, style, baseAtPt, 5),
      limitLeft: muToPt(fontProfile, style, baseAtPt, 3),
      limitRight: 0,
    };
  }
  return {
    measureLeft: muToPt(fontProfile, style, baseAtPt, 5),
    measureRight: muToPt(fontProfile, style, baseAtPt, 9),
    limitLeft: 0,
    limitRight: muToPt(fontProfile, style, baseAtPt, 3),
  };
}

function extensibleArrowMinimumWidth(
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): number {
  const font = fontProfile.resolveMathFont({ family: "symbols", style, baseAtPt });
  const relbarWidth = roundTexPt(tfmToPt(font, requiredCharMetric(font, 0).width));
  const arrowWidth = roundTexPt(tfmToPt(font, requiredCharMetric(font, 33).width));
  return roundTexPt(relbarWidth * 2 + arrowWidth + muToPt(fontProfile, style, baseAtPt, -14));
}

function layoutExtensibleArrowBody(
  command: TexMathExtensibleArrowNucleus["command"],
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  targetWidth: number,
  sourceSpan: TexMathSourceSpan
): TexMathAtomLayout {
  const font = fontProfile.resolveMathFont({ family: "symbols", style, baseAtPt });
  const relbarCode = 0;
  const leftArrowCode = 32;
  const rightArrowCode = 33;
  const headCode = command === "xleftarrow" ? leftArrowCode : rightArrowCode;
  const relbarMetric = requiredCharMetric(font, relbarCode);
  const headMetric = requiredCharMetric(font, headCode);
  const relbarWidth = roundTexPt(tfmToPt(font, relbarMetric.width));
  const headWidth = roundTexPt(tfmToPt(font, headMetric.width));
  const headKern = muToPt(fontProfile, style, baseAtPt, -7);
  const leaderSideKern = muToPt(fontProfile, style, baseAtPt, -2);
  const leaderUnitWidth = roundTexPt(relbarWidth + 2 * leaderSideKern);
  const minimumWidth = roundTexPt(relbarWidth + headKern + headWidth);
  const repeatCount = Math.max(
    1,
    Math.ceil((targetWidth - minimumWidth - headKern - relbarWidth) / Math.max(0.1, leaderUnitWidth))
  );
  const items: TexMathHListItem[] = [];
  let cursor = 0;
  let height = 0;
  let depth = 0;

  const appendGlyph = (code: number, text: string): void => {
    const metric = requiredCharMetric(font, code);
    const item = {
      kind: "glyph",
      fontId: font.id,
      atPt: font.atPt,
      family: "symbols",
      code,
      text,
      x: roundTexPt(cursor),
      y: 0,
      width: roundTexPt(tfmToPt(font, metric.width)),
      height: roundTexPt(tfmToPt(font, metric.height)),
      depth: roundTexPt(tfmToPt(font, metric.depth)),
      italicCorrection: roundTexPt(tfmToPt(font, metric.italicCorrection)),
      sourceSpan,
    } satisfies TexMathGlyphLayoutItem;
    items.push(item);
    cursor = roundTexPt(cursor + item.width);
    height = Math.max(height, item.height);
    depth = Math.max(depth, item.depth);
  };
  const appendKern = (width: number): void => {
    items.push({
      kind: "kern",
      x: roundTexPt(cursor),
      width,
      reason: "operator-kern",
      sourceSpan,
    });
    cursor = roundTexPt(cursor + width);
  };
  const appendLeader = (): void => {
    appendKern(leaderSideKern);
    appendGlyph(relbarCode, "\\relbar");
    appendKern(leaderSideKern);
  };

  if (command === "xleftarrow") {
    appendGlyph(leftArrowCode, "\\leftarrow");
    appendKern(headKern);
    for (let index = 0; index < repeatCount; index += 1) {
      appendLeader();
    }
    appendKern(headKern);
    appendGlyph(relbarCode, "\\relbar");
  } else {
    appendGlyph(relbarCode, "\\relbar");
    appendKern(headKern);
    for (let index = 0; index < repeatCount; index += 1) {
      appendLeader();
    }
    appendKern(headKern);
    appendGlyph(rightArrowCode, "\\rightarrow");
  }

  const extra = roundTexPt(targetWidth - cursor);
  if (extra > 0) {
    appendKern(extra);
  }
  return {
    items,
    width: roundTexPt(Math.max(targetWidth, cursor)),
    height: roundTexPt(height),
    depth: roundTexPt(depth),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan,
  };
}

function largeOperatorCode(
  font: ResolvedTexFont,
  code: number,
  style: TexMathStyle
): number {
  if (style !== "display") {
    return code;
  }
  const metric = requiredCharMetric(font, code);
  return metric.nextLarger ?? code;
}

function offsetDelimiterItems(
  items: readonly TexMathGlyphLayoutItem[],
  x: number,
  y: number
): readonly TexMathGlyphLayoutItem[] {
  return items.map((item) => ({
    ...item,
    x: roundTexPt(item.x + x),
    y: roundTexPt(item.y + y),
  }));
}

function selectDelimiterFromChain(
  font: ResolvedTexFont,
  family: TexMathFontFamily,
  startCode: number,
  targetHeight: number,
  sourceSpan: TexMathSourceSpan
): {
  readonly delimiter: TexMathDelimiterLayout;
  readonly largeEnough: boolean;
} | null {
  let code = startCode;
  let best: TexMathDelimiterLayout | null = null;
  let bestHeight = 0;
  const seen = new Set<number>();
  while (!seen.has(code)) {
    seen.add(code);
    const metric = font.data.chars[String(code)];
    if (!metric) {
      break;
    }
    if (metric.varchar) {
      return {
        delimiter: layoutExtensibleDelimiter(font, family, metric.varchar, targetHeight, sourceSpan),
        largeEnough: true,
      };
    }
    const height = charHeightPlusDepth(font, metric);
    if (height > bestHeight) {
      best = layoutSingleDelimiterGlyph(font, family, code, metric, sourceSpan);
      bestHeight = height;
      if (height >= targetHeight) {
        return { delimiter: best, largeEnough: true };
      }
    }
    if (metric.nextLarger === undefined) {
      break;
    }
    code = metric.nextLarger;
  }
  return best ? { delimiter: best, largeEnough: false } : null;
}

function layoutSingleDelimiterGlyph(
  font: ResolvedTexFont,
  family: TexMathFontFamily,
  code: number,
  metric: GeneratedTexCharMetric,
  sourceSpan: TexMathSourceSpan
): TexMathDelimiterLayout {
  const width = roundTexPt(tfmToPt(font, metric.width) + tfmToPt(font, metric.italicCorrection));
  const height = roundTexPt(tfmToPt(font, metric.height));
  const depth = roundTexPt(tfmToPt(font, metric.depth));
  return {
    items: [delimiterGlyphItem(font, family, code, metric, 0, sourceSpan)],
    width,
    height,
    depth,
  };
}

function layoutExtensibleDelimiter(
  font: ResolvedTexFont,
  family: TexMathFontFamily,
  recipe: GeneratedTexExtensibleRecipe,
  targetHeight: number,
  sourceSpan: TexMathSourceSpan
): TexMathDelimiterLayout {
  const repCode = recipe.rep;
  if (repCode === undefined) {
    return { items: [], width: 0, height: 0, depth: 0 };
  }
  const repMetric = requiredCharMetric(font, repCode);
  const repSize = charHeightPlusDepth(font, repMetric);
  const fixedCodes = [recipe.bot, recipe.mid, recipe.top].filter((code): code is number => code !== undefined);
  let totalSize = fixedCodes.reduce((sum, code) => sum + charHeightPlusDepth(font, requiredCharMetric(font, code)), 0);
  let repeatCount = 0;
  if (repSize > 0) {
    while (totalSize < targetHeight) {
      totalSize += repSize;
      repeatCount += 1;
      if (recipe.mid !== undefined) {
        totalSize += repSize;
      }
    }
  }

  const componentCodes: number[] = [];
  if (recipe.top !== undefined) {
    componentCodes.push(recipe.top);
  }
  for (let index = 0; index < repeatCount; index++) {
    componentCodes.push(repCode);
  }
  if (recipe.mid !== undefined) {
    componentCodes.push(recipe.mid);
    for (let index = 0; index < repeatCount; index++) {
      componentCodes.push(repCode);
    }
  }
  if (recipe.bot !== undefined) {
    componentCodes.push(recipe.bot);
  }

  const width = roundTexPt(tfmToPt(font, repMetric.width) + tfmToPt(font, repMetric.italicCorrection));
  const firstMetric = requiredCharMetric(font, componentCodes[0] ?? repCode);
  const boxHeight = roundTexPt(tfmToPt(font, firstMetric.height));
  const items: TexMathGlyphLayoutItem[] = [];
  let currentTop = -boxHeight;
  for (const code of componentCodes) {
    const metric = requiredCharMetric(font, code);
    const y = roundTexPt(currentTop + tfmToPt(font, metric.height));
    items.push(delimiterGlyphItem(font, family, code, metric, y, sourceSpan));
    currentTop = roundTexPt(currentTop + charHeightPlusDepth(font, metric));
  }

  return {
    items,
    width,
    height: boxHeight,
    depth: roundTexPt(totalSize - boxHeight),
  };
}

function delimiterGlyphItem(
  font: ResolvedTexFont,
  family: TexMathFontFamily,
  code: number,
  metric: GeneratedTexCharMetric,
  y: number,
  sourceSpan: TexMathSourceSpan
): TexMathGlyphLayoutItem {
  return {
    kind: "glyph",
    fontId: font.id,
    atPt: font.atPt,
    family,
    code,
    text: "\\sqrt",
    x: 0,
    y,
    width: roundTexPt(tfmToPt(font, metric.width)),
    height: roundTexPt(tfmToPt(font, metric.height)),
    depth: roundTexPt(tfmToPt(font, metric.depth)),
    italicCorrection: roundTexPt(tfmToPt(font, metric.italicCorrection)),
    sourceSpan,
  };
}

function layoutGlyphNucleus(
  nucleus: TexMathGlyphNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathAtomLayout | null {
  const parts = resolveMathSymbolParts(nucleus, fontProfile, style, baseAtPt, alphabet);
  if (parts.length === 0) {
    return null;
  }
  const items: TexMathHListItem[] = [];
  let cursor = 0;
  let height = 0;
  let depth = 0;
  let italicCorrection = 0;
  let glyphCount = 0;
  for (const glyph of parts) {
    if (glyph.kind === "kern") {
      items.push({
        kind: "kern",
        x: roundTexPt(cursor + glyph.xOffset),
        width: glyph.width,
        reason: "italic-correction",
        sourceSpan: glyph.sourceSpan,
      });
      cursor = roundTexPt(cursor + glyph.width);
      continue;
    }
    const metric = requiredCharMetric(glyph.font, glyph.code);
    const width = roundTexPt(tfmToPt(glyph.font, metric.width));
    const glyphHeight = roundTexPt(tfmToPt(glyph.font, metric.height));
    const glyphDepth = roundTexPt(tfmToPt(glyph.font, metric.depth));
    italicCorrection = roundTexPt(tfmToPt(glyph.font, metric.italicCorrection));
    glyphCount += 1;
    items.push({
      kind: "glyph",
      fontId: glyph.font.id,
      atPt: glyph.font.atPt,
      family: glyph.family,
      code: glyph.code,
      text: glyph.text,
      x: roundTexPt(cursor + glyph.xOffset),
      y: 0,
      width,
      height: glyphHeight,
      depth: glyphDepth,
      italicCorrection,
      sourceSpan: glyph.sourceSpan,
    });
    cursor = roundTexPt(cursor + glyph.advance);
    height = Math.max(height, glyphHeight);
    depth = Math.max(depth, glyphDepth);
  }
  return {
    items,
    width: cursor,
    height: roundTexPt(height),
    depth: roundTexPt(depth),
    italicCorrection: glyphCount === 1 ? italicCorrection : 0,
    isCharacterNucleus: glyphCount === 1,
    sourceSpan: nucleus.sourceSpan,
  };
}

export function resolveMathGlyph(
  nucleus: TexMathGlyphNucleus,
  fontProfile: TexMathFontProfile = defaultTexMathFontProfile,
  style: TexMathStyle = "text",
  baseAtPt = 10,
  alphabet?: TexMathAlphabetCommand
): ResolvedMathGlyph | null {
  return resolveMathGlyphs(nucleus, fontProfile, style, baseAtPt, alphabet)[0] ?? null;
}

export function resolveMathGlyphs(
  nucleus: TexMathGlyphNucleus,
  fontProfile: TexMathFontProfile = defaultTexMathFontProfile,
  style: TexMathStyle = "text",
  baseAtPt = 10,
  alphabet?: TexMathAlphabetCommand
): readonly ResolvedMathGlyph[] {
  return resolveMathSymbolParts(nucleus, fontProfile, style, baseAtPt, alphabet)
    .filter((part): part is ResolvedMathGlyph => part.kind !== "kern");
}

function resolveMathSymbolParts(
  nucleus: TexMathGlyphNucleus,
  fontProfile: TexMathFontProfile = defaultTexMathFontProfile,
  style: TexMathStyle = "text",
  baseAtPt = 10,
  alphabet?: TexMathAlphabetCommand
): readonly ResolvedMathSymbolPart[] {
  const alphabetGlyph = alphabet
    ? defaultLuaLatexMathAlphabetGlyph(nucleus.text, alphabet, style)
    : null;
  if (alphabetGlyph) {
    const font = fontProfile.metricProvider.resolveFont({
      fontId: alphabetGlyph.fontId,
      atPt: textStyleAtPt(style, baseAtPt),
    });
    const metric = requiredCharMetric(font, alphabetGlyph.code);
    const width = roundTexPt(tfmToPt(font, metric.width));
    return [{
      kind: "glyph",
      font,
      family: "alphabet",
      code: alphabetGlyph.code,
      text: nucleus.text,
      xOffset: 0,
      advance: width,
      sourceSpan: nucleus.sourceSpan,
    }];
  }
  const resolved = defaultLuaLatexMathSymbols(nucleus.text);
  if (resolved.length === 0) {
    return [];
  }
  return resolved.map((glyph) => {
    if (glyph.kind === "kern") {
      const scale = textStyleAtPt(style, baseAtPt) / 10;
      return {
        kind: "kern",
        width: roundTexPt(glyph.width * scale),
        xOffset: roundTexPt((glyph.xOffset ?? 0) * scale),
        sourceSpan: nucleus.sourceSpan,
      };
    }
    const font = fontProfile.resolveMathFont({
      family: glyph.family,
      style,
      baseAtPt,
    });
    const metric = requiredCharMetric(font, glyph.code);
    const width = roundTexPt(tfmToPt(font, metric.width));
    return {
      kind: "glyph",
      font,
      family: glyph.family,
      code: glyph.code,
      text: nucleus.text,
      xOffset: glyph.xOffset !== undefined
        ? roundTexPt(glyph.xOffset * (textStyleAtPt(style, baseAtPt) / 10))
        : 0,
      advance: glyph.advance !== undefined
        ? roundTexPt(glyph.advance * (textStyleAtPt(style, baseAtPt) / 10))
        : width,
      sourceSpan: nucleus.sourceSpan,
    };
  });
}

function resolveMathAccent(
  command: TexMathAccentCommand,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  sourceSpan: TexMathSourceSpan
): ResolvedMathGlyph | null {
  const resolved = defaultLuaLatexMathAccent(command);
  if (!resolved) {
    return null;
  }
  return {
    kind: "glyph",
    font: fontProfile.resolveMathFont({
      family: resolved.family,
      style,
      baseAtPt,
    }),
    family: resolved.family,
    code: resolved.code,
    text: `\\${command}`,
    xOffset: 0,
    advance: 0,
    sourceSpan,
  };
}

function defaultLuaLatexMathAccent(
  command: TexMathAccentCommand
): { family: TexMathFontFamily; code: number } | null {
  switch (command) {
    case "bar":
      return { family: "operators", code: 22 };
    case "dot":
      return { family: "operators", code: 95 };
    case "ddot":
      return { family: "operators", code: 127 };
    case "dddot":
    case "ddddot":
      return null;
    case "hat":
      return { family: "operators", code: 94 };
    case "tilde":
      return { family: "operators", code: 126 };
    case "vec":
      return { family: "letters", code: 126 };
  }
  return null;
}

function defaultLuaLatexMathAlphabetGlyph(
  text: string,
  alphabet: TexMathAlphabetCommand,
  style: TexMathStyle
): { fontId: string; code: number } | null {
  if (!/^[A-Za-z0-9]$/.test(text)) {
    return null;
  }
  return {
    fontId: defaultLuaLatexMathAlphabetFontId(alphabet, style),
    code: text.charCodeAt(0),
  };
}

function defaultLuaLatexMathAlphabetFontId(
  alphabet: TexMathAlphabetCommand,
  style: TexMathStyle
): string {
  switch (alphabet) {
    case "mathbf":
      if (style === "script") {
        return "cmbx7";
      }
      if (style === "scriptscript") {
        return "cmbx5";
      }
      return "cmbx10";
    case "mathcal":
      if (style === "script") {
        return "cmsy7";
      }
      if (style === "scriptscript") {
        return "cmsy5";
      }
      return "cmsy10";
    case "mathit":
      if (style === "text" || style === "display") {
        return "cmti10";
      }
      return "cmti7";
    case "mathrm":
      if (style === "script") {
        return "cmr7";
      }
      if (style === "scriptscript") {
        return "cmr5";
      }
      return "cmr10";
    case "mathsf":
      if (style === "text" || style === "display") {
        return "cmss10";
      }
      return "cmss8";
    case "mathtt":
      if (style === "text" || style === "display") {
        return "cmtt10";
      }
      return "cmtt8";
  }
}

function selectAccentMetric(
  font: ResolvedTexFont,
  code: number,
  baseWidth: number
): GeneratedTexCharMetric {
  let metric = requiredCharMetric(font, code);
  while (metric.nextLarger !== undefined) {
    const next = requiredCharMetric(font, metric.nextLarger);
    if (tfmToPt(font, next.width) > baseWidth) {
      break;
    }
    metric = next;
  }
  return metric;
}

function accentXHeight(font: ResolvedTexFont): number {
  return tfmToPt(font, font.data.fontdimen.xheight);
}

function accentBaseSkew(
  base: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): number {
  if (base.items.length !== 1) {
    return 0;
  }
  const item = base.items[0];
  if (
    item?.kind !== "atom" ||
    item.subscript ||
    item.superscript
  ) {
    return 0;
  }
  if (item.nucleus.kind === "accent") {
    return accentBaseSkew(item.nucleus.base, fontProfile, style, baseAtPt, alphabet);
  }
  if (item.nucleus.kind !== "glyph") {
    return 0;
  }
  const glyph = resolveMathGlyph(item.nucleus, fontProfile, style, baseAtPt, alphabet);
  if (!glyph) {
    return 0;
  }
  const kern = glyph.font.data.ligKerns.find((rule) =>
    rule[0] === "kern" &&
    rule[1] === glyph.code &&
    rule[2] === TEX_DEFAULT_SKEW_CHAR
  );
  return kern ? roundTexPt(tfmToPt(glyph.font, kern[3])) : 0;
}

function accentBaseSingleGlyphMetrics(
  base: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): { readonly width: number; readonly italicCorrection: number } | null {
  if (base.items.length !== 1) {
    return null;
  }
  const item = base.items[0];
  if (
    item?.kind !== "atom" ||
    item.subscript ||
    item.superscript ||
    item.nucleus.kind !== "glyph"
  ) {
    return null;
  }
  const glyph = resolveMathGlyph(item.nucleus, fontProfile, style, baseAtPt, alphabet);
  if (!glyph) {
    return null;
  }
  return {
    width: glyph.advance,
    italicCorrection: roundTexPt(tfmToPt(glyph.font, requiredCharMetric(glyph.font, glyph.code).italicCorrection)),
  };
}

function defaultLuaLatexMathSymbols(
  text: string
): readonly MathGlyphSpec[] {
  if (/^[A-Za-z]$/.test(text)) {
    return [{ family: "letters", code: text.charCodeAt(0) }];
  }
  if (/^[0-9]$/.test(text)) {
    return [{ family: "operators", code: text.charCodeAt(0) }];
  }
  const command = text.startsWith("\\") ? text.slice(1) : text;
  switch (command) {
    case "Gamma":
      return [{ family: "operators", code: 0 }];
    case "Delta":
      return [{ family: "operators", code: 1 }];
    case "Theta":
      return [{ family: "operators", code: 2 }];
    case "Lambda":
      return [{ family: "operators", code: 3 }];
    case "Xi":
      return [{ family: "operators", code: 4 }];
    case "Pi":
      return [{ family: "operators", code: 5 }];
    case "Sigma":
      return [{ family: "operators", code: 6 }];
    case "Upsilon":
      return [{ family: "operators", code: 7 }];
    case "Phi":
      return [{ family: "operators", code: 8 }];
    case "Psi":
      return [{ family: "operators", code: 9 }];
    case "Omega":
      return [{ family: "operators", code: 10 }];
    case "alpha":
      return [{ family: "letters", code: 11 }];
    case "beta":
      return [{ family: "letters", code: 12 }];
    case "gamma":
      return [{ family: "letters", code: 13 }];
    case "delta":
      return [{ family: "letters", code: 14 }];
    case "epsilon":
      return [{ family: "letters", code: 15 }];
    case "zeta":
      return [{ family: "letters", code: 16 }];
    case "eta":
      return [{ family: "letters", code: 17 }];
    case "theta":
      return [{ family: "letters", code: 18 }];
    case "iota":
      return [{ family: "letters", code: 19 }];
    case "kappa":
      return [{ family: "letters", code: 20 }];
    case "lambda":
      return [{ family: "letters", code: 21 }];
    case "mu":
      return [{ family: "letters", code: 22 }];
    case "nu":
      return [{ family: "letters", code: 23 }];
    case "xi":
      return [{ family: "letters", code: 24 }];
    case "pi":
      return [{ family: "letters", code: 25 }];
    case "rho":
      return [{ family: "letters", code: 26 }];
    case "sigma":
      return [{ family: "letters", code: 27 }];
    case "tau":
      return [{ family: "letters", code: 28 }];
    case "upsilon":
      return [{ family: "letters", code: 29 }];
    case "phi":
      return [{ family: "letters", code: 30 }];
    case "chi":
      return [{ family: "letters", code: 31 }];
    case "psi":
      return [{ family: "letters", code: 32 }];
    case "omega":
      return [{ family: "letters", code: 33 }];
    case "varepsilon":
      return [{ family: "letters", code: 34 }];
    case "vartheta":
      return [{ family: "letters", code: 35 }];
    case "varpi":
      return [{ family: "letters", code: 36 }];
    case "varrho":
      return [{ family: "letters", code: 37 }];
    case "varsigma":
      return [{ family: "letters", code: 38 }];
    case "varphi":
      return [{ family: "letters", code: 39 }];
    case "lbrace":
    case "{":
      return [{ family: "symbols", code: 102 }];
    case "rbrace":
    case "}":
      return [{ family: "symbols", code: 103 }];
    case "langle":
      return [{ family: "symbols", code: 104 }];
    case "rangle":
      return [{ family: "symbols", code: 105 }];
    case "lfloor":
      return [{ family: "symbols", code: 98 }];
    case "rfloor":
      return [{ family: "symbols", code: 99 }];
    case "lceil":
      return [{ family: "symbols", code: 100 }];
    case "rceil":
      return [{ family: "symbols", code: 101 }];
    case "ulcorner":
      return [{ family: "amsSymbolsA", code: 0x70 }];
    case "urcorner":
      return [{ family: "amsSymbolsA", code: 0x71 }];
    case "square":
      return [{ family: "amsSymbolsA", code: 0x03 }];
    case "blacksquare":
      return [{ family: "amsSymbolsA", code: 0x04 }];
    case "partial":
      return [{ family: "letters", code: 64 }];
    case "ell":
      return [{ family: "letters", code: 96 }];
    case "wp":
      return [{ family: "letters", code: 125 }];
    case "imath":
      return [{ family: "letters", code: 123 }];
    case "jmath":
      return [{ family: "letters", code: 124 }];
    case "flat":
      return [{ family: "letters", code: 91 }];
    case "natural":
      return [{ family: "letters", code: 92 }];
    case "sharp":
      return [{ family: "letters", code: 93 }];
    case "aleph":
      return [{ family: "symbols", code: 64 }];
    case "prime":
      return [{ family: "symbols", code: 48 }];
    case "emptyset":
      return [{ family: "symbols", code: 59 }];
    case "nabla":
      return [{ family: "symbols", code: 114 }];
    case "top":
      return [{ family: "symbols", code: 62 }];
    case "bot":
      return [{ family: "symbols", code: 63 }];
    case "triangle":
      return [{ family: "symbols", code: 52 }];
    case "Re":
      return [{ family: "symbols", code: 60 }];
    case "Im":
      return [{ family: "symbols", code: 61 }];
    case "cdot":
      return [{ family: "symbols", code: 1 }];
    case "times":
      return [{ family: "symbols", code: 2 }];
    case "ast":
      return [{ family: "symbols", code: 3 }];
    case "div":
      return [{ family: "symbols", code: 4 }];
    case "diamond":
      return [{ family: "symbols", code: 5 }];
    case "pm":
      return [{ family: "symbols", code: 6 }];
    case "mp":
      return [{ family: "symbols", code: 7 }];
    case "boxdot":
      return [{ family: "amsSymbolsA", code: 0x00 }];
    case "dotplus":
      return [{ family: "amsSymbolsA", code: 0x75 }];
    case "circleddash":
      return [{ family: "amsSymbolsA", code: 0x7f }];
    case "oplus":
      return [{ family: "symbols", code: 8 }];
    case "ominus":
      return [{ family: "symbols", code: 9 }];
    case "otimes":
      return [{ family: "symbols", code: 10 }];
    case "oslash":
      return [{ family: "symbols", code: 11 }];
    case "odot":
      return [{ family: "symbols", code: 12 }];
    case "bigcirc":
      return [{ family: "symbols", code: 13 }];
    case "circ":
      return [{ family: "symbols", code: 14 }];
    case "bullet":
      return [{ family: "symbols", code: 15 }];
    case "asymp":
      return [{ family: "symbols", code: 16 }];
    case "colon":
      return [{ family: "operators", code: 58 }];
    case "equiv":
      return [{ family: "symbols", code: 17 }];
    case "subseteq":
      return [{ family: "symbols", code: 18 }];
    case "supseteq":
      return [{ family: "symbols", code: 19 }];
    case "le":
    case "leq":
      return [{ family: "symbols", code: 20 }];
    case "ge":
    case "geq":
      return [{ family: "symbols", code: 21 }];
    case "approx":
      return [{ family: "symbols", code: 25 }];
    case "subset":
      return [{ family: "symbols", code: 26 }];
    case "supset":
      return [{ family: "symbols", code: 27 }];
    case "ll":
      return [{ family: "symbols", code: 28 }];
    case "gg":
      return [{ family: "symbols", code: 29 }];
    case "lesssim":
      return [{ family: "amsSymbolsA", code: 0x2e }];
    case "gtrsim":
      return [{ family: "amsSymbolsA", code: 0x26 }];
    case "leqslant":
      return [{ family: "amsSymbolsA", code: 0x36 }];
    case "geqslant":
      return [{ family: "amsSymbolsA", code: 0x3e }];
    case "Subset":
      return [{ family: "amsSymbolsA", code: 0x62 }];
    case "Supset":
      return [{ family: "amsSymbolsA", code: 0x63 }];
    case "Vdash":
      return [{ family: "amsSymbolsA", code: 0x0d }];
    case "prec":
      return [{ family: "symbols", code: 30 }];
    case "succ":
      return [{ family: "symbols", code: 31 }];
    case "leftarrow":
    case "gets":
      return [{ family: "symbols", code: 32 }];
    case "rightarrow":
    case "to":
      return [{ family: "symbols", code: 33 }];
    case "leftrightarrow":
      return [{ family: "symbols", code: 36 }];
    case "nearrow":
      return [{ family: "symbols", code: 37 }];
    case "searrow":
      return [{ family: "symbols", code: 38 }];
    case "Leftarrow":
      return [{ family: "symbols", code: 40 }];
    case "Rightarrow":
      return [{ family: "symbols", code: 41 }];
    case "Longrightarrow":
    case "implies":
      return [
        { family: "operators", code: 61 },
        { kind: "kern", width: -1.66667 },
        { family: "symbols", code: 41 },
      ];
    case "Longleftarrow":
      return [
        { family: "symbols", code: 40 },
        { kind: "kern", width: -1.66667 },
        { family: "operators", code: 61 },
      ];
    case "longrightarrow":
      return [
        { family: "symbols", code: 0 },
        { kind: "kern", width: -1.66667 },
        { family: "symbols", code: 33 },
      ];
    case "longleftarrow":
      return [
        { family: "symbols", code: 32 },
        { kind: "kern", width: -1.66667 },
        { family: "symbols", code: 0 },
      ];
    case "Uparrow":
      return [{ family: "symbols", code: 42 }];
    case "Downarrow":
      return [{ family: "symbols", code: 43 }];
    case "Leftrightarrow":
      return [{ family: "symbols", code: 44 }];
    case "Longleftrightarrow":
    case "iff":
      return [
        { family: "symbols", code: 40 },
        { kind: "kern", width: -1.66667 },
        { family: "symbols", code: 41 },
      ];
    case "nwarrow":
      return [{ family: "symbols", code: 45 }];
    case "swarrow":
      return [{ family: "symbols", code: 46 }];
    case "infty":
      return [{ family: "symbols", code: 49 }];
    case "in":
      return [{ family: "symbols", code: 50 }];
    case "ni":
    case "owns":
      return [{ family: "symbols", code: 51 }];
    case "propto":
      return [{ family: "symbols", code: 47 }];
    case "nleqslant":
      return [{ family: "amsSymbolsB", code: 0x0a }];
    case "ngeqslant":
      return [{ family: "amsSymbolsB", code: 0x0b }];
    case "nVdash":
      return [{ family: "amsSymbolsB", code: 0x31 }];
    case "varnothing":
      return [{ family: "amsSymbolsB", code: 0x3f }];
    case "thickapprox":
      return [{ family: "amsSymbolsB", code: 0x74 }];
    case "approxeq":
      return [{ family: "amsSymbolsB", code: 0x75 }];
    case "digamma":
      return [{ family: "amsSymbolsB", code: 0x7a }];
    case "Bbbk":
      return [{ family: "amsSymbolsB", code: 0x7c }];
    case "not":
      return [{ family: "symbols", code: 54 }];
    case "notin":
      return [
        { kind: "kern", xOffset: 0.555565, width: 0.555542 },
        { family: "letters", code: 61, xOffset: 0.555565, advance: -0.555542 },
        { family: "symbols", code: 50 },
      ];
    case "mapsto":
      return [
        { family: "symbols", code: 55 },
        { family: "symbols", code: 33 },
      ];
    case "forall":
      return [{ family: "symbols", code: 56 }];
    case "exists":
      return [{ family: "symbols", code: 57 }];
    case "neg":
    case "lnot":
      return [{ family: "symbols", code: 58 }];
    case "simeq":
      return [{ family: "symbols", code: 39 }];
    case "preceq":
      return [{ family: "symbols", code: 22 }];
    case "succeq":
      return [{ family: "symbols", code: 23 }];
    case "sim":
      return [{ family: "symbols", code: 24 }];
    case "dashv":
      return [{ family: "symbols", code: 97 }];
    case "vdash":
      return [{ family: "symbols", code: 96 }];
    case "mid":
    case "lvert":
    case "rvert":
      return [{ family: "symbols", code: 106 }];
    case "parallel":
    case "lVert":
    case "rVert":
      return [{ family: "symbols", code: 107 }];
    case "uparrow":
      return [{ family: "symbols", code: 34 }];
    case "downarrow":
      return [{ family: "symbols", code: 35 }];
    case "updownarrow":
      return [{ family: "symbols", code: 108 }];
    case "Updownarrow":
      return [{ family: "symbols", code: 109 }];
    case "perp":
      return [{ family: "symbols", code: 63 }];
    case "cup":
      return [{ family: "symbols", code: 91 }];
    case "cap":
      return [{ family: "symbols", code: 92 }];
    case "uplus":
      return [{ family: "symbols", code: 93 }];
    case "wedge":
      return [{ family: "symbols", code: 94 }];
    case "vee":
      return [{ family: "symbols", code: 95 }];
    case "sqcup":
      return [{ family: "symbols", code: 116 }];
    case "sqcap":
      return [{ family: "symbols", code: 117 }];
    case "dagger":
      return [{ family: "symbols", code: 121 }];
    case "ddagger":
      return [{ family: "symbols", code: 122 }];
    case "amalg":
      return [{ family: "symbols", code: 113 }];
    case "wr":
      return [{ family: "symbols", code: 111 }];
    case "bigtriangleup":
      return [{ family: "symbols", code: 52 }];
    case "bigtriangledown":
      return [{ family: "symbols", code: 53 }];
    case "triangleleft":
      return [{ family: "symbols", code: 47 }];
    case "triangleright":
      return [{ family: "symbols", code: 46 }];
    case "star":
      return [{ family: "letters", code: 63 }];
    case "setminus":
      return [{ family: "symbols", code: 110 }];
    case "ne":
    case "neq":
    case "not=":
      return [
        { family: "symbols", code: 54 },
        { family: "operators", code: 61 },
      ];
    case "not\\in":
      return [
        { family: "symbols", code: 54 },
        { family: "symbols", code: 50 },
      ];
    case "not\\subset":
      return [
        { family: "symbols", code: 54 },
        { family: "symbols", code: 26 },
      ];
    case "not\\le":
    case "not\\leq":
      return [
        { family: "symbols", code: 54 },
        { family: "symbols", code: 20 },
      ];
    case "+":
    case "=":
    case "(":
    case ")":
    case "[":
    case "]":
      return [{ family: "operators", code: text.charCodeAt(0) }];
    case "-":
      return [{ family: "symbols", code: 0 }];
    case "*":
      return [{ family: "symbols", code: 3 }];
    case ",":
      return [{ family: "letters", code: 59 }];
    case ":":
      return [{ family: "operators", code: 58 }];
    case ".":
      return [{ family: "letters", code: 58 }];
    case "/":
      return [{ family: "letters", code: 61 }];
    case "<":
    case ">":
      return [{ family: "letters", code: text.charCodeAt(0) }];
    default:
      return [];
  }
}

function muToPt(
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  mu: number
): number {
  const symbols = fontProfile.resolveMathFont({
    family: "symbols",
    style,
    baseAtPt,
  });
  return roundTexPt((tfmToPt(symbols, symbols.data.fontdimen.quad) / 18) * mu);
}

function layoutScriptList(
  list: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathHList | null {
  const result = layoutTexMathList(list, { fontProfile, style, cramped, baseAtPt, alphabet });
  if (!result.supported) {
    return null;
  }
  const clean = omitSingleCharacterCleanBoxItalicCorrection(result.hlist, list);
  const width = roundTexPt(clean.width + TEX_SCRIPT_SPACE_PT);
  return {
    ...expandSingleLineRuleCleanBox(clean, list, width),
    width,
  };
}

function expandSingleLineRuleCleanBox(
  hlist: TexMathHList,
  list: TexMathList,
  width: number
): TexMathHList {
  const item = list.items.length === 1 ? list.items[0] : null;
  if (
    item?.kind !== "atom" ||
    item.subscript ||
    item.superscript ||
    item.nucleus.kind !== "line"
  ) {
    return hlist;
  }

  return {
    ...hlist,
    items: hlist.items.map((layoutItem) => {
      if (layoutItem.kind !== "rule" || (layoutItem.role !== "overline-rule" && layoutItem.role !== "underline-rule")) {
        return layoutItem;
      }
      return {
        ...layoutItem,
        width,
      };
    }),
  };
}

function layoutLimitList(
  list: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number,
  alphabet?: TexMathAlphabetCommand
): TexMathHList | null {
  const result = layoutTexMathList(list, { fontProfile, style, cramped, baseAtPt, alphabet });
  return result.supported ? omitSingleCharacterCleanBoxItalicCorrection(result.hlist, list) : null;
}

function omitSingleCharacterCleanBoxItalicCorrection(
  hlist: TexMathHList,
  list: TexMathList
): TexMathHList {
  if (!isSingleCharacterCleanBoxList(list)) {
    return hlist;
  }
  const last = hlist.items.at(-1);
  if (last?.kind !== "kern" || last.reason !== "italic-correction") {
    return hlist;
  }
  return {
    ...hlist,
    items: hlist.items.slice(0, -1),
  };
}

function reboxSingleCharacterItalicCorrection(hlist: TexMathHList, targetWidth: number): TexMathHList {
  if (hlist.width === targetWidth || hlist.items.length !== 1) {
    return hlist;
  }
  const glyph = hlist.items[0];
  if (glyph?.kind !== "glyph") {
    return hlist;
  }
  const italicCorrection = roundTexPt(hlist.width - glyph.width);
  if (italicCorrection === 0) {
    return hlist;
  }
  return {
    ...hlist,
    items: [
      glyph,
      {
        kind: "kern",
        x: roundTexPt(glyph.x + glyph.width),
        width: italicCorrection,
        reason: "italic-correction",
        sourceSpan: glyph.sourceSpan,
      },
    ],
  };
}

function isSingleCharacterCleanBoxList(list: TexMathList): boolean {
  const item = list.items[0];
  return list.items.length === 1 &&
    item?.kind === "atom" &&
    !item.subscript &&
    !item.superscript &&
    item.nucleus.kind === "glyph";
}

function childHList(
  role: TexMathChildHListLayoutItem["role"],
  x: number,
  y: number,
  hlist: TexMathHList,
  sourceSpan: TexMathSourceSpan
): TexMathChildHListLayoutItem {
  return {
    kind: "hlist",
    role,
    x: roundTexPt(x),
    y: roundTexPt(y),
    width: hlist.width,
    height: hlist.height,
    depth: hlist.depth,
    sourceSpan,
    items: hlist.items,
  };
}

function appendTrailingItalicCorrection(
  layout: TexMathAtomLayout,
  italicCorrection: number,
  sourceSpan: TexMathSourceSpan
): TexMathAtomLayout {
  if (italicCorrection === 0) {
    return layout;
  }
  return {
    ...layout,
    items: [
      ...layout.items,
      {
        kind: "kern",
        x: layout.width,
        width: italicCorrection,
        reason: "italic-correction",
        sourceSpan,
      } satisfies TexMathKernLayoutItem,
    ],
    width: roundTexPt(layout.width + italicCorrection),
  };
}

function offsetMathLayoutItem(item: TexMathHListItem, x: number): TexMathHListItem {
  return {
    ...item,
    x: roundTexPt(item.x + x),
  };
}

function superscriptShiftUp(
  sup: TexMathHList,
  initialShiftUp: number,
  style: TexMathStyle,
  cramped: boolean,
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): number {
  let shiftUp = Math.max(initialShiftUp, superscriptMinimumShift(fontProfile, style, cramped, baseAtPt));
  shiftUp = Math.max(shiftUp, sup.depth + mathXHeight(fontProfile, style, baseAtPt) / 4);
  return roundTexPt(shiftUp);
}

function subscriptShiftDown(
  sub: TexMathHList,
  initialShiftDown: number,
  hasSuperscript: boolean,
  style: TexMathStyle,
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): number {
  let shiftDown = Math.max(initialShiftDown, mathParameterToPt(fontProfile, hasSuperscript ? "sub2" : "sub1", style, baseAtPt));
  if (!hasSuperscript) {
    shiftDown = Math.max(shiftDown, sub.height - (mathXHeight(fontProfile, style, baseAtPt) * 4) / 5);
  }
  return roundTexPt(shiftDown);
}

function combinedScriptShifts(
  sup: TexMathHList,
  sub: TexMathHList,
  initialShifts: { readonly shiftUp: number; readonly shiftDown: number },
  style: TexMathStyle,
  cramped: boolean,
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): { readonly shiftUp: number; readonly shiftDown: number } {
  let shiftUp = superscriptShiftUp(sup, initialShifts.shiftUp, style, cramped, fontProfile, baseAtPt);
  let shiftDown = subscriptShiftDown(sub, initialShifts.shiftDown, true, style, fontProfile, baseAtPt);
  const defaultRuleThickness = mathExtensionParameterToPt(fontProfile, "defaultRuleThickness", style, baseAtPt);
  const clearance = 4 * defaultRuleThickness - ((shiftUp - sup.depth) - (sub.height - shiftDown));
  if (clearance > 0) {
    shiftDown += clearance;
    const xHeightClearance = (mathXHeight(fontProfile, style, baseAtPt) * 4) / 5 - (shiftUp - sup.depth);
    if (xHeightClearance > 0) {
      shiftUp += xHeightClearance;
      shiftDown -= xHeightClearance;
    }
  }
  return {
    shiftUp: roundTexPt(shiftUp),
    shiftDown: roundTexPt(shiftDown),
  };
}

function initialScriptShifts(
  nucleus: TexMathAtomLayout,
  style: TexMathStyle,
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): { readonly shiftUp: number; readonly shiftDown: number } {
  if (nucleus.isCharacterNucleus || nucleus.scriptShiftsAsCharacter) {
    return { shiftUp: 0, shiftDown: 0 };
  }
  return {
    shiftUp: roundTexPt(Math.max(0, nucleus.height - mathParameterToPt(fontProfile, "supDrop", scriptSizeStyle(style), baseAtPt))),
    shiftDown: roundTexPt(Math.max(0, nucleus.depth + mathParameterToPt(fontProfile, "subDrop", scriptSizeStyle(style), baseAtPt))),
  };
}

function superscriptMinimumShift(
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  cramped: boolean,
  baseAtPt: number
): number {
  if (cramped) {
    return mathParameterToPt(fontProfile, "sup3", style, baseAtPt);
  }
  if (style === "display") {
    return mathParameterToPt(fontProfile, "sup1", style, baseAtPt);
  }
  return mathParameterToPt(fontProfile, "sup2", style, baseAtPt);
}

function mathParameterToPt(
  fontProfile: TexMathFontProfile,
  name:
    | "axisHeight"
    | "num1"
    | "num2"
    | "num3"
    | "denom1"
    | "denom2"
    | "delim1"
    | "delim2"
    | "sup1"
    | "sup2"
    | "sup3"
    | "sub1"
    | "sub2"
    | "supDrop"
    | "subDrop",
  style: TexMathStyle,
  baseAtPt: number
): number {
  const symbols = fontProfile.resolveMathFont({
    family: "symbols",
    style,
    baseAtPt,
  });
  return tfmToPt(symbols, requiredFontdimen(symbols, mathParameterFontdimenName(name)));
}

function mathExtensionParameterToPt(
  fontProfile: TexMathFontProfile,
  name:
    | "defaultRuleThickness"
    | "bigOpSpacing1"
    | "bigOpSpacing2"
    | "bigOpSpacing3"
    | "bigOpSpacing4"
    | "bigOpSpacing5",
  style: TexMathStyle,
  baseAtPt: number
): number {
  const extension = fontProfile.resolveMathFont({
    family: "extension",
    style,
    baseAtPt,
  });
  return tfmToPt(extension, requiredFontdimen(extension, mathExtensionParameterFontdimenName(name)));
}

function mathStyleParameterToPt(
  fontProfile: TexMathFontProfile,
  name: "stackNumUp" | "stackDenomDown" | "stackVGap",
  style: TexMathStyle,
  baseAtPt: number
): number {
  return roundTexPt(fontProfile.parameters[name][style] * (baseAtPt / 10));
}

function mathExtensionParameterFontdimenName(
  name:
    | "defaultRuleThickness"
    | "bigOpSpacing1"
    | "bigOpSpacing2"
    | "bigOpSpacing3"
    | "bigOpSpacing4"
    | "bigOpSpacing5"
): string {
  return {
    defaultRuleThickness: "defaultrulethickness",
    bigOpSpacing1: "bigopspacing1",
    bigOpSpacing2: "bigopspacing2",
    bigOpSpacing3: "bigopspacing3",
    bigOpSpacing4: "bigopspacing4",
    bigOpSpacing5: "bigopspacing5",
  }[name];
}

function charHeightPlusDepth(
  font: ResolvedTexFont,
  metric: GeneratedTexCharMetric
): number {
  return tfmToPt(font, metric.height) + tfmToPt(font, metric.depth);
}

function mathXHeight(
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): number {
  const symbols = fontProfile.resolveMathFont({
    family: "symbols",
    style,
    baseAtPt,
  });
  return tfmToPt(symbols, symbols.data.fontdimen.xheight);
}

function radicalInitialClearance(
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  defaultRuleThickness: number
): number {
  if (style === "display") {
    return defaultRuleThickness + Math.abs(mathXHeight(fontProfile, style, baseAtPt)) / 4;
  }
  return defaultRuleThickness + Math.abs(defaultRuleThickness) / 4;
}

function leftRightDelimiterTarget(
  height: number,
  depth: number,
  axis: number
): number {
  const maxDistanceFromAxis = Math.max(height - axis, depth + axis);
  const factored = (Math.floor((maxDistanceFromAxis * TEX_SP_PER_PT) / 500) * TEX_DELIMITER_FACTOR) / TEX_SP_PER_PT;
  const shortfallAdjusted = 2 * maxDistanceFromAxis - TEX_DELIMITER_SHORTFALL_PT;
  return Math.max(factored, shortfallAdjusted);
}

function supStyle(style: TexMathStyle): TexMathStyle {
  return style === "text" || style === "display" ? "script" : "scriptscript";
}

function subStyle(style: TexMathStyle): TexMathStyle {
  return style === "text" || style === "display" ? "script" : "scriptscript";
}

function numeratorStyle(style: TexMathStyle): TexMathStyle {
  return style === "display" ? "text" : supStyle(style);
}

function denominatorStyle(style: TexMathStyle): TexMathStyle {
  return style === "display" ? "text" : subStyle(style);
}

function scriptSizeStyle(style: TexMathStyle): TexMathStyle {
  return style === "script" || style === "scriptscript" ? "scriptscript" : "script";
}

function delimiterSizeStyle(style: TexMathStyle): TexMathStyle {
  return style === "script" || style === "scriptscript" ? style : "text";
}

function mathParameterFontdimenName(
  name:
    | "axisHeight"
    | "num1"
    | "num2"
    | "num3"
    | "denom1"
    | "denom2"
    | "delim1"
    | "delim2"
    | "sup1"
    | "sup2"
    | "sup3"
    | "sub1"
    | "sub2"
    | "supDrop"
    | "subDrop"
): string {
  if (name === "axisHeight") {
    return "axisheight";
  }
  if (name === "supDrop") {
    return "supdrop";
  }
  if (name === "subDrop") {
    return "subdrop";
  }
  return name;
}

function requiredFontdimen(font: ResolvedTexFont, name: string): number {
  const value = font.data.fontdimen[name];
  if (value === undefined) {
    throw new Error(`Font '${font.id}' is missing required math fontdimen '${name}'.`);
  }
  return value;
}

function requiredCharMetric(
  font: ResolvedTexFont,
  code: number
): GeneratedTexCharMetric {
  const metric = font.data.chars[String(code)];
  if (!metric) {
    throw new Error(`Font '${font.id}' has no TeX math metric for code ${code}.`);
  }
  return metric;
}
