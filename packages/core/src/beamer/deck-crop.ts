import { applyFragments, plainNumber, sourceSlice, tikz, EMPTY_FRAGMENT, type TikzFragment } from "../edit/fragment.js";
import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import { texDimensionUnitFactor } from "../text/tex/dimensions.js";
import { readOptionList, rewriteBeamerOptions, type OptionListLocation } from "./option-edits.js";
import { beamerOptionalArgumentAfter, beamerOverlayArgumentAfter, createBeamerSyntaxContext } from "./syntax.js";
import type { BeamerFrameLayout, BeamerRect } from "./types.js";

/** Amounts cut from each side of the image's natural box, in TeX points. */
export type BeamerImageCrop = { readonly left: number; readonly bottom: number; readonly right: number; readonly top: number };

/** A size value's number; an empty span before a bare register (`\\textwidth`) inserts one. */
type SizeValue = { readonly axis: "x" | "y"; readonly span: Span; readonly factor: number };

export type BeamerImageCropTarget = {
  readonly objectId: string;
  readonly sourceStart: number;
  /** The drawn (kept) part of the image on the slide. */
  readonly bounds: BeamerRect;
  /** The whole image at its drawn scale, positioned behind `bounds`. */
  readonly imageBounds: BeamerRect;
  readonly natural: { readonly width: number; readonly height: number };
  readonly crop: BeamerImageCrop;
  /** Slide points per natural point. */
  readonly scale: { readonly x: number; readonly y: number };
  readonly filename: string;
  /** @internal source edit plan */
  readonly plan: CropSourcePlan;
};

type CropSourcePlan = {
  readonly key: { readonly name: "trim" | "viewport" | "bb"; readonly entrySpan: Span; readonly valueSpan: Span; readonly previousEnd: number | null; readonly nextStart: number | null } | null;
  /** Where `, trim=…` goes in an existing list, or where a new `[…]` goes. */
  readonly insert: { readonly at: number; readonly list: "none" | "empty" | "entries" };
  readonly clip: "present" | "missing" | { readonly falseEntry: Span };
  readonly sizes: readonly SizeValue[];
  /** Reset must remove every crop key, including ones shadowed by the last. */
  readonly resetList: OptionListLocation | null;
};

const BP = 72.27 / 72;

function cropKeyName(key: string | null | undefined): "trim" | "viewport" | "bb" | null {
  return key === "trim" || key === "viewport" || key === "bb" ? key : null;
}
const NUMBER = String.raw`[+]?(?:\d+(?:\.\d*)?|\.\d+)`;

/** `0.5\textwidth`, `3cm`, `\linewidth`: a value whose number can be scaled in place. */
function sizeValue(source: string, span: Span, axis: "x" | "y"): SizeValue | null {
  const raw = source.slice(span.from, span.to);
  const match = new RegExp(String.raw`^(\s*\{?\s*)(${NUMBER})?(\s*(?:\\[a-zA-Z]+|[a-zA-Z]{2}))(\s*\}?\s*)$`, "u").exec(raw);
  if (!match || raw.includes("{") !== raw.includes("}")) return null;
  const number = match[2];
  if (number === undefined && !match[3]?.trim().startsWith("\\")) return null;
  const from = span.from + (match[1]?.length ?? 0);
  const factor = number === undefined ? 1 : Number(number);
  if (!(factor > 0)) return null;
  return { axis, span: { from, to: from + (number?.length ?? 0) }, factor };
}

/**
 * The crop state of a drawn image and how to write a new one back, or null
 * when the preview cannot crop it faithfully: rotated, draft, unresolved, or
 * sized by values whose number cannot be rescaled in place.
 */
