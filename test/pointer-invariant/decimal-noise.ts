import { applyEditAction, type EditAction } from "../../packages/core/src/edit/actions.js";
import { createEditGeometrySession } from "../../packages/core/src/edit/geometry-session.js";
import { collectSourceWorldBounds } from "../../packages/core/src/edit/snapping/geometry.js";
import { applyMatrix } from "../../packages/core/src/semantic/transform.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { pointAtPlacementSegment } from "../../packages/core/src/semantic/path/path-attached.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import type { DocumentGraphicsResolver } from "../../packages/core/src/graphics/types.js";
import type { EvaluateOptions } from "../../packages/core/src/semantic/types.js";
import type { NodeTextEngine } from "../../packages/core/src/text/types.js";
import { wp } from "../coords-helpers.js";
import { BODIES, FRAMES, caseRandom, pictureSource, runPointerFuzz, type Body, type FrameStack, type Snapshot } from "./pointer-fuzz.js";

/**
 * Decimal-noise audit: does an edit write more decimals than the gesture
 * could have meant? A pointer is only as precise as a screen pixel, so every
 * number an edit writes is checked against the shortest decimal that would
 * render the picture within half a pixel of what was written. The difference
 * in decimal places is the noise.
 *
 * Also: dragging something back to where it was must restore the source.
 */

/** Half a CSS pixel at 100% zoom, in pt. */
export const DEFAULT_TOLERANCE_PT = 0.375;

/** An image node, so resizes that scale `\includegraphics` are audited too. */
export const IMAGE_BODY: Body = { label: "image-node", text: String.raw`\node[inner sep=0pt,P] at (1,1) {\includegraphics[width=2cm]{photo.png}};` };

export type WrittenNumber = {
  readonly text: string;
  /** What follows the number: a unit, a length macro, or "" for plain numbers. */
  readonly unit: string;
  readonly written: number;
  /** Fewest decimals that render within tolerance of what was written. */
  readonly needed: number;
  readonly shortest: string;
};

export type EditAudit = {
  readonly key: string;
  readonly action: string;
  readonly frame: string;
  readonly numbers: readonly WrittenNumber[];
  /** The changed source text, for the report. */
  readonly wrote: string;
};

/**
 * restored: the source came back byte for byte. respelled: the same numbers,
 * written differently (`.5` → `0.5`). drifted: a number came back different.
 * restructured: other text changed (a named endpoint became a coordinate).
 */
export type DragBackOutcome = "restored" | "respelled" | "drifted" | "restructured" | "refused";
export type DragBackAudit = { readonly key: string; readonly action: string; readonly frame: string; readonly outcome: DragBackOutcome; readonly diff?: string };

export type DecimalNoiseRun = { readonly edits: EditAudit[]; readonly dragBacks: DragBackAudit[]; readonly tolerancePt: number };

/**
 * Every image resolves to a 4:3 picture, so an image is drawn at its
 * graphicx size; unresolved, core would set the command's source text.
 */
const GRAPHICS: DocumentGraphicsResolver = { cacheKey: "decimal-noise", resolve: () => ({ status: "resolved", mimeType: "image/png", dataBase64: "", naturalWidthPt: 120, naturalHeightPt: 90, revision: "1" }) };

/**
 * How the audit renders: images resolved, and, when given, the native TeX
 * engine, which is what measures an image inside a node.
 */
export type AuditRendering = { readonly evaluateOptions: EvaluateOptions };

export function auditRendering(textEngine?: NodeTextEngine): AuditRendering {
  return { evaluateOptions: { graphicsResolver: GRAPHICS, ...(textEngine ? { textEngine } : {}) } };
}

const PLAIN = auditRendering();

/** A render with images resolved, for the fingerprints and the audit's own edits. */
function render(source: string, rendering: AuditRendering): Snapshot {
  const parsed = parseTikz(source, { recover: true, includeContextDefinitions: true });
  const semantic = evaluateTikzFigure(parsed.figure, source, rendering.evaluateOptions);
  return { source, handles: semantic.editHandles, parsed, semantic };
}

