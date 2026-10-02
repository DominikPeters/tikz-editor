import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import {
  beamerOverlaySpecContains,
  resolveBeamerOverlaySpanVisibility,
  scanBeamerFrameOverlays,
  type BeamerOverlayCommand,
  type BeamerOverlayModel,
  type BeamerOverlaySpec,
  type BeamerOverlayVisibility,
} from "./overlay.js";
import { scanBeamerDocumentWithSyntax } from "./scan.js";
import {
  beamerOptionalArgumentAfter,
  beamerOverlayArgumentAfter,
  beamerRequiredArgumentAfter,
  createBeamerSyntaxContext,
  type BeamerSyntaxContext,
} from "./syntax.js";

export type BeamerBuildRow = {
  /** Identity is an authored source location, never the generated label. */
  id: string;
  parentId: string | null;
  kind: "content" | "list" | "branch" | "pause" | "unsupported";
  label: string;
  sourceSpan: Span;
  contentSpans: readonly Span[];
  ruleSpan: Span;
  spec: BeamerOverlaySpec | null;
  command?: BeamerOverlayCommand;
  provenance: "explicit" | "relative" | "list-default" | "branch" | "pause" | "unsupported";
  editable: boolean;
};

export type BeamerBuildModel = {
  source: string;
  frameId: string;
  stepCount: number;
  rows: readonly BeamerBuildRow[];
  overlays: BeamerOverlayModel;
};

export type BeamerBuildState = {
  visibility: BeamerOverlayVisibility | "unknown";
  label: string;
  /** Source ranges of the active branch; absent content has no canvas bounds. */
  contentSpans: readonly Span[];
};

const contains = (outer: Span, inner: Span): boolean =>
  outer.from <= inner.from && outer.to >= inner.to;

/** Deliberately excludes relative, mode-qualified and action specifications. */
export function isExplicitBeamerBuildSpec(value: string): boolean {
  return value.trim().length > 0 && value.split(",").every((part) => {
    const match = /^\s*(\d+)?\s*(-)?\s*(\d+)?\s*$/u.exec(part);
    if (!match || (!match[1] && !match[3]) || (!match[2] && match[3])) return false;
    const from = Number(match[1] ?? 1);
    const to = match[2] && match[3] ? Number(match[3]) : from;
    return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 1 && to >= from;
  });
}

function understoodSpec(spec: BeamerOverlaySpec): boolean {
  // The scanner resolves +/. and these presentation qualifiers. Reject any
  // unconsumed syntax instead of presenting a partially decoded rule as truth.
  return isExplicitBeamerBuildSpec(spec.resolved);
}

function excerpt(value: string): string {
  const text = value
    .replace(/(?<!\\)%[^\n]*/gu, " ")
    .replace(/\\(?:textbf|textit|textrm|textsf|emph|alert|underline)\s*\{([^{}]*)\}/gu, "$1")
    .replace(/\\(?:begin|end)\{[^{}]*\}(?:\[[^\]]*\])?/gu, " ")
    .replace(/\\item(?:<[^>]*>)?(?:\[[^\]]*\])?/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > 52 ? `${text.slice(0, 51).trimEnd()}…` : text;
}