export function beamerImageCropTarget(source: string, layout: BeamerFrameLayout, objectId: string): BeamerImageCropTarget | null {
  const graphic = layout.graphics.find((item) => item.itemId === objectId && item.visibility === "visible");
  if (graphic?.asset.status !== "resolved" || graphic.bounds.width <= 0 || graphic.bounds.height <= 0) return null;
  const options = graphic.options;
  if (options.draft || options.sizeKeys?.some((key) => key.key === "angle" || (key.key !== "scale" && key.value === null))) return null;
  // The two-bracket corner form has no key to rewrite.
  if ((options.viewport || options.trim) && !options.optionList) return null;
  const natural = { width: graphic.asset.naturalWidthPt, height: graphic.asset.naturalHeightPt };
  const crop: BeamerImageCrop = options.trim
    ? { left: options.trim.left, bottom: options.trim.bottom, right: options.trim.right, top: options.trim.top }
    : options.viewport
      ? { left: options.viewport.llx, bottom: options.viewport.lly, right: natural.width - options.viewport.urx, top: natural.height - options.viewport.ury }
      : { left: 0, bottom: 0, right: 0, top: 0 };
  const keptWidth = natural.width - crop.left - crop.right;
  const keptHeight = natural.height - crop.bottom - crop.top;
  if (!(keptWidth > 0) || !(keptHeight > 0)) return null;

  const context = createBeamerSyntaxContext(source);
  const command = context.syntax.controlsIn(graphic.sourceSpan).find((item) => item.name === "includegraphics");
  if (!command) return null;
  const commandEnd = command.starSpan?.to ?? command.span.to;
  const afterOverlay = beamerOverlayArgumentAfter(context, commandEnd, graphic.sourceSpan.to)?.span.to ?? commandEnd;
  const optional = beamerOptionalArgumentAfter(context, afterOverlay, graphic.sourceSpan.to);
  const list = optional ? readOptionList(source, optional) : null;
  const entries = list?.entries ?? [];
  const lastIndex = (keys: readonly string[]) => entries.map((entry) => keys.includes(entry.key ?? "")).lastIndexOf(true);

  const keyIndex = lastIndex(["trim", "viewport", "bb"]);
  const keyEntry = keyIndex >= 0 ? entries[keyIndex] : undefined;
  if (keyEntry && !keyEntry.valueSpan) return null;
  const keyName = cropKeyName(keyEntry?.key);
  const key = keyEntry?.valueSpan && keyName ? {
    name: keyName,
    entrySpan: keyEntry.span,
    valueSpan: keyEntry.valueSpan,
    previousEnd: entries[keyIndex - 1]?.span.to ?? null,
    nextStart: entries[keyIndex + 1]?.span.from ?? null,
  } : null;

  const clipIndex = lastIndex(["clip"]);
  const clipEntry = clipIndex >= 0 ? entries[clipIndex] : undefined;
  const clipFalse = clipEntry?.valueSpan && /^\s*\{?\s*(?:false|0|no)\s*\}?\s*$/iu.test(source.slice(clipEntry.valueSpan.from, clipEntry.valueSpan.to));
  const clip = clipEntry && !clipFalse ? "present" as const
    : clipEntry && clipFalse ? { falseEntry: clipEntry.span }
    : command.starSpan ? "present" as const : "missing" as const;

  const sizes: SizeValue[] = [];
  for (const [axis, keys] of [["x", ["width"]], ["y", ["height", "totalheight"]]] as const) {
    const entry = entries[lastIndex(keys)];
    if (!entry) continue;
    const value = entry.valueSpan && sizeValue(source, entry.valueSpan, axis);
    if (!value) return null;
    sizes.push(value);
  }

  const scale = { x: graphic.bounds.width / keptWidth, y: graphic.bounds.height / keptHeight };
  return {
    objectId,
    sourceStart: graphic.sourceSpan.from,
    bounds: graphic.bounds,
    imageBounds: {
      x: graphic.bounds.x - crop.left * scale.x,
      y: graphic.bounds.y - crop.top * scale.y,
      width: natural.width * scale.x,
      height: natural.height * scale.y,
    },
    natural,
    crop,
    scale,
    filename: graphic.asset.filename,
    plan: {
      key,
      insert: list
        ? { at: list.contentSpan.to, list: entries.length ? "entries" : "empty" }
        : { at: afterOverlay, list: "none" },
      clip,
      sizes,
      resetList: entries.filter((entry) => cropKeyName(entry.key) !== null).length > 1 ? list : null,
    },
  };
}

function formatNumber(value: number): TikzFragment {
  return plainNumber(Number(value.toFixed(2)) || 0, "beamer-length");
}