const NUMBER = /[-+]?(?:\d+\.\d*|\.\d+|\d+)/gu;
const UNIT = /^\s*(?:\\[A-Za-z]+|cm|mm|pt|bp|in|em|ex|sp|pc|dd|cc)?/u;

type Fingerprint = { handles: { x: number; y: number }[]; bounds: Map<string, number[]>; scene: { x: number; y: number }[] };

function fingerprint(snapshot: Snapshot): Fingerprint {
  const bounds = new Map<string, number[]>();
  for (const [id, box] of collectSourceWorldBounds(snapshot.semantic.scene.elements)) bounds.set(id, [box.minX, box.minY, box.maxX, box.maxY]);
  const scene = snapshot.semantic.scene.elements.flatMap(element => {
    const local = element.kind === "Path"
      ? element.commands.flatMap(command => command.kind === "M" || command.kind === "L" ? [command.to] : command.kind === "C" ? [command.c1, command.c2, command.to] : [])
      : element.kind === "Circle" || element.kind === "Ellipse" ? [element.center] : [];
    return local.map(point => element.transform ? applyMatrix(element.transform, point) : point);
  });
  return { handles: snapshot.handles.map(handle => handle.world), bounds, scene };
}

/** Whether two renders of the same structure lie within `tolerance` of each other everywhere. */
function within(a: Fingerprint, b: Fingerprint, tolerance: number): boolean {
  const close = (p: { x: number; y: number }[], q: { x: number; y: number }[]) =>
    p.length === q.length && p.every((point, index) => Math.hypot(point.x - q[index].x, point.y - q[index].y) <= tolerance);
  if (!close(a.handles, b.handles) || !close(a.scene, b.scene) || a.bounds.size !== b.bounds.size) return false;
  for (const [id, box] of a.bounds) {
    const other = b.bounds.get(id);
    if (!other || box.some((value, index) => Math.abs(value - other[index]) > tolerance)) return false;
  }
  return true;
}

function decimalsOf(text: string): number {
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

function roundTo(text: string, decimals: number): string {
  const value = Number(text);
  const rounded = Number(value.toFixed(decimals));
  const plain = String(Object.is(rounded, -0) ? 0 : rounded);
  // Keep a leading-dot spelling when the author's text used one.
  return /^[-+]?\./u.test(text) ? plain.replace(/^(-?)0\./u, "$1.") : plain;
}

/** The changed region of `after`, widened to whole numbers at its ends. */
function changedRegion(before: string, after: string): { from: number; to: number } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  let from = start;
  let to = after.length - end;
  while (from > 0 && /[\d.]/u.test(after[from - 1])) from--;
  while (to < after.length && /[\d.]/u.test(after[to])) to++;
  return { from, to };
}

/** Every decimal number the edit wrote, with the fewest decimals it needed. */
export function auditWrittenNumbers(before: Snapshot, after: Snapshot, tolerance: number, rendering: AuditRendering = PLAIN): { numbers: WrittenNumber[]; wrote: string } {
  const region = changedRegion(before.source, after.source);
  const wrote = after.source.slice(region.from, region.to);
  const reference = fingerprint(render(after.source, rendering));
  const numbers: WrittenNumber[] = [];
  for (const match of wrote.matchAll(NUMBER)) {
    const text = match[0];
    const at = region.from + match.index;
    // Digits in names (`node3`, `path:0`) are not numbers TikZ reads.
    if (/[A-Za-z_:@]/u.test(after.source[at - 1] ?? "")) continue;
    const written = decimalsOf(text);
    if (written === 0) continue;
    const unit = (UNIT.exec(after.source.slice(at + text.length))?.[0] ?? "").trim();
    let needed = written;
    let shortest = text;
    for (let decimals = 0; decimals < written; decimals++) {
      const candidate = roundTo(text, decimals);
      if (candidate === text) break;
      const source = after.source.slice(0, at) + candidate + after.source.slice(at + text.length);
      let candidateRender: Fingerprint;
      try { candidateRender = fingerprint(render(source, rendering)); } catch { continue; }
      if (within(candidateRender, reference, tolerance)) { needed = decimalsOf(candidate); shortest = candidate; break; }
    }
    numbers.push({ text, unit, written, needed, shortest });
  }
  return { numbers, wrote };
}