function contentLabel(context: BeamerSyntaxContext, span: Span): string {
  const raw = context.source.slice(span.from, span.to).trim();
  const boundaries = context.syntax.environmentBoundariesIn(span);
  const begin = boundaries.find((entry) => entry.kind === "begin");
  const firstControl = context.syntax.controlsIn(span)[0];
  if (begin?.span.from === firstControl?.span.from && begin) {
    // A wrapper around several objects gets a group row, even when its first
    // child happens to have a title. Do not call the whole group that block.
    let depth = 0;
    const end = boundaries.find((entry) => {
      depth += entry.kind === "begin" ? 1 : -1;
      return depth === 0;
    });
    const prefix = context.source.slice(span.from, begin.span.from).trim();
    const suffix = context.source.slice(end?.span.to ?? span.to, span.to).trim();
    if (prefix || suffix) return `Group · ${excerpt(raw)}`;
    let cursor = begin.span.to;
    const overlay = beamerOverlayArgumentAfter(context, cursor, span.to);
    cursor = overlay?.span.to ?? cursor;
    const optional = beamerOptionalArgumentAfter(context, cursor, span.to);
    cursor = optional?.span.to ?? cursor;
    const title = beamerRequiredArgumentAfter(context, cursor, span.to);
    if (["block", "alertblock", "exampleblock", "theorem", "lemma", "definition", "proof", "corollary", "proposition"].includes(begin.name)) {
      return `${begin.name.includes("block") ? "Block" : begin.name[0].toUpperCase() + begin.name.slice(1)} · ${excerpt(title?.value ?? optional?.value ?? raw) || "Untitled"}`;
    }
    if (begin.name === "tikzpicture") return "Diagram · TikZ picture";
    if (["equation", "equation*", "align", "align*"].includes(begin.name)) return `Equation · ${excerpt(raw)}`;
    if (["itemize", "enumerate", "description"].includes(begin.name)) return `List · ${excerpt(raw) || "Empty list"}`;
  }
  if (firstControl?.name === "includegraphics") {
    const optional = beamerOptionalArgumentAfter(context, firstControl.span.to, span.to);
    const file = beamerRequiredArgumentAfter(context, optional?.span.to ?? firstControl.span.to, span.to);
    if (file && !context.source.slice(file.span.to, span.to).trim()) return `Image · ${file.value.split(/[\\/]/u).at(-1) ?? file.value}`;
  }
  const group = /\n\s*\n/u.test(raw) || boundaries.filter((entry) => entry.kind === "begin").length > 1;
  return `${group ? "Group" : /^(?:\$|\\\[)/u.test(raw) ? "Equation" : "Text"} · ${excerpt(raw) || "Empty content"}`;
}

/** A source projection, independent of the active overlay's rendered objects. */
export function buildBeamerBuildModel(source: string, frameId: string): BeamerBuildModel | null {
  const context = createBeamerSyntaxContext(source);
  const document = scanBeamerDocumentWithSyntax(context);
  const frame = document.frames.find((candidate) => candidate.id === frameId);
  if (!frame) return null;
  const overlays = scanBeamerFrameOverlays(source, frame, context.syntax);
  const rows: BeamerBuildRow[] = [];
  const ruleFields = (spec: BeamerOverlaySpec) => {
    const editable = isExplicitBeamerBuildSpec(spec.source.value);
    const relative = /[+.]/u.test(spec.source.value);
    return {
      spec,
      ruleSpan: spec.source.span,
      editable,
      provenance: editable ? "explicit" as const : relative ? "relative" as const : "unsupported" as const,
    };
  };

  for (const command of overlays.commands) {
    const alternatives = command.branches.length > 1;
    const id = `command:${command.span.from}`;
    rows.push({
      id, parentId: null, kind: "content", sourceSpan: command.span,
      contentSpans: command.branches.map((branch) => branch.contentSpan),
      label: alternatives ? `${command.kind === "alt" ? "Alternatives" : "Before / during / after"} · ${command.branches.map((branch) => excerpt(branch.value)).join(" / ")}`
        : contentLabel(context, command.branches[0].contentSpan),
      command, ...ruleFields(command.spec),
    });
    if (alternatives) {
      command.branches.forEach((branch, index) => rows.push({
        id: `${id}:branch:${index}`, parentId: id, kind: "branch",
        sourceSpan: branch.span, contentSpans: [branch.contentSpan],
        label: `${command.kind === "alt" ? ["On matching steps", "Otherwise"][index] : ["Before", "During", "After"][index]} · ${excerpt(branch.value) || "Empty"}`,
        spec: command.spec, ruleSpan: command.spec.source.span,
        provenance: "branch", editable: false,
      }));
    }
  }
  for (const { span, spec } of overlays.listDefaults) {
    rows.push({
      id: `list:${span.from}`, parentId: null, kind: "list",
      sourceSpan: span, contentSpans: [],
      label: contentLabel(context, span), ...ruleFields(spec),
    });
  }
  for (const item of overlays.items) {
    rows.push({
      id: `item:${item.commandSpan.from}`, parentId: null, kind: "content",
      sourceSpan: { from: item.commandSpan.from, to: item.contentSpan.to },
      contentSpans: [item.contentSpan],
      label: `Bullet · ${excerpt(source.slice(item.contentSpan.from, item.contentSpan.to)) || "Empty item"}`,
      ...ruleFields(item.spec),
      ...(item.defaultListSpan ? {
        provenance: "list-default" as const, editable: false,
      } : {}),
    });
  }
  for (const pause of overlays.pauses) {
    rows.push({
      id: `pause:${pause.span.from}`, parentId: null, kind: "pause",
      sourceSpan: pause.span, contentSpans: [pause.contentSpan], ruleSpan: pause.span,
      label: `Pause before “${excerpt(source.slice(pause.contentSpan.from, pause.contentSpan.to)) || "end of frame"}”`,
      spec: null, provenance: "pause", editable: false,
    });
  }

  // Keep unsupported overlay-bearing commands discoverable, without guessing
  // their paint or counter semantics (e.g. \alert<2>, a macro, bare \onslide).
  for (const control of context.syntax.controlsIn(frame.bodySpan)) {
    if (["begin", "end", "item"].includes(control.name) || overlays.commands.some((command) => command.commandSpan.from === control.span.from)) continue;
    const spec = beamerOverlayArgumentAfter(context, control.span.to, frame.bodySpan.to);
    if (!spec) continue;
    const body = beamerRequiredArgumentAfter(context, spec.span.to, frame.bodySpan.to);
    rows.push({
      id: `unsupported:${control.span.from}`, parentId: null, kind: "unsupported",
      sourceSpan: { from: control.span.from, to: body?.span.to ?? spec.span.to },
      contentSpans: body ? [body.contentSpan] : [], ruleSpan: spec.span,
      label: `Source · \\${control.name}${body ? ` · ${excerpt(body.value)}` : ""}`,
      spec: null, provenance: "unsupported", editable: false,
    });
  }

  for (const row of rows) {
    if (row.parentId) continue;
    const parents = rows.filter((candidate) => candidate !== row && candidate.kind !== "pause" &&
      contains(candidate.sourceSpan, row.sourceSpan) &&
      candidate.sourceSpan.to - candidate.sourceSpan.from > row.sourceSpan.to - row.sourceSpan.from);
    parents.sort((a, b) => (a.sourceSpan.to - a.sourceSpan.from) - (b.sourceSpan.to - b.sourceSpan.from));
    row.parentId = parents[0]?.id ?? null;
  }
  rows.sort((a, b) => a.sourceSpan.from - b.sourceSpan.from || b.sourceSpan.to - a.sourceSpan.to);
  return { source, frameId, stepCount: overlays.stepCount, rows, overlays };
}