/** Keep an author's unit when every non-zero value already uses it. */
function cropValue(source: string, target: BeamerImageCropTarget, crop: BeamerImageCrop): TikzFragment {
  const key = target.plan.key;
  const values = key?.name === "trim" || !key
    ? [crop.left, crop.bottom, crop.right, crop.top]
    : [crop.left, crop.bottom, target.natural.width - crop.right, target.natural.height - crop.top];
  let unit: { span: Span; factor: number } | null = null;
  if (key) {
    const raw = source.slice(key.valueSpan.from, key.valueSpan.to);
    const units = [...raw.matchAll(new RegExp(String.raw`(${NUMBER})\s*([a-zA-Z]{2})?`, "gu"))]
      .filter((match) => match[2] !== undefined || Number(match[1]) !== 0);
    const first = units[0];
    const name = first?.[2];
    const factor = name ? texDimensionUnitFactor(name) : null;
    if (first && name && factor !== null && units.every((match) => match[2] === name)) {
      const from = key.valueSpan.from + first.index + first[0].length - name.length;
      unit = { span: { from, to: from + name.length }, factor };
    }
  }
  const parts = values.map((value) => unit
    ? tikz`${formatNumber(value / unit.factor)}${sourceSlice(source, unit.span)}`
    : formatNumber(value / BP));
  return tikz`${parts[0] ?? EMPTY_FRAGMENT} ${parts[1] ?? EMPTY_FRAGMENT} ${parts[2] ?? EMPTY_FRAGMENT} ${parts[3] ?? EMPTY_FRAGMENT}`;
}

/** The unit crop values are written in: the author's, when they share one, else bp. */
export function beamerImageCropUnit(source: string, target: BeamerImageCropTarget): { readonly name: string; readonly pt: number } {
  const key = target.plan.key;
  if (key) {
    const raw = source.slice(key.valueSpan.from, key.valueSpan.to);
    const units = [...raw.matchAll(new RegExp(String.raw`(${NUMBER})\s*([a-zA-Z]{2})?`, "gu"))]
      .filter((match) => match[2] !== undefined || Number(match[1]) !== 0);
    const name = units[0]?.[2];
    const pt = name ? texDimensionUnitFactor(name) : null;
    if (name && pt !== null && units.every((match) => match[2] === name)) return { name, pt };
  }
  return { name: "bp", pt: BP };
}

function edit(span: Span, replacement: TikzFragment) { return { span, replacement }; }

/**
 * Patches that crop the image to `crop` while keeping its drawn scale:
 * graphicx sizes the cropped image, so numeric width/height values follow
 * the kept extent. An uncropped result removes the crop key.
 */
