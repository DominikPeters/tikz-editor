import type { OptionEntry } from "../options/types.js";
import type { StyleChainEntry, StyleSourceRef } from "../semantic/style-chain.js";
import type { SceneElement, ResolvedStyle } from "../semantic/types.js";
import type { EditAction, StyleLevel } from "./actions.js";
import {
  TIKZPICTURE_GLOBAL_TARGET_ID,
  getInspectorDescriptor,
  type InspectorDescriptor,
  type InspectorProperty,
  type InspectorSnapshot,
  type SetPropertyWriteTarget
} from "./inspector.js";
import {
  DASH_STYLE_OPTIONS,
  FILL_MODE_OPTIONS,
  FILL_PATTERN_OPTIONS,
  FILL_SHADING_OPTIONS,
  LINE_CAP_OPTIONS,
  LINE_JOIN_OPTIONS,
  NODE_INNER_SEP_DEFAULT,
  NODE_SHAPE_OPTIONS
} from "./inspector/presets.js";
import {
  dashStylePresetFromStyle,
  fillPatternPresetFromResolvedPattern,
  fillShadingPresetFromStyleName,
  lineCapPresetFromStyle,
  lineJoinPresetFromStyle,
  lineWidthPresetLabel
} from "./inspector/preset-values.js";
import { resolveTransformInspectorValues } from "./property-write-builders.js";
import {
  FOREACH_TEMPLATE_TARGET_PREFIX,
  makeStyleSourceTargetId,
  resolvePropertyTarget,
  type PropertyTargetResolution
} from "./property-target.js";
import { normalizeOptionKey } from "./option-mutations.js";
import { formatNumber } from "./format.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { readBalancedBlock, stripEnclosingBraces } from "../semantic/style/option-utils.js";
import { parseCustomStyleDefinition } from "../semantic/style/custom-styles.js";
import { parseOptionListRaw } from "../options/parse.js";
import { incrementProfilingCounter } from "../profiling.js";
import {
  buildPropertyMutations,
  isAddableProperty,
  propertyIdForOptionEntry,
  propertyIdForStyleContribution,
  propertyIdForWriteKey,
  type SemanticPropertyId
} from "./property-registry.js";

export type StylesCascadeDeclarationStatus = "active" | "overridden" | "inactive-default" | "unsupported" | "disabled";

export type StylesEditablePropertyCatalogEntry = {
  propertyId: string;
  label: string;
  kind: InspectorProperty["kind"];
};

export type StylesCascadeDeclaration = {
  id: string;
  propertyId: string | null;
  label: string;
  cssValue: string;
  status: StylesCascadeDeclarationStatus;
  property: InspectorProperty | null;
  writeTargets: SetPropertyWriteTarget[];
  sourceText: string;
  readOnlyReason?: string;
};

export type StylesCascadeSection = {
  id: string;
  kind: "command" | "scope" | "named-style" | "global" | "default";
  title: string;
  subtitle: string | null;
  sourceLevel: StyleLevel | null;
  sourceLabel: string | null;
  sourceLocation: string | null;
  writable: boolean;
  readOnlyReason?: string;
  declarations: StylesCascadeDeclaration[];
  addableProperties: StylesEditablePropertyCatalogEntry[];
  addPropertyTemplates: Record<string, InspectorProperty>;
  writeTargets: SetPropertyWriteTarget[];
};

export type StylesCascadeModel = {
  elementKind: InspectorDescriptor["elementKind"];
  elementIds: string[];
  sections: StylesCascadeSection[];
  comparableSignature: string;
};

type StylesSectionWriteTarget = {
  writeTarget: SetPropertyWriteTarget;
  readOnly: boolean;
  readOnlyReason?: string;
};

type StylesDeclarationDraft = Omit<StylesCascadeDeclaration, "status" | "writeTargets"> & {
  writeTarget: SetPropertyWriteTarget;
  priorityKey: string;
  defaultLike: boolean;
  status?: StylesCascadeDeclarationStatus;
};

