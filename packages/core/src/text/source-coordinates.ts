declare const sourceOffsetBrand: unique symbol;

/** The coordinate frame in which a source offset is expressed. */
export type SourceCoordinateSpace = "layout" | "document" | "textarea";

/**
 * A UTF-16 source offset branded by its coordinate frame.
 *
 * Arithmetic deliberately erases the brand. Call one of the constructors or
 * conversion helpers below to make the resulting frame explicit again.
 */
export type SourceOffset<Space extends SourceCoordinateSpace> = number & {
  readonly [sourceOffsetBrand]: Space;
};

export type LayoutSourceOffset = SourceOffset<"layout">;
export type DocumentSourceOffset = SourceOffset<"document">;
export type TextareaOffset = SourceOffset<"textarea">;

export type SourceSpan<Space extends SourceCoordinateSpace> = Readonly<{
  start: SourceOffset<Space>;
  end: SourceOffset<Space>;
}>;

export function layoutSourceOffset(value: number): LayoutSourceOffset {
  return checkedSourceOffset(value, "layout");
}

export function documentSourceOffset(value: number): DocumentSourceOffset {
  return checkedSourceOffset(value, "document");
}

export function textareaOffset(value: number): TextareaOffset {
  return checkedSourceOffset(value, "textarea");
}

export function sourceOffsetForSpace<Space extends SourceCoordinateSpace>(
  value: number,
  space: Space
): SourceOffset<Space> {
  return checkedSourceOffset(value, space);
}

export function sourceSpanForSpace<Space extends SourceCoordinateSpace>(
  start: number,
  end: number,
  space: Space
): SourceSpan<Space> {
  const brandedStart = checkedSourceOffset(start, space);
  const brandedEnd = checkedSourceOffset(end, space);
  if (brandedEnd < brandedStart) {
    throw new Error(`Invalid ${space} source span ${start}:${end}.`);
  }
  return { start: brandedStart, end: brandedEnd };
}

export function textareaOffsetToDocument(
  offset: TextareaOffset,
  documentSpan: Readonly<{ from: number; to: number }>
): DocumentSourceOffset {
  assertDocumentSpan(documentSpan);
  const length = documentSpan.to - documentSpan.from;
  if (offset < 0 || offset > length) {
    throw new Error(
      `Textarea offset ${offset} is outside document span ${documentSpan.from}:${documentSpan.to}.`
    );
  }
  return documentSourceOffset(documentSpan.from + offset);
}

export function documentOffsetToTextarea(
  offset: DocumentSourceOffset,
  documentSpan: Readonly<{ from: number; to: number }>
): TextareaOffset {
  assertDocumentSpan(documentSpan);
  if (offset < documentSpan.from || offset > documentSpan.to) {
    throw new Error(
      `Document offset ${offset} is outside textarea span ${documentSpan.from}:${documentSpan.to}.`
    );
  }
  return textareaOffset(offset - documentSpan.from);
}

function checkedSourceOffset<Space extends SourceCoordinateSpace>(
  value: number,
  space: Space
): SourceOffset<Space> {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${space} source offset ${value}.`);
  }
  return value as SourceOffset<Space>;
}

function assertDocumentSpan(span: Readonly<{ from: number; to: number }>): void {
  if (
    !Number.isInteger(span.from) ||
    !Number.isInteger(span.to) ||
    span.from < 0 ||
    span.to < span.from
  ) {
    throw new Error(`Invalid document source span ${span.from}:${span.to}.`);
  }
}
