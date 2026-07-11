import { applyEditAction, type EditAction, type EditActionResult } from "@tikz-editor/core/edit/actions";
import {
  getInspectorDescriptor,
  type InspectorProperty,
  type InspectorSnapshot
} from "@tikz-editor/core/edit/inspector";
import type { SceneElement } from "@tikz-editor/core/semantic/types";

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
  activeFigureId: string | null;
  figureCount: number;
  propertyWriteMode?: "commit" | "preview";
}): BucketFillEditResolution {
  const {
    sourceId,
    colorToken,
    source,
    elements,
    editHandles,
    activeFigureId,
    figureCount,
    propertyWriteMode = "commit"
  } = args;

  const element = elements.find((candidate) => candidate.sourceRef.sourceId === sourceId);
  if (!element) {
    return { kind: "noop" };
  }

  const descriptor = getInspectorDescriptor(element, {
    source,
    editHandles,
    parseOptions: {
      activeFigureId:
        activeFigureId ?? (figureCount > 1 ? null : undefined)
    }
  });
  const fillProperty = findFillColorProperty(descriptor.sections.flatMap((section) => section.properties));
  if (!fillProperty || !fillProperty.write.writable || fillProperty.write.elementId.length === 0) {
    return { kind: "noop", reason: fillProperty?.write.reason };
  }

  const action: Extract<EditAction, { kind: "setProperty" }> = {
    kind: "setProperty",
    elementId: fillProperty.write.elementId,
    level: fillProperty.write.level,
    key: fillProperty.write.key,
    value: colorToken,
    propertyId: fillProperty.write.propertyId,
    clearKeys: colorClearKeys(fillProperty.syntaxValue)
  };
  const result = applyEditAction(source, editHandles ?? [], action, {
    parseOptions: {
      activeFigureId:
        activeFigureId ?? (figureCount > 1 ? null : undefined),
      propertyWriteMode
    }
  });

  if ((result.kind !== "success" && result.kind !== "partial") || result.newSource === source) {
    return {
      kind: "noop",
      reason: result.kind === "unsupported" ? result.reason : result.kind === "error" ? result.message : undefined
    };
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