export function buildStylesCascadeModel(
  element: SceneElement,
  snapshot: InspectorSnapshot,
  descriptor = getInspectorDescriptor(element, snapshot)
): StylesCascadeModel {
  incrementProfilingCounter("buildStylesCascadeModelCalls");
  const propertyMap = new Map(descriptor.sections.flatMap((section) => section.properties.map((property) => [property.id, property] as const)));
  const addTemplates = buildAddPropertyTemplates(descriptor, element, snapshot.source, snapshot);
  const sections: StylesCascadeSection[] = [];
  const orderedEntries = [...element.styleChain].reverse();
  const writeTargetCache = new Map<string, PropertyTargetResolution>();

  for (let index = 0; index < orderedEntries.length; index += 1) {
    const entry = orderedEntries[index];
    const targetId = entry.sourceRef ? sourceTargetIdForEntry(entry, entry.sourceRef) : null;
    const sectionTarget =
      targetId != null
        ? resolveSectionWriteTarget(snapshot.source, entry, targetId, snapshot.parseOptions, writeTargetCache)
        : resolveSectionWriteTarget(snapshot.source, entry, null, snapshot.parseOptions, writeTargetCache);
    const declarationDrafts = buildSectionDeclarations(entry, propertyMap, sectionTarget.writeTarget, snapshot.source);
    if (declarationDrafts.length === 0) {
      continue;
    }
    const title = formatSectionTitle(entry);
    sections.push({
      id: `styles-section-${index}`,
      kind: normalizeSectionKind(entry),
      title,
      subtitle: formatSectionSubtitle(entry),
      sourceLevel: sectionTarget.writeTarget.level,
      sourceLabel: entry.sourceRef?.label ?? null,
      sourceLocation: formatSourceLocation(snapshot.source, entry.sourceRef),
      writable: !sectionTarget.readOnly,
      readOnlyReason: sectionTarget.readOnlyReason,
      declarations: declarationDrafts.map((draft) => ({
        ...draft,
        status: draft.status ?? "unsupported",
        writeTargets: draft.writeTarget.writable ? [draft.writeTarget] : []
      })),
      addableProperties: Object.values(addTemplates).map((property) => ({ propertyId: property.id, label: property.label, kind: property.kind })),
      addPropertyTemplates: addTemplates,
      writeTargets: sectionTarget.writeTarget.writable ? [sectionTarget.writeTarget] : []
    });
  }

  applyDeclarationStatuses(sections);

  return {
    elementKind: descriptor.elementKind,
    elementIds: [descriptor.elementId],
    sections,
    comparableSignature: JSON.stringify(
      sections.map((section) => ({
        kind: section.kind,
        title: section.title,
        subtitle: section.subtitle,
        declarations: section.declarations.map((declaration) => ({
          propertyId: declaration.propertyId,
          label: declaration.label,
          cssValue: declaration.cssValue,
          status: declaration.status,
          sourceText: declaration.sourceText
        }))
      }))
    )
  };
}

export function buildSharedStylesCascadeModel(models: StylesCascadeModel[]): StylesCascadeModel | null {
  if (models.length === 0) {
    return null;
  }
  const signature = models[0].comparableSignature;
  if (models.some((model) => model.comparableSignature !== signature)) {
    return null;
  }

  const base = models[0];
  return {
    elementKind: base.elementKind,
    elementIds: models.flatMap((model) => model.elementIds),
    comparableSignature: base.comparableSignature,
    sections: base.sections.map((section, sectionIndex) => ({
      ...section,
      writeTargets: models.flatMap((model) => model.sections[sectionIndex]?.writeTargets ?? []),
      declarations: section.declarations.map((declaration, declarationIndex) => ({
        ...declaration,
        writeTargets: models.flatMap((model) => model.sections[sectionIndex]?.declarations[declarationIndex]?.writeTargets ?? [])
      }))
    }))
  };
}

export function areStylesCascadeModelsIdentical(models: StylesCascadeModel[]): boolean {
  return buildSharedStylesCascadeModel(models) != null;
}

export function planStylesSetPropertyActions(
  writeTargets: readonly SetPropertyWriteTarget[],
  mutation: { key: string; value: string; clearKeys?: string[]; propertyId?: SemanticPropertyId }
): EditAction[] {
  const unique = new Map<string, EditAction>();
  for (const target of writeTargets) {
    if (!target.writable || target.elementId.trim().length === 0) {
      continue;
    }
    const [plannedMutation] = buildPropertyMutations({
      propertyId: mutation.propertyId ?? target.propertyId,
      key: mutation.key,
      value: mutation.value,
      clearKeys: mutation.clearKeys
    });
    if (!plannedMutation) {
      continue;
    }
    const action: EditAction = {
      kind: "setProperty",
      elementId: target.elementId,
      level: target.level,
      key: plannedMutation.key,
      value: plannedMutation.value,
      propertyId: plannedMutation.propertyId,
      clearKeys: plannedMutation.clearKeys
    };
    unique.set(`${target.elementId}:${plannedMutation.key}:${plannedMutation.value}:${(plannedMutation.clearKeys ?? []).join(",")}`, action);
  }
  return [...unique.values()];
}

export function planStylesTogglePropertyActions(
  writeTargets: readonly SetPropertyWriteTarget[],
  mutation: { key: string; mode: "disable" | "enable"; sourceText: string }
): EditAction[] {
  const unique = new Map<string, EditAction>();
  for (const target of writeTargets) {
    if (!target.writable || target.elementId.trim().length === 0) {
      continue;
    }
    const action: EditAction = {
      kind: "setProperty",
      elementId: target.elementId,
      level: target.level,
      key: mutation.key,
      value: "",
      propertyId: target.propertyId ?? propertyIdForWriteKey(mutation.key) ?? undefined,
      commentMode: mutation.mode,
      commentSourceText: mutation.sourceText
    };
    unique.set(`${target.elementId}:${mutation.key}:${mutation.mode}:${mutation.sourceText}`, action);
  }
  return [...unique.values()];
}

