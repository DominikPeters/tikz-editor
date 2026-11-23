/**
 * Layout-stage vertical list: replays the prepared vlist and the IR's vertical
 * events through VerticalListBuilder after paragraphs are measured, so list
 * skips, display skips (normal or short from \predisplaysize) and baseline
 * glue come from one model. Replaces resolveDisplayMathVerticalGlueInVList
 * when the document carries vertical events. See design/vertical-list-builder.md.
 */
import type { SimpleTexVerticalEvent } from "../ir.js";
import type { TexDisplayMathLayoutProfile, TexListLayoutProfile } from "../layout-options.js";
import { texLength, type TexLength } from "../coordinates.js";
import { texVListPathKey } from "./paths.js";
import {
  displayAlignmentIntertextLeadingSize,
  displayMathSkipVariant,
  isMaterialTexVBoxItem,
  materialVBoxMetrics,
  resolveDisplayMathBoundaryGlueItem,
  resolveDisplayMathVerticalGlueInVList,
  texMaterialBoundaryPreviousDepth,
  texOpenedInterlineGlueSize,
  texParagraphLastLineDepth,
} from "./spacing.js";
import type {
  TexGlueItem,
  TexVListDocument,
  TexVListItem,
  TexVListParagraphBoxMeasurement,
} from "./types.js";
import { glue, VerticalListBuilder, type VerticalGlue, type VerticalListNode } from "./vertical-builder.js";
import { createVerticalEventApplier } from "./vertical-shadow.js";

export interface VerticalLayoutOptions {
  readonly lineHeight: TexLength;
  readonly initialPreviousDepth?: TexLength;
  readonly displayMathProfile?: TexDisplayMathLayoutProfile;
}

/** Glue the old pipeline generated before measurement; the builder recomputes it. */
function isPlannedGlue(item: TexVListItem): boolean {
  if (item.kind !== "glue") return false;
  const kind = item.origin?.kind;
  return kind === "list-boundary" || kind === "trivlist-boundary" || kind === "quote-boundary" ||
    kind === "display-math-boundary" || kind === "paragraph-boundary-interline" ||
    (kind === "display-math-interline" && (item.origin?.purpose === undefined || item.origin.purpose === "leading-empty-line-baseline"));
}

interface Leaf {
  readonly id: string;
  readonly item: TexVListItem;
  /** Path of the item in the grouped document. */
  readonly path: readonly number[];
  readonly at: number;
}

function glueOf(item: TexGlueItem): VerticalGlue {
  return glue(Number(item.size), Number(item.stretch ?? 0), Number(item.shrink ?? 0));
}

function isGlueItem(value: unknown): value is TexGlueItem {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "glue";
}

function isPenaltyItem(value: unknown): value is Extract<TexVListItem, { kind: "penalty" }> {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "penalty";
}

function generatedGlueItem(node: Extract<VerticalListNode, { kind: "glue" }>, beforeBlockIndex: number): TexGlueItem {
  if (isGlueItem(node.ref)) return node.ref;
  const base = {
    kind: "glue" as const,
    size: texLength(node.glue.natural),
    ...(node.glue.stretch !== 0 ? { stretch: texLength(node.glue.stretch) } : {}),
    ...(node.glue.shrink !== 0 ? { shrink: texLength(node.glue.shrink) } : {}),
    stretchOrder: "normal" as const,
    shrinkOrder: "normal" as const,
  };
  if (node.origin === "interline") return { ...base, origin: { kind: "paragraph-boundary-interline", boundary: "plain" } };
  if (node.origin.startsWith("trivlist:")) return { ...base, origin: { kind: "trivlist-boundary", beforeBlockIndex } };
  if (node.origin.startsWith("quote:")) return { ...base, origin: { kind: "quote-boundary", beforeBlockIndex } };
  return { ...base, origin: { kind: "list-boundary", beforeBlockIndex } };
}

