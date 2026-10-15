import { applyEditAction, type EditAction, type EditActionResult } from "@tikz-editor/core/edit/actions";
import {
  getInspectorDescriptor,
  type InspectorProperty,
  type InspectorSnapshot
} from "@tikz-editor/core/edit/inspector";
import type { SceneElement } from "@tikz-editor/core/semantic/types";
import { parseWindowRootId } from "../../root-inventory";

export type BucketFillEditResolution =
  | {
      kind: "ready";
      sourceId: string;
      action: Extract<EditAction, { kind: "setProperty" }>;
      result: Extract<EditActionResult, { kind: "success" | "partial" }>;
    }
  | {
      kind: "noop";
      reason?: string;
    };

export function resolveBucketFillEdit(args: {
  sourceId: string;
  colorToken: string;
  source: string;
  elements: readonly SceneElement[];
  editHandles: InspectorSnapshot["editHandles"];
  activeRootId: string | null;
  figureCount: number;
  propertyWriteMode?: "commit" | "preview";
}): BucketFillEditResolution {
  const {
    sourceId,
    colorToken,
    source,
    elements,
    editHandles,
    activeRootId,
    figureCount,
    propertyWriteMode = "commit"
  } = args;

  const element = elements.find((candidate) => candidate.sourceRef.sourceId === sourceId);
  if (!element) {
    return { kind: "noop" };
  }

  const activeFigureId = parseWindowRootId(activeRootId, figureCount);
  const descriptor = getInspectorDescriptor(element, {
    source,
    ...(editHandles !== undefined ? { editHandles: editHandles } : {}),
    parseOptions: {
      ...(activeFigureId !== undefined ? { activeFigureId } : {})
    }
  });
  const fillProperty = findFillColorProperty(descriptor.sections.flatMap((section) => section.properties));
  if (!fillProperty || !fillProperty.write.writable || fillProperty.write.elementId.length === 0) {
    return { kind: "noop", ...(fillProperty?.write.reason !== undefined ? { reason: fillProperty.write.reason } : {}) };
  }

  const clearKeys = colorClearKeys(fillProperty.syntaxValue);
  const action: Extract<EditAction, { kind: "setProperty" }> = {
    kind: "setProperty",
    elementId: fillProperty.write.elementId,
    level: fillProperty.write.level,
    key: fillProperty.write.key,
    value: colorToken,
    ...(fillProperty.write.propertyId !== undefined ? { propertyId: fillProperty.write.propertyId } : {}),
    ...(clearKeys !== undefined ? { clearKeys } : {})
  };
  const result = applyEditAction(source, editHandles ?? [], action, {
    parseOptions: {
      ...(activeFigureId !== undefined ? { activeFigureId } : {}),
      propertyWriteMode
    }
  });

  if ((result.kind !== "success" && result.kind !== "partial") || result.newSource === source) {
    const reason = result.kind === "unsupported" ? result.reason : result.kind === "error" ? result.message : undefined;
    return { kind: "noop", ...(reason !== undefined ? { reason } : {}) };
  }

  return {
    kind: "ready",
    sourceId,
    action,
    result
  };
}

function findFillColorProperty(properties: readonly InspectorProperty[]): Extract<InspectorProperty, { kind: "color" }> | null {
  for (const property of properties) {
    if (property.kind !== "color") {
      continue;
    }
    if (property.id === "fill-color" || property.id === "adornment-fill-color") {
      return property;
    }
  }
  return null;
}

function colorClearKeys(syntaxValue: string | null): string[] | undefined {
  const normalized = syntaxValue?.trim() ?? "";
  return normalized.length > 0 ? [normalized] : undefined;
}
