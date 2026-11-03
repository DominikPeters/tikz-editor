import type { Span } from "../ast/types.js";
import { preambleCommandScope } from "./preamble-edit-context.js";
import { beamerOptionalArgumentAfter, beamerRequiredArgumentAfter, createBeamerSyntaxContext, type BeamerSyntaxContext } from "./syntax.js";
import type { BeamerDocumentModel, BeamerMetadataFieldModel, BeamerMetadataFieldName } from "./types.js";

export type BeamerMetadataDeclaration = {
  name: BeamerMetadataFieldName;
  span: Span;
  scope: "top-level" | "macro" | "scoped";
  field: BeamerMetadataFieldModel | null;
};

function metadataName(name: string): name is BeamerMetadataFieldName {
  return name === "title" || name === "subtitle" || name === "author" || name === "institute" || name === "date" || name === "titlegraphic";
}

/** Shared target selection for rendering, the inspector and preamble writes. */
export function scanBeamerMetadataDeclarations(
  document: BeamerDocumentModel,
  context: BeamerSyntaxContext = createBeamerSyntaxContext(document.source)
): BeamerMetadataDeclaration[] {
  return context.syntax.controlsIn(document.preamble.span).flatMap(command => {
    if (!metadataName(command.name)) return [];
    const shortValue = command.name === "titlegraphic" ? null : beamerOptionalArgumentAfter(context, command.span.to, document.preamble.span.to);
    const value = beamerRequiredArgumentAfter(context, shortValue?.span.to ?? command.span.to, document.preamble.span.to);
    const span = { from: command.span.from, to: value?.span.to ?? shortValue?.span.to ?? command.span.to };
    return [{
      name: command.name,
      span,
      scope: preambleCommandScope(document, command.span, context),
      field: value ? { name: command.name, span, commandSpan: command.span, ...(shortValue ? { shortValue } : {}), value } : null,
    }];
  });
}
