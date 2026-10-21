import type { Span } from "../ast/types.js";
import type { Deg, Pt } from "../coords/scalars.js";
import { formatNumber } from "./format.js";

declare const fragmentBrand: unique symbol;
declare const editedSourceBrand: unique symbol;
declare const coordinateTextBrand: unique symbol;
declare const optionValueBrand: unique symbol;

/**
 * Source text an edit writes. Runtime values enter one only through a typed
 * constructor: the coordinate writer for anything read in a frame, `option`
 * for option values, `userText` for what the user typed, `sourceSlice` for
 * text copied from the document. `tikz` composes them around literal text.
 */
export type TikzFragment = string & { readonly [fragmentBrand]: true };

/** Coordinate-writer output: the only value a frame-dependent option key accepts. */
export type CoordinateText = TikzFragment & { readonly [coordinateTextBrand]: true };

/** A document after fragments were applied: the only source an edit result carries. */
export type EditedSource = string & { readonly [editedSourceBrand]: true };

/**
 * A frame-free value for an option. Not a string and not a fragment, so it
 * cannot fill a `tikz` hole or a patch; it enters source only through `option`.
 */
export type OptionValue = Readonly<{ [optionValueBrand]: true; text: string }>;

/** Why a raw string is trusted as source text. Each call site is reviewed (checker rule F2). */
export type UserTextOrigin =
  | "inspector-value"
  | "node-text"
  | "pasted-tikz"
  | "assistant-tikz"
  | "imported-svg"
  | "source-editor"
  | "beamer-text";

function asFragment(text: string): TikzFragment {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This module is the fragment constructor boundary.
  return text as TikzFragment;
}

function asEditedSource(text: string): EditedSource {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This module is the fragment constructor boundary.
  return text as EditedSource;
}

export const EMPTY_FRAGMENT: TikzFragment = asFragment("");

/**
 * Literal text with fragment holes. Must be used as a tagged template
 * (checker rule F4): called as a function, it would accept built strings.
 * The literal is raw, so TeX is written as TeX (one backslash before a
 * control word), and a line break is a real line break.
 */
export function tikz(strings: TemplateStringsArray, ...parts: readonly TikzFragment[]): TikzFragment {
  let text = strings.raw[0] ?? "";
  for (const [index, part] of parts.entries()) text += part + (strings.raw[index + 1] ?? "");
  return asFragment(text);
}

export function joinFragments(parts: readonly TikzFragment[], separator: TikzFragment = EMPTY_FRAGMENT): TikzFragment {
  return asFragment(parts.join(separator));
}

/** Text copied verbatim from the document being edited (checker rule F2 lists the call sites). */
export function sourceSlice(source: string, span: Span): TikzFragment {
  return asFragment(source.slice(span.from, span.to));
}

/** Text the user typed or pasted (checker rule F2 lists the call sites). */
export function userText(text: string, origin: UserTextOrigin): TikzFragment {
  void origin;
  return asFragment(text);
}

/**
 * Migration only: source text built before the fragment layer existed. Every
 * call site is a fingerprinted exception that may only be removed, never
 * added (checker rule F2).
 */
export function legacyText(text: string): TikzFragment {
  return asFragment(text);
}

/** Migration only: a whole edited document built from strings (checker rule F2). */
export function legacyEditedSource(text: string): EditedSource {
  return asEditedSource(text);
}

/** The document unchanged, as an edit result's source. */
export function unchangedSource(source: string): EditedSource {
  return asEditedSource(source);
}

/** Whitespace between statements or options: newlines and indentation, nothing else. */
export function layout(text: string): TikzFragment {
  if (!/^\s*$/.test(text)) throw new Error(`layout() takes whitespace only, got ${JSON.stringify(text)}`);
  return asFragment(text);
}

/** Part of a fragment is still text a typed constructor produced. */
export function sliceFragment(fragment: TikzFragment, from: number, to?: number): TikzFragment {
  return asFragment(fragment.slice(from, to));
}

/** A slice of an edited document, or of a fragment, is still text a typed constructor produced. */
export function editedSlice(source: EditedSource | TikzFragment, from: number, to: number): TikzFragment {
  return asFragment(source.slice(from, to));
}

export type FragmentEdit = Readonly<{ span: Span; fragment: TikzFragment }>;

/** Applies non-overlapping edits, given against `source`, in source order. */
export function applyFragments(source: string, edits: readonly FragmentEdit[]): EditedSource {
  const sorted = [...edits].sort((left, right) => left.span.from - right.span.from || left.span.to - right.span.to);
  let cursor = 0;
  let output = "";
  for (const { span, fragment } of sorted) {
    if (span.from < cursor || span.from > span.to || span.to > source.length) throw new Error("Fragment edits overlap or leave the source");
    output += source.slice(cursor, span.from) + fragment;
    cursor = span.to;
  }
  return asEditedSource(output + source.slice(cursor));
}

