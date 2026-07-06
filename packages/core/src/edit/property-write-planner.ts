import type { EditActionResultLike } from "./result-types.js";
import type { Span, Statement } from "../ast/types.js";
import { renderTikzToSvg } from "../render/index.js";
import type { SceneElement } from "../semantic/types.js";
import { normalizeColor } from "../semantic/style/colors.js";
import { replaceSpan } from "./patch.js";
import { parseTikzForEdit, type EditParseOptions, type PropertyWriteInteractionMode } from "./parse-options.js";
import { resolvePropertyTarget } from "./property-target.js";
import type { SourcePatch } from "./types.js";
import { normalizeOptionKey } from "./option-key.js";
import type { SetPropertyAction } from "./actions/set-property.js";
import { applySetPropertyActionRaw } from "./actions/set-property.js";
import {
  propertyCleanupKinds,
  propertyIdForWriteKey,
  shouldOmitDefaultWhenEquivalent
} from "./property-registry.js";


export type CleanupCertificate =
  | {
      accepted: true;
      reason: string;
      candidate: string;
    }
  | {
      accepted: false;
      reason: string;
      candidate: string;
    };

export type PropertyWriteRequest = {
  source: string;
  action: SetPropertyAction;
  parseOptions?: EditParseOptions;
  mode?: PropertyWriteInteractionMode;
};

export type PropertyWritePlan = {
  conservative: EditActionResultLike;
  selected: EditActionResultLike;
  certificates: CleanupCertificate[];
};

type CleanupCandidate = {
  source: string;
  reason: string;
};

type PaintOptions = {
  draw: string | null;
  fill: string | null;
  drawDisabled: boolean;
  fillDisabled: boolean;
};

type CertificationRender = ReturnType<typeof renderTikzToSvg>;
type CertificationRenderCache = Map<string, CertificationRender | null>;

export function applyPlannedSetPropertyAction(
  source: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  return withChangedSourceId(planPropertyWrite({ source, action, parseOptions }).selected, action.elementId);
}

export const PROPERTY_WRITE_CLEANUP_NOOP_REASON = "Property write cleanup would not change the source.";
const LARGE_DRAG_END_CLEANUP_SOURCE_LENGTH = 100_000;

export function cleanupIdiomaticPropertyWrites(
  source: string,
  parseOptions: EditParseOptions = {},
  elementIds?: readonly string[]
): EditActionResultLike {
  if (shouldSkipLargeDragEndPaintCleanup(source, parseOptions)) {
    return { kind: "unsupported", reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON };
  }

  let current = source;
  const certificationCache: CertificationRenderCache = new Map();
  const requestedElementIds = normalizeCleanupElementIds(elementIds);
  const pathIds = requestedElementIds ?? collectPathStatementIds(parseTikzForEdit(source, parseOptions).figure.body);
  for (const elementId of pathIds) {
    const candidates = buildPaintCommandCleanupCandidates(
      current,
      {
        elementId,
        key: "draw",
        value: "true"
      },
      parseOptions
    );
    for (const candidate of candidates) {
      if (certifyEquivalentSource(current, candidate.source, parseOptions, certificationCache) && sourceLooksCleaner(candidate.source, current)) {
        current = candidate.source;
        break;
      }
    }
  }

  if (current === source) {
    return { kind: "unsupported", reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON };
  }

  return {
    kind: "success",
    newSource: current,
    patches: deriveSingleSourcePatch(source, current),
    changedSourceIds: requestedElementIds && requestedElementIds.length > 0 ? requestedElementIds : undefined
  };
}

function withChangedSourceId(result: EditActionResultLike, sourceId: string): EditActionResultLike {
  if (result.kind !== "success" && result.kind !== "partial") {
    return result;
  }
  if (result.changedSourceIds !== undefined) {
    return result;
  }
  const normalized = sourceId.trim();
  return {
    ...result,
    changedSourceIds: [normalized]
  };
}

function shouldSkipLargeDragEndPaintCleanup(source: string, parseOptions: EditParseOptions): boolean {
  return (
    parseOptions.propertyWriteMode === "drag-end" &&
    source.length > LARGE_DRAG_END_CLEANUP_SOURCE_LENGTH &&
    !hasConservativePaintCleanupToken(source)
  );
}

function hasConservativePaintCleanupToken(source: string): boolean {
  return (
    source.includes("draw=none") ||
    source.includes("fill=none") ||
    source.includes("decorate=false") ||
    source.includes("sharp corners")
  );
}