function buildSectionDeclarations(
  entry: StyleChainEntry,
  propertyMap: Map<string, InspectorProperty>,
  writeTarget: SetPropertyWriteTarget,
  source: string
): StylesDeclarationDraft[] {
  const declarations: StylesDeclarationDraft[] = [];
  const seen = new Set<string>();
  const appendCandidate = (candidate: {
    entry: OptionEntry;
    disabled: boolean;
    absoluteFrom: number;
    sourceText: string;
  }, candidateWriteTarget: SetPropertyWriteTarget = writeTarget) => {
    if (isStyleDefinitionEntry(candidate.entry)) {
      return;
    }
    const matched = mapEntryToDeclaration(candidate.entry, propertyMap, candidateWriteTarget);
    if (!matched) {
      const unsupported = buildUnsupportedDeclaration(candidate.entry, candidateWriteTarget, entry);
      if (candidate.disabled) {
        declarations.push({
          ...unsupported,
          id: `disabled:unsupported:${candidate.absoluteFrom}`,
          sourceText: candidate.sourceText,
          priorityKey: `disabled:unsupported:${candidate.absoluteFrom}`,
          status: "disabled"
        });
      } else {
        declarations.push(unsupported);
      }
      return;
    }

    if (!candidate.disabled) {
      if (seen.has(matched.priorityKey)) {
        return;
      }
      seen.add(matched.priorityKey);
      declarations.push(matched);
      return;
    }

    declarations.push({
      ...matched,
      id: `disabled:${matched.propertyId ?? "unknown"}:${candidate.absoluteFrom}`,
      sourceText: candidate.sourceText,
      priorityKey: `disabled:${matched.propertyId ?? matched.priorityKey}:${candidate.absoluteFrom}`,
      status: "disabled"
    });
  };

  for (const optionList of entry.rawOptions) {
    const nestedStyleValueSpans = optionList.entries
      .flatMap((optionEntry) => {
        if (optionEntry.kind !== "kv" || !isStyleDefinitionEntry(optionEntry)) {
          return [];
        }
        const span = resolveStyleDefinitionValueSpan(source, optionEntry);
        return span ? [span] : [];
      });
    const candidates: Array<{
      entry: OptionEntry;
      disabled: boolean;
      absoluteFrom: number;
      sourceText: string;
    }> = [
      ...optionList.entries.map((optionEntry) => ({
        entry: optionEntry,
        disabled: false,
        absoluteFrom: optionEntry.span.from,
        sourceText: optionEntry.raw.trim()
      })),
      ...extractDisabledOptionDeclarations(source, optionList)
        .filter((candidate) =>
          !nestedStyleValueSpans.some((span) => candidate.absoluteFrom >= span.from && candidate.absoluteFrom < span.to)
        )
        .map((candidate) => ({
          entry: candidate.entry,
          disabled: true,
          absoluteFrom: candidate.absoluteFrom,
          sourceText: candidate.sourceText
        }))
    ].sort((left, right) => left.absoluteFrom - right.absoluteFrom);

    for (const candidate of candidates) {
      if (isStyleDefinitionEntry(candidate.entry)) {
        if (candidate.entry.kind === "kv" && !candidate.disabled) {
          const styleTargetId = makeStyleSourceTargetId(candidate.entry.span);
          const styleTarget = resolvePropertyTarget(source, styleTargetId);
          const styleWriteTarget: SetPropertyWriteTarget =
            styleTarget.kind === "found"
              ? { ...writeTarget, elementId: styleTargetId, writable: true, reason: undefined }
              : { ...writeTarget, elementId: styleTargetId, writable: false, reason: styleTarget.reason };
          const styleOptionsSpan =
            styleTarget.kind === "found" && styleTarget.target.optionsSpan && styleTarget.target.optionsSpan.to > styleTarget.target.optionsSpan.from
              ? styleTarget.target.optionsSpan
              : resolveStyleDefinitionValueSpan(source, candidate.entry);
          if (styleOptionsSpan) {
            const nestedDisabledCandidates = extractDisabledOptionDeclarations(source, {
              span: styleOptionsSpan
            });
            for (const nested of nestedDisabledCandidates) {
              appendCandidate(
                {
                  entry: nested.entry,
                  disabled: true,
                  absoluteFrom: nested.absoluteFrom,
                  sourceText: nested.sourceText
                },
                styleWriteTarget
              );
            }
          }
        }
        continue;
      }
      appendCandidate(candidate);
    }
  }

  if (
    entry.rawOptions.length === 0
    && entry.sourceRef?.sourceSpan
    && (/\boptions\b/u.test(entry.sourceRef.sourceKind) || /style/u.test(entry.sourceRef.sourceKind))
  ) {
    const disabledCandidates = extractDisabledOptionDeclarations(source, { span: entry.sourceRef.sourceSpan });
    for (const candidate of disabledCandidates) {
      appendCandidate({
        entry: candidate.entry,
        disabled: true,
        absoluteFrom: candidate.absoluteFrom,
        sourceText: candidate.sourceText
      });
    }
  }

  if (declarations.length > 0) {
    return declarations;
  }

  for (const key of Object.keys(entry.resolvedContributions) as Array<keyof ResolvedStyle>) {
    const matched = mapContributionToDeclaration(key, entry.after, propertyMap, writeTarget, entry);
    if (!matched || seen.has(matched.priorityKey)) {
      continue;
    }
    seen.add(matched.priorityKey);
    declarations.push(matched);
  }

  return declarations;
}

