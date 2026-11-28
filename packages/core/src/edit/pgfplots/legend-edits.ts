/**
 * Legend entries follow their plots through structural edits (design
 * pgfplots-behaviour.md L4). The plot-to-entry association is the one the
 * renderer draws (`AxisEvaluation.legend`, built by `associateLegend` in
 * pgfplots/legend.ts): image i (an `\addplot` that is not `forget plot`, or
 * an `\addlegendimage`) pairs with entry i of the effective list, which is
 * the `\addlegendentry`/`\legend` commands when there are any, else the
 * `legend entries` key. Every edit here is a set of replacements against the
 * original source, applied as one source change.
 *
 * Rules (per form of the entry that belongs to a plot):
 * - `\addlegendentry`: the statement is removed with its plot, moved with it
 *   (when it directly follows its image) or its text travels between the
 *   entry statements (when entries are written apart from the plots);
 * - an item of `\legend{…}` or `legend entries={…}`: the item is removed or
 *   the items are permuted, with the list's own separators; a list left
 *   empty removes the statement or the key; a plot that has no entry but
 *   comes before one that has gets an empty item (an empty list item draws
 *   no pair, L4).
 * An `\addlegendentry` cannot express "no entry" before a later entry: an
 * empty `\addlegendentry{}` keeps the pairing but draws its image without
 * text (Z8). The result says so.
 */
import type { AddLegendEntryStatement, AxisBodyItem, AxisStatement, LegendStatement, Span } from "../../ast/types.js";
import type { OptionEntry } from "../../options/types.js";
import { getAxisEvaluations } from "../../pgfplots/evaluate-axis.js";
import { legendEntryOf, type LegendAssociation } from "../../pgfplots/legend.js";
import { splitTopLevelListSpans, type LegendEntryText } from "../../pgfplots/model.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import { EMPTY_FRAGMENT, joinFragments, layout, sourceSlice, tikz, unchangedSource, userText, type EditedSource, type TikzFragment } from "../fragment.js";
import { normalizeOptionKey } from "../option-key.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import type { SourcePatch } from "../types.js";

export type Replacement = { span: Span; fragment: TikzFragment };

/** The renderer's legend association of an axis (evaluates the source). */
export function readLegendAssociation(source: string, axisId: string, parseOptions: EditParseOptions = {}): LegendAssociation | null {
  const parsed = parseTikzForEdit(source, parseOptions);
  const result = evaluateTikzFigure(parsed.figure, source);
  return getAxisEvaluations(result.scene).find((axis) => axis.axisId === axisId)?.legend ?? null;
}

/** Applies non-overlapping replacements given against `source` as one edit. */
export function applyReplacements(source: string, replacements: readonly Replacement[]): { source: EditedSource; patches: SourcePatch[] } {
  const sorted = [...replacements].sort((a, b) => a.span.from - b.span.from || a.span.to - b.span.to);
  let text = "";
  let cursor = 0;
  let shift = 0;
  const patches: SourcePatch[] = [];
  for (const { span, fragment } of sorted) {
    if (span.from < cursor) throw new Error("legend edit: overlapping replacements");
    text += source.slice(cursor, span.from) + fragment;
    patches.push({ oldSpan: span, newSpan: { from: span.from + shift, to: span.from + shift + fragment.length }, replacement: fragment });
    shift += fragment.length - (span.to - span.from);
    cursor = span.to;
  }
  return { source: unchangedSource(text + source.slice(cursor)), patches };
}

/** Widens a statement span to its whole line(s) when only blanks share them (as a deleted statement). */
export function statementLineSpan(source: string, span: Span): Span {
  let from = span.from;
  while (from > 0 && (source[from - 1] === " " || source[from - 1] === "\t")) from -= 1;
  let to = span.to;
  while (to < source.length && (source[to] === " " || source[to] === "\t")) to += 1;
  if ((from === 0 || source[from - 1] === "\n") && (to === source.length || source[to] === "\n")) return { from, to: to < source.length ? to + 1 : to };
  return span;
}

/** A list the entries live in: `\legend{…}` or the `legend entries` value in the axis options. */
type ListContainer = {
  id: string;
  items: Span[];
  sep: TikzFragment;
  /** What removes the whole list (the statement, or the option entry). */
  removal: Span;
};