function normalizeCleanupElementIds(elementIds: readonly string[] | undefined): string[] | null {
  if (!elementIds) {
    return null;
  }
  return elementIds.map((id) => id.trim()).filter((id) => id.length > 0);
}

export function planPropertyWrite(request: PropertyWriteRequest): PropertyWritePlan {
  const parseOptions = request.parseOptions ?? {};
  const mode = request.mode ?? parseOptions.propertyWriteMode ?? "commit";
  const conservative = applySetPropertyActionRaw(request.source, request.action, parseOptions);
  if (conservative.kind !== "success" && conservative.kind !== "partial") {
    return { conservative, selected: conservative, certificates: [] };
  }
  if (mode === "preview" || mode === "drag-frame" || request.action.commentMode) {
    return { conservative, selected: conservative, certificates: [] };
  }
  if (hasParseErrors(conservative.newSource, parseOptions)) {
    return { conservative, selected: conservative, certificates: [] };
  }

  const candidates = buildCleanupCandidates(request.source, conservative.newSource, request.action, parseOptions);
  if (candidates.length === 0) {
    return { conservative, selected: conservative, certificates: [] };
  }

  const certificationCache: CertificationRenderCache = new Map();
  const certificates: CleanupCertificate[] = [];
  let selectedSource = conservative.newSource;
  let selectedReason: string | null = null;
  for (const candidate of candidates) {
    const accepted = certifyEquivalentSource(conservative.newSource, candidate.source, parseOptions, certificationCache);
    certificates.push({
      accepted,
      reason: accepted ? candidate.reason : "candidate changed semantic render output",
      candidate: candidate.source
    });
    if (accepted && sourceLooksCleaner(candidate.source, selectedSource)) {
      selectedSource = candidate.source;
      selectedReason = candidate.reason;
    }
  }

  if (!selectedReason || selectedSource === conservative.newSource) {
    return { conservative, selected: conservative, certificates };
  }

  return {
    conservative,
    selected: {
      ...conservative,
      newSource: selectedSource,
      patches: deriveSingleSourcePatch(request.source, selectedSource)
    },
    certificates
  };
}

function buildCleanupCandidates(
  originalSource: string,
  conservativeSource: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions
): CleanupCandidate[] {
  const candidates: CleanupCandidate[] = [];
  const removal = buildDefaultOmissionCandidate(conservativeSource, action, parseOptions);
  if (removal && removal !== conservativeSource && removal !== originalSource) {
    candidates.push({ source: removal, reason: "remove default-equivalent local property" });
  }

  for (const candidate of buildPaintCommandCleanupCandidates(conservativeSource, action, parseOptions)) {
    if (candidate.source !== conservativeSource && candidate.source !== originalSource) {
      candidates.push(candidate);
    }
  }

  return dedupeCandidates(candidates);
}

function collectPathStatementIds(statements: readonly Statement[]): string[] {
  const ids: string[] = [];
  for (const statement of statements) {
    if (statement.kind === "Path") {
      ids.push(statement.id);
    } else if (statement.kind === "Scope") {
      ids.push(...collectPathStatementIds(statement.body));
    }
  }
  return ids;
}