function resolveStyleDefinitionValueSpan(
  source: string,
  entry: Extract<OptionEntry, { kind: "kv" }>
): { from: number; to: number } | null {
  const raw = source.slice(entry.span.from, entry.span.to);
  const equalIndex = raw.indexOf("=");
  if (equalIndex < 0) {
    return null;
  }

  let valueStart = equalIndex + 1;
  while (valueStart < raw.length && /\s/u.test(raw[valueStart] ?? "")) {
    valueStart += 1;
  }
  if (valueStart >= raw.length) {
    return null;
  }

  let valueEnd = raw.length;
  while (valueEnd > valueStart && /\s/u.test(raw[valueEnd - 1] ?? "")) {
    valueEnd -= 1;
  }
  if (valueEnd <= valueStart) {
    return null;
  }

  const opener = raw[valueStart];
  if (opener === "{" || opener === "[") {
    const closer = opener === "{" ? "}" : "]";
    const block = readBalancedBlock(raw, valueStart, opener, closer);
    if (block) {
      const contentFrom = entry.span.from + valueStart + 1;
      const contentTo = entry.span.from + block.nextIndex - 1;
      if (contentTo >= contentFrom) {
        return { from: contentFrom, to: contentTo };
      }
    }
  }

  return {
    from: entry.span.from + valueStart,
    to: entry.span.from + valueEnd
  };
}

type DisabledOptionDeclarationCandidate = {
  entry: OptionEntry;
  sourceText: string;
  absoluteFrom: number;
};

function extractDisabledOptionDeclarations(source: string, optionList: { span: { from: number; to: number } }): DisabledOptionDeclarationCandidate[] {
  if (optionList.span.to <= optionList.span.from) {
    return [];
  }
  const raw = source.slice(optionList.span.from, optionList.span.to);
  if (raw.length === 0) {
    return [];
  }

  const candidates: DisabledOptionDeclarationCandidate[] = [];
  let lineStart = 0;
  while (lineStart <= raw.length) {
    let lineEnd = lineStart;
    while (lineEnd < raw.length) {
      const char = raw[lineEnd];
      if (char === "\n" || char === "\r") {
        break;
      }
      lineEnd += 1;
    }
    const line = raw.slice(lineStart, lineEnd);
    const trimmed = line.trimStart();
    if (trimmed.startsWith("%")) {
      const body = trimmed.slice(1).trim();
      if (body.endsWith(",")) {
        const sourceText = body.slice(0, -1).trim();
        if (sourceText.length > 0) {
          const parsed = parseOptionListRaw(`[${sourceText}]`);
          const parsedEntry = parsed.entries[0];
          if (parsedEntry) {
            candidates.push({
              entry: parsedEntry,
              sourceText,
              absoluteFrom: optionList.span.from + lineStart
            });
          }
        }
      }
    }

    if (lineEnd >= raw.length) {
      break;
    }
    if (raw[lineEnd] === "\r" && raw[lineEnd + 1] === "\n") {
      lineStart = lineEnd + 2;
    } else {
      lineStart = lineEnd + 1;
    }
  }

  return candidates;
}

function mapEntryToDeclaration(
  entry: OptionEntry,
  propertyMap: Map<string, InspectorProperty>,
  writeTarget: SetPropertyWriteTarget
): StylesDeclarationDraft | null {
  if (entry.kind === "unknown") {
    return null;
  }
  const normalizedKey = normalizeOptionKey(entry.key);
  const propertyId = propertyIdForOptionEntry(normalizedKey, new Set(propertyMap.keys()));
  if (!propertyId) {
    return null;
  }
  const template = propertyMap.get(propertyId);
  if (!template) {
    return null;
  }
  const property = overrideInspectorPropertyValue(template, entryValueForProperty(entry, template), writeTarget);
  const cssValue = formatCssValue(property);
  return {
    id: `decl:${propertyId}:${entry.span.from}`,
    propertyId,
    label: template.label,
    cssValue,
    property,
    sourceText: entry.raw.trim(),
    writeTarget,
    priorityKey: propertyId,
    defaultLike: false,
    readOnlyReason: writeTarget.reason
  };
}

function mapContributionToDeclaration(
  key: keyof ResolvedStyle,
  style: ResolvedStyle,
  propertyMap: Map<string, InspectorProperty>,
  writeTarget: SetPropertyWriteTarget,
  entry: StyleChainEntry
): StylesDeclarationDraft | null {
  const propertyId = propertyIdForStyleContribution(key, new Set(propertyMap.keys()));
  if (!propertyId) {
    return null;
  }
  const template = propertyMap.get(propertyId);
  if (!template) {
    return null;
  }
  const property = overrideInspectorPropertyValue(template, styleValueForProperty(template, style), { ...writeTarget, writable: false });
  return {
    id: `default:${propertyId}:${entry.kind}:${entry.sourceRef?.sourceKind ?? "unknown"}`,
    propertyId,
    label: template.label,
    cssValue: formatCssValue(property),
    property,
    sourceText: `${template.label}: ${formatCssValue(property)}`,
    writeTarget: { ...writeTarget, writable: false },
    priorityKey: propertyId,
    defaultLike: true,
    readOnlyReason: writeTarget.reason ?? "Defaults are shown for reference only."
  };
}