function applyDrag(snapshot: Snapshot, action: EditAction, rendering: AuditRendering): string | null {
  try {
    const geometry = createEditGeometrySession({ source: snapshot.source, parsed: snapshot.parsed, semantic: snapshot.semantic });
    const result = applyEditAction(snapshot.source, snapshot.handles, action, { geometry, evaluateOptions: rendering.evaluateOptions });
    return result.kind === "success" || result.kind === "partial" ? result.newSource : null;
  } catch {
    return null;
  }
}

/** The drag that undoes `action` by moving the pointer back. */
function reverseDrag(action: EditAction, before: Snapshot): EditAction | null {
  if (action.kind === "moveHandle") {
    const start = before.handles.find(handle => handle.id === action.handleId);
    return start ? { ...action, newWorld: start.world } : null;
  }
  if (action.kind === "moveElements") return { ...action, delta: wp(-action.delta.x, -action.delta.y) };
  return null;
}

function dragBack(key: string, frame: FrameStack, action: EditAction, before: Snapshot, after: Snapshot, rendering: AuditRendering): DragBackAudit | null {
  const reverse = reverseDrag(action, before);
  if (!reverse) return null;
  const name = key.split("|")[0];
  const restored = applyDrag(after, reverse, rendering);
  if (restored === null) return { key, action: name, frame: frame.label, outcome: "refused" };
  if (restored === before.source) return { key, action: name, frame: frame.label, outcome: "restored" };
  const region = changedRegion(before.source, restored);
  const original = changedRegion(restored, before.source);
  const was = before.source.slice(original.from, original.to);
  const now = restored.slice(region.from, region.to);
  return { key, action: name, frame: frame.label, outcome: classifyDrift(was, now), diff: `${JSON.stringify(was)} → ${JSON.stringify(now)}` };
}

function classifyDrift(was: string, now: string): DragBackOutcome {
  const template = (text: string) => text.replace(NUMBER, "#");
  const values = (text: string) => [...text.matchAll(NUMBER)].map(match => Number(match[0]));
  if (template(was) !== template(now)) return "restructured";
  const a = values(was), b = values(now);
  return a.every((value, index) => value === b[index]) ? "respelled" : "drifted";
}

/** Resizing an image node: the pointer fuzzer resizes only plain nodes and rectangles. */
function imageResizeEdits(frames: readonly FrameStack[], seed: number, rendering: AuditRendering, observe: (key: string, frame: FrameStack, action: EditAction, before: Snapshot, after: Snapshot) => void): void {
  for (const frame of frames) {
    const key = `resizeImage|${frame.label}|image-node|bottom-right`;
    const before = render(pictureSource(frame, IMAGE_BODY.text).source, rendering);
    const elementId = before.handles.find(handle => handle.kind === "node-position" && handle.sourceRef.sourceSpan.from > before.source.indexOf("{A}"))?.sourceRef.sourceId;
    const bounds = elementId ? collectSourceWorldBounds(before.semantic.scene.elements).get(elementId) : undefined;
    if (!elementId || !bounds) continue;
    const random = caseRandom(key, seed);
    const action: EditAction = { kind: "resizeElement", elementId, role: "bottom-right", newWorld: wp(bounds.maxX + 10 + 30 * random(), bounds.minY - 5 - 20 * random()) };
    const next = applyDrag(before, action, rendering);
    if (next !== null && next !== before.source) observe(key, frame, action, before, render(next, rendering));
  }
}