/**
 * Resolves the document's vertical glue with the builder, or returns undefined
 * when the document has no vertical events.
 */
export function resolveVerticalListWithBuilder(
  document: TexVListDocument,
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>,
  options: VerticalLayoutOptions
): TexVListDocument | undefined {
  const context = document.verticalBuilder;
  if (!context) return undefined;
  const profile: TexListLayoutProfile | undefined = context.listProfile;
  const builder = new VerticalListBuilder({
    parskip: glue(profile?.paragraphSkipPt ?? 0),
    listColorWhatsits: profile !== undefined,
    minipage: profile?.suppressInitialTopsep === true,
    ...(context.startsHorizontal === true ? { horizontal: true } : {}),
    ...(options.initialPreviousDepth !== undefined ? { prevDepth: Number(options.initialPreviousDepth) } : {}),
  });
  const applyEvent = createVerticalEventApplier(builder, profile);
  const events: readonly SimpleTexVerticalEvent[] = context.events;
  let eventIndex = 0;
  const leafById = new Map<string, Leaf>();
  /** Items emitted in place, keyed by the id of the leaf they precede. */
  const attachedBefore = new Map<string, TexVListItem[]>();
  let pendingAttached: TexVListItem[] = [];
  let lastParagraph: TexVListParagraphBoxMeasurement | undefined;
  /** The below-display skip uses the variant the above skip chose (tex.web §1199). */
  let displayVariant: "normal" | "short" = "normal";
  /** \baselineskip in force at the last display (its font), for the empty line that resumes after it. */
  let displayBaselineSkip: number | undefined;
  /** amsmath's \intertext is a \vtop in a \noalign: no \parskip and no automatic baseline glue. */
  let intertextPending = false;
  /** The baseline skip of the empty line a display starts in vertical mode; undefined when suppressed. */
  let emptyLineBaseline: { readonly size: number | undefined; readonly item: TexGlueItem } | undefined;
  let carryAt = 0;
  let leafCount = 0;

  const flushEvents = (at: number) => {
    // A label line the parser emits at an \item or \end offset precedes that command's glue,
    // so only events strictly before the item's start apply first.
    while (eventIndex < events.length && (events[eventIndex]?.sourceStart ?? Infinity) < at) {
      const event = events[eventIndex++];
      if (event) applyEvent(event);
    }
  };
  const newLeaf = (item: TexVListItem, path: readonly number[]): Leaf => {
    const at = item.sourceSpan?.start ?? carryAt;
    carryAt = at;
    const leaf = { id: `leaf${leafCount++}`, item, path, at };
    leafById.set(leaf.id, leaf);
    if (pendingAttached.length) {
      attachedBefore.set(leaf.id, pendingAttached);
      pendingAttached = [];
    }
    return leaf;
  };
  const nextRowHeight = (items: readonly TexVListItem[], index: number): number | undefined => {
    for (let next = index + 1; next < items.length; next++) {
      const candidate = items[next];
      if (candidate?.kind === "hbox" && candidate.role?.kind === "display-align-row") return Number(candidate.box.metrics.height);
      if (candidate?.kind !== "glue" && candidate?.kind !== "penalty") break;
    }
    return;
  };
  const nextParagraphMeasurement = (items: readonly TexVListItem[], index: number, prefix: readonly number[]) => {
    for (let next = index + 1; next < items.length; next++) {
      const candidate = items[next];
      if (candidate?.kind === "paragraph") return paragraphMeasurements.get(texVListPathKey([...prefix, next]));
      if (candidate?.kind !== "glue" && candidate?.kind !== "penalty") break;
    }
    return;
  };

  const walk = (items: readonly TexVListItem[], prefix: readonly number[]): void => {
    for (const [index, item] of items.entries()) {
      const path = [...prefix, index];
      const at = item.sourceSpan?.start ?? carryAt;
      if (item.kind === "vbox" && !isMaterialTexVBoxItem(item)) {
        walk(item.items, path);
        continue;
      }
      if (item.kind === "glue" && item.origin?.kind === "display-math-boundary") {
        flushEvents(at);
        const variant = item.origin.variant ?? (item.origin.side === "below" ? displayVariant
          : item.origin.displayLeftEdge !== undefined ? displayMathSkipVariant(item.origin.displayLeftEdge, lastParagraph) : "normal");
        if (item.origin.side === "above") displayVariant = variant;
        const resolved = resolveDisplayMathBoundaryGlueItem(item, variant, options.displayMathProfile);
        if (item.origin.side === "above") builder.displayAbove(glueOf(resolved), resolved);
        else builder.displayBelow(glueOf(resolved), resolved);
        lastParagraph = undefined;
        continue;
      }
      if (item.kind === "glue" && item.origin?.kind === "display-math-interline" && item.origin.purpose === "align-row-baseline") {
        const height = nextRowHeight(items, index);
        const previousDepth = builder.prevDepth;
        const size = height === undefined || previousDepth === undefined ? texLength(0)
          : texOpenedInterlineGlueSize(texLength(previousDepth), texLength(height), item.origin.openedInterline);
        builder.vskip(glue(Number(size)), "align-row", { ...item, size });
        continue;
      }
      if (item.kind === "glue" && item.origin?.kind === "display-alignment-intertext-leading") {
        const size = displayAlignmentIntertextLeadingSize(texLength(builder.prevDepth ?? 0),
          nextParagraphMeasurement(items, index, prefix), item.origin.openedInterline);
        builder.vskip(glue(Number(size)), "intertext", { ...item, size });
        intertextPending = true;
        continue;
      }
      if (item.kind === "glue" && item.origin?.kind === "display-math-interline" &&
          (item.origin.purpose === undefined || item.origin.purpose === "leading-empty-line-baseline")) {
        // The empty line a display starts in vertical mode: its baseline skip, or none at all when an
        // enclosing environment (Beamer column[T]) already shipped the line.
        emptyLineBaseline = { size: item.origin.purpose === undefined ? undefined : Number(item.size), item };
        continue;
      }
      if (isPlannedGlue(item)) continue;
      if (item.kind === "glue") {
        flushEvents(at);
        const origin = item.origin;
        if (origin?.kind === "external-flow-before" && origin.addvspace === true) {
          // tcolorbox's before skip (tcolorbox.sty, `before skip balanced`): \addvspace, balanced
          // against \prevdepth, then \nointerlineskip.
          const depth = builder.prevDepth;
          const balance = origin.balancedPt;
          const extra = balance !== undefined && depth !== undefined && depth >= 0 && depth <= balance ? balance - depth : 0;
          const size = Number(item.size) + extra;
          builder.addvspace(glue(size, Number(item.stretch ?? 0), Number(item.shrink ?? 0)), "authored", extra ? { ...item, size: texLength(size) } : item);
          if (origin.noInterline === true) builder.noInterline();
          continue;
        }
        if (origin?.kind === "external-flow-after" && origin.addvspace === true) {
          // `after skip balanced` sets \prevdepth before its \addvspace; `after skip` uses \nointerlineskip.
          if (origin.prevDepthPt !== undefined) builder.setPrevDepth(origin.prevDepthPt);
          else builder.noInterline();
          builder.addvspace(glueOf(item), "authored", item);
          continue;
        }
        if (item.origin?.kind === "explicit-command" && item.origin.command === "nointerlineskip") {
          builder.vskip(glueOf(item), "authored", item);
          builder.noInterline();
          continue;
        }
        builder.vskip(glueOf(item), "authored", item);
        // LaTeX's \vspace ends with \vskip\z@skip (ltspace.dtx), so a following \addvspace sees a zero
        // \lastskip and adds its skip instead of comparing with the \vspace.
        if (item.origin?.kind === "explicit-command" && item.origin.command === "vspace") builder.vskip(glue(0), "vspace-zero");
        continue;
      }
      if (item.kind === "penalty") {
        flushEvents(at);
        builder.penalty(Number(item.penalty), item);
        continue;
      }
      if (item.kind === "hbox" && (item.verticalPlacement?.kind === "paragraph-first-line-baseline" || item.affectsVBoxBaseline === false)) {
        // List labels ride with their paragraph; transparent boxes take no glue.
        pendingAttached.push(item);
        continue;
      }
      flushEvents(at);
      const leaf = newLeaf(item, path);
      if (item.kind === "paragraph") {
        const measurement = paragraphMeasurements.get(texVListPathKey(path));
        // A declaration-only paragraph ships no lines and changes nothing.
        if (!measurement || measurement.lineOffsets.length === 0) continue;
        if (intertextPending) {
          intertextPending = false;
          builder.rawBox(leaf.id, Number(texParagraphLastLineDepth(measurement)));
          lastParagraph = measurement;
          continue;
        }
        builder.startParagraph(leaf.id, {
          height: Number(measurement.ruleLeadingMetrics.height),
          depth: Number(texParagraphLastLineDepth(measurement)),
          baselineSkip: Number(measurement.baselineSkip ?? options.lineHeight),
        });
        lastParagraph = measurement;
      } else if (item.kind === "display-math") {
        displayBaselineSkip = item.baselineSkip !== undefined ? Number(item.baselineSkip) : undefined;
        builder.displayBox(leaf.id, { height: Number(item.box.height), depth: Number(item.box.depth),
          baselineSkip: Number(item.baselineSkip ?? options.lineHeight) });
      } else if (item.kind === "hbox" && item.role?.kind === "display-align-row") {
        builder.rawBox(leaf.id, Number(item.box.metrics.depth));
      } else if (item.kind === "hbox" && item.role?.kind === "display-empty-line") {
        // The empty line of a display started in vertical mode (or resumed after its \vspace).
        const baseline = emptyLineBaseline;
        emptyLineBaseline = undefined;
        if (baseline && baseline.size === undefined) builder.noInterline();
        // At the top of a container (ignore_depth) the empty line still sits one \baselineskip down:
        // the enclosing list's \prevdepth is outside this list.
        else if (baseline?.size && builder.prevDepth === undefined) builder.vskip(glue(baseline.size), "authored", baseline.item);
        const resumed = item.role.position === "after-display-vspace" ? displayBaselineSkip : undefined;
        builder.startParagraph(leaf.id, { height: 0, depth: 0, baselineSkip: baseline?.size ?? resumed ?? Number(options.lineHeight) });
        lastParagraph = undefined;
      } else if (item.kind === "hbox") {
        const role = item.role;
        const baselineSkip = role?.kind === "external-flow" || role?.kind === "list-empty-line" ? role.baselineSkipPt : undefined;
        builder.box(leaf.id, role?.kind === "external-flow" && role.consumesItemLabels === true, {
          height: Number(item.box.metrics.height), depth: Number(item.box.metrics.depth),
          baselineSkip: Number(baselineSkip ?? options.lineHeight),
        }, role?.kind === "external-flow");
        lastParagraph = undefined;
      } else if (item.kind === "vbox") {
        // A material box (\parbox, minipage): its contents keep the old resolution for now.
        const nested = resolveDisplayMathVerticalGlueInVList({ kind: "vlist", items: item.items }, paragraphMeasurements, options);
        const material = { ...item, items: nested.items };
        const metrics = materialVBoxMetrics(material, paragraphMeasurements);
        // After a paragraph, the material box's baseline glue sees at least a strut's depth.
        if (lastParagraph && builder.prevDepth !== undefined) builder.setPrevDepth(Number(texMaterialBoundaryPreviousDepth(lastParagraph, options.lineHeight)));
        builder.box(leaf.id, false, metrics ? { height: Number(metrics.height), depth: Number(metrics.depth),
          baselineSkip: Number(options.lineHeight) } : undefined);
        leafById.set(leaf.id, { ...leaf, item: material });
        lastParagraph = undefined;
      } else if (item.kind === "rule") {
        builder.rule(leaf.id);
        lastParagraph = undefined;
      } else {
        builder.box(leaf.id);
        lastParagraph = undefined;
      }
    }
  };
  walk(document.items, []);
  flushEvents(Infinity);
  if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VLIST_TRACE === "1") {
    console.log("VLTRACE events", events.map(event => `${event.kind}@${event.sourceStart}${"depth" in event ? ":" + String(event.depth) : ""}`).join(" "));
    console.log("VLTRACE nodes", builder.list.map(node => node.kind === "box" ? `[${node.id}]` : node.kind === "glue" ? `${node.origin}=${node.glue.natural}${node.glue.stretch || node.glue.shrink ? `+${node.glue.stretch}-${node.glue.shrink}` : ""}` : node.kind).join(" "));
    console.log("VLTRACE leaves", [...leafById.values()].map(leaf => `${leaf.id}:${leaf.item.kind}@${leaf.at}`).join(" "));
  }

  // Distribute the builder's nodes: glue and penalties before each leaf go into its container.
  const before = new Map<string, TexVListItem[]>();
  let pending: TexVListItem[] = [];
  const mergeable = new Set<TexVListItem>();
  const nodes = builder.list;
  let lastLeafPosition = -1;
  for (const [position, node] of nodes.entries()) if (node.kind === "box" && leafById.has(node.id)) lastLeafPosition = position;
  for (const [position, node] of nodes.entries()) {
    if (node.kind === "box") {
      const leaf = leafById.get(node.id);
      if (!leaf) {
        // A label line the builder set itself: its glue moves on to the next leaf.
        continue;
      }
      before.set(node.id, [...pending, ...(attachedBefore.get(node.id) ?? [])]);
      pending = [];
      continue;
    }
    if (node.kind === "whatsit") continue;
    if (node.kind === "penalty") {
      if (isPenaltyItem(node.ref)) pending.push(node.ref);
      continue;
    }
    if (node.origin === "authored" || node.origin === "align-row" || node.origin === "intertext" ||
        node.origin === "display-above" || node.origin === "display-below") {
      pending.push(generatedGlueItem(node, -1));
      continue;
    }
    // Zero glue only matters after the last box: it still ends the list in glue (TeX's \vskip-\lastskip).
    if (node.glue.natural === 0 && node.glue.stretch === 0 && node.glue.shrink === 0 && (position < lastLeafPosition || node.origin !== "cancelled")) continue;
    const next = nodes.slice(position + 1).find(candidate => candidate.kind === "box" && leafById.has(candidate.id));
    const nextItem = next?.kind === "box" ? leafById.get(next.id)?.item : undefined;
    let generated = generatedGlueItem(node, nextItem?.kind === "paragraph" ? nextItem.blockIndex : -1);
    if (generated.origin?.kind === "paragraph-boundary-interline") {
      // Baseline glue is reported against the boundary it follows.
      const prior = pending.at(-1);
      const kind = prior?.kind === "glue" && mergeable.has(prior) ? prior.origin?.kind : undefined;
      const boundary = kind === "quote-boundary" ? "quote" : kind === "list-boundary" ? "list" : kind === "trivlist-boundary" ? "trivlist" : "plain";
      generated = { ...generated, origin: { kind: "paragraph-boundary-interline", boundary } };
    }
    if (node.origin === "cancelled") {
      pending.push(generated);
      continue;
    }
    // Consecutive list skips (an \addvspace and the \parskip after it) form one boundary glue item.
    const previous = pending.at(-1);
    if (previous?.kind === "glue" && mergeable.has(previous) && previous.origin?.kind === generated.origin?.kind &&
        generated.origin?.kind !== "paragraph-boundary-interline") {
      const merged: TexGlueItem = { ...previous, size: texLength(Number(previous.size) + Number(generated.size)),
        ...(Number(previous.stretch ?? 0) + Number(generated.stretch ?? 0) !== 0 ? { stretch: texLength(Number(previous.stretch ?? 0) + Number(generated.stretch ?? 0)) } : {}),
        ...(Number(previous.shrink ?? 0) + Number(generated.shrink ?? 0) !== 0 ? { shrink: texLength(Number(previous.shrink ?? 0) + Number(generated.shrink ?? 0)) } : {}) };
      pending[pending.length - 1] = merged;
      mergeable.add(merged);
      continue;
    }
    mergeable.add(generated);
    pending.push(generated);
  }
  // Leaves the builder did not see as boxes (empty paragraphs) keep their place without glue.
  const leafByPath = new Map([...leafById.values()].map(leaf => [texVListPathKey(leaf.path), leaf]));
  const rebuild = (items: readonly TexVListItem[], prefix: readonly number[]): TexVListItem[] => {
    const output: TexVListItem[] = [];
    for (const [index, item] of items.entries()) {
      const path = texVListPathKey([...prefix, index]);
      if (item.kind === "vbox" && !isMaterialTexVBoxItem(item)) {
        output.push({ ...item, items: rebuild(item.items, [...prefix, index]) });
        continue;
      }
      const leaf = leafByPath.get(path);
      if (!leaf) continue;
      const preceding = before.get(leaf.id) ?? attachedBefore.get(leaf.id) ?? [];
      output.push(...preceding, leaf.item);
    }
    return output;
  };
  const items = rebuild(document.items, []);
  // A container's closing skips (\endlist, \endtrivlist) are the builder's: the container decides what
  // its end does with them (a minipage's \unskip, a frame box's glue setting).
  items.push(...pendingAttached, ...pending);
  return { ...document, items };
}


