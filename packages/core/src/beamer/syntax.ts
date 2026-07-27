import { beamerDocumentParser } from "@tikz-editor/lezer-tex";

import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import type { Tree } from "@lezer/common";
import {
  buildTexSyntaxIndex,
  type TexSyntaxArgumentKind,
  type TexSyntaxDelimitedArgument,
  type TexSyntaxIndex,
} from "../text/tex/syntax-index.js";
import type { BeamerDelimitedSourceValue } from "./types.js";

export interface BeamerSyntaxContext {
  readonly source: string;
  readonly syntax: TexSyntaxIndex;
}

export interface BeamerControlSequence {
  readonly from: number;
  readonly to: number;
  readonly name: string;
  readonly starred: boolean;
}

export interface BeamerEnvironmentBoundary {
  readonly kind: "begin" | "end";
  readonly name: string;
  readonly span: Span;
}

export function createBeamerSyntaxContext(
  source: string,
  structuralMasks: readonly Span[] = [],
  incremental: {
    previousTree?: Tree;
    patches?: readonly SourcePatch[];
  } = {}
): BeamerSyntaxContext {
  const parseSource = applyStructuralMasks(source, structuralMasks);
  return {
    source,
    syntax: buildTexSyntaxIndex(source, beamerDocumentParser, {
      parseSource,
      previousTree: incremental.previousTree,
      changes: incremental.patches?.map((patch) => ({
        fromA: patch.oldSpan.from,
        toA: patch.oldSpan.to,
        fromB: patch.newSpan.from,
        toB: patch.newSpan.to,
      })),
    }),
  };
}

function applyStructuralMasks(
  source: string,
  masks: readonly Span[]
): string {
  let result = source;
  for (const mask of masks) {
    const from = Math.max(0, Math.min(result.length, mask.from));
    const to = Math.max(from, Math.min(result.length, mask.to));
    if (to === from) continue;
    result =
      result.slice(0, from) +
      result.slice(from, to).replace(/[^\n]/gu, " ") +
      result.slice(to);
  }
  return result;
}

export function beamerSyntaxContext(
  source: string,
  syntax?: TexSyntaxIndex
): BeamerSyntaxContext {
  return syntax
    ? { source, syntax }
    : createBeamerSyntaxContext(source);
}

export function beamerControlSequencesIn(
  context: BeamerSyntaxContext,
  range: Span
): readonly BeamerControlSequence[] {
  return context.syntax.controlsIn(range).map((control) => ({
    from: control.span.from,
    to: control.span.to,
    name: control.name,
    starred: control.starSpan != null,
  }));
}

export function beamerEnvironmentBoundariesIn(
  context: BeamerSyntaxContext,
  range: Span
): readonly BeamerEnvironmentBoundary[] {
  return context.syntax.environmentBoundariesIn(range).map((boundary) => ({
    kind: boundary.kind,
    name: boundary.name,
    span: boundary.span,
  }));
}

export function beamerRequiredArgumentAfter(
  context: BeamerSyntaxContext,
  from: number,
  limit: number
): BeamerDelimitedSourceValue | null {
  return readBeamerArgument(context, from, "required", limit);
}

export function beamerOptionalArgumentAfter(
  context: BeamerSyntaxContext,
  from: number,
  limit: number
): BeamerDelimitedSourceValue | null {
  return readBeamerArgument(context, from, "optional", limit);
}

export function beamerOverlayArgumentAfter(
  context: BeamerSyntaxContext,
  from: number,
  limit: number
): BeamerDelimitedSourceValue | null {
  return readBeamerArgument(context, from, "overlay", limit);
}

function readBeamerArgument(
  context: BeamerSyntaxContext,
  from: number,
  kind: TexSyntaxArgumentKind,
  limit: number
): BeamerDelimitedSourceValue | null {
  const argument = context.syntax.argumentAfter(from, kind, limit);
  return argument?.complete
    ? beamerArgumentValue(context.source, argument)
    : null;
}

function beamerArgumentValue(
  source: string,
  argument: TexSyntaxDelimitedArgument
): BeamerDelimitedSourceValue {
  return {
    span: argument.span,
    contentSpan: argument.contentSpan,
    value: source.slice(argument.contentSpan.from, argument.contentSpan.to),
  };
}
