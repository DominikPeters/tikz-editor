import type { Span } from "../../ast/types.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import { beamerControlSequencesIn, beamerOptionalArgumentAfter, beamerRequiredArgumentAfter, createBeamerSyntaxContext } from "../syntax.js";
import type { BeamerDelimitedSourceValue, BeamerDocumentModel } from "../types.js";

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
  const tokens = (value: BeamerDelimitedSourceValue): string => {
    let cursor = value.contentSpan.from;
    let result = "";
    for (const comment of context.syntax.comments) {
      if (comment.to <= cursor || comment.from >= value.contentSpan.to) continue;
      result += document.source.slice(cursor, Math.max(cursor, comment.from));
      cursor = Math.min(value.contentSpan.to, comment.to);
    }
    return (result + document.source.slice(cursor, value.contentSpan.to)).trim();
  };
  for (const command of beamerControlSequencesIn(context, document.preamble.span)) {
    if (command.name !== "setbeamertemplate" || document.preamble.macroDefinitions.some(definition => definition.span.from <= command.from && definition.span.to >= command.to)) continue;
    const role = beamerRequiredArgumentAfter(context, command.to, limit);
    if (!role || tokens(role) !== "navigation symbols") continue;
    const choice = beamerOptionalArgumentAfter(context, role.span.to, limit);
    const body = choice ? null : beamerRequiredArgumentAfter(context, role.span.to, limit);
    const span = { from: command.from, to: (choice ?? body ?? role).span.to };
    const fail = (code: string, message: string) => events.push({ kind: "navigation-template", span, diagnostic: { severity: "warning", code, message, span } });
    let node = context.syntax.tree.resolveInner(command.from + 1, 1);
    let grouped = false;
    while (node.parent) { node = node.parent; if (node.name === "Group") grouped = true; }
    if (grouped) { fail("beamer-navigation-scoped-template", "Grouped preamble navigation templates are not supported in this preview."); continue; }
    if (choice && tokens(choice) === "default") events.push({ kind: "navigation-template", span, templateId: "beamer/navigation-symbols/default" });
    else if (body && tokens(body) === "") events.push({ kind: "navigation-template", span, templateId: "beamer/navigation-symbols/none" });
    else fail("beamer-navigation-unsupported-template", "This preview supports the empty navigation symbols template and the stock [default] template; custom navigation template code is not supported.");
  }
  return events;
}