function buildUnsupportedDeclaration(
  entry: OptionEntry,
  writeTarget: SetPropertyWriteTarget,
  styleEntry: StyleChainEntry
): StylesDeclarationDraft {
  const raw = entry.raw.trim();
  return {
    id: `unsupported:${entry.span.from}`,
    propertyId: null,
    label: raw.split("=")[0]?.trim() || raw,
    cssValue: raw.includes("=") ? raw.slice(raw.indexOf("=") + 1).trim() : "",
    property: null,
    sourceText: raw,
    writeTarget,
    priorityKey: `unsupported:${raw}`,
    defaultLike: styleEntry.sourceRef?.sourceKind === "command-default" || styleEntry.sourceRef?.sourceKind === "builtin-style"
  };
}

function applyDeclarationStatuses(sections: StylesCascadeSection[]): void {
  const seen = new Set<string>();
  for (const section of sections) {
    section.declarations = section.declarations.map((declaration) => {
      if (declaration.status === "disabled") {
        return declaration;
      }
      if (declaration.propertyId == null) {
        return { ...declaration, status: declaration.writeTargets.length > 0 ? "active" : "unsupported" };
      }
      if (!seen.has(declaration.propertyId)) {
        seen.add(declaration.propertyId);
        return { ...declaration, status: "active" };
      }
      return {
        ...declaration,
        status: declaration.readOnlyReason ? "inactive-default" : "overridden"
      };
    });
  }
}

function buildAddPropertyTemplates(
  descriptor: InspectorDescriptor,
  element: SceneElement,
  source: string,
  snapshot: InspectorSnapshot
): Record<string, InspectorProperty> {
  const propertyMap = new Map(descriptor.sections.flatMap((section) => section.properties.map((property) => [property.id, property] as const)));
  const transformValues = resolveTransformInspectorValues(source, descriptor.writeTargetId, snapshot.parseOptions);
  const noopWrite: SetPropertyWriteTarget = { mode: "setProperty", elementId: descriptor.writeTargetId ?? "", level: "command", key: "", writable: true };
  const templates: InspectorProperty[] = [
    ...(descriptor.sections.flatMap((section) => section.properties)).filter((property) => isAddableProperty(property.id, property.kind)),
    {
      kind: "number",
      id: "xshift",
      label: "X shift",
      value: transformValues.xshift,
      step: 0.1,
      unit: "pt",
      write: { ...noopWrite, key: "xshift", transformContext: { key: "xshift", values: transformValues } }
    },
    {
      kind: "number",
      id: "yshift",
      label: "Y shift",
      value: transformValues.yshift,
      step: 0.1,
      unit: "pt",
      write: { ...noopWrite, key: "yshift", transformContext: { key: "yshift", values: transformValues } }
    },
    {
      kind: "number",
      id: "xscale",
      label: "X scale",
      value: transformValues.xscale,
      step: 0.1,
      write: { ...noopWrite, key: "xscale", transformContext: { key: "xscale", values: transformValues } }
    },
    {
      kind: "number",
      id: "yscale",
      label: "Y scale",
      value: transformValues.yscale,
      step: 0.1,
      write: { ...noopWrite, key: "yscale", transformContext: { key: "yscale", values: transformValues } }
    },
    {
      kind: "number",
      id: "rotate",
      label: "Rotate",
      value: transformValues.rotate,
      step: 1,
      unit: "deg",
      write: { ...noopWrite, key: "rotate", transformContext: { key: "rotate", values: transformValues } }
    },
    {
      kind: "lineWidth",
      id: "line-width",
      label: "Line width",
      value: element.style.lineWidth,
      min: 0.1,
      max: 6,
      step: 0.1,
      presetLabel: lineWidthPresetLabel(element.style.lineWidth),
      write: { ...noopWrite, key: "line width" }
    },
    {
      kind: "dashStyle",
      id: "dash-style",
      label: "Dash style",
      value: dashStylePresetFromStyle(element.style.dashArray, element.style.lineWidth),
      options: DASH_STYLE_OPTIONS,
      previewLineWidth: element.style.lineWidth,
      write: { ...noopWrite, key: "solid" }
    },
    {
      kind: "lineCap",
      id: "line-cap",
      label: "Line cap",
      value: lineCapPresetFromStyle(element.style.lineCap),
      options: LINE_CAP_OPTIONS,
      previewLineWidth: element.style.lineWidth,
      write: { ...noopWrite, key: "line cap" }
    },
    {
      kind: "lineJoin",
      id: "line-join",
      label: "Line join",
      value: lineJoinPresetFromStyle(element.style.lineJoin),
      options: LINE_JOIN_OPTIONS,
      previewLineWidth: element.style.lineWidth,
      write: { ...noopWrite, key: "line join" }
    },
    {
      kind: "fillMode",
      id: "fill-mode",
      label: "Mode",
      value: element.style.fillPattern ? "pattern" : element.style.shadeEnabled ? "gradient" : "solid",
      options: FILL_MODE_OPTIONS,
      context: {
        fillColor: colorPropertyValue(propertyMap.get("fill-color")),
        patternColor: colorPropertyValue(propertyMap.get("fill-pattern-color")) ?? element.style.patternColor,
        shading: fillShadingPresetFromStyleName(element.style.shading),
        pattern: fillPatternPresetFromResolvedPattern(element.style.fillPattern)
      },
      write: { ...noopWrite, key: "fill" }
    },
    {
      kind: "fillShading",
      id: "fill-shading",
      label: "Shading",
      value: fillShadingPresetFromStyleName(element.style.shading),
      options: FILL_SHADING_OPTIONS,
      write: { ...noopWrite, key: "shading" }
    },
    {
      kind: "fillPattern",
      id: "fill-pattern",
      label: "Pattern",
      value: fillPatternPresetFromResolvedPattern(element.style.fillPattern),
      options: FILL_PATTERN_OPTIONS,
      write: { ...noopWrite, key: "pattern" }
    },
    {
      kind: "roundedCorners",
      id: "rounded-corners",
      label: "Rounded corners",
      enabled: element.style.roundedCorners != null,
      disableRequiresSharpCorners: true,
      radius: element.style.roundedCorners ?? 4,
      defaultRadius: 4,
      min: 0,
      max: 24,
      step: 0.1,
      write: { ...noopWrite, key: "rounded corners" }
    },
    {
      kind: "nodeShape",
      id: "node-shape",
      label: "Shape",
      value: "rectangle",
      options: NODE_SHAPE_OPTIONS,
      write: { ...noopWrite, key: "shape" }
    },
    {
      kind: "length",
      id: "node-inner-sep",
      label: "Inner sep",
      value: NODE_INNER_SEP_DEFAULT,
      step: 0.1,
      unit: "pt",
      write: { ...noopWrite, key: "inner sep" }
    }
  ];

  const unique = new Map<string, InspectorProperty>();
  for (const property of templates) {
    if (!isAddableProperty(property.id, property.kind)) {
      continue;
    }
    unique.set(property.id, property);
  }
  return Object.fromEntries(unique.entries());
}