const ADORNED_BODY = String.raw`\node[draw,label=above:L,pin=right:P,P] at (1,1) {N};`;
const ATTACHED_BODY = String.raw`\draw[P] (0,0) -- (2,1) node[pos=.3] {M};`;

/**
 * Drags the pointer fuzzer has no cases for: labels and pins (angle and
 * distance) and nodes on a path (`pos`), each as the canvas sends them.
 */
function adornmentEdits(frames: readonly FrameStack[], seed: number, rendering: AuditRendering, observe: (key: string, frame: FrameStack, action: EditAction, before: Snapshot, after: Snapshot) => void): void {
  for (const frame of frames) {
    const adorned = render(pictureSource(frame, ADORNED_BODY).source, rendering);
    const owner = adorned.handles.find(handle => handle.kind === "node-position" && handle.sourceRef.sourceId.startsWith("path:") && handle.sourceRef.sourceSpan.from > adorned.source.indexOf("{A}"));
    for (const handle of adorned.handles.filter(h => h.kind === "node-position" && h.sourceRef.sourceId.startsWith("node-adornment:"))) {
      if (!owner) break;
      const kind = handle.sourceRef.sourceId.includes(":pin:") ? "pin" : "label";
      const key = `moveAdornment|${frame.label}|${kind}`;
      const random = caseRandom(key, seed);
      const angle = random() * 2 * Math.PI, length = 15 + 30 * random();
      const action: EditAction = { kind: "moveAdornment", targetId: handle.sourceRef.sourceId, ownerPoint: owner.world,
        newWorld: wp(owner.world.x + length * Math.cos(angle), owner.world.y + length * Math.sin(angle)) };
      const next = applyDrag(adorned, action, rendering);
      if (next !== null && next !== adorned.source) observe(key, frame, action, adorned, render(next, rendering));
    }

    const attached = render(pictureSource(frame, ATTACHED_BODY).source, rendering);
    const node = attached.handles.find(handle => handle.pathAttachmentContext !== undefined);
    const context = node?.pathAttachmentContext;
    if (!node || !context) continue;
    const key = `movePathAttachedNode|${frame.label}|line`;
    const random = caseRandom(key, seed);
    let length = 0;
    let previous = pointAtPlacementSegment(context.segment, 0);
    for (let i = 1; i <= 32; i++) {
      const point = pointAtPlacementSegment(context.segment, i / 32);
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
    }
    const host = attached.parsed.figure.body.find(statement => statement.kind === "Path" && statement.items.some(item => item.kind === "Node" && item.id === node.sourceRef.sourceId));
    if (!host || length <= 0) continue;
    const action: EditAction = { kind: "movePathAttachedNode", nodeId: node.sourceRef.sourceId, hostPathSourceId: host.id, pos: .1 + .8 * random(),
      posTolerance: DEFAULT_TOLERANCE_PT / length, snapToPreset: false, preserveRegime: true };
    const next = applyDrag(attached, action, rendering);
    if (next !== null && next !== attached.source) observe(key, frame, action, attached, render(next, rendering));
  }
}

export function runDecimalNoiseAudit(options: { seed?: number; frames?: readonly FrameStack[]; bodies?: readonly Body[]; tolerancePt?: number; textEngine?: NodeTextEngine } = {}): DecimalNoiseRun {
  const tolerancePt = options.tolerancePt ?? DEFAULT_TOLERANCE_PT;
  const rendering = auditRendering(options.textEngine);
  const edits: EditAudit[] = [];
  const dragBacks: DragBackAudit[] = [];
  const observe = (key: string, frame: FrameStack, action: EditAction, before: Snapshot, after: Snapshot) => {
    const { numbers, wrote } = auditWrittenNumbers(before, after, tolerancePt, rendering);
    edits.push({ key, action: key.split("|")[0], frame: frame.label, numbers, wrote });
    const back = dragBack(key, frame, action, before, after, rendering);
    if (back) dragBacks.push(back);
  };
  const frames = options.frames ?? FRAMES;
  runPointerFuzz(options.seed ?? 1, frames, options.bodies ?? [...BODIES, IMAGE_BODY], edit => observe(edit.key, edit.frame, edit.action, edit.before, edit.after));
  imageResizeEdits(frames, options.seed ?? 1, rendering, observe);
  adornmentEdits(frames, options.seed ?? 1, rendering, observe);
  return { edits, dragBacks, tolerancePt };
}