function hasParseErrors(source: string, parseOptions: EditParseOptions): boolean {
  return parseTikzForEdit(source, parseOptions).diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function buildDefaultOmissionCandidate(
  source: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions
): string | null {
  if (action.value.trim().length === 0 || !shouldOmitDefaultWhenEquivalent(action.propertyId ?? propertyIdForWriteKey(action.key))) {
    return null;
  }
  const result = applySetPropertyActionRaw(
    source,
    {
      ...action,
      value: "",
      clearKeys: undefined
    },
    parseOptions
  );
  return result.kind === "success" || result.kind === "partial" ? result.newSource : null;
}

function buildPaintCommandCleanupCandidates(
  source: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions
): CleanupCandidate[] {
  if (!propertyCleanupKinds(action.propertyId ?? propertyIdForWriteKey(action.key)).includes("paint-command")) {
    return [];
  }
  const resolved = resolvePropertyTarget(source, action.elementId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "path-statement") {
    return [];
  }
  const command = normalizedPaintCommand(resolved.target.pathCommand);
  if (!command) {
    return [];
  }

  const paint = resolvePaintOptions(source, action.elementId, parseOptions);
  const shouldPreserveInheritedDrawSuppression = paint.drawDisabled
    && hasInheritedRenderableDrawBeforeCommand(source, action.elementId, parseOptions);
  const commands = chooseCandidateCommands(paint);
  const candidates: CleanupCandidate[] = [];
  for (const nextCommand of commands) {
    if (shouldPreserveInheritedDrawSuppression && commandRemovesExplicitDrawSuppression(nextCommand)) {
      continue;
    }
    const candidate = rewritePaintCommand(source, action.elementId, nextCommand, paint, parseOptions);
    if (candidate && candidate !== source) {
      candidates.push({
        source: candidate,
        reason: `rewrite paint command to \\\\${nextCommand}`
      });
    }
  }
  return candidates;
}

function chooseCandidateCommands(paint: PaintOptions): Array<"path" | "draw" | "fill"> {
  const drawEnabled = paint.draw != null && !paint.drawDisabled;
  const fillEnabled = paint.fill != null && !paint.fillDisabled;
  const candidates: Array<"path" | "draw" | "fill"> = [];
  if (!drawEnabled && !fillEnabled) {
    candidates.push("path");
  }
  if (fillEnabled && !drawEnabled) {
    candidates.push("fill");
  }
  if (drawEnabled) {
    candidates.push("draw");
  }
  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

function commandRemovesExplicitDrawSuppression(command: "path" | "draw" | "fill"): boolean {
  return command === "path" || command === "fill";
}

function normalizedPaintCommand(command: string | undefined): "path" | "draw" | "fill" | "filldraw" | null {
  const normalized = command?.trim().toLowerCase();
  return normalized === "path" || normalized === "draw" || normalized === "fill" || normalized === "filldraw"
    ? normalized
    : null;
}

function rewritePaintCommand(
  source: string,
  elementId: string,
  nextCommand: "path" | "draw" | "fill",
  paint: PaintOptions,
  parseOptions: EditParseOptions
): string | null {
  let current = rewritePathCommandToken(source, elementId, nextCommand, parseOptions);
  if (!current) {
    return null;
  }

  if (nextCommand === "path") {
    if (paint.drawDisabled) {
      current = applyOptionalPropertyMutation(current, elementId, "draw", "", parseOptions) ?? current;
    }
    if (paint.fillDisabled) {
      current = applyOptionalPropertyMutation(current, elementId, "fill", "", parseOptions) ?? current;
    }
    return current;
  }

  if (nextCommand === "fill") {
    if (paint.fill && !paint.fillDisabled) {
      current = applyOptionalPropertyMutation(current, elementId, "fill", paint.fill, parseOptions) ?? current;
    }
    if (paint.drawDisabled) {
      current = applyOptionalPropertyMutation(current, elementId, "draw", "", parseOptions) ?? current;
    }
    return current;
  }

  if (paint.draw && !paint.drawDisabled) {
    current = applyOptionalPropertyMutation(current, elementId, "draw", paint.draw, parseOptions) ?? current;
  }
  if (paint.fillDisabled) {
    current = applyOptionalPropertyMutation(current, elementId, "fill", "", parseOptions) ?? current;
  }
  return current;
}

function applyOptionalPropertyMutation(
  source: string,
  elementId: string,
  key: string,
  value: string,
  parseOptions: EditParseOptions
): string | null {
  const result = applySetPropertyActionRaw(
    source,
    {
      elementId,
      key,
      value
    },
    parseOptions
  );
  return result.kind === "success" || result.kind === "partial" ? result.newSource : null;
}

function rewritePathCommandToken(
  source: string,
  elementId: string,
  nextCommand: "path" | "draw" | "fill",
  parseOptions: EditParseOptions
): string | null {
  const resolved = resolvePropertyTarget(source, elementId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "path-statement" || !resolved.target.pathCommand) {
    return null;
  }
  const commandSpan = findPathCommandTokenSpan(source, resolved.target.span, resolved.target.pathCommand);
  if (!commandSpan) {
    return null;
  }
  return replaceSpan(source, commandSpan, `\\${nextCommand}`).source;
}

function findPathCommandTokenSpan(source: string, statementSpan: Span, command: string): Span | null {
  const pattern = new RegExp(String.raw`\\?${escapeRegex(command)}\b`, "u");
  const statementSource = source.slice(statementSpan.from, statementSpan.to);
  const match = pattern.exec(statementSource);
  if (!match) {
    return null;
  }
  return {
    from: statementSpan.from + match.index,
    to: statementSpan.from + match.index + match[0].length
  };
}

function resolvePaintOptions(
  source: string,
  elementId: string,
  parseOptions: EditParseOptions
): PaintOptions {
  const resolved = resolvePropertyTarget(source, elementId, parseOptions);
  if (resolved.kind !== "found" || !resolved.target.options) {
    return {
      draw: null,
      fill: null,
      drawDisabled: false,
      fillDisabled: false
    };
  }
  let draw: string | null = null;
  let fill: string | null = null;
  for (const entry of resolved.target.options.entries) {
    if (entry.kind === "kv") {
      const key = normalizeOptionKey(entry.key);
      if (key === "draw" || key === "color") {
        draw = normalizeOptionValue(entry.valueRaw);
      }
      if (key === "fill") {
        fill = normalizeOptionValue(entry.valueRaw);
      }
      continue;
    }
    if (entry.kind === "flag") {
      const key = normalizeOptionKey(entry.key);
      if (key === "draw") {
        draw = "true";
      } else if (key === "fill") {
        fill = "true";
      }
    }
  }
  return {
    draw,
    fill,
    drawDisabled: isDisabledPaintValue(draw),
    fillDisabled: isDisabledPaintValue(fill)
  };
}

function normalizeOptionValue(value: string): string {
  return value.trim().replace(/^\{|\}$/gu, "").trim();
}

function isDisabledPaintValue(value: string | null): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "none" || normalized === "false";
}

function hasInheritedRenderableDrawBeforeCommand(
  source: string,
  elementId: string,
  parseOptions: EditParseOptions
): boolean {
  try {
    const rendered = renderTikzToSvg(source, {
      parse: {
        recover: true,
        activeFigureId: parseOptions.activeFigureId,
        includeContextDefinitions: true
      }
    });
    const element = rendered.semantic.scene.elements.find((candidate) => sceneElementMatchesSourceId(candidate, elementId));
    const commandDefault = element?.styleChain.find(
      (entry) => entry.sourceRef?.sourceKind === "command-default" && styleSourceRefMatches(entry.sourceRef.sourceId, elementId)
    );
    return commandDefault?.before.drawExplicit === true
      && hasRenderableStroke(commandDefault.before);
  } catch {
    return false;
  }
}

function sceneElementMatchesSourceId(element: SceneElement, sourceId: string): boolean {
  return element.sourceRef.sourceId === sourceId || element.identityRef?.sourceId === sourceId;
}

function styleSourceRefMatches(sourceId: string, targetSourceId: string): boolean {
  return sourceId === targetSourceId;
}

function certifyEquivalentSource(
  leftSource: string,
  rightSource: string,
  parseOptions: EditParseOptions,
  cache?: CertificationRenderCache
): boolean {
  const left = renderForCertification(leftSource, parseOptions, cache);
  const right = renderForCertification(rightSource, parseOptions, cache);
  if (!left || !right) {
    return false;
  }
  return (
    diagnosticsSignature(left.parse.diagnostics) === diagnosticsSignature(right.parse.diagnostics) &&
    semanticSignature(left.semantic.scene.elements) === semanticSignature(right.semantic.scene.elements) &&
    svgSignature(left.svg.svg) === svgSignature(right.svg.svg)
  );
}

function renderForCertification(
  source: string,
  parseOptions: EditParseOptions,
  cache: CertificationRenderCache | undefined
): CertificationRender | null {
  if (cache?.has(source)) {
    return cache.get(source) ?? null;
  }
  try {
    const rendered = renderTikzToSvg(source, {
      parse: {
        recover: true,
        activeFigureId: parseOptions.activeFigureId,
        includeContextDefinitions: true
      }
    });
    cache?.set(source, rendered);
    return rendered;
  } catch {
    cache?.set(source, null);
    return null;
  }
}

function semanticSignature(value: unknown): string {
  return JSON.stringify(sanitizeSemanticValue(value));
}

function sanitizeSemanticValue(value: unknown, geometricStyle = false): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => !isInvisibleSceneElement(entry)).map((entry) => sanitizeSemanticValue(entry));
  }
  if (typeof value === "number") {
    return normalizeSignatureNumber(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const isGeometricElement = input.kind === "Path" || input.kind === "Circle" || input.kind === "Ellipse";
  for (const [key, entryValue] of Object.entries(input)) {
    if (
      key === "span" ||
      key === "id" ||
      key === "runtimeId" ||
      key === "sourceSpan" ||
      key === "textSourceSpan" ||
      key === "sourceFingerprint" ||
      key === "styleChain" ||
      key === "rawOptions" ||
      (geometricStyle && key === "textColor")
    ) {
      continue;
    }
    output[key] = sanitizeStyleValueForSignature(key, entryValue, geometricStyle);
    if (output[key] === entryValue) {
      output[key] = sanitizeSemanticValue(entryValue, isGeometricElement && key === "style");
    }
  }
  return output;
}

function sanitizeStyleValueForSignature(key: string, value: unknown, geometricStyle: boolean): unknown {
  if (!geometricStyle) {
    return value;
  }
  if (key === "stroke" || key === "fill") {
    return normalizePaintColorForSignature(value);
  }
  return value;
}

function normalizePaintColorForSignature(value: unknown): unknown {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === "none") {
    return null;
  }
  return normalizeColor(trimmed);
}

