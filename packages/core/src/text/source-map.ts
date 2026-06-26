export type TextSourceRange = {
  readonly from: number;
  readonly to: number;
};

export type TextSourceRangePolicy = "caret" | "select" | "macro" | "generated" | "unmapped";

export type TextSourceProjection =
  | {
      readonly kind: "direct";
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: "macro-argument";
      readonly from: number;
      readonly to: number;
      readonly invocation: TextSourceRange;
      readonly macroName?: string;
      readonly definition?: TextSourceRange;
    }
  | {
      readonly kind: "macro-generated";
      readonly invocation: TextSourceRange;
      readonly macroName?: string;
      readonly definition?: TextSourceRange;
    }
  | {
      readonly kind: "generated";
      readonly reason: string;
      readonly owner?: TextSourceRange;
    }
  | {
      readonly kind: "unmapped";
      readonly reason: string;
    };

export type TextSourceAnchor =
  | {
      readonly kind: "offset";
      readonly offset: number;
    }
  | {
      readonly kind: "range";
      readonly from: number;
      readonly to: number;
      readonly policy: TextSourceRangePolicy;
      readonly projection?: TextSourceProjection;
    }
  | {
      readonly kind: "unmapped";
      readonly reason: string;
    };

export type TextSourceHit =
  | {
      readonly kind: "source-offset";
      readonly offset: number;
    }
  | {
      readonly kind: "source-range";
      readonly from: number;
      readonly to: number;
      readonly policy: TextSourceRangePolicy;
      readonly macroName?: string;
      readonly reason?: string;
    }
  | {
      readonly kind: "unmapped";
      readonly reason: string;
    };

export type TextSourceMap = {
  readonly inputText: string;
  readonly charOrigins: readonly TextSourceProjection[];
  readonly boundaryOrigins: readonly TextSourceAnchor[];
};

export type MappedText = {
  readonly text: string;
  readonly sourceMap: TextSourceMap;
};

export function createIdentityMappedText(text: string, sourceOffset = 0): MappedText {
  const charOrigins = Array.from({ length: text.length }, (_, index): TextSourceProjection => ({
    kind: "direct",
    from: sourceOffset + index,
    to: sourceOffset + index + 1
  }));
  const boundaryOrigins = Array.from({ length: text.length + 1 }, (_, index): TextSourceAnchor => ({
    kind: "offset",
    offset: sourceOffset + index
  }));
  return createMappedText(text, charOrigins, boundaryOrigins);
}

export function createGeneratedMappedText(
  text: string,
  reason: string,
  owner?: TextSourceRange
): MappedText {
  const projection: TextSourceProjection = owner
    ? { kind: "generated", reason, owner }
    : { kind: "generated", reason };
  const anchor: TextSourceAnchor = owner
    ? { kind: "range", from: owner.from, to: owner.to, policy: "generated", projection }
    : { kind: "unmapped", reason };
  return createMappedText(
    text,
    Array.from({ length: text.length }, () => projection),
    Array.from({ length: text.length + 1 }, () => anchor)
  );
}

export function createMappedText(
  text: string,
  charOrigins: readonly TextSourceProjection[],
  boundaryOrigins?: readonly TextSourceAnchor[]
): MappedText {
  const normalizedCharOrigins = normalizeCharOrigins(text, charOrigins);
  return {
    text,
    sourceMap: {
      inputText: text,
      charOrigins: normalizedCharOrigins,
      boundaryOrigins: normalizeBoundaryOrigins(text, normalizedCharOrigins, boundaryOrigins)
    }
  };
}

export function sliceMappedText(mapped: MappedText, start: number, end: number): MappedText {
  const safeStart = clampInteger(start, 0, mapped.text.length);
  const safeEnd = clampInteger(end, safeStart, mapped.text.length);
  return createMappedText(
    mapped.text.slice(safeStart, safeEnd),
    mapped.sourceMap.charOrigins.slice(safeStart, safeEnd),
    mapped.sourceMap.boundaryOrigins.slice(safeStart, safeEnd + 1)
  );
}

export function concatMappedText(parts: readonly MappedText[]): MappedText {
  if (parts.length === 0) {
    return createIdentityMappedText("");
  }

  let text = "";
  const charOrigins: TextSourceProjection[] = [];
  const boundaryOrigins: TextSourceAnchor[] = [];
  for (const [index, part] of parts.entries()) {
    text += part.text;
    charOrigins.push(...part.sourceMap.charOrigins);
    if (index === 0) {
      boundaryOrigins.push(...part.sourceMap.boundaryOrigins);
    } else {
      const previous = boundaryOrigins.pop();
      const next = part.sourceMap.boundaryOrigins[0];
      boundaryOrigins.push(mergeTextSourceAnchors(previous, next));
      boundaryOrigins.push(...part.sourceMap.boundaryOrigins.slice(1));
    }
  }

  return createMappedText(text, charOrigins, boundaryOrigins);
}