export function beamerBuildStateAt(model: BeamerBuildModel, row: BeamerBuildRow, step: number): BeamerBuildState {
  if (row.kind === "unsupported" || (row.spec && !understoodSpec(row.spec))) {
    return { visibility: "unknown", label: "Unknown", contentSpans: [] };
  }
  if (row.kind === "list") {
    return { visibility: "unknown", label: "List default", contentSpans: [] };
  }
  if (model.rows.some((candidate) => candidate.kind === "unsupported" && candidate.contentSpans.length === 0 &&
    candidate.sourceSpan.to <= row.sourceSpan.from)) {
    return { visibility: "unknown", label: "Unknown preceding rule", contentSpans: [] };
  }
  let spans = row.contentSpans;
  let branchLabel: string | null = null;
  if (row.command && row.command.branches.length > 1) {
    const command = row.command;
    const matches = beamerOverlaySpecContains(command.spec, step);
    const branch = command.kind === "alt" ? (matches ? 0 : 1)
      : matches ? 1 : step < (command.spec.minimumStep ?? 1) ? 0 : 2;
    spans = [command.branches[branch].contentSpan];
    branchLabel = excerpt(command.branches[branch].value) || "Empty branch";
  }
  if (model.rows.some((candidate) => candidate !== row && candidate.kind !== "list" &&
    (candidate.kind === "unsupported" || (candidate.spec && !understoodSpec(candidate.spec))) &&
    spans.some((span) => contains(candidate.sourceSpan, span)))) {
    return { visibility: "unknown", label: "Unknown enclosing rule", contentSpans: [] };
  }
  const states = spans.map((span) => resolveBeamerOverlaySpanVisibility(model.overlays, span, step));
  const visibility = states.includes("visible") ? "visible" : states.includes("hidden") ? "hidden" : "removed";
  return {
    visibility,
    label: visibility === "visible" ? branchLabel ?? "Visible" : visibility === "hidden" ? "Covered" : "Absent",
    contentSpans: visibility === "visible" ? spans : [],
  };
}