function resolveSectionWriteTarget(
  source: string,
  entry: StyleChainEntry,
  targetId: string | null,
  parseOptions: InspectorSnapshot["parseOptions"] = {},
  writeTargetCache: Map<string, PropertyTargetResolution>
): StylesSectionWriteTarget {
  const sourceRef = entry.sourceRef;
  if (!sourceRef) {
    return {
      writeTarget: { mode: "setProperty", elementId: "", level: mapStyleLevel(entry), key: "", writable: false, reason: "No editable source information is available for this style layer." },
      readOnly: true,
      readOnlyReason: "No editable source information is available for this style layer."
    };
  }

  const isForeachTemplateTarget = targetId?.includes(FOREACH_TEMPLATE_TARGET_PREFIX) ?? false;
  if (
    sourceRef.sourceKind === "command-default"
    || sourceRef.sourceKind === "builtin-style"
    || sourceRef.sourceKind === "global-default"
  ) {
    return {
      writeTarget: { mode: "setProperty", elementId: "", level: mapStyleLevel(entry), key: "", writable: false, reason: "This default style layer is shown for reference only." },
      readOnly: true,
      readOnlyReason: "This default style layer is shown for reference only."
    };
  }

  if (sourceRef.identityRef && targetId != null && !isForeachTemplateTarget) {
    return {
      writeTarget: {
        mode: "setProperty",
        elementId: targetId,
        level: mapStyleLevel(entry),
        key: "",
        writable: false,
        reason: "Generated style layers cannot be edited directly."
      },
      readOnly: true,
      readOnlyReason: "Generated style layers cannot be edited directly."
    };
  }

  if (targetId == null) {
    return {
      writeTarget: { mode: "setProperty", elementId: "", level: mapStyleLevel(entry), key: "", writable: false, reason: "No editable source information is available for this style layer." },
      readOnly: true,
      readOnlyReason: "No editable source information is available for this style layer."
    };
  }

  const resolution =
    writeTargetCache.get(targetId) ?? resolvePropertyTarget(source, targetId, parseOptions);
  writeTargetCache.set(targetId, resolution);
  if (resolution.kind === "not-found") {
    return {
      writeTarget: { mode: "setProperty", elementId: targetId, level: mapStyleLevel(entry), key: "", writable: false, reason: resolution.reason },
      readOnly: true,
      readOnlyReason: resolution.reason
    };
  }

  return {
    writeTarget: { mode: "setProperty", elementId: targetId, level: mapStyleLevel(entry), key: "", writable: true },
    readOnly: false
  };
}

function sourceTargetIdForEntry(entry: StyleChainEntry, sourceRef: StyleSourceRef): string {
  if (sourceRef.identityRef && sourceRef.sourceId.startsWith("foreach:")) {
    return sourceRef.sourceId;
  }
  if (entry.kind === "command" || sourceRef.sourceKind === "path-statement" || sourceRef.sourceKind === "scope-statement") {
    return sourceRef.sourceId;
  }
  if (sourceRef.sourceId === TIKZPICTURE_GLOBAL_TARGET_ID) {
    return TIKZPICTURE_GLOBAL_TARGET_ID;
  }
  if (sourceRef.sourceSpan) {
    return makeStyleSourceTargetId(sourceRef.sourceSpan);
  }
  return sourceRef.sourceId;
}

function mapStyleLevel(entry: StyleChainEntry): StyleLevel {
  switch (entry.kind) {
    case "command":
      return "command";
    case "scope":
      return "scope";
    case "named-style":
      return "named-style";
    case "global":
    case "every-node":
    case "every-shape":
    default:
      return "preamble";
  }
}

