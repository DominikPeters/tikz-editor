import { TreeFragment, type SyntaxNodeRef, type Tree } from "@lezer/common";
import type { LRParser } from "@lezer/lr";

import type { Span } from "../../ast/types.js";

const SYNTAX_INDEX_CACHE_LIMIT = 128;
const OPAQUE_ENVIRONMENT_NAMES = [
  "BVerbatim",
  "Verbatim",
  "alltt",
  "lstlisting",
  "minted",
  "semiverbatim",
  "verbatim",
  "verbatim*",
] as const;

export type TexSyntaxArgumentKind = "required" | "optional" | "overlay";

export interface TexSyntaxControlSequence {
  readonly name: string;
  readonly kind: "word" | "symbol";
  /** The control sequence itself, excluding an immediately following star. */
  readonly commandSpan: Span;
  /** The complete command token, including an immediately following star. */
  readonly span: Span;
  readonly starSpan: Span | null;
}

export interface TexSyntaxSpan extends Span {
  readonly recovered: boolean;
}

export interface TexSyntaxDelimitedArgument {
  readonly kind: TexSyntaxArgumentKind;
  readonly span: Span;
  readonly contentSpan: Span;
  readonly complete: boolean;
  readonly recovered: boolean;
}

export interface TexSyntaxEnvironmentBoundary {
  readonly kind: "begin" | "end";
  readonly name: string;
  readonly span: Span;
  readonly commandSpan: Span;
  readonly nameSpan: Span;
  readonly recovered: boolean;
  readonly opaque: boolean;
}

export interface TexSyntaxOpaqueEnvironment {
  readonly name: string;
  readonly span: Span;
  readonly beginSpan: Span;
  readonly bodySpan: Span;
  readonly endSpan: Span | null;
  readonly recovered: boolean;
}

export interface TexSyntaxMatchedEnvironment {
  readonly name: string;
  readonly begin: TexSyntaxEnvironmentBoundary;
  readonly end: TexSyntaxEnvironmentBoundary;
  readonly span: Span;
  readonly contentSpan: Span;
}

export interface TexSyntaxIndex {
  readonly source: string;
  readonly tree: Tree;
  readonly controls: readonly TexSyntaxControlSequence[];
  readonly environmentBoundaries: readonly TexSyntaxEnvironmentBoundary[];
  readonly comments: readonly TexSyntaxSpan[];
  readonly whitespace: readonly TexSyntaxSpan[];
  readonly groups: readonly TexSyntaxDelimitedArgument[];
  readonly optionalArguments: readonly TexSyntaxDelimitedArgument[];
  readonly overlayArguments: readonly TexSyntaxDelimitedArgument[];
  readonly opaqueEnvironments: readonly TexSyntaxOpaqueEnvironment[];
  readonly errors: readonly TexSyntaxSpan[];
  readonly controlByStart: ReadonlyMap<number, TexSyntaxControlSequence>;
  readonly environmentBoundaryByStart: ReadonlyMap<
    number,
    TexSyntaxEnvironmentBoundary
  >;
  readonly triviaEndByStart: ReadonlyMap<number, number>;
  readonly commentEndByStart: ReadonlyMap<number, number>;
  readonly whitespaceEndByStart: ReadonlyMap<number, number>;
  readonly textEndByStart: ReadonlyMap<number, number>;
  readonly groupByStart: ReadonlyMap<number, TexSyntaxDelimitedArgument>;
  readonly optionalArgumentByStart: ReadonlyMap<
    number,
    TexSyntaxDelimitedArgument
  >;
  readonly overlayArgumentByStart: ReadonlyMap<
    number,
    TexSyntaxDelimitedArgument
  >;
  controlsIn(range: Span): readonly TexSyntaxControlSequence[];
  environmentBoundariesIn(
    range: Span
  ): readonly TexSyntaxEnvironmentBoundary[];
  argumentAfter(
    offset: number,
    kind: TexSyntaxArgumentKind,
    limit: number
  ): TexSyntaxDelimitedArgument | null;
}

const syntaxIndexCache = new WeakMap<
  LRParser,
  Map<string, TexSyntaxIndex>