/** Test interval boundaries, not every step: <1000000-> must stay cheap. */
export function firstVisibleBeamerBuildStep(model: BeamerBuildModel, row: BeamerBuildRow): number | null {
  const candidates = new Set([1]);
  for (const spec of [...model.overlays.commands, ...model.overlays.items].map((entry) => entry.spec)) {
    for (const interval of spec.intervals) {
      candidates.add(interval.from);
      if (interval.to != null) candidates.add(interval.to + 1);
    }
  }
  for (const pause of model.overlays.pauses) candidates.add(pause.threshold);
  return [...candidates].filter((step) => step <= model.stepCount).sort((a, b) => a - b)
    .find((step) => beamerBuildStateAt(model, row, step).visibility === "visible") ?? null;
}

export function beamerBuildSpecPatch(model: BeamerBuildModel, rowId: string, value: string): SourcePatch | null {
  const row = model.rows.find((candidate) => candidate.id === rowId);
  if (!row?.editable || !row.spec || !isExplicitBeamerBuildSpec(value)) return null;
  const oldSpan = row.spec.source.contentSpan;
  const replacement = value.trim();
  return { oldSpan, newSpan: { from: oldSpan.from, to: oldSpan.from + replacement.length }, replacement };
}

export type BeamerBuildTimingAction = "from" | "only" | "through";
export type BeamerBuildBoundary = "start" | "end";

/** These commands describe visibility, so inverted and branching rules use the text field. */
export function canEditBeamerBuildTiming(row: BeamerBuildRow): boolean {
  return row.editable && (!row.command || ["only", "uncover", "visible"].includes(row.command.kind));
}

export function beamerBuildTimingPatch(model: BeamerBuildModel, rowId: string, action: BeamerBuildTimingAction, step: number): SourcePatch | null {
  const row = model.rows.find((candidate) => candidate.id === rowId);
  if (!row || !canEditBeamerBuildTiming(row) || !Number.isSafeInteger(step) || step < 1) return null;
  return beamerBuildSpecPatch(model, rowId, action === "from" ? `${step}-` : action === "through" ? `-${step}` : String(step));
}

/** A single authored interval; never flatten disjoint or relative specifications. */
export function beamerBuildRange(row: BeamerBuildRow): { from: number; to: number | null } | null {
  if (!canEditBeamerBuildTiming(row) || !row.spec || row.spec.source.value.includes(",")) return null;
  const interval = row.spec.intervals[0];
  return interval ? { from: interval.from, to: interval.to } : null;
}

export function beamerBuildBoundaryPatch(model: BeamerBuildModel, rowId: string, boundary: BeamerBuildBoundary, step: number): SourcePatch | null {
  const row = model.rows.find((candidate) => candidate.id === rowId);
  const range = row ? beamerBuildRange(row) : null;
  if (!row?.spec || !range || !Number.isSafeInteger(step) || step < 1 || (boundary === "end" && range.to == null)) return null;
  const from = boundary === "start" ? Math.min(step, range.to ?? Number.MAX_SAFE_INTEGER) : range.from;
  const to = boundary === "end" ? Math.max(step, range.from) : range.to;
  if (from === range.from && to === range.to) return null;
  // Preserve an omitted lower bound when moving only the upper bound.
  const value = to == null ? `${from}-` : boundary === "end" && row.spec.source.value.trim().startsWith("-")
    ? `-${to}` : from === to ? String(from) : `${from}-${to}`;
  return beamerBuildSpecPatch(model, rowId, value);
}

/** Keep selection through ordinary source edits; never identify rows by label. */
export function reconcileBeamerBuildRow(previous: BeamerBuildModel, rowId: string, next: BeamerBuildModel): BeamerBuildRow | null {
  const row = previous.rows.find((candidate) => candidate.id === rowId);
  if (!row || previous.frameId !== next.frameId) return null;
  if (previous.source === next.source) return next.rows.find((candidate) => candidate.id === rowId) ?? null;
  let start = 0;
  while (start < previous.source.length && start < next.source.length && previous.source[start] === next.source[start]) start++;
  let oldEnd = previous.source.length;
  let newEnd = next.source.length;
  while (oldEnd > start && newEnd > start && previous.source[oldEnd - 1] === next.source[newEnd - 1]) { oldEnd--; newEnd--; }
  if (start <= row.sourceSpan.from && oldEnd >= row.sourceSpan.to) return null;
  const from = row.sourceSpan.from < start ? row.sourceSpan.from
    : row.sourceSpan.from >= oldEnd ? row.sourceSpan.from + newEnd - oldEnd : null;
  return next.rows.find((candidate) => candidate.sourceSpan.from === from && candidate.kind === row.kind) ?? null;
}
