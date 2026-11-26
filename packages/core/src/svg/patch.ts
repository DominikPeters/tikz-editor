import type {
  SvgDiffHints,
  SvgPatchOp,
  SvgRenderModel
} from "./types.js";

export function diffSvgModels(
  previous: SvgRenderModel | null,
  next: SvgRenderModel,
  hints: SvgDiffHints = {}
): SvgPatchOp[] {
  if (!previous) {
    return [{ kind: "replaceAll", model: next }];
  }

  if (!hasValidModelInvariants(previous) || !hasValidModelInvariants(next)) {
    return [{ kind: "replaceAll", model: next }];
  }

  const operations: SvgPatchOp[] = [];

  if (!sameViewBox(previous.viewBox, next.viewBox)) {
    operations.push({
      kind: "setViewBox",
      viewBox: next.viewBox
    });
  }

  if (previous.defsFingerprint !== next.defsFingerprint) {
    operations.push({
      kind: "replaceDefs",
      defs: [...next.defs],
      defsFingerprint: next.defsFingerprint
    });
  }

  const knownGlyphs = new Set(previous.glyphDefs);
  const addedGlyphs = (next.glyphDefs ?? []).filter((def) => !knownGlyphs.has(def));
  if (addedGlyphs.length > 0) {
    operations.push({ kind: "appendGlyphDefs", defs: addedGlyphs });
  }

  if (hasUnscopedPartDrift(previous, next, hints)) {
    return diffSvgModels(previous, next, {});
  }

  const previousById = new Map(previous.parts.map((part) => [part.partId, part] as const));
  const nextById = new Map(next.parts.map((part) => [part.partId, part] as const));
  const candidatePartIds = resolveCandidatePartIds(previous, next, hints);

  for (const partId of candidatePartIds) {
    if (!nextById.has(partId) && previousById.has(partId)) {
      operations.push({
        kind: "removePart",
        partId
      });
    }
  }

  const nextCandidates = next.parts.filter((part) => candidatePartIds.has(part.partId));
  for (const part of nextCandidates) {
    const previousPart = previousById.get(part.partId);
    const changed =
      previousPart?.fingerprint !== part.fingerprint ||
      previousPart.order !== part.order;
    if (!changed) {
      continue;
    }

    operations.push({
      kind: "upsertPart",
      part,
      afterPartId: findPreviousPartIdInOrder(next, part.order)
    });
  }

  return operations;
}

function hasUnscopedPartDrift(
  previous: SvgRenderModel,
  next: SvgRenderModel,
  hints: SvgDiffHints
): boolean {
  const affectedSourceIds = hints.affectedSourceIds;
  if (!affectedSourceIds || affectedSourceIds.length === 0) {
    return false;
  }

  const affected = new Set(affectedSourceIds);
  const previousUnscoped = previous.parts.filter((part) => !affected.has(part.sourceId));
  const nextUnscoped = next.parts.filter((part) => !affected.has(part.sourceId));
  if (previousUnscoped.length !== nextUnscoped.length) {
    return true;
  }

  for (let index = 0; index < previousUnscoped.length; index += 1) {
    const previousPart = previousUnscoped.at(index);
    const nextPart = nextUnscoped.at(index);
    if (!previousPart || !nextPart) {
      return true;
    }
    if (
      previousPart.partId !== nextPart.partId ||
      previousPart.fingerprint !== nextPart.fingerprint
    ) {
      return true;
    }
  }

  return false;
}

function resolveCandidatePartIds(
  previous: SvgRenderModel,
  next: SvgRenderModel,
  hints: SvgDiffHints
): Set<string> {
  const affectedSourceIds = hints.affectedSourceIds;
  if (!affectedSourceIds || affectedSourceIds.length === 0) {
    return new Set([
      ...previous.parts.map((part) => part.partId),
      ...next.parts.map((part) => part.partId)
    ]);
  }

  const affected = new Set(affectedSourceIds);
  const candidates = new Set<string>();
  for (const part of previous.parts) {
    if (affected.has(part.sourceId)) {
      candidates.add(part.partId);
    }
  }
  for (const part of next.parts) {
    if (affected.has(part.sourceId)) {
      candidates.add(part.partId);
    }
  }
  return candidates;
}

function findPreviousPartIdInOrder(
  model: SvgRenderModel,
  order: number
): string | null {
  for (let index = order - 1; index >= 0; index -= 1) {
    const candidate = model.parts.at(index);
    if (candidate) {
      return candidate.partId;
    }
  }
  return null;
}

function sameViewBox(
  left: SvgRenderModel["viewBox"],
  right: SvgRenderModel["viewBox"]
): boolean {
  return (
    Math.abs(left.x - right.x) <= 1e-9 &&
    Math.abs(left.y - right.y) <= 1e-9 &&
    Math.abs(left.width - right.width) <= 1e-9 &&
    Math.abs(left.height - right.height) <= 1e-9
  );
}

function hasValidModelInvariants(model: SvgRenderModel): boolean {
  const partIds = new Set<string>();
  for (let index = 0; index < model.parts.length; index += 1) {
    const part = model.parts.at(index);
    if (!part) {
      return false;
    }
    if (part.order !== index) {
      return false;
    }
    if (partIds.has(part.partId)) {
      return false;
    }
    partIds.add(part.partId);
  }
  return true;
}