function legendContainer(source: string, statement: LegendStatement): ListContainer {
  const items = statement.entries.map((entry) => entry.span);
  const first = items[0]; const second = items[1];
  return {
    id: statement.id,
    items,
    sep: first && second ? sourceSlice(source, { from: first.to, to: second.from }) : statement.delimiter === "," ? tikz`,` : tikz`\\ `,
    removal: statementLineSpan(source, statement.span)
  };
}

function legendEntriesOption(axis: AxisStatement): Extract<OptionEntry, { kind: "kv" }> | null {
  let found: Extract<OptionEntry, { kind: "kv" }> | null = null;
  for (const entry of axis.options?.entries ?? []) {
    if (entry.kind === "kv" && normalizeOptionKey(entry.key).replace(/^\/pgfplots\//u, "") === "legend entries") found = entry;
  }
  return found;
}

function legendEntriesContainer(source: string, axis: AxisStatement): ListContainer | null {
  const entry = legendEntriesOption(axis);
  if (!entry?.valueSpan || source.slice(entry.valueSpan.from, entry.valueSpan.to) !== entry.valueRaw) return null;
  const base = entry.valueSpan.from;
  const items = splitTopLevelListSpans(entry.valueRaw).map((item) => ({ from: base + item.from, to: base + item.to }));
  const first = items[0]; const second = items[1];
  return { id: "legend entries", items, sep: first && second ? sourceSlice(source, { from: first.to, to: second.from }) : tikz`,`, removal: optionRemovalSpan(source, axis, entry) };
}

/** The text removing one option entry with its comma; the whole list when it is the only entry. */
function optionRemovalSpan(source: string, axis: AxisStatement, entry: OptionEntry): Span {
  const entries = (axis.options?.entries ?? []).filter((candidate) => candidate.raw.trim().length > 0);
  if (entries.length <= 1 && axis.optionsSpan) return axis.optionsSpan;
  let { from, to } = entry.span;
  let after = to;
  while (after < source.length && /\s/u.test(source[after] ?? "")) after += 1;
  if (source[after] === ",") {
    to = after + 1;
    while (to < source.length && /[ \t]/u.test(source[to] ?? "")) to += 1;
    return { from, to };
  }
  let before = from;
  while (before > 0 && /\s/u.test(source[before - 1] ?? "")) before -= 1;
  if (source[before - 1] === ",") from = before - 1;
  return { from, to };
}

/** The list a list origin points into. */
function containerOf(source: string, axis: AxisStatement, entry: LegendEntryText, cache: Map<string, ListContainer | null>): ListContainer | null {
  const origin = entry.origin;
  if (!origin || origin.kind === "addlegendentry") return null;
  const key = origin.kind === "legend" ? origin.statementId : "legend entries";
  if (!cache.has(key)) {
    if (origin.kind === "legend") {
      const statement = axis.body.find((item): item is LegendStatement => item.kind === "Legend" && item.id === origin.statementId);
      cache.set(key, statement ? legendContainer(source, statement) : null);
    } else cache.set(key, legendEntriesContainer(source, axis));
  }
  return cache.get(key) ?? null;
}

/** The new item list of a container as one replacement (or its removal when empty). */
function rebuildContainer(source: string, container: ListContainer, contents: readonly TikzFragment[]): Replacement {
  if (contents.length === 0) return { span: container.removal, fragment: EMPTY_FRAGMENT };
  const first = container.items[0];
  const last = container.items[container.items.length - 1];
  if (!first || !last) return { span: container.removal, fragment: EMPTY_FRAGMENT };
  return { span: { from: first.from, to: last.to }, fragment: joinFragments(contents, container.sep) };
}

function statementOf(axis: AxisStatement, id: string): AddLegendEntryStatement | null {
  return axis.body.find((item): item is AddLegendEntryStatement => item.kind === "AddLegendEntry" && item.id === id) ?? null;
}

export type LegendEditResult = { replacements: Replacement[]; notes: string[] } | { unsupported: string };

/**
 * Deleting plots: the entries that belong to them go too, wherever they are
 * written; every other plot keeps its entry (entries after a removed one move
 * up with their images).
 */
export function legendEntriesForDeletedPlots(source: string, axis: AxisStatement, association: LegendAssociation, deletedIds: ReadonlySet<string>): LegendEditResult {
  const removed = new Set<number>();
  for (const id of deletedIds) {
    const entry = legendEntryOf(association, id)?.entry;
    if (entry !== null && entry !== undefined) removed.add(entry);
  }
  if (removed.size === 0) return { replacements: [], notes: [] };
  const replacements: Replacement[] = [];
  const cache = new Map<string, ListContainer | null>();
  const lists = new Map<ListContainer, Set<number>>();
  for (const index of removed) {
    const entry = association.entries[index];
    const origin = entry?.origin;
    if (!entry || !origin) continue;
    if (origin.kind === "addlegendentry") {
      if (!statementOf(axis, origin.statementId)) continue;
      replacements.push({ span: statementLineSpan(source, origin.span), fragment: EMPTY_FRAGMENT });
      continue;
    }
    const container = containerOf(source, axis, entry, cache);
    if (!container || origin.span === null) return { unsupported: "The legend entry of the plot is not written as a list item in this axis (a `\\legend` with `...`, or `legend entries` set outside the axis options); delete it there." };
    const set = lists.get(container) ?? new Set<number>();
    set.add(origin.index);
    lists.set(container, set);
  }
  for (const [container, drop] of lists) {
    replacements.push(rebuildContainer(source, container, container.items.flatMap((item, i) => (drop.has(i) ? [] : [sourceSlice(source, item)]))));
  }
  return { replacements, notes: [] };
}

/** An entry as `\addlegendentry` text (conversion between forms; the text is the document's). */
function asStatement(source: string, entry: LegendEntryText): TikzFragment {
  if (entry.origin?.kind === "addlegendentry") return sourceSlice(source, entry.origin.span);
  const options = entry.options ? userText(`[${entry.options}]`, "source-editor") : EMPTY_FRAGMENT;
  return tikz`\addlegendentry${options}{${userText(entry.text, "source-editor")}}`;
}

/** An entry as a list item. */
function asItem(source: string, entry: LegendEntryText): TikzFragment {
  if (entry.origin && entry.origin.kind !== "addlegendentry" && entry.origin.span) return sourceSlice(source, entry.origin.span);
  const raw = `${entry.options ? `[${entry.options}]` : ""}${entry.text}`;
  return userText(/[,=]/u.test(raw) || raw !== raw.trim() ? `{${raw}}` : raw, "source-editor");
}

const EMPTY_ENTRY_NOTE = "A plot without a legend entry now comes before plots with one: an empty `\\addlegendentry{}` keeps the others attached to their plots, and draws its image without text.";

/** The indentation of the line `at` is on. */
function indentAt(source: string, at: number): string {
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/u.exec(source.slice(lineStart, at))?.[0] ?? "";
}

/**
 * Reordering plots: `slots[s]` is the id of the plot that moves into the
 * position of the s-th `\addplot` of the body. Returns the replacements for
 * the plots and their entries.
 */
export function reorderPlotsWithLegend(source: string, axis: AxisStatement, association: LegendAssociation, plotIds: readonly string[], next: readonly string[]): LegendEditResult {
  const plots = plotIds.map((id) => axis.body.find((item) => item.kind === "AddPlot" && item.id === id)).filter((item): item is Extract<AxisBodyItem, { kind: "AddPlot" }> => item !== undefined);
  const byId = new Map(plots.map((plot) => [plot.id, plot]));
  const imageIds = new Set(association.images.map((image) => image.sourceId));
  // The images after the move: plot positions take the moved plots; `\addlegendimage`s stay.
  const newImages: string[] = [];
  let slot = 0;
  for (const item of axis.body) {
    if (item.kind === "AddPlot") {
      const id = next[slot] ?? item.id;
      slot += 1;
      if (imageIds.has(id)) newImages.push(id);
    } else if (item.kind === "AddLegendImage" && imageIds.has(item.id)) newImages.push(item.id);
  }
  const entryOf = (id: string): number | null => legendEntryOf(association, id)?.entry ?? null;
  const entries = association.entries;
  const notes: string[] = [];
  const replacements: Replacement[] = [];
  const plotText = (id: string): TikzFragment => {
    const plot = byId.get(id);
    return plot ? sourceSlice(source, plot.span) : EMPTY_FRAGMENT;
  };

  // Attached form: every entry is an `\addlegendentry` right after its image. Units move whole.
  const attached = new Map<string, AddLegendEntryStatement>();
  const allAttached = entries.length <= association.images.length && entries.every((entry, index) => {
    const origin = entry.origin;
    const imageId = association.images[index]?.sourceId;
    if (origin?.kind !== "addlegendentry" || !imageId) return false;
    const at = axis.body.findIndex((item) => item.id === imageId);
    const following = axis.body[at + 1];
    const imageItem = axis.body[at];
    if (!imageItem || following?.kind !== "AddLegendEntry" || following.id !== origin.statementId || !/^\s*$/u.test(source.slice(imageItem.span.to, following.span.from))) return false;
    attached.set(imageId, following);
    return true;
  });
  if (allAttached) {
    const lastWith = newImages.reduce((last, id, j) => (attached.has(id) ? j : last), -1);
    const needsEmpty = new Set(newImages.filter((id, j) => j < lastWith && !attached.has(id)));
    if (needsEmpty.size > 0) notes.push(EMPTY_ENTRY_NOTE);
    const unitSpan = (id: string): Span => {
      const plot = byId.get(id);
      const entry = attached.get(id);
      return plot ? { from: plot.span.from, to: (entry ?? plot).span.to } : { from: 0, to: 0 };
    };
    const emptyAfter = (span: Span): TikzFragment => tikz`${layout(`\n${indentAt(source, span.from)}`)}\addlegendentry{}`;
    plotIds.forEach((id, s) => {
      const target = next[s] ?? id;
      const span = unitSpan(id);
      const moved = sourceSlice(source, unitSpan(target));
      const text = needsEmpty.has(target) ? tikz`${moved}${emptyAfter(unitSpan(target))}` : moved;
      if (target !== id || needsEmpty.has(target)) replacements.push({ span, fragment: text });
    });
    for (const item of axis.body) {
      if (item.kind === "AddLegendImage" && needsEmpty.has(item.id)) replacements.push({ span: { from: item.span.to, to: item.span.to }, fragment: emptyAfter(item.span) });
    }
    return { replacements, notes };
  }

  // Slot form: plots trade places; entry slots stay and take the entries of the images now at their index.
  plotIds.forEach((id, s) => {
    const target = next[s] ?? id;
    if (target !== id) replacements.push({ span: byId.get(id)?.span ?? { from: 0, to: 0 }, fragment: plotText(target) });
  });
  const desired = newImages.map((id) => entryOf(id));
  const lastWith = desired.reduce<number>((last, entry, j) => (entry !== null ? j : last), -1);
  type Content = { kind: "entry"; index: number } | { kind: "empty" } | { kind: "drop" };
  const contentFor = (k: number): Content => {
    if (k >= newImages.length) return { kind: "entry", index: k };
    if (k > lastWith) return { kind: "drop" };
    const index = desired[k];
    return index === null || index === undefined ? { kind: "empty" } : { kind: "entry", index };
  };
  const cache = new Map<string, ListContainer | null>();
  const listContents = new Map<ListContainer, Array<TikzFragment | null>>();
  let lastStatement: AddLegendEntryStatement | null = null;
  let lastList: ListContainer | null = null;
  const unchanged = (k: number, content: Content) => content.kind === "entry" && content.index === k;
  for (let k = 0; k < entries.length; k += 1) {
    const slotEntry = entries[k];
    const origin = slotEntry?.origin;
    if (!slotEntry || !origin) return { unsupported: "A legend entry of this axis is not written where it can be edited." };
    const content = contentFor(k);
    if (origin.kind === "addlegendentry") {
      lastStatement = statementOf(axis, origin.statementId);
      lastList = null;
      if (unchanged(k, content)) continue;
      if (content.kind === "drop") { replacements.push({ span: statementLineSpan(source, origin.span), fragment: EMPTY_FRAGMENT }); continue; }
      if (content.kind === "empty") { notes.push(EMPTY_ENTRY_NOTE); replacements.push({ span: origin.span, fragment: tikz`\addlegendentry{}` }); continue; }
      const moved = entries[content.index];
      if (moved) replacements.push({ span: origin.span, fragment: asStatement(source, moved) });
      continue;
    }
    const container = containerOf(source, axis, slotEntry, cache);
    if (!container || origin.span === null) return { unsupported: "The legend entries of this axis are not written as list items here (a `\\legend` with `...`, or `legend entries` set outside the axis options)." };
    lastList = container; lastStatement = null;
    const list = listContents.get(container) ?? container.items.map((item) => sourceSlice(source, item));
    const moved = content.kind === "entry" ? entries[content.index] : undefined;
    list[origin.index] = content.kind === "drop" ? null : content.kind === "empty" ? EMPTY_FRAGMENT : moved ? asItem(source, moved) : EMPTY_FRAGMENT;
    listContents.set(container, list);
  }
  // Images with an entry beyond the old list end get new entries after the last one.
  const appended: Content[] = [];
  for (let j = entries.length; j <= lastWith; j += 1) appended.push(contentFor(j));
  if (appended.length > 0) {
    if (lastList) {
      const list = listContents.get(lastList) ?? lastList.items.map((item) => sourceSlice(source, item));
      for (const content of appended) {
        const entry = content.kind === "entry" ? entries[content.index] : undefined;
        list.push(entry ? asItem(source, entry) : EMPTY_FRAGMENT);
      }
      listContents.set(lastList, list);
    } else if (lastStatement) {
      const indent = indentAt(source, lastStatement.span.from);
      const texts = appended.map((content) => {
        if (content.kind !== "entry") { notes.push(EMPTY_ENTRY_NOTE); return tikz`\addlegendentry{}`; }
        const entry = entries[content.index];
        return entry ? asStatement(source, entry) : tikz`\addlegendentry{}`;
      });
      replacements.push({ span: { from: lastStatement.span.to, to: lastStatement.span.to }, fragment: joinFragments(texts.map((text) => tikz`${layout(`\n${indent}`)}${text}`)) });
    }
  }
  for (const [container, list] of listContents) {
    // Trailing empties left by dropped slots are dropped too.
    const kept = list.filter((item): item is TikzFragment => item !== null);
    const original = container.items.map((item) => source.slice(item.from, item.to));
    if (kept.length === original.length && kept.every((item, i) => item === original[i])) continue;
    replacements.push(rebuildContainer(source, container, kept));
  }
  return { replacements, notes: [...new Set(notes)] };
}

/** The legend association of the scene `elements` came from when it was a full evaluation, else from evaluating the source. */
export function legendAssociationFor(source: string, axisId: string, parseOptions: EditParseOptions, elements?: readonly unknown[]): LegendAssociation | null {
  const known = elements ? getAxisEvaluations(elements).find((axis) => axis.axisId === axisId)?.legend : undefined;
  return known ?? readLegendAssociation(source, axisId, parseOptions);
}

const PAD_NOTE = "Plots before this one have no legend entry: empty `\\addlegendentry{}` statements keep the new entry with its plot, and draw their images without text.";

function itemText(entry: LegendEntryText | null, raw: string, original: string | null): string {
  const text = `${entry?.options ? `[${entry.options}]` : ""}${raw}`;
  const braced = (original?.trim().startsWith("{") ?? false) || /[,=]/u.test(text) || text.startsWith("[") !== Boolean(entry?.options);
  return braced ? `{${text}}` : text;
}

/**
 * Sets the legend text of a plot where the renderer reads it (the inspector's
 * "Legend entry"): its `\addlegendentry`, its `\legend` item or its `legend
 * entries` item. A plot without an entry gets one at its index: an item of
 * the list in use (padded with empty items, which draw no pair), or an
 * `\addlegendentry` (padded with empty ones when plots before it have none).
 * An empty text removes the entry when nothing follows it, else empties it.
 */
export function setPlotLegendEntry(source: string, axis: AxisStatement, association: LegendAssociation, plotId: string, text: string): LegendEditResult {
  const info = legendEntryOf(association, plotId);
  if (!info) return { unsupported: "A `forget plot` has no legend entry." };
  const entries = association.entries;
  const plot = axis.body.find((item) => item.id === plotId);
  if (!plot) return { unsupported: "The plot was not found." };
  const typed = (value: string) => userText(value, "inspector-value");
  const cache = new Map<string, ListContainer | null>();
  if (info.entry !== null) {
    const entry = entries[info.entry];
    const origin = entry?.origin;
    if (!entry || !origin) return { unsupported: "The legend entry of this plot is not written where it can be edited." };
    const isLast = info.entry === entries.length - 1;
    if (origin.kind === "addlegendentry") {
      const statement = statementOf(axis, origin.statementId);
      if (!statement) return { unsupported: "The legend entry was not found." };
      if (text.length > 0) return { replacements: [{ span: statement.textSpan, fragment: typed(text) }], notes: [] };
      if (isLast) return { replacements: [{ span: statementLineSpan(source, statement.span), fragment: EMPTY_FRAGMENT }], notes: [] };
      return { replacements: [{ span: statement.textSpan, fragment: EMPTY_FRAGMENT }], notes: ["Plots after this one have legend entries: the entry is left empty (`\\addlegendentry{}`) so they keep theirs; its image is drawn without text."] };
    }
    const container = containerOf(source, axis, entry, cache);
    if (!container || origin.span === null) return { unsupported: "The legend entry of this plot is not written as a list item in this axis (a `\\legend` with `...`, or `legend entries` set outside the axis options)." };
    const original = source.slice(origin.span.from, origin.span.to);
    if (text.length > 0) return { replacements: [{ span: origin.span, fragment: typed(itemText(entry, text, original)) }], notes: [] };
    const lastInList = origin.index === container.items.length - 1 && isLast;
    const contents = container.items.flatMap((item, i) => (i === origin.index ? (lastInList ? [] : [EMPTY_FRAGMENT]) : [sourceSlice(source, item)]));
    return { replacements: [rebuildContainer(source, container, contents)], notes: [] };
  }
  if (text.length === 0) return { replacements: [], notes: [] };
  const k = info.image;
  const last = entries[entries.length - 1];
  const lastOrigin = last?.origin;
  const indent = indentAt(source, plot.span.from);
  const after = (span: Span, fragments: readonly TikzFragment[]): Replacement => ({ span: { from: span.to, to: span.to }, fragment: joinFragments(fragments.map((fragment) => tikz`${layout(`\n${indent}`)}${fragment}`)) });
  if (association.form === "none") {
    if (k === 0) return { replacements: [after(plot.span, [tikz`\addlegendentry{${typed(text)}}`])], notes: [] };
    // Empty `\legend` items draw no pair (L4): the earlier plots stay out of the legend.
    return { replacements: [after(plot.span, [tikz`\legend{${typed(`${",".repeat(k)}${itemText(null, text, null)}`)}}`])], notes: [] };
  }
  if (lastOrigin && lastOrigin.kind !== "addlegendentry") {
    const container = containerOf(source, axis, last, cache);
    if (!container || lastOrigin.span === null) return { unsupported: "The legend entries of this axis are not written as list items here (a `\\legend` with `...`, or `legend entries` set outside the axis options)." };
    const contents = container.items.map((item) => sourceSlice(source, item));
    for (let j = entries.length; j < k; j += 1) contents.push(EMPTY_FRAGMENT);
    contents.push(typed(itemText(null, text, null)));
    return { replacements: [rebuildContainer(source, container, contents)], notes: [] };
  }
  if (!lastOrigin) return { unsupported: "The legend entries of this axis are not written where they can be edited." };
  // `\addlegendentry` form: after the plot, or after the last entry when that comes later in the body.
  const anchor = lastOrigin.span.from > plot.span.to ? lastOrigin.span : plot.span;
  const pads = Math.max(0, k - entries.length);
  const statements = [...Array.from({ length: pads }, () => tikz`\addlegendentry{}`), tikz`\addlegendentry{${typed(text)}}`];
  return { replacements: [after(anchor, statements)], notes: pads > 0 ? [PAD_NOTE] : [] };
}