export type ActionSummary = {
  action: string;
  edits: number;
  numbers: number;
  /** Numbers with at least one decimal more than needed. */
  noisy: number;
  /** Numbers with three or more decimals too many: noise, not a judgement call. */
  gross: number;
  excessDigits: number;
  maxWritten: number;
};

export function summarize(run: DecimalNoiseRun): ActionSummary[] {
  const byAction = new Map<string, ActionSummary>();
  for (const edit of run.edits) {
    const entry = byAction.get(edit.action) ?? { action: edit.action, edits: 0, numbers: 0, noisy: 0, gross: 0, excessDigits: 0, maxWritten: 0 };
    entry.edits++;
    for (const number of edit.numbers) {
      entry.numbers++;
      const excess = number.written - number.needed;
      if (excess > 0) entry.noisy++;
      if (excess >= 3) entry.gross++;
      entry.excessDigits += excess;
      entry.maxWritten = Math.max(entry.maxWritten, number.written);
    }
    byAction.set(edit.action, entry);
  }
  return [...byAction.values()].sort((a, b) => b.gross - a.gross || b.excessDigits - a.excessDigits || a.action.localeCompare(b.action));
}

/** Markdown report: the ranking, the worst writes per action, and drag-back drift. */
export function renderReport(run: DecimalNoiseRun, examplesPerAction = 5): string {
  const summary = summarize(run);
  const lines = [
    "# Decimal-noise audit",
    "",
    `Tolerance: ${run.tolerancePt}pt (half a CSS pixel at 100% zoom). A number is noisy when fewer decimals render within that of what was written.`,
    "",
    "Noisy: at least one decimal too many. Gross: three or more.",
    "",
    "| Action | Edits | Numbers | Noisy | Gross | Excess digits | Max decimals |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...summary.map(s => `| ${s.action} | ${s.edits} | ${s.numbers} | ${s.noisy} | ${s.gross} | ${s.excessDigits} | ${s.maxWritten} |`),
    "",
  ];
  for (const s of summary.filter(entry => entry.noisy > 0)) {
    lines.push(`## ${s.action}`, "");
    const worst = run.edits.filter(edit => edit.action === s.action)
      .map(edit => ({ edit, excess: edit.numbers.reduce((sum, n) => sum + n.written - n.needed, 0) }))
      .filter(entry => entry.excess > 0).sort((a, b) => b.excess - a.excess).slice(0, examplesPerAction);
    for (const { edit } of worst) {
      const noisy = edit.numbers.filter(n => n.written > n.needed).map(n => `${n.text}${n.unit} → ${n.shortest}${n.unit}`).join(", ");
      lines.push(`- \`${edit.key}\`: ${noisy}`, `  wrote \`${edit.wrote.replace(/\s+/gu, " ").slice(0, 160)}\``);
    }
    lines.push("");
  }
  const counts = (outcome: DragBackOutcome) => run.dragBacks.filter(entry => entry.outcome === outcome).length;
  lines.push("## Drag back", "",
    `Moving the pointer back to the start: ${counts("restored")} restored the source, ${counts("respelled")} respelled numbers, ${counts("drifted")} drifted, ${counts("restructured")} restructured, ${counts("refused")} refused.`, "");
  for (const outcome of ["drifted", "respelled", "restructured"] as const) {
    const entries = run.dragBacks.filter(entry => entry.outcome === outcome);
    if (entries.length === 0) continue;
    lines.push(`### ${outcome}`, "");
    for (const entry of entries.slice(0, 15)) lines.push(`- \`${entry.key}\`: ${entry.diff ?? ""}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