>();
const matchedEnvironmentCache = new WeakMap<
  TexSyntaxIndex,
  ReadonlyMap<number, TexSyntaxMatchedEnvironment>
>();

export function getTexSyntaxIndex(
  source: string,
  parser: LRParser
): TexSyntaxIndex {
  let parserCache = syntaxIndexCache.get(parser);
  if (!parserCache) {
    parserCache = new Map();
    syntaxIndexCache.set(parser, parserCache);
  }
  const cached = parserCache.get(source);
  if (cached) {
    return cached;
  }
  const index = buildTexSyntaxIndex(source, parser);
  parserCache.set(source, index);
  if (parserCache.size > SYNTAX_INDEX_CACHE_LIMIT) {
    const oldest = parserCache.keys().next().value;
    if (oldest !== undefined) {
      parserCache.delete(oldest);
    }
  }
  return index;
}

export function buildTexSyntaxIndex(
  source: string,
  parser: LRParser,
  options: {
    parseSource?: string;
    previousTree?: Tree;
    changes?: readonly {
      fromA: number;
      toA: number;
      fromB: number;
      toB: number;
    }[];
  } = {}
): TexSyntaxIndex {
  const parseSource = options.parseSource ?? source;
  if (parseSource.length !== source.length) {
    throw new Error("A TeX syntax parse source must preserve source length.");
  }
  const fragments =
    options.previousTree && options.changes?.length
      ? TreeFragment.applyChanges(
          TreeFragment.addTree(options.previousTree),
          options.changes
        )
      : undefined;
  const tree = parser.parse(parseSource, fragments);
  const controlsByStart = new Map<number, TexSyntaxControlSequence>();
  const boundariesByStart = new Map<
    number,
    TexSyntaxEnvironmentBoundary
  >();
  const comments: TexSyntaxSpan[] = [];
  const whitespace: TexSyntaxSpan[] = [];
  const groups: TexSyntaxDelimitedArgument[] = [];
  const optionalArguments: TexSyntaxDelimitedArgument[] = [];
  const overlayArguments: TexSyntaxDelimitedArgument[] = [];
  const opaqueEnvironments: TexSyntaxOpaqueEnvironment[] = [];
  const errors: TexSyntaxSpan[] = [];
  const triviaEndByStart = new Map<number, number>();
  const commentEndByStart = new Map<number, number>();
  const whitespaceEndByStart = new Map<number, number>();
  const textEndByStart = new Map<number, number>();
  const groupByStart = new Map<number, TexSyntaxDelimitedArgument>();
  const optionalArgumentByStart = new Map<
    number,
    TexSyntaxDelimitedArgument
  >();
  const overlayArgumentByStart = new Map<
    number,
    TexSyntaxDelimitedArgument
  >();

  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        errors.push({
          from: node.from,
          to: node.to,
          recovered: true,
        });
        return;
      }
      if (node.name === "ControlSequence" || node.name === "IncludeGraphicsCmd") {
        addControl(source, node, controlsByStart);
      } else if (node.name === "BeginCommand") {
        addEnvironmentControl(source, node.from, "begin", controlsByStart);
      } else if (node.name === "EndCommand") {
        addEnvironmentControl(source, node.from, "end", controlsByStart);
      } else if (node.name === "Comment") {
        const span = syntaxSpan(node);
        comments.push(span);
        triviaEndByStart.set(node.from, node.to);
        commentEndByStart.set(node.from, node.to);
      } else if (node.name === "Whitespace") {
        const span = syntaxSpan(node);
        whitespace.push(span);
        triviaEndByStart.set(node.from, node.to);
        whitespaceEndByStart.set(node.from, node.to);
      } else if (node.name === "Text") {
        textEndByStart.set(node.from, node.to);
      } else if (node.name === "Group" || node.name === "MathGroup") {
        addArgument(
          source,
          node,
          "required",
          "{",
          "}",
          groups,
          groupByStart
        );
      } else if (node.name === "OptionalArgument") {
        addArgument(
          source,
          node,
          "optional",
          "[",
          "]",
          optionalArguments,
          optionalArgumentByStart
        );
      } else if (node.name === "OverlaySpecification") {
        addArgument(
          source,
          node,
          "overlay",
          "<",
          ">",
          overlayArguments,
          overlayArgumentByStart
        );
      } else if (
        node.name === "BeginEnvironment" ||
        node.name === "BeginMathEnvironment"
      ) {
        addEnvironmentBoundary(
          source,
          node,
          "begin",
          false,
          boundariesByStart,
          controlsByStart
        );
      } else if (
        node.name === "EndEnvironment" ||
        node.name === "EndMathEnvironment"
      ) {
        addEnvironmentBoundary(
          source,
          node,
          "end",
          false,
          boundariesByStart,
          controlsByStart
        );
      } else if (node.name === "OpaqueEnvironment") {
        const opaque = opaqueEnvironmentFromSyntax(source, node);
        if (opaque) {
          opaqueEnvironments.push(opaque);
          addOpaqueBoundary(
            source,
            opaque,
            "begin",
            boundariesByStart,
            controlsByStart
          );
          if (opaque.endSpan) {
            addOpaqueBoundary(
              source,
              opaque,
              "end",
              boundariesByStart,
              controlsByStart
            );
          }
        }
      }
      return;
    },
  });

  markRecovered(groups, errors);
  markRecovered(optionalArguments, errors);
  markRecovered(overlayArguments, errors);
  markRecovered([...boundariesByStart.values()], errors);
  markRecovered(opaqueEnvironments, errors);
  // Lezer's preorder traversal is source ordered. Maps preserve that
  // insertion order, including the begin/end pair projected atomically from
  // an opaque token, so no post-parse sorting pass is required.
  const controls = [...controlsByStart.values()];
  const environmentBoundaries = [...boundariesByStart.values()];

  const index: TexSyntaxIndex = {
    source,
    tree,
    controls,
    environmentBoundaries,
    comments,
    whitespace,
    groups,
    optionalArguments,
    overlayArguments,
    opaqueEnvironments,
    errors,
    controlByStart: controlsByStart,
    environmentBoundaryByStart: boundariesByStart,
    triviaEndByStart,
    commentEndByStart,
    whitespaceEndByStart,
    textEndByStart,
    groupByStart,
    optionalArgumentByStart,
    overlayArgumentByStart,
    controlsIn(range) {
      return valuesInRange(controls, range, (control) => control.span.from);
    },
    environmentBoundariesIn(range) {
      return valuesInRange(
        environmentBoundaries,
        range,
        (boundary) => boundary.span.from
      );
    },
    argumentAfter(offset, kind, limit) {
      if (offset < 0 || offset > limit || limit > source.length) {
        return null;
      }
      let cursor = offset;
      for (
        let triviaEnd = triviaEndByStart.get(cursor);
        triviaEnd !== undefined && triviaEnd <= limit;
        triviaEnd = triviaEndByStart.get(cursor)
      ) {
        cursor = triviaEnd;
      }
      const argument = argumentMapForKind(
        kind,
        groupByStart,
        optionalArgumentByStart,
        overlayArgumentByStart
      ).get(cursor);
      return argument && argument.span.to <= limit ? argument : null;
    },
  };
  return index;
}

