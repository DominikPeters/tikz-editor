import type { OverlayGroupCommand, OverlaySpecAst, Span, Statement } from "../ast/types.js";
import { walkStatements } from "../ast/walk.js";
import { expandForeachFigure } from "../foreach/index.js";
import { parseTikz } from "../parser/index.js";

/** A specification where the source has it, with its text after a loop's substitutions (`2-` for `\x-`). */
export type TikzOverlaySpecSite = {
  /** With its angle brackets. Empty where a macro's body wrote the specification. */
  readonly span: Span;
  readonly contentSpan: Span;
  readonly raw: string;
};

type Performed = {
  /**
   * Which iteration of its loops performs the operation, outermost first;
   * empty outside a loop. A loop performs the operation at one place in the
   * source once per iteration.
   */
  readonly instance: readonly number[];
  /** The outermost loop around it. */
  readonly loopSpan: Span | null;
};

/**
 * One overlay operation a picture performs at statement level, in the order
 * TeX executes them. Spans are the authored source's.
 */
export type TikzOverlayTraceOp = Performed & (
  | {
      /** `\node<spec> …;`: the path exists only on the specification's steps. */
      readonly kind: "path";
      readonly span: Span;
      readonly spec: TikzOverlaySpecSite;
    }
  | {
      /** `\only<spec>{…}` and the like, around statements. */
      readonly kind: "group";
      readonly command: OverlayGroupCommand;
      readonly modifier: "*" | "+" | null;
      /** The whole command with its bodies. */
      readonly span: Span;
      readonly spec: TikzOverlaySpecSite;
      /** The content of each brace body. */
      readonly branches: readonly Span[];
    }
  | {
      /** `\onslide<spec>` without a body: holds to the end of its scope. */
      readonly kind: "declaration";
      readonly modifier: "*" | "+" | null;
      readonly span: Span;
      readonly spec: TikzOverlaySpecSite | null;
    }
  | {
      readonly kind: "pause";
      readonly span: Span;
      readonly countRaw: string | null;
    }
);

export type TikzOverlayTrace = {
  readonly ops: readonly TikzOverlayTraceOp[];
  /**
   * Where the picture's statement-level overlay commands start, loop bodies
   * included: the ones its parser reads and its evaluator applies. Overlay
   * commands elsewhere in the picture are inside a statement (node text, an
   * option value) and are resolved as text.
   */
  readonly statementStarts: ReadonlySet<number>;
};

/** The TikZ commands that start a path, each of which takes a specification straight after its name. */
export const TIKZ_PATH_COMMAND_NAMES = ["path", "draw", "fill", "filldraw", "pattern", "shade", "shadedraw", "clip", "useasboundingbox", "node", "coordinate", "matrix", "pic"] as const;

/** A path command's name at the start of a text: `\node`, not `\nodepart`. */
export const TIKZ_PATH_COMMAND_START = new RegExp(String.raw`^\\(${TIKZ_PATH_COMMAND_NAMES.join("|")})(?![A-Za-z@])`, "u");

/**
 * Whether the picture's text can hold anything a trace reports: an angle
 * bracket or an overlay command's name. Deliberately loose; the parser
 * decides what is a specification.
 */
export function tikzOverlayTraceNeeded(text: string): boolean {
  return /<|\\(?:pause|onslide|only|uncover|visible|invisible|alt|temporal)(?![A-Za-z@])/u.test(text);
}