export function projectInputOffset(sourceMap: TextSourceMap | undefined, inputOffset: number): TextSourceHit {
  if (!sourceMap) {
    return { kind: "source-offset", offset: inputOffset };
  }

  const anchor = sourceMap.boundaryOrigins[clampInteger(inputOffset, 0, sourceMap.inputText.length)];
  return anchorToHit(anchor, "caret");
}

export function projectInputRange(
  sourceMap: TextSourceMap | undefined,
  inputStart: number,
  inputEnd: number
): TextSourceHit {
  if (!sourceMap) {
    return { kind: "source-range", from: inputStart, to: inputEnd, policy: "caret" };
  }

  const safeStart = clampInteger(inputStart, 0, sourceMap.inputText.length);
  const safeEnd = clampInteger(inputEnd, safeStart, sourceMap.inputText.length);
  if (safeStart === safeEnd) {
    return projectInputOffset(sourceMap, safeStart);
  }

  const origins = sourceMap.charOrigins.slice(safeStart, safeEnd);
  const directRange = directContiguousRange(origins);
  if (directRange) {
    return {
      kind: "source-range",
      from: directRange.from,
      to: directRange.to,
      policy: "caret"
    };
  }

  const macroGenerated = sharedMacroGeneratedRange(origins);
  if (macroGenerated) {
    return {
      kind: "source-range",
      from: macroGenerated.invocation.from,
      to: macroGenerated.invocation.to,
      policy: "macro",
      ...(macroGenerated.macroName ? { macroName: macroGenerated.macroName } : {})
    };
  }

  const generated = sharedGeneratedRange(origins);
  if (generated) {
    return generated.owner
      ? {
          kind: "source-range",
          from: generated.owner.from,
          to: generated.owner.to,
          policy: "generated",
          reason: generated.reason
        }
      : { kind: "unmapped", reason: generated.reason };
  }

  const covering = coveringSourceRange(origins);
  if (covering) {
    return {
      kind: "source-range",
      from: covering.from,
      to: covering.to,
      policy: "select"
    };
  }

  return { kind: "unmapped", reason: "Input range has no editable source projection." };
}

function normalizeCharOrigins(
  text: string,
  charOrigins: readonly TextSourceProjection[]
): readonly TextSourceProjection[] {
  if (charOrigins.length === text.length) {
    return charOrigins;
  }
  const origins = Array.from(charOrigins);
  while (origins.length < text.length) {
    origins.push({ kind: "unmapped", reason: "Missing source origin." });
  }
  return origins.slice(0, text.length);
}

function normalizeBoundaryOrigins(
  text: string,
  charOrigins: readonly TextSourceProjection[],
  boundaryOrigins: readonly TextSourceAnchor[] | undefined
): readonly TextSourceAnchor[] {
  if (boundaryOrigins?.length === text.length + 1) {
    return boundaryOrigins;
  }

  const anchors: TextSourceAnchor[] = [];
  for (let index = 0; index <= text.length; index += 1) {
    anchors.push(inferBoundaryAnchor(charOrigins, index));
  }
  return anchors;
}

function inferBoundaryAnchor(
  charOrigins: readonly TextSourceProjection[],
  index: number
): TextSourceAnchor {
  const left = index > 0 ? projectionToAnchor(charOrigins[index - 1], "end") : undefined;
  const right = index < charOrigins.length ? projectionToAnchor(charOrigins[index], "start") : undefined;
  return mergeTextSourceAnchors(left, right);
}

function projectionToAnchor(
  projection: TextSourceProjection | undefined,
  edge: "start" | "end"
): TextSourceAnchor | undefined {
  if (!projection) {
    return undefined;
  }
  if (projection.kind === "direct" || projection.kind === "macro-argument") {
    return {
      kind: "offset",
      offset: edge === "start" ? projection.from : projection.to
    };
  }
  if (projection.kind === "macro-generated") {
    return {
      kind: "range",
      from: projection.invocation.from,
      to: projection.invocation.to,
      policy: "macro",
      projection
    };
  }
  if (projection.kind === "generated") {
    return projection.owner
      ? {
          kind: "range",
          from: projection.owner.from,
          to: projection.owner.to,
          policy: "generated",
          projection
        }
      : { kind: "unmapped", reason: projection.reason };
  }
  return { kind: "unmapped", reason: projection.reason };
}