export function beamerImageCropPatches(source: string, target: BeamerImageCropTarget, next: BeamerImageCrop): SourcePatch[] {
  const { natural, crop, plan } = target;
  const keptWidth = natural.width - crop.left - crop.right;
  const keptHeight = natural.height - crop.bottom - crop.top;
  const nextWidth = natural.width - next.left - next.right;
  const nextHeight = natural.height - next.bottom - next.top;
  if (!(nextWidth > 0) || !(nextHeight > 0)) return [];
  const edits: { span: Span; replacement: TikzFragment }[] = [];
  for (const size of plan.sizes) {
    const factor = size.factor * (size.axis === "x" ? nextWidth / keptWidth : nextHeight / keptHeight);
    if (Math.abs(factor - size.factor) < 1e-9) continue;
    const number = plainNumber(Number(factor.toFixed(4)), "beamer-length", source[size.span.from] === ".");
    edits.push(edit(size.span, number));
  }
  const uncropped = [next.left, next.bottom, next.right, next.top].every((value) => Math.abs(value) < 0.005);
  if (uncropped && plan.resetList) {
    const span = plan.resetList.span;
    const sized = applyFragments(source.slice(span.from, span.to), edits.map((item) => ({
      span: { from: item.span.from - span.from, to: item.span.to - span.from }, fragment: item.replacement,
    })));
    const removals = rewriteBeamerOptions(sized, { span: { from: 0, to: sized.length }, contentSpan: { from: 1, to: sized.length - 1 } },
      (entry) => cropKeyName(entry.kind === "unknown" ? null : entry.key) === null);
    const reset = applyFragments(sized, removals.map((item) => ({ span: item.span, fragment: item.insert })));
    const replacement = sourceSlice(reset, { from: 0, to: reset.length });
    return [{ oldSpan: span, newSpan: { from: span.from, to: span.from + replacement.length }, replacement }];
  }
  if (plan.key && uncropped) {
    // Remove the entry with one neighbouring comma, never touching other entries.
    const { entrySpan, previousEnd, nextStart } = plan.key;
    const span = previousEnd !== null ? { from: previousEnd, to: entrySpan.to }
      : nextStart !== null ? { from: entrySpan.from, to: nextStart }
      : entrySpan;
    const comments = createBeamerSyntaxContext(source).syntax.comments.some((comment) => comment.from < span.to && comment.to > span.from);
    edits.push(edit(comments ? plan.key.valueSpan : span, comments ? cropValue(source, target, next) : EMPTY_FRAGMENT));
  } else if (plan.key) {
    const raw = source.slice(plan.key.valueSpan.from, plan.key.valueSpan.to);
    const inner = /^(\s*\{\s*)([^]*?)(\s*\}\s*)$/u.exec(raw);
    const from = plan.key.valueSpan.from + (inner ? inner[1]?.length ?? 0 : raw.length - raw.trimStart().length);
    const to = plan.key.valueSpan.to - (inner ? inner[3]?.length ?? 0 : raw.length - raw.trimEnd().length);
    edits.push(edit({ from, to }, cropValue(source, target, next)));
  } else if (!uncropped) {
    const value = cropValue(source, target, next);
    const clip = plan.clip === "missing" ? tikz`, clip` : EMPTY_FRAGMENT;
    const at = { from: plan.insert.at, to: plan.insert.at };
    edits.push(edit(at, plan.insert.list === "none" ? tikz`[trim=${value}${clip}]`
      : plan.insert.list === "empty" ? tikz`trim=${value}${clip}` : tikz`, trim=${value}${clip}`));
  }
  if (!uncropped && plan.key && plan.clip === "missing") {
    edits.push(edit({ from: plan.insert.at, to: plan.insert.at }, plan.insert.list === "empty" ? tikz`clip` : tikz`, clip`));
  }
  if (!uncropped && typeof plan.clip === "object") edits.push(edit(plan.clip.falseEntry, tikz`clip`));
  let delta = 0;
  return edits.filter((item) => source.slice(item.span.from, item.span.to) !== item.replacement)
    .sort((a, b) => a.span.from - b.span.from || a.span.to - b.span.to)
    .map((item) => {
      const from = item.span.from + delta;
      delta += item.replacement.length - (item.span.to - item.span.from);
      return { oldSpan: item.span, newSpan: { from, to: from + item.replacement.length }, replacement: item.replacement };
    });
}

export type BeamerImageCropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

/**
 * The crop after dragging `handle` by (dx, dy) slide points. Edges stay
 * inside the image and keep at least `minimum` slide points; `move` slides
 * the image under its fixed window.
 */
export function beamerImageCropDrag(target: BeamerImageCropTarget, handle: BeamerImageCropHandle, dx: number, dy: number, minimum = 4): BeamerImageCrop {
  const { natural, scale } = target;
  const c = target.crop;
  const nx = dx / scale.x;
  const ny = dy / scale.y;
  const minW = Math.min(minimum / scale.x, natural.width - c.left - c.right);
  const minH = Math.min(minimum / scale.y, natural.height - c.top - c.bottom);
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
  if (handle === "move") {
    const x = clamp(-nx, -c.left, c.right);
    const y = clamp(-ny, -c.top, c.bottom);
    return { left: c.left + x, right: c.right - x, top: c.top + y, bottom: c.bottom - y };
  }
  let { left, bottom, right, top } = c;
  if (handle.includes("w")) left = clamp(c.left + nx, 0, natural.width - c.right - minW);
  if (handle.includes("e")) right = clamp(c.right - nx, 0, natural.width - c.left - minW);
  if (handle.includes("n")) top = clamp(c.top + ny, 0, natural.height - c.bottom - minH);
  if (handle.includes("s")) bottom = clamp(c.bottom - ny, 0, natural.height - c.top - minH);
  return { left, bottom, right, top };
}