export function matchTexSyntaxEnvironments(
  index: TexSyntaxIndex
): ReadonlyMap<number, TexSyntaxMatchedEnvironment> {
  const cached = matchedEnvironmentCache.get(index);
  if (cached) {
    return cached;
  }
  const matched = new Map<number, TexSyntaxMatchedEnvironment>();
  const stack: TexSyntaxEnvironmentBoundary[] = [];
  for (const boundary of index.environmentBoundaries) {
    if (boundary.kind === "begin") {
      stack.push(boundary);
      continue;
    }
    const begin = stack.at(-1);
    if (begin?.name !== boundary.name) {
      continue;
    }
    stack.pop();
    if (begin.recovered || boundary.recovered) {
      continue;
    }
    matched.set(begin.span.from, {
      name: begin.name,
      begin,
      end: boundary,
      span: { from: begin.span.from, to: boundary.span.to },
      contentSpan: { from: begin.span.to, to: boundary.span.from },
    });
  }
  matchedEnvironmentCache.set(index, matched);
  return matched;
}

function addControl(
  source: string,
  node: SyntaxNodeRef,
  controlsByStart: Map<number, TexSyntaxControlSequence>
): void {
  if (controlsByStart.has(node.from)) {
    return;
  }
  if (source.charCodeAt(node.from) !== 92 || node.to <= node.from + 1) {
    return;
  }
  const first = source.charCodeAt(node.from + 1);
  const word =
    first === 64 ||
    (first >= 65 && first <= 90) ||
    (first >= 97 && first <= 122);
  const name = source.slice(node.from + 1, node.to);
  if (
    !word &&
    (name.length !== 1 || first === 10 || first === 13)
  ) {
    return;
  }
  const starSpan =
    word && source[node.to] === "*"
      ? { from: node.to, to: node.to + 1 }
      : null;
  controlsByStart.set(node.from, {
    name,
    kind: word ? "word" : "symbol",
    commandSpan: { from: node.from, to: node.to },
    span: { from: node.from, to: starSpan?.to ?? node.to },
    starSpan,
  });
}

