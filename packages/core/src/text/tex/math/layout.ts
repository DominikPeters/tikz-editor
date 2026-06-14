import { roundTexPt, tfmToPt } from "../fonts/units.js";
import type {
  GeneratedTexCharMetric,
  ResolvedTexFont,
} from "../fonts/types.js";
import {
  defaultTexMathFontProfile,
  type TexMathFontFamily,
  type TexMathFontProfile,
} from "./font-profile.js";
import type {
  TexMathAtom,
  TexMathGlyphNucleus,
  TexMathList,
  TexMathNucleus,
  TexMathSourceSpan,
  TexMathStyle,
} from "./ir.js";
import {
  spaceTexMathList,
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
  readonly family: TexMathFontFamily;
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
  readonly reason: "italic-correction";
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathRuleLayoutItem {
  readonly kind: "rule";
  readonly role: "fraction-rule" | "radical-rule";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathChildHListLayoutItem {
  readonly kind: "hlist";
  readonly role: "nucleus" | "superscript" | "subscript";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly sourceSpan: TexMathSourceSpan;
  readonly items: readonly TexMathHListItem[];
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
  readonly fontProfile?: TexMathFontProfile;
  readonly baseAtPt?: number;
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
  readonly family: TexMathFontFamily;
  readonly font: ResolvedTexFont;
  readonly code: number;
  readonly text: string;
  readonly sourceSpan: TexMathSourceSpan;
}

const TEX_SCRIPT_SPACE_PT = 0.5;
const TEX_NULL_DELIMITER_SPACE_PT = 1.2;

interface TexMathAtomLayout {
  readonly items: readonly TexMathHListItem[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly italicCorrection: number;
  readonly isCharacterNucleus: boolean;
  readonly sourceSpan: TexMathSourceSpan;
}

export function layoutTexMathList(
  list: TexMathList,
  options: TexMathLayoutOptions = {}
): TexMathLayoutResult {
  const style = options.style ?? "text";
  const fontProfile = options.fontProfile ?? defaultTexMathFontProfile;
  const baseAtPt = options.baseAtPt ?? 10;
  const spaced = spaceTexMathList(list, { style });
  const items: TexMathHListItem[] = [];
  const errors: TexMathLayoutError[] = [];
  let cursor = 0;
  let height = 0;
  let depth = 0;

  for (const item of spaced.items) {
    if (item.kind === "resolved-glue") {
      const width = muToPt(fontProfile, style, baseAtPt, item.mu);
      const stretch = muToPt(fontProfile, style, baseAtPt, item.stretchMu);
      const shrink = muToPt(fontProfile, style, baseAtPt, item.shrinkMu);
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
    if (item.kind === "unsupported") {
      errors.push({
        message: `Unsupported TeX math item ${item.command}.`,
        sourceSpan: item.sourceSpan,
      });
      continue;
    }

    const atomLayout = layoutAtom(item, fontProfile, style, baseAtPt);
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

  return {
    supported: true,
    hlist: {
      kind: "math-hlist",
      style,
      width: roundTexPt(cursor),
      height: roundTexPt(height),
      depth: roundTexPt(depth),
      sourceSpan: list.sourceSpan,
      items,
    },
    errors: [],
  };
}

function layoutAtom(
  atom: TexMathAtom,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  const nucleus = layoutNucleus(atom.nucleus, fontProfile, style, baseAtPt);
  if (!nucleus) {
    return null;
  }

  if (!atom.subscript && !atom.superscript) {
    return nucleus.isCharacterNucleus
      ? appendTrailingItalicCorrection(nucleus, nucleus.italicCorrection, nucleus.sourceSpan)
      : nucleus;
  }

  const items: TexMathHListItem[] = [...nucleus.items];
  let scriptStartX = nucleus.width;
  let atomWidth = nucleus.width;
  let height = nucleus.height;
  let depth = nucleus.depth;
  const delta = atom.subscript && nucleus.isCharacterNucleus ? nucleus.italicCorrection : 0;
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
  }

  const sup = atom.superscript
    ? layoutScriptList(atom.superscript.list, fontProfile, supStyle(style), baseAtPt)
    : null;
  const sub = atom.subscript
    ? layoutScriptList(atom.subscript.list, fontProfile, subStyle(style), baseAtPt)
    : null;
  if ((atom.superscript && !sup) || (atom.subscript && !sub)) {
    return null;
  }

  const baseShifts = initialScriptShifts(nucleus, style, fontProfile, baseAtPt);
  if (sup && !sub) {
    const shiftUp = superscriptShiftUp(sup, baseShifts.shiftUp, style, fontProfile, baseAtPt);
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
    const shifts = combinedScriptShifts(sup, sub, baseShifts, style, fontProfile, baseAtPt);
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

function layoutNucleus(
  nucleus: TexMathNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  if (nucleus.kind === "glyph") {
    return layoutGlyphNucleus(nucleus, fontProfile, style, baseAtPt);
  }
  if (nucleus.kind === "list") {
    const result = layoutTexMathList(nucleus.list, { fontProfile, style, baseAtPt });
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
    return layoutFractionNucleus(nucleus, fontProfile, style, baseAtPt);
  }
  if (nucleus.kind === "radical") {
    return layoutRadicalNucleus(nucleus, fontProfile, style, baseAtPt);
  }
  return null;
}

function layoutFractionNucleus(
  nucleus: Extract<TexMathNucleus, { readonly kind: "fraction" }>,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  const numerator = layoutFractionList(nucleus.numerator, fontProfile, numeratorStyle(style), baseAtPt);
  const denominator = layoutFractionList(nucleus.denominator, fontProfile, denominatorStyle(style), baseAtPt);
  if (!numerator || !denominator) {
    return null;
  }

  const fractionWidth = roundTexPt(Math.max(numerator.width, denominator.width));
  const width = roundTexPt(fractionWidth + 2 * TEX_NULL_DELIMITER_SPACE_PT);
  const thickness = mathExtensionParameterToPt(fontProfile, "defaultRuleThickness", baseAtPt);
  const axis = mathParameterToPt(fontProfile, "axisHeight", style, baseAtPt);
  let shiftUp: number;
  let shiftDown: number;
  if (style === "display") {
    shiftUp = mathParameterToPt(fontProfile, "num1", style, baseAtPt);
    shiftDown = mathParameterToPt(fontProfile, "denom1", style, baseAtPt);
  } else {
    shiftUp = mathParameterToPt(fontProfile, "num2", style, baseAtPt);
    shiftDown = mathParameterToPt(fontProfile, "denom2", style, baseAtPt);
  }

  const halfThickness = thickness / 2;
  const clearance = style === "display" ? 3 * thickness : thickness;
  const delta1 = clearance - ((shiftUp - numerator.depth) - (axis + halfThickness));
  const delta2 = clearance - ((axis - halfThickness) - (denominator.height - shiftDown));
  if (delta1 > 0) {
    shiftUp += delta1;
  }
  if (delta2 > 0) {
    shiftDown += delta2;
  }

  const numeratorChild = childHList(
    "nucleus",
    TEX_NULL_DELIMITER_SPACE_PT + (fractionWidth - numerator.width) / 2,
    -shiftUp,
    numerator,
    numerator.sourceSpan
  );
  const denominatorChild = childHList(
    "nucleus",
    TEX_NULL_DELIMITER_SPACE_PT + (fractionWidth - denominator.width) / 2,
    shiftDown,
    denominator,
    denominator.sourceSpan
  );
  const rule = {
    kind: "rule",
    role: "fraction-rule",
    x: TEX_NULL_DELIMITER_SPACE_PT,
    y: roundTexPt(-(axis + halfThickness)),
    width: fractionWidth,
    height: roundTexPt(thickness),
    sourceSpan: nucleus.sourceSpan,
  } satisfies TexMathRuleLayoutItem;

  return {
    items: [numeratorChild, rule, denominatorChild],
    width,
    height: roundTexPt(shiftUp + numerator.height),
    depth: roundTexPt(denominator.depth + shiftDown),
    italicCorrection: 0,
    isCharacterNucleus: false,
    sourceSpan: nucleus.sourceSpan,
  };
}

function layoutFractionList(
  list: TexMathList,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathHList | null {
  const result = layoutTexMathList(list, { fontProfile, style, baseAtPt });
  return result.supported ? result.hlist : null;
}

function layoutRadicalNucleus(
  nucleus: Extract<TexMathNucleus, { readonly kind: "radical" }>,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  const radicand = layoutRadicandList(nucleus.radicand, fontProfile, style, baseAtPt);
  if (!radicand) {
    return null;
  }

  const radicalFont = fontProfile.resolveMathFont({
    family: "symbols",
    style,
    baseAtPt,
  });
  const radicalCode = 112;
  const radicalMetric = requiredCharMetric(radicalFont, radicalCode);
  const radicalWidth = roundTexPt(tfmToPt(radicalFont, radicalMetric.width));
  const radicalHeight = roundTexPt(tfmToPt(radicalFont, radicalMetric.height));
  const radicalDepth = roundTexPt(tfmToPt(radicalFont, radicalMetric.depth));
  const thickness = mathExtensionParameterToPt(fontProfile, "defaultRuleThickness", baseAtPt);
  let clearance = radicalInitialClearance(fontProfile, style, baseAtPt, thickness);
  const targetHeight = radicand.height + radicand.depth + clearance + thickness;
  if (radicalHeight + radicalDepth < targetHeight) {
    return null;
  }

  const delta = radicalDepth - (radicand.height + radicand.depth + clearance);
  if (delta > 0) {
    clearance += delta / 2;
  }
  const radicalY = roundTexPt(-(radicand.height + clearance));
  const ruleY = roundTexPt(radicalY - thickness);
  const radicalGlyph = {
    kind: "glyph",
    fontId: radicalFont.id,
    atPt: radicalFont.atPt,
    family: "symbols",
    code: radicalCode,
    text: "\\sqrt",
    x: 0,
    y: radicalY,
    width: radicalWidth,
    height: radicalHeight,
    depth: radicalDepth,
    italicCorrection: roundTexPt(tfmToPt(radicalFont, radicalMetric.italicCorrection)),
    sourceSpan: nucleus.sourceSpan,
  } satisfies TexMathGlyphLayoutItem;
  const rule = {
    kind: "rule",
    role: "radical-rule",
    x: radicalWidth,
    y: ruleY,
    width: radicand.width,
    height: roundTexPt(thickness),
    sourceSpan: nucleus.sourceSpan,
  } satisfies TexMathRuleLayoutItem;
  const radicandChild = childHList(
    "nucleus",
    radicalWidth,
    0,
    radicand,
    nucleus.radicand.sourceSpan
  );
  const height = Math.max(
    radicand.height,
    -radicalGlyph.y + radicalGlyph.height,
    -rule.y + rule.height
  );
  const depth = Math.max(
    radicand.depth,
    radicalGlyph.y + radicalGlyph.depth
  );

  return {
    items: [radicalGlyph, rule, radicandChild],
    width: roundTexPt(radicalWidth + radicand.width),
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
  baseAtPt: number
): TexMathHList | null {
  const result = layoutTexMathList(list, { fontProfile, style, baseAtPt });
  return result.supported ? result.hlist : null;
}

function layoutGlyphNucleus(
  nucleus: TexMathGlyphNucleus,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): TexMathAtomLayout | null {
  const glyph = resolveMathGlyph(nucleus, fontProfile, style, baseAtPt);
  if (!glyph) {
    return null;
  }
  const metric = requiredCharMetric(glyph.font, glyph.code);
  const width = roundTexPt(tfmToPt(glyph.font, metric.width));
  const glyphHeight = roundTexPt(tfmToPt(glyph.font, metric.height));
  const glyphDepth = roundTexPt(tfmToPt(glyph.font, metric.depth));
  const italicCorrection = roundTexPt(tfmToPt(glyph.font, metric.italicCorrection));
  return {
    items: [{
      kind: "glyph",
      fontId: glyph.font.id,
      atPt: glyph.font.atPt,
      family: glyph.family,
      code: glyph.code,
      text: glyph.text,
      x: 0,
      y: 0,
      width,
      height: glyphHeight,
      depth: glyphDepth,
      italicCorrection,
      sourceSpan: glyph.sourceSpan,
    }],
    width,
    height: glyphHeight,
    depth: glyphDepth,
    italicCorrection,
    isCharacterNucleus: true,
    sourceSpan: glyph.sourceSpan,
  };
}

export function resolveMathGlyph(
  nucleus: TexMathGlyphNucleus,
  fontProfile: TexMathFontProfile = defaultTexMathFontProfile,
  style: TexMathStyle = "text",
  baseAtPt = 10
): ResolvedMathGlyph | null {
  const resolved = defaultLuaLatexMathSymbol(nucleus.text);
  if (!resolved) {
    return null;
  }
  return {
    font: fontProfile.resolveMathFont({
      family: resolved.family,
      style,
      baseAtPt,
    }),
    family: resolved.family,
    code: resolved.code,
    text: nucleus.text,
    sourceSpan: nucleus.sourceSpan,
  };
}

function defaultLuaLatexMathSymbol(
  text: string
): Pick<ResolvedMathGlyph, "family" | "code"> | null {
  if (/^[A-Za-z]$/.test(text)) {
    return { family: "letters", code: text.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(text)) {
    return { family: "operators", code: text.charCodeAt(0) };
  }
  switch (text) {
    case "+":
    case "=":
    case "(":
    case ")":
    case "[":
    case "]":
      return { family: "operators", code: text.charCodeAt(0) };
    case "-":
      return { family: "symbols", code: 0 };
    case "*":
      return { family: "symbols", code: 3 };
    case ",":
      return { family: "letters", code: 59 };
    case ".":
      return { family: "letters", code: 58 };
    case "/":
      return { family: "letters", code: 61 };
    case "<":
    case ">":
      return { family: "letters", code: text.charCodeAt(0) };
    default:
      return null;
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
  baseAtPt: number
): TexMathHList | null {
  const result = layoutTexMathList(list, { fontProfile, style, baseAtPt });
  if (!result.supported) {
    return null;
  }
  return {
    ...result.hlist,
    width: roundTexPt(result.hlist.width + TEX_SCRIPT_SPACE_PT),
  };
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
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): number {
  let shiftUp = Math.max(initialShiftUp, superscriptMinimumShift(fontProfile, style, baseAtPt));
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
  shiftDown = Math.max(shiftDown, sub.height - (mathXHeight(fontProfile, style, baseAtPt) * 4) / 5);
  return roundTexPt(shiftDown);
}

function combinedScriptShifts(
  sup: TexMathHList,
  sub: TexMathHList,
  initialShifts: { readonly shiftUp: number; readonly shiftDown: number },
  style: TexMathStyle,
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): { readonly shiftUp: number; readonly shiftDown: number } {
  let shiftUp = superscriptShiftUp(sup, initialShifts.shiftUp, style, fontProfile, baseAtPt);
  let shiftDown = subscriptShiftDown(sub, initialShifts.shiftDown, true, style, fontProfile, baseAtPt);
  const defaultRuleThickness = mathExtensionParameterToPt(fontProfile, "defaultRuleThickness", baseAtPt);
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
  if (nucleus.isCharacterNucleus) {
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
  baseAtPt: number
): number {
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
    | "denom1"
    | "denom2"
    | "sup1"
    | "sup2"
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
  name: "defaultRuleThickness",
  baseAtPt: number
): number {
  const extension = fontProfile.resolveMathFont({
    family: "extension",
    style: "text",
    baseAtPt,
  });
  return tfmToPt(extension, fontProfile.parameters[name]);
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

function mathParameterFontdimenName(
  name:
    | "axisHeight"
    | "num1"
    | "num2"
    | "denom1"
    | "denom2"
    | "sup1"
    | "sup2"
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
