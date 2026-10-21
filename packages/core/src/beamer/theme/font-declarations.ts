import type { Span } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { BeamerDocumentModel } from "../types.js";
import { beamerControlSequencesIn, beamerRequiredArgumentAfter, createBeamerSyntaxContext } from "../syntax.js";
import { beamerNamedFontSize, beamerNamedFontSizes } from "./font-sizes.js";
import type { BeamerThemeFont, BeamerThemeFontRole } from "./types.js";

export type BeamerFontDeclaration = {
  kind: "font-declaration";
  span: Span;
  role: BeamerThemeFontRole;
  values: Readonly<Record<string, string>>;
};

const roles: Readonly<Partial<Record<string, BeamerThemeFontRole>>> = {
  title: "title", subtitle: "subtitle", author: "author", institute: "institute", date: "date",
  "normal text": "normal-text", frametitle: "frame-title", framesubtitle: "frame-subtitle",
  "block title": "block-title", "block body": "block-body",
};

/** Literal preamble role settings, interleaved with theme component uses. */
export function scanBeamerFontDeclarations(document: BeamerDocumentModel, span: Span = document.preamble.span, scoped = false): BeamerFontDeclaration[] {
  const context = createBeamerSyntaxContext(document.source);
  const declarations: BeamerFontDeclaration[] = [];
  for (const command of beamerControlSequencesIn(context, span)) {
    if (command.name !== "setbeamerfont" || document.preamble.macroDefinitions.some(definition =>
      definition.span.from <= command.from && definition.span.to >= command.to)) continue;
    let node = context.syntax.tree.resolveInner(command.from + 1, 1);
    let grouped = false;
    while (node.parent) { node = node.parent; if (node.name === "Group") grouped = true; }
    if (grouped && !scoped) continue;
    const role = beamerRequiredArgumentAfter(context, command.to, span.to);
    if (!role) continue;
    const target = roles[role.value.trim()];
    if (!target) continue;
    const body = beamerRequiredArgumentAfter(context, role.span.to, span.to);
    if (!body) continue;
    const values: Record<string, string> = {};
    for (const entry of parseOptionListRaw(`[${body.value}]`).entries) {
      if (entry.kind === "kv") values[entry.key] = entry.valueRaw.replace(/^\{(.*)\}$/su, "$1").trim();
    }
    declarations.push({ kind: "font-declaration", span: { from: command.from, to: body.span.to }, role: target, values });
  }
  return declarations;
}

export function applyBeamerFontDeclaration(font: BeamerThemeFont, declaration: BeamerFontDeclaration, classSize: string): BeamerThemeFont {
  const result = { ...font };
  const namedSize = /^\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)$/u.exec(declaration.values.size ?? "");
  const command = beamerNamedFontSizes().find(([name]) => name === namedSize?.[1])?.[0];
  if (command) Object.assign(result, beamerNamedFontSize(classSize, command));
  const explicit = /^\\fontsize\s*\{([\d.]+)(?:pt)?\}\s*\{([\d.]+)(?:pt)?\}(?:\s*\\selectfont)?$/u.exec(declaration.values.size ?? "");
  if (explicit && Number(explicit[1]) > 0 && Number.isFinite(Number(explicit[1])) &&
    Number(explicit[2]) > 0 && Number.isFinite(Number(explicit[2]))) {
    result.sizePt = Number(explicit[1]); result.lineHeightPt = Number(explicit[2]);
  }
  if (declaration.values.series === "\\bfseries") result.series = "bold";
  if (declaration.values.series === "\\mdseries") result.series = "medium";
  const shapes: Readonly<Partial<Record<string, BeamerThemeFont["shape"]>>> = {
    "\\itshape": "italic", "\\slshape": "slanted", "\\scshape": "small-caps", "\\upshape": "upright",
  };
  const shape = shapes[declaration.values.shape ?? ""];
  if (shape) result.shape = shape;
  const families: Readonly<Partial<Record<string, BeamerThemeFont["family"]>>> = {
    "\\rmfamily": "serif", "\\sffamily": "sans", "\\ttfamily": "monospace",
  };
  const family = families[declaration.values.family ?? ""];
  if (family) result.family = family;
  return result;
}