function addEnvironmentControl(
  source: string,
  from: number,
  name: "begin" | "end",
  controlsByStart: Map<number, TexSyntaxControlSequence>
): void {
  const to = from + name.length + 1;
  if (
    controlsByStart.has(from) ||
    source.slice(from, to) !== `\\${name}`
  ) {
    return;
  }
  controlsByStart.set(from, {
    name,
    kind: "word",
    commandSpan: { from, to },
    span: { from, to },
    starSpan: null,
  });
}

function addArgument(
  source: string,
  node: SyntaxNodeRef,
  kind: TexSyntaxArgumentKind,
  open: string,
  close: string,
  target: TexSyntaxDelimitedArgument[],
  byStart: Map<number, TexSyntaxDelimitedArgument>
): void {
  if (source[node.from] !== open || byStart.has(node.from)) {
    return;
  }
  const complete = node.to > node.from && source[node.to - 1] === close;
  const argument: TexSyntaxDelimitedArgument = {
    kind,
    span: { from: node.from, to: node.to },
    contentSpan: {
      from: Math.min(node.to, node.from + 1),
      to: Math.max(node.from + 1, node.to - (complete ? 1 : 0)),
    },
    complete,
    recovered: !complete,
  };
  target.push(argument);
  byStart.set(node.from, argument);
}

function addEnvironmentBoundary(
  source: string,
  node: SyntaxNodeRef,
  kind: "begin" | "end",
  opaque: boolean,
  boundariesByStart: Map<number, TexSyntaxEnvironmentBoundary>,
  controlsByStart: Map<number, TexSyntaxControlSequence>
): void {
  if (boundariesByStart.has(node.from)) {
    return;
  }
  const prefix = `\\${kind}{`;
  if (!source.startsWith(prefix, node.from)) {
    return;
  }
  const contentFrom = node.from + prefix.length;
  const complete = node.to > contentFrom && source[node.to - 1] === "}";
  const rawContentTo = Math.max(contentFrom, node.to - (complete ? 1 : 0));
  const nameSpan = trimSourceSpan(source, {
    from: contentFrom,
    to: rawContentTo,
  });
  const name = source.slice(nameSpan.from, nameSpan.to);
  if (!name) {
    return;
  }
  const commandTo = node.from + kind.length + 1;
  const boundary: TexSyntaxEnvironmentBoundary = {
    kind,
    name,
    span: { from: node.from, to: node.to },
    commandSpan: { from: node.from, to: commandTo },
    nameSpan,
    recovered: !complete,
    opaque,
  };
  boundariesByStart.set(node.from, boundary);
  addEnvironmentControl(source, node.from, kind, controlsByStart);
}

