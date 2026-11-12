import type { Span, Statement } from "../ast/types.js";
import { walkStatements } from "../ast/walk.js";
import { expandForeachFigure } from "../foreach/index.js";
import { parseTikz } from "../parser/index.js";

/**
 * One overlay operation a picture performs, in the order TeX executes them.
 * Spans are the authored source's; a loop performs the operation at one
 * place once per iteration, each time as its own `instance`.
 */
export type TikzOverlayTraceOp =
  | {
      readonly kind: "path";
      /** The path statement, which exists only on the specification's steps. */
      readonly statementSpan: Span;
      readonly specSpan: Span;
      readonly specContentSpan: Span;
      /** The specification after the loop's substitutions (`2-` for `\x-`). */
      readonly raw: string;
      readonly instance: readonly number[];
      readonly loopSpan: Span | null;
    }
  | {
      readonly kind: "pause";
      readonly span: Span;
      readonly countRaw: string | null;
      readonly instance: readonly number[];
      readonly loopSpan: Span;
    };

export type TikzOverlayTrace = {
  readonly ops: readonly TikzOverlayTraceOp[];
  /**
   * Where the overlay commands start that the picture's parser reads and its
   * evaluator applies: those at statement level, and a loop body's
   * specifications and pauses.
   */
  readonly statementStarts: ReadonlySet<number>;
  /** The outermost loops whose bodies pause; their pauses are in `ops`, once per iteration. */
  readonly pausingLoops: readonly Span[];
};

/** Whether the picture's text can hold anything a trace reports. */
export function tikzOverlayTraceNeeded(text: string): boolean {
  return /\\(?:path|draw|fill|filldraw|pattern|shade|shadedraw|clip|useasboundingbox|node|coordinate|matrix|pic)\s*(?:\[[^\]]*\]\s*)?<|\\(?:pause|onslide|only|uncover|visible|invisible|alt|temporal)(?![A-Za-z@])/u.test(text);
}

const cache = new Map<string, TikzOverlayTrace>();
const CACHE_LIMIT = 64;

function shift(span: Span, by: number): Span {
  return { from: span.from + by, to: span.to + by };
}

/** The same order for two iterations of nested loops, outermost first: negative when `left` runs first. */
export function compareTikzOverlayInstances(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function traceRelative(text: string): TikzOverlayTrace {
  const figure = parseTikz(text, { recover: true }).figure;
  const statementStarts = new Set<number>();
  const seen = { loops: false };
  walkStatements(figure.body, {
    onStatement: (statement) => {
      if (statement.kind === "Foreach") seen.loops = true;
      if (statement.kind === "OverlayGroup" || statement.kind === "OverlayDeclaration" ||
        (statement.kind === "Path" && statement.overlay)) statementStarts.add(statement.span.from);
    }
  });
  const ops: TikzOverlayTraceOp[] = [];
  const pausingLoops: Span[] = [];
  const expanded = seen.loops ? expandForeachFigure(figure, text) : null;
  const visit = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === "Scope") { visit(statement.body); continue; }
      const attribution = expanded?.statementAttribution.get(statement);
      const stack = attribution?.foreachStack ?? [];
      const sourceMap = expanded?.statementSourceMaps.get(statement);
      const authored = (span: Span): Span | null => sourceMap ? sourceMap.mapSpan(span) : span;
      const statementSpan = authored(statement.span) ?? sourceMap?.sourceSpan ?? attribution?.sourceSpan ?? statement.span;
      const instance = stack.map((frame) => frame.iterationIndex);
      const loopSpan = stack[0]?.loopSpan ?? null;
      if (statement.kind === "Path" && statement.overlay) {
        // Substitution may have changed the specification's length; its place is then read from the authored text.
        const open = text.indexOf("<", statementSpan.from);
        const close = text.indexOf(">", open);
        const specSpan = authored(statement.overlay.span) ?? (open >= 0 && close > open && close < statementSpan.to ? { from: open, to: close + 1 } : null);
        if (!specSpan || text[specSpan.from] !== "<") continue;
        if (stack.length > 0) statementStarts.add(statementSpan.from);
        ops.push({ kind: "path", statementSpan, specSpan, specContentSpan: { from: specSpan.from + 1, to: Math.max(specSpan.from + 1, specSpan.to - 1) },
          raw: statement.overlay.raw, instance, loopSpan });
      } else if (statement.kind === "OverlayDeclaration" && statement.command === "pause" && loopSpan) {
        statementStarts.add(statementSpan.from);
        if (!pausingLoops.some((loop) => loop.from === loopSpan.from)) pausingLoops.push(loopSpan);
        ops.push({ kind: "pause", span: statementSpan, countRaw: statement.countRaw ?? null, instance, loopSpan });
      }
    }
  };
  visit(expanded?.figureBody ?? figure.body);
  return { ops, statementStarts, pausingLoops };
}

/**
 * The overlay operations of the picture at `picture`, from its parsed and
 * loop-expanded statements: what the frame's decoder resolves for it, and
 * what its evaluator then asks about, by place and iteration.
 */
export function tikzOverlayTrace(source: string, picture: Span): TikzOverlayTrace {
  const text = source.slice(picture.from, picture.to);
  let relative = cache.get(text);
  if (!relative) {
    relative = traceRelative(text);
    if (cache.size >= CACHE_LIMIT) cache.delete(requireFirstKey(cache));
    cache.set(text, relative);
  }
  const by = picture.from;
  return {
    ops: relative.ops.map((op) => op.kind === "path"
      ? { ...op, statementSpan: shift(op.statementSpan, by), specSpan: shift(op.specSpan, by), specContentSpan: shift(op.specContentSpan, by), loopSpan: op.loopSpan ? shift(op.loopSpan, by) : null }
      : { ...op, span: shift(op.span, by), loopSpan: shift(op.loopSpan, by) }),
    statementStarts: new Set([...relative.statementStarts].map((start) => start + by)),
    pausingLoops: relative.pausingLoops.map((loop) => shift(loop, by)),
  };
}

function requireFirstKey(map: Map<string, unknown>): string {
  const first = map.keys().next();
  if (first.done) throw new Error("Expected a cached overlay trace");
  return first.value;
}