// Option values: frame-free by construction.

export function count(value: number): OptionValue {
  if (!Number.isInteger(value)) throw new Error(`count needs an integer, got ${value}`);
  return optionValue(String(value));
}

/** An angle that is not geometry in a frame: label and pin directions, arrow bends. */
export function angle(value: Deg, fractionDigits = 2): OptionValue {
  return optionValue(formatNumber(value, { fractionDigits }));
}

export type CanvasLengthUnit = "pt" | "cm" | "mm" | "in" | "em" | "ex" | "bp";
const PT_PER_UNIT: Record<Exclude<CanvasLengthUnit, "em" | "ex">, number> = {
  pt: 1, cm: 72.27 / 2.54, mm: 72.27 / 25.4, in: 72.27, bp: 72.27 / 72
};

/** A length PGF does not transform: node sizes without `transform shape`, line widths, separations. */
export function canvasLength(value: Pt, unit: Exclude<CanvasLengthUnit, "em" | "ex"> = "pt", fractionDigits = 2): OptionValue {
  return optionValue(`${formatNumber(value / PT_PER_UNIT[unit], { fractionDigits })}${unit}`);
}

/** A plain ratio or fraction: `pos=`, opacity, `looseness`. */
export function ratio(value: number, fractionDigits = 3): OptionValue {
  return optionValue(formatNumber(value, { fractionDigits }));
}

function optionValue(text: string): OptionValue {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This module is the option value constructor boundary.
  return Object.freeze({ text }) as OptionValue;
}

/**
 * Keys whose values are read in the frame: transformations, and lengths or
 * positions the CTM or axis vectors scale. They take coordinate-writer output.
 */
export const FRAME_KEYS = [
  "shift", "xshift", "yshift", "rotate", "rotate around", "scale", "xscale", "yscale",
  "xslant", "yslant", "x", "y", "z", "cm", "at", "radius", "x radius", "y radius",
  "start angle", "end angle", "delta angle", "node distance", "shift only"
] as const;

/**
 * Keys whose values PGF does not transform. They take option values. Keys
 * in neither table (`in`, `out`, `bend left`, `rounded corners`, tree
 * distances…) take user text until their frame semantics are checked in PGF.
 */
export const CANVAS_KEYS = [
  "minimum width", "minimum height", "minimum size", "inner sep", "inner xsep", "inner ysep",
  "outer sep", "outer xsep", "outer ysep", "line width", "label distance", "pin distance",
  "text width", "shorten >", "shorten <", "double distance",
  "pos", "opacity", "draw opacity", "fill opacity", "looseness"
] as const;

export type FrameKey = typeof FRAME_KEYS[number];
export type CanvasKey = typeof CANVAS_KEYS[number];
type ReservedKey = FrameKey | CanvasKey;
/** A literal key outside both tables; a wide `string` could hide a reserved key. */
type OtherKey<K extends string> = string extends K ? never : K extends ReservedKey ? never : K;

/**
 * One `key=value` option. Frame keys take writer output, canvas keys take
 * option values, any other key takes text the user wrote or a literal.
 */
export function option(key: FrameKey, value: CoordinateText): TikzFragment;
export function option(key: CanvasKey, value: OptionValue): TikzFragment;
export function option<K extends string>(key: OtherKey<K>, value?: TikzFragment): TikzFragment;
export function option(key: string, value?: CoordinateText | OptionValue | TikzFragment): TikzFragment {
  if (value === undefined) return asFragment(key);
  const text = typeof value === "string" ? value : value.text;
  const braced = /[,=[\]]/.test(text) && !/^\{.*\}$/.test(text) ? `{${text}}` : text;
  return asFragment(`${key}=${braced}`);
}

/** The value text alone, for option mutations that keep the key separately. Same key table as `option`. */
export function optionValueFor(key: FrameKey, value: CoordinateText): TikzFragment;
export function optionValueFor(key: CanvasKey, value: OptionValue): TikzFragment;
export function optionValueFor(key: string, value: CoordinateText | OptionValue): TikzFragment {
  void key;
  return asFragment(typeof value === "string" ? value : value.text);
}

/** `[a, b]`, or nothing when there are no options. */
export function optionList(options: readonly TikzFragment[]): TikzFragment {
  return options.length === 0 ? EMPTY_FRAGMENT : asFragment(`[${options.join(", ")}]`);
}