function mergeTextSourceAnchors(
  left: TextSourceAnchor | undefined,
  right: TextSourceAnchor | undefined
): TextSourceAnchor {
  if (!left) {
    return right ?? { kind: "unmapped", reason: "Missing source boundary." };
  }
  if (!right) {
    return left;
  }
  if (anchorsEqual(left, right)) {
    return left;
  }
  if (left.kind === "offset" && right.kind === "offset") {
    return {
      kind: "range",
      from: Math.min(left.offset, right.offset),
      to: Math.max(left.offset, right.offset),
      policy: "select"
    };
  }

  const leftRange = anchorRange(left);
  const rightRange = anchorRange(right);
  if (!leftRange || !rightRange) {
    return left.kind === "unmapped" ? right : left;
  }
  return {
    kind: "range",
    from: Math.min(leftRange.from, rightRange.from),
    to: Math.max(leftRange.to, rightRange.to),
    policy: leftRange.policy === rightRange.policy ? leftRange.policy : "select"
  };
}

function anchorsEqual(left: TextSourceAnchor, right: TextSourceAnchor): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "offset" && right.kind === "offset") {
    return left.offset === right.offset;
  }
  if (left.kind === "range" && right.kind === "range") {
    return left.from === right.from && left.to === right.to && left.policy === right.policy;
  }
  return left.kind === "unmapped" && right.kind === "unmapped" && left.reason === right.reason;
}

function anchorRange(anchor: TextSourceAnchor): { from: number; to: number; policy: TextSourceRangePolicy } | null {
  if (anchor.kind === "offset") {
    return { from: anchor.offset, to: anchor.offset, policy: "caret" };
  }
  if (anchor.kind === "range") {
    return { from: anchor.from, to: anchor.to, policy: anchor.policy };
  }
  return null;
}

function anchorToHit(anchor: TextSourceAnchor | undefined, fallbackPolicy: TextSourceRangePolicy): TextSourceHit {
  if (!anchor) {
    return { kind: "unmapped", reason: "Missing source boundary." };
  }
  if (anchor.kind === "offset") {
    return { kind: "source-offset", offset: anchor.offset };
  }
  if (anchor.kind === "range") {
    return {
      kind: "source-range",
      from: anchor.from,
      to: anchor.to,
      policy: anchor.policy ?? fallbackPolicy,
      ...(anchor.projection?.kind === "macro-generated" && anchor.projection.macroName
        ? { macroName: anchor.projection.macroName }
        : {}),
      ...(anchor.projection?.kind === "generated" ? { reason: anchor.projection.reason } : {})
    };
  }
  return { kind: "unmapped", reason: anchor.reason };
}

function directContiguousRange(
  origins: readonly TextSourceProjection[]
): { from: number; to: number } | null {
  const first = origins[0];
  if (!first || (first.kind !== "direct" && first.kind !== "macro-argument")) {
    return null;
  }
  let previousTo = first.to;
  for (const origin of origins.slice(1)) {
    if (
      (origin.kind !== "direct" && origin.kind !== "macro-argument") ||
      origin.from !== previousTo
    ) {
      return null;
    }
    previousTo = origin.to;
  }
  return { from: first.from, to: previousTo };
}

function sharedMacroGeneratedRange(
  origins: readonly TextSourceProjection[]
): Extract<TextSourceProjection, { kind: "macro-generated" }> | null {
  const first = origins[0];
  if (!first || first.kind !== "macro-generated") {
    return null;
  }
  return origins.every((origin) =>
    origin.kind === "macro-generated" &&
    origin.invocation.from === first.invocation.from &&
    origin.invocation.to === first.invocation.to &&
    origin.macroName === first.macroName
  )
    ? first
    : null;
}

function sharedGeneratedRange(
  origins: readonly TextSourceProjection[]
): Extract<TextSourceProjection, { kind: "generated" }> | null {
  const first = origins[0];
  if (!first || first.kind !== "generated") {
    return null;
  }
  return origins.every((origin) =>
    origin.kind === "generated" &&
    origin.reason === first.reason &&
    origin.owner?.from === first.owner?.from &&
    origin.owner?.to === first.owner?.to
  )
    ? first
    : null;
}

function coveringSourceRange(
  origins: readonly TextSourceProjection[]
): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const origin of origins) {
    const range = projectionSourceRange(origin);
    if (!range) {
      continue;
    }
    from = Math.min(from, range.from);
    to = Math.max(to, range.to);
  }
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
}

function projectionSourceRange(projection: TextSourceProjection): TextSourceRange | null {
  if (projection.kind === "direct" || projection.kind === "macro-argument") {
    return { from: projection.from, to: projection.to };
  }
  if (projection.kind === "macro-generated") {
    return projection.invocation;
  }
  if (projection.kind === "generated") {
    return projection.owner ?? null;
  }
  return null;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