function svgSignature(svg: string): string {
  return svg.replace(/\b(stroke|fill|stop-color)="([^"]*)"/gu, (_match, attribute: string, value: string) =>
    `${attribute}="${normalizeSvgPaintForSignature(value)}"`
  );
}

function normalizeSvgPaintForSignature(value: string): string {
  const trimmed = value.trim();
  if (/^url\(/iu.test(trimmed)) {
    return value;
  }
  if (trimmed.length === 0 || trimmed.toLowerCase() === "none") {
    return "none";
  }
  return normalizeColor(trimmed);
}

function normalizeSignatureNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const rounded = Math.round(value * 1e9) / 1e9;
  return Math.abs(rounded) < 1e-12 ? 0 : rounded;
}

function isInvisibleSceneElement(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const element = value as Record<string, unknown>;
  if (element.kind !== "Path" && element.kind !== "Circle" && element.kind !== "Ellipse") {
    return false;
  }
  const style = element.style;
  if (!style || typeof style !== "object") {
    return false;
  }
  const styleRecord = style as Record<string, unknown>;
  return (
    !hasRenderableStroke(styleRecord) &&
    !hasRenderableFill(styleRecord) &&
    !hasRenderableEffect(styleRecord)
  );
}

function hasRenderableStroke(style: Record<string, unknown>): boolean {
  return (
    isRenderableColor(style.stroke) &&
    numericStyleValue(style.opacity, 1) > 0 &&
    numericStyleValue(style.strokeOpacity, 1) > 0 &&
    numericStyleValue(style.lineWidth, 0.4) > 0
  );
}