function normalizeSectionKind(entry: StyleChainEntry): StylesCascadeSection["kind"] {
  if (
    entry.sourceRef?.sourceKind === "command-default"
    || entry.sourceRef?.sourceKind === "builtin-style"
    || entry.sourceRef?.sourceKind === "global-default"
  ) {
    return "default";
  }
  switch (entry.kind) {
    case "command":
      return "command";
    case "scope":
      return "scope";
    case "named-style":
      return "named-style";
    case "global":
    case "every-node":
    case "every-shape":
    default:
      return "global";
  }
}

function formatSectionTitle(entry: StyleChainEntry): string {
  if (entry.sourceRef?.sourceKind === "command-default" || entry.sourceRef?.sourceKind === "global-default") {
    return "TikZ defaults";
  }
  if (entry.sourceRef?.sourceKind === "builtin-style") {
    return entry.sourceRef.label ?? "Built-in style";
  }
  switch (entry.kind) {
    case "command":
      return entry.sourceRef?.label ?? "Command";
    case "scope":
      return "scope";
    case "named-style":
      return entry.styleName;
    case "every-node":
      return "every node";
    case "every-shape":
      return `every ${entry.shape} node`;
    case "global":
    default:
      return entry.sourceRef?.label ?? "global";
  }
}

function isStyleDefinitionEntry(entry: OptionEntry): boolean {
  if (entry.kind !== "kv") {
    return false;
  }
  const normalized = entry.key.trim().toLowerCase();
  if (
    normalized.endsWith("/.style")
    || normalized.endsWith("/.append style")
    || normalized.endsWith("/.prefix style")
  ) {
    return true;
  }
  return parseCustomStyleDefinition(entry.key) != null;
}

function formatSectionSubtitle(entry: StyleChainEntry): string | null {
  if (entry.kind === "named-style") {
    return `.${entry.styleName}`;
  }
  if (entry.kind === "every-shape") {
    return entry.shape;
  }
  return null;
}

