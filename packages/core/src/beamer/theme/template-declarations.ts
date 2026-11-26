import type { Span } from "../../ast/types.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import { beamerControlSequencesIn, beamerOptionalArgumentAfter, beamerRequiredArgumentAfter, beamerSourceValueTokens, createBeamerSyntaxContext } from "../syntax.js";
import type { BeamerDelimitedSourceValue, BeamerDocumentModel } from "../types.js";
import { preambleCommandScope } from "../preamble-edit-context.js";
import { beamerNamedFontSizes, type BeamerFontSizeProfile } from "./font-sizes.js";
import type { BeamerRuntimeTypeface, BeamerTemplateElementFont, BeamerThemeFont } from "./types.js";
import { TemplateReader, fragFromSource, splitTemplateOptions } from "./template-lexer.js";

export type BeamerNavigationTemplateEvent = {
  kind: "navigation-template";
  span: Span;
  templateId?: "beamer/navigation-symbols/none" | "beamer/navigation-symbols/default";
  diagnostic?: Diagnostic;
};

/** Literal, ungrouped preamble navigation templates, evaluated in source order. */
export function scanBeamerNavigationTemplates(document: BeamerDocumentModel): BeamerNavigationTemplateEvent[] {
  const context = createBeamerSyntaxContext(document.source);
  const events: BeamerNavigationTemplateEvent[] = [];
  const limit = document.preamble.span.to;
  const tokens = (value: BeamerDelimitedSourceValue): string => beamerSourceValueTokens(context, value);
  for (const command of beamerControlSequencesIn(context, document.preamble.span)) {
    if (command.name !== "setbeamertemplate" || document.preamble.macroDefinitions.some(definition => definition.span.from <= command.from && definition.span.to >= command.to)) continue;
    const role = beamerRequiredArgumentAfter(context, command.to, limit);
    if (!role || tokens(role) !== "navigation symbols") continue;
    const choice = beamerOptionalArgumentAfter(context, role.span.to, limit);
    const body = choice ? null : beamerRequiredArgumentAfter(context, role.span.to, limit);
    const span = { from: command.from, to: (choice ?? body ?? role).span.to };
    const fail = (code: string, message: string) => events.push({ kind: "navigation-template", span, diagnostic: { severity: "warning", code, message, span } });
    if (preambleCommandScope(document, span, context) !== "top-level") { fail("beamer-navigation-scoped-template", "Scoped preamble navigation templates are not supported in this preview."); continue; }
    if (choice && tokens(choice) === "default") events.push({ kind: "navigation-template", span, templateId: "beamer/navigation-symbols/default" });
    else if (body && tokens(body) === "") events.push({ kind: "navigation-template", span, templateId: "beamer/navigation-symbols/none" });
    else fail("beamer-navigation-unsupported-template", "This preview supports the empty navigation symbols template and the stock [default] template; custom navigation template code is not supported.");
  }
  return events;
}

export type BeamerTemplateSetEvent = {
  kind: "template-set";
  span: Span;
  /** The template name as written, whitespace-normalised. */
  role: string;
  /** The `[choice]` form, e.g. `default`. */
  choice: string | null;
  /** The body in braces, without them; null for the choice form. */
  body: string | null;
  /** Offset of the body's first character in `document.source`. */
  bodyOffset: number;
};

export type BeamerElementFontEvent = {
  kind: "element-font";
  span: Span;
  element: string;
  values: Readonly<Record<string, string>>;
};

/**
 * `\setbeamertemplate` and `\setbeamerfont` commands at the top level of the
 * preamble (not in groups or macro definitions), in source order. Template
 * bodies are returned as text; the interpreter runs them.
 */
