import type { Span } from "../../ast/types.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import { beamerControlSequencesIn, beamerOptionalArgumentAfter, beamerRequiredArgumentAfter, beamerSourceValueTokens, createBeamerSyntaxContext } from "../syntax.js";
import type { BeamerDelimitedSourceValue, BeamerDocumentModel } from "../types.js";
import { preambleCommandScope } from "../preamble-edit-context.js";

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