/** Development aid: glue before each material item, flattened, for comparing two resolutions. */
export function verticalGlueProfile(items: readonly TexVListItem[]): { key: string; glue: number; flex: string; parts: string }[] {
  const rows: { key: string; glue: number; flex: string; parts: string }[] = [];
  let sum = 0;
  let stretch = 0;
  let shrink = 0;
  let parts: string[] = [];
  const visit = (list: readonly TexVListItem[]) => {
    for (const item of list) {
      if (item.kind === "vbox" && !isMaterialTexVBoxItem(item)) { visit(item.items); continue; }
      if (item.kind === "glue") {
        sum += Number(item.size);
        stretch += Number(item.stretch ?? 0);
        shrink += Number(item.shrink ?? 0);
        parts.push(`${item.origin?.kind ?? "glue"}${item.origin && "side" in item.origin ? ":" + item.origin.side : ""}=${Number(item.size).toFixed(2)}`);
        continue;
      }
      if (item.kind === "penalty") continue;
      if (item.kind === "hbox" && (item.verticalPlacement?.kind === "paragraph-first-line-baseline" || item.affectsVBoxBaseline === false)) continue;
      const label = item.kind === "paragraph" ? `p:${item.paragraph.text.slice(0, 18)}` : item.kind === "hbox" ? `h:${item.role?.kind ?? ""}` : item.kind;
      rows.push({ key: `${label}@${item.sourceSpan?.start ?? "?"}`, glue: Math.round(sum * 1000) / 1000,
        flex: `+${Math.round(stretch * 100) / 100}-${Math.round(shrink * 100) / 100}`, parts: parts.join(" ") });
      sum = 0;
      stretch = 0;
      shrink = 0;
      parts = [];
    }
  };
  visit(items);
  rows.push({ key: "<end>", glue: Math.round(sum * 1000) / 1000, flex: `+${Math.round(stretch * 100) / 100}-${Math.round(shrink * 100) / 100}`, parts: parts.join(" ") });
  return rows;
}