function opaqueEnvironmentFromSyntax(
  source: string,
  node: SyntaxNodeRef
): TexSyntaxOpaqueEnvironment | null {
  const token = node.node.firstChild;
  if (
    !token ||
    (token.name !== "OpaqueEnvironmentToken" &&
      token.name !== "UnterminatedOpaqueEnvironmentToken")
  ) {
    return null;
  }
  const name = OPAQUE_ENVIRONMENT_NAMES.find((candidate) =>
    source.startsWith(`\\begin{${candidate}}`, token.from)
  );
  if (!name) {
    return null;
  }
  const beginSpan = {
    from: token.from,
    to: token.from + `\\begin{${name}}`.length,
  };
  const endMarker = `\\end{${name}}`;
  const complete =
    token.name === "OpaqueEnvironmentToken" &&
    source.startsWith(endMarker, token.to - endMarker.length);
  const endSpan = complete
    ? { from: token.to - endMarker.length, to: token.to }
    : null;
  return {
    name,
    span: { from: node.from, to: node.to },
    beginSpan,
    bodySpan: {
      from: beginSpan.to,
      to: endSpan?.from ?? token.to,
    },
    endSpan,
    recovered: !complete,
  };
}

function addOpaqueBoundary(
  source: string,
  opaque: TexSyntaxOpaqueEnvironment,
  kind: "begin" | "end",
  boundariesByStart: Map<number, TexSyntaxEnvironmentBoundary>,
  controlsByStart: Map<number, TexSyntaxControlSequence>
): void {
  const span = kind === "begin" ? opaque.beginSpan : opaque.endSpan;
  if (!span) {
    return;
  }
  const nameFrom = span.from + kind.length + 2;
  const nameSpan = {
    from: nameFrom,
    to: span.to - 1,
  };
  boundariesByStart.set(span.from, {
    kind,
    name: opaque.name,
    span,
    commandSpan: {
      from: span.from,
      to: span.from + kind.length + 1,
    },
    nameSpan,
    recovered: false,
    opaque: true,
  });
  addEnvironmentControl(source, span.from, kind, controlsByStart);
}

function syntaxSpan(node: SyntaxNodeRef): TexSyntaxSpan {
  return {
    from: node.from,
    to: node.to,
    recovered: false,
  };
}

function markRecovered(
  values: readonly { readonly span: Span; readonly recovered: boolean }[],
  errors: readonly TexSyntaxSpan[]
): void {
  for (const value of values) {
    if (!value.recovered && containsError(errors, value.span)) {
      (value as { recovered: boolean }).recovered = true;
    }
  }
}

function containsError(
  errors: readonly TexSyntaxSpan[],
  span: Span
): boolean {
  let low = 0;
  let high = errors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((errors[middle]?.from ?? Number.POSITIVE_INFINITY) < span.from) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  for (let index = low; index < errors.length; index += 1) {
    const error = errors[index];
    if (!error || error.from > span.to) {
      return false;
    }
    if (error.to <= span.to) {
      return true;
    }
  }
  return false;
}

function trimSourceSpan(source: string, span: Span): Span {
  let from = span.from;
  let to = span.to;
  while (from < to && /\s/u.test(source[from] ?? "")) {
    from += 1;
  }
  while (to > from && /\s/u.test(source[to - 1] ?? "")) {
    to -= 1;
  }
  return { from, to };
}

function argumentMapForKind(
  kind: TexSyntaxArgumentKind,
  groups: ReadonlyMap<number, TexSyntaxDelimitedArgument>,
  optional: ReadonlyMap<number, TexSyntaxDelimitedArgument>,
  overlay: ReadonlyMap<number, TexSyntaxDelimitedArgument>
): ReadonlyMap<number, TexSyntaxDelimitedArgument> {
  if (kind === "required") {
    return groups;
  }
  return kind === "optional" ? optional : overlay;
}

function valuesInRange<T>(
  values: readonly T[],
  range: Span,
  position: (value: T) => number
): readonly T[] {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (position(values[middle]) < range.from) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const result: T[] = [];
  for (let index = low; index < values.length; index += 1) {
    const value = values[index];
    if (position(value) >= range.to) {
      break;
    }
    result.push(value);
  }
  return result;
}