/** Two iterations of nested loops, outermost first: negative when `left` runs first, zero when one contains the other. */
export function compareTikzOverlayInstances(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

const cache = new Map<string, TikzOverlayTrace>();
const CACHE_LIMIT = 64;

function shift(span: Span, by: number): Span {
  return { from: span.from + by, to: span.to + by };
}

function shiftSpec(spec: TikzOverlaySpecSite, by: number): TikzOverlaySpecSite {
  return { span: shift(spec.span, by), contentSpan: shift(spec.contentSpan, by), raw: spec.raw };
}

function traceRelative(text: string): TikzOverlayTrace {
  const figure = parseTikz(text, { recover: true }).figure;
  const statementStarts = new Set<number>();
  // Loops and the picture's own macros make statements the parsed body does not show.
  const seen = { expanding: false };
  const isOverlay = (statement: Statement) => statement.kind === "OverlayGroup" || statement.kind === "OverlayDeclaration" ||
    (statement.kind === "Path" && statement.overlay !== undefined);
  walkStatements(figure.body, {
    onStatement: (statement) => {
      if (statement.kind === "Foreach" || statement.kind === "MacroDefinition" || statement.kind === "MacroCommandDefinition") seen.expanding = true;
      if (isOverlay(statement)) statementStarts.add(statement.span.from);
    }
  });
  const ops: TikzOverlayTraceOp[] = [];
  const expanded = seen.expanding ? expandForeachFigure(figure, text) : null;
  const visit = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === "Scope") { visit(statement.body); continue; }
      if (!isOverlay(statement)) continue;
      const attribution = expanded?.statementAttribution.get(statement);
      const stack = attribution?.foreachStack ?? [];
      const sourceMap = expanded?.statementSourceMaps.get(statement);
      const authored = (span: Span): Span | null => sourceMap ? sourceMap.mapSpan(span) : span;
      const span = authored(statement.span);
      if (!span) continue;
      const specSite = (spec: OverlaySpecAst): TikzOverlaySpecSite | null => {
        // A substitution can change a specification's length; its place is then read from the authored statement.
        const open = text.indexOf("<", span.from);
        const close = text.indexOf(">", open);
        const site = authored(spec.span) ?? (open >= 0 && close > open && close < span.to ? { from: open, to: close + 1 } : null);
        if (site && text[site.from] === "<" && text[site.to - 1] === ">") return { span: site, contentSpan: { from: site.from + 1, to: site.to - 1 }, raw: spec.raw };
        // A macro's body wrote it: it has no place in the source, and holds for what the call makes.
        return sourceMap?.sourceKind === "macro" ? { span: { from: span.from, to: span.from }, contentSpan: { from: span.from, to: span.from }, raw: spec.raw } : null;
      };
      const performed: Performed = { instance: stack.map((frame) => frame.iterationIndex), loopSpan: stack[0]?.loopSpan ?? null };
      if (stack.length > 0) statementStarts.add(span.from);
      if (statement.kind === "Path" && statement.overlay) {
        const spec = specSite(statement.overlay);
        if (spec) ops.push({ kind: "path", span, spec, ...performed });
      } else if (statement.kind === "OverlayGroup") {
        const spec = specSite(statement.spec);
        const whole = authored(statement.groupSpan);
        const branches = statement.branches.map(authored);
        if (spec && whole && branches.every((branch): branch is Span => branch !== null)) {
          ops.push({ kind: "group", command: statement.command, modifier: statement.modifier ?? null, span: whole, spec, branches, ...performed });
        }
      } else if (statement.kind === "OverlayDeclaration") {
        if (statement.command === "pause") ops.push({ kind: "pause", span, countRaw: statement.countRaw ?? null, ...performed });
        else ops.push({ kind: "declaration", modifier: statement.modifier ?? null, span, spec: statement.spec ? specSite(statement.spec) : null, ...performed });
      }
    }
  };
  visit(expanded?.figureBody ?? figure.body);
  return { ops, statementStarts };
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
    const oldest = cache.keys().next();
    if (cache.size >= CACHE_LIMIT && !oldest.done) cache.delete(oldest.value);
    cache.set(text, relative);
  }
  const by = picture.from;
  return {
    ops: relative.ops.map((op): TikzOverlayTraceOp => {
      const loopSpan = op.loopSpan ? shift(op.loopSpan, by) : null;
      if (op.kind === "path") return { ...op, loopSpan, span: shift(op.span, by), spec: shiftSpec(op.spec, by) };
      if (op.kind === "group") return { ...op, loopSpan, span: shift(op.span, by), spec: shiftSpec(op.spec, by), branches: op.branches.map((branch) => shift(branch, by)) };
      if (op.kind === "declaration") return { ...op, loopSpan, span: shift(op.span, by), spec: op.spec ? shiftSpec(op.spec, by) : null };
      return { ...op, loopSpan, span: shift(op.span, by) };
    }),
    statementStarts: new Set([...relative.statementStarts].map((start) => start + by)),
  };
}