function formatSourceLocation(source: string, sourceRef: StyleSourceRef | undefined): string | null {
  const span = sourceRef?.sourceSpan;
  if (!span) {
    return null;
  }
  let line = 1;
  for (let index = 0; index < span.from && index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return `line ${line}`;
}

function entryValueForProperty(entry: OptionEntry, property: InspectorProperty): unknown {
  if (entry.kind === "unknown") {
    return undefined;
  }
  const rawValue = entry.kind === "flag" ? entry.key : entry.valueRaw;
  const normalized = stripEnclosingBraces(rawValue).trim();
  switch (property.kind) {
    case "color":
      return normalized;
    case "number": {
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : property.value;
    }
    case "length":
      return parseLength(normalized, property.unit) ?? property.value;
    case "lineWidth":
      return parseLength(normalized, "pt") ?? property.value;
    case "dashStyle": {
      const key = entry.kind === "flag" ? normalizeOptionKey(entry.key) : normalizeOptionKey(entry.key);
      return ["solid", "dashed", "densely dashed", "loosely dashed", "dotted", "densely dotted", "loosely dotted"].includes(key)
        ? key
        : property.value;
    }
    case "lineCap":
      return normalized;
    case "lineJoin":
      return normalized;
    case "fillMode": {
      const key = normalizeOptionKey(entry.key);
      if (key === "pattern") return normalized.toLowerCase() === "none" ? "solid" : "pattern";
      if (key === "shade" || key === "shading" || key.endsWith("color")) return "gradient";
      return property.value;
    }
    case "fillShading":
      return fillShadingPresetFromStyleName(normalized);
    case "fillPattern":
      return normalized.toLowerCase() === "none" ? "custom" : normalized;
    case "roundedCorners": {
      const radius = parseLength(normalized, "pt") ?? property.radius;
      return { enabled: normalized.toLowerCase() !== "false" && normalized.toLowerCase() !== "none", radius };
    }
    case "nodeShape":
      return normalized.toLowerCase();
    case "arrowTip":
    case "boolean":
    case "enum":
    case "fillPatternOption":
    case "nodeFont":
    case "nodeTextAlign":
    case "optionalLength":
    case "pathMorphingDecoration":
    case "shadowPreset":
    case "slider":
    case "text":
    default:
      return property;
  }
}

function styleValueForProperty(property: InspectorProperty, style: ResolvedStyle): unknown {
  switch (property.id) {
    case "stroke-color":
      return style.stroke;
    case "fill-color":
      return style.fill;
    case "node-text-color":
    case "adornment-text-color":
      return style.textColor;
    case "line-width":
      return style.lineWidth;
    case "dash-style":
      return dashStylePresetFromStyle(style.dashArray, style.lineWidth);
    case "line-cap":
      return style.lineCap;
    case "line-join":
      return style.lineJoin;
    case "fill-mode":
      return style.fillPattern ? "pattern" : style.shadeEnabled ? "gradient" : "solid";
    case "fill-shading":
      return fillShadingPresetFromStyleName(style.shading);
    case "fill-pattern":
      return fillPatternPresetFromResolvedPattern(style.fillPattern);
    case "fill-pattern-color":
      return style.patternColor;
    case "fill-axis-top-color":
      return style.axisTopColor;
    case "fill-axis-bottom-color":
      return style.axisBottomColor;
    case "fill-radial-inner-color":
      return style.radialInnerColor;
    case "fill-radial-outer-color":
      return style.radialOuterColor;
    case "fill-ball-color":
      return style.ballColor;
    case "rounded-corners":
      return { enabled: style.roundedCorners != null, radius: style.roundedCorners ?? 4 };
    default:
      return null;
  }
}

function overrideInspectorPropertyValue(
  property: InspectorProperty,
  nextValue: unknown,
  writeTarget: SetPropertyWriteTarget
): InspectorProperty {
  switch (property.kind) {
    case "number":
      return { ...property, value: typeof nextValue === "number" ? nextValue : property.value, write: property.write ? { ...writeTarget, key: property.write.key, transformContext: property.write.transformContext } : undefined };
    case "length":
      return { ...property, value: typeof nextValue === "number" ? nextValue : property.value, write: { ...writeTarget, key: property.write.key } };
    case "color":
      return {
        ...property,
        value: typeof nextValue === "string" || nextValue == null ? (nextValue ?? null) : property.value,
        syntaxValue: typeof nextValue === "string" || nextValue == null ? (nextValue ?? null) : property.syntaxValue,
        write: { ...writeTarget, key: property.write.key }
      };
    case "lineWidth":
      return { ...property, value: typeof nextValue === "number" ? nextValue : property.value, presetLabel: lineWidthPresetLabel(typeof nextValue === "number" ? nextValue : property.value), write: { ...writeTarget, key: property.write.key } };
    case "dashStyle":
      return { ...property, value: coerceInspectorStringValue(nextValue, property.value), write: { ...writeTarget, key: property.write.key } };
    case "lineCap":
      return { ...property, value: coerceInspectorStringValue(nextValue, property.value), write: { ...writeTarget, key: property.write.key } };
    case "lineJoin":
      return { ...property, value: coerceInspectorStringValue(nextValue, property.value), write: { ...writeTarget, key: property.write.key } };
    case "fillMode":
      return { ...property, value: coerceInspectorStringValue(nextValue, property.value), write: { ...writeTarget, key: property.write.key } };
    case "fillShading":
      return { ...property, value: coerceInspectorStringValue(nextValue, property.value), write: { ...writeTarget, key: property.write.key } };
    case "fillPattern":
      return { ...property, value: coerceInspectorStringValue(nextValue, property.value), write: { ...writeTarget, key: property.write.key } };
    case "roundedCorners": {
      const next = (nextValue && typeof nextValue === "object") ? nextValue as { enabled?: boolean; radius?: number } : null;
      return {
        ...property,
        enabled: next?.enabled ?? property.enabled,
        radius: next?.radius ?? property.radius,
        write: { ...writeTarget, key: property.write.key }
      };
    }
    case "nodeShape":
      return { ...property, value: coerceInspectorStringValue(nextValue, property.value), write: { ...writeTarget, key: property.write.key } };
    case "arrowTip":
    case "boolean":
    case "enum":
    case "fillPatternOption":
    case "nodeFont":
    case "nodeTextAlign":
    case "optionalLength":
    case "pathMorphingDecoration":
    case "shadowPreset":
    case "slider":
    case "text":
    default:
      return property;
  }
}

function coerceInspectorStringValue<T extends string>(nextValue: unknown, fallback: T): T {
  return typeof nextValue === "string" ? nextValue as T : fallback;
}

function formatCssValue(property: InspectorProperty | null): string {
  if (!property) {
    return "";
  }
  switch (property.kind) {
    case "number":
      return `${formatNumber(property.value)}${property.unit ?? ""}`;
    case "length":
      return `${formatNumber(property.value)}${property.unit}`;
    case "color":
      return property.syntaxValue ?? property.value ?? "none";
    case "lineWidth":
      return `${formatNumber(property.value)}pt`;
    case "dashStyle":
    case "lineCap":
    case "lineJoin":
    case "fillMode":
    case "fillShading":
    case "fillPattern":
    case "nodeShape":
      return String(property.value);
    case "roundedCorners":
      return property.enabled ? `${formatNumber(property.radius)}pt` : "false";
    case "arrowTip":
    case "boolean":
    case "enum":
    case "fillPatternOption":
    case "nodeFont":
    case "nodeTextAlign":
    case "optionalLength":
    case "pathMorphingDecoration":
    case "shadowPreset":
    case "slider":
    case "text":
    default:
      return property.label;
  }
}

function colorPropertyValue(property: InspectorProperty | undefined): string | null {
  return property?.kind === "color" ? property.syntaxValue ?? property.value : null;
}

export function planStylesRemovePropertyActions(
  writeTargets: readonly SetPropertyWriteTarget[],
  key: string
): EditAction[] {
  return planStylesSetPropertyActions(writeTargets, { key, value: "" });
}

export function planStylesRenamePropertyActions(
  writeTargets: readonly SetPropertyWriteTarget[],
  oldKey: string,
  newKey: string,
  currentValue: string
): EditAction[] {
  if (oldKey === newKey) return [];
  const nextValue = currentValue.trim().length > 0 ? currentValue : "true";
  const removeActions = planStylesSetPropertyActions(writeTargets, { key: oldKey, value: "" });
  const addActions = planStylesSetPropertyActions(writeTargets, { key: newKey, value: nextValue });
  return [...removeActions, ...addActions];
}