function hasRenderableFill(style: Record<string, unknown>): boolean {
  return (
    (isRenderableColor(style.fill) || style.fillPattern != null || style.shadeEnabled === true) &&
    numericStyleValue(style.opacity, 1) > 0 &&
    numericStyleValue(style.fillOpacity, 1) > 0
  );
}

function hasRenderableEffect(style: Record<string, unknown>): boolean {
  return (
    style.clip === true ||
    style.useAsBoundingBox === true ||
    style.doubleStroke === true ||
    style.markerStart != null ||
    style.markerEnd != null ||
    hasEnabledDecoration(style.decoration) ||
    hasNonEmptyArray(style.decorationPreActions) ||
    hasNonEmptyArray(style.decorationPostActions) ||
    hasNonEmptyArray(style.shadowLayers)
  );
}

function isRenderableColor(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.trim().toLowerCase() !== "none";
}

function numericStyleValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hasEnabledDecoration(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).enabled === true);
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function diagnosticsSignature(diagnostics: readonly { severity: string; message: string }[]): string {
  return diagnostics.map((diagnostic) => `${diagnostic.severity}:${diagnostic.message}`).join("\n");
}

function sourceLooksCleaner(candidate: string, current: string): boolean {
  if (candidate.length !== current.length) {
    return candidate.length < current.length;
  }
  return sourceNoiseScore(candidate) < sourceNoiseScore(current);
}

function sourceNoiseScore(source: string): number {
  return countOccurrences(source, "draw=none")
    + countOccurrences(source, "fill=none")
    + countOccurrences(source, "decorate=false")
    + countOccurrences(source, "sharp corners");
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = source.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

function deriveSingleSourcePatch(previous: string, next: string): SourcePatch[] {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) {
    prefix += 1;
  }
  let previousSuffix = previous.length;
  let nextSuffix = next.length;
  while (
    previousSuffix > prefix &&
    nextSuffix > prefix &&
    previous[previousSuffix - 1] === next[nextSuffix - 1]
  ) {
    previousSuffix -= 1;
    nextSuffix -= 1;
  }
  return [
    {
      oldSpan: { from: prefix, to: previousSuffix },
      newSpan: { from: prefix, to: nextSuffix },
      replacement: next.slice(prefix, nextSuffix)
    }
  ];
}

function dedupeCandidates(candidates: CleanupCandidate[]): CleanupCandidate[] {
  const seen = new Set<string>();
  const unique: CleanupCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.source)) {
      continue;
    }
    seen.add(candidate.source);
    unique.push(candidate);
  }
  return unique;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