export function scanBeamerTemplateDeclarations(document: BeamerDocumentModel): Array<BeamerTemplateSetEvent | BeamerElementFontEvent> {
  const from = document.preamble.span.from;
  const text = document.source.slice(from, document.preamble.span.to);
  if (!/\\set(?:beamertemplate|beamerfont)(?![A-Za-z@])/u.test(text)) return [];
  const reader = new TemplateReader(fragFromSource(text, from));
  const events: Array<BeamerTemplateSetEvent | BeamerElementFontEvent> = [];
  let depth = 0;
  for (let token = reader.next(); token; token = reader.next()) {
    if (token.kind === "char") {
      if (token.char === "{") depth += 1;
      else if (token.char === "}") depth = Math.max(0, depth - 1);
      continue;
    }
    if (token.kind !== "cs" || depth > 0) continue;
    if (token.name === "setbeamertemplate" || token.name === "setbeamerfont") {
      // A starred form or an overlay specification is not a plain declaration.
      const role = reader.readGroup();
      if (!role) continue;
      const roleText = role.text.replace(/\s+/gu, " ").trim();
      if (token.name === "setbeamerfont") {
        const body = reader.readGroup();
        if (!body) continue;
        const values: Record<string, string> = {};
        for (const [key, value] of splitTemplateOptions(body.text)) if (value !== null) values[key] = value;
        events.push({ kind: "element-font", span: { from: from + token.from, to: from + reader.position }, element: roleText, values });
        continue;
      }
      const choice = reader.readOptional();
      if (choice) {
        events.push({ kind: "template-set", span: { from: from + token.from, to: from + reader.position }, role: roleText, choice: choice.text.trim(), body: null, bodyOffset: from });
        continue;
      }
      reader.skipBlanks();
      const start = reader.position + 1;
      const body = reader.readGroup();
      if (!body) continue;
      events.push({ kind: "template-set", span: { from: from + token.from, to: from + reader.position }, role: roleText, choice: null, body: body.text, bodyOffset: from + start });
    }
  }
  return events;
}

/** The declarations of one `\setbeamerfont` element, as overrides rather than a whole font. */
export function parseBeamerElementFont(
  values: Readonly<Record<string, string>>,
  sizeProfile: BeamerFontSizeProfile,
  familyCommands: Readonly<Record<string, BeamerRuntimeTypeface>> | undefined
): BeamerTemplateElementFont {
  const result: BeamerTemplateElementFont = {};
  const size = values.size?.trim();
  if (size) {
    const named = /^\\([A-Za-z]+)$/u.exec(size)?.[1];
    const explicit = /^\\fontsize\s*\{([\d.]+)(?:pt)?\}\s*\{([\d.]+)(?:pt)?\}(?:\s*\\selectfont)?$/u.exec(size);
    const entry = named ? beamerNamedFontSizes({ options: typeof sizeProfile === "string" ? { "class-font-size": sizeProfile } : { "class-font-size": sizeProfile.classSize, ...(sizeProfile.posterFontScale !== undefined ? { "poster-font-scale": String(sizeProfile.posterFontScale) } : {}) } }).find(([candidate]) => candidate === named) : undefined;
    if (entry) { result.sizePt = entry[1]; result.lineHeightPt = entry[2]; }
    else if (explicit) { result.sizePt = Number(explicit[1]); result.lineHeightPt = Number(explicit[2]); }
  }
  const series = values.series?.trim();
  if (series === "\\bfseries") result.series = "bold";
  else if (series === "\\mdseries") result.series = "medium";
  const shapes: Readonly<Partial<Record<string, BeamerThemeFont["shape"]>>> = { "\\itshape": "italic", "\\slshape": "slanted", "\\scshape": "small-caps", "\\upshape": "upright" };
  const shape = shapes[values.shape?.trim() ?? ""];
  if (shape) result.shape = shape;
  const family = values.family?.trim();
  if (family === "\\rmfamily") result.family = "serif";
  else if (family === "\\sffamily") result.family = "sans";
  else if (family === "\\ttfamily") result.family = "monospace";
  else if (family) {
    const typeface = familyCommands?.[family];
    if (typeface) { result.family = "sans"; result.typeface = typeface; }
  }
  return result;
}
