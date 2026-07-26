import { beamerDocumentParser } from "@tikz-editor/lezer-tex";

import type { Span } from "../ast/types.js";
import {
  getTexSyntaxIndex,
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

export interface BeamerEnvironmentToken {
  readonly kind: "begin" | "end";
  readonly name: string;
  readonly span: Span;
}

export function createBeamerSyntaxContext(
  source: string
): BeamerSyntaxContext {
  return {
    source,
    syntax: getTexSyntaxIndex(source, beamerDocumentParser),
  };
}

export function beamerSyntaxContext(
  source: string,
  syntax?: TexSyntaxIndex
): BeamerSyntaxContext {
  return syntax
    ? { source, syntax }
    : createBeamerSyntaxContext(source);
}

export function scanBeamerControlSequences(
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

export function scanBeamerEnvironmentTokens(
  context: BeamerSyntaxContext,
  range: Span
): readonly BeamerEnvironmentToken[] {
  return context.syntax.environmentBoundariesIn(range).map((boundary) => ({
    kind: boundary.kind,
    name: boundary.name,
    span: boundary.span,
  }));
}

export function readBeamerRequiredArgument(
  context: BeamerSyntaxContext,
  from: number,
  limit: number
): BeamerDelimitedSourceValue | null {
  return readBeamerArgument(context, from, "required", limit);
}

export function readBeamerOptionalArgument(
  context: BeamerSyntaxContext,
  from: number,
  limit: number
): BeamerDelimitedSourceValue | null {
  return readBeamerArgument(context, from, "optional", limit);
}

export function readBeamerOverlayArgument(
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
