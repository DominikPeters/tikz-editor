import type { PathItem, PathStatement, Span, Statement } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type {
  ExpansionSourceMap,
  ForeachOriginFrame as ExpansionForeachOriginFrame,
  ForeachStatementAttribution
} from "../foreach/types.js";
import type { MacroOriginFrame } from "../macros/index.js";
import type { StyleChainEntry } from "./style-chain.js";
import type { EditHandle, PicOriginFrame, SceneElement } from "./types.js";

export function mapExpansionSpan(sourceMap: ExpansionSourceMap, span: Span): Span {
  return sourceMap.mapSpan(span) ?? sourceMap.sourceSpan;
}

function mapDiagnosticExpansionSpan(
  sourceMap: ExpansionSourceMap,
  diagnostic: Diagnostic,
  ownerSpan?: Span,
  mappedElementSpan?: Span
): Span {
  if (shouldUseExpansionSourceSpan(diagnostic)) {
    return mappedElementSpan
      ?? (ownerSpan ? sourceMap.mapSpan(ownerSpan) ?? sourceMap.sourceSpan : sourceMap.sourceSpan);
  }
  return mapExpansionSpan(sourceMap, diagnostic.span);
}

function shouldUseExpansionSourceSpan(diagnostic: Diagnostic): boolean {
  return diagnostic.code?.startsWith("unsupported-option-key:") === true
    || diagnostic.code?.startsWith("unsupported-option-flag:") === true;
}

export function remapDiagnostics(
  diagnostics: Diagnostic[],
  fromIndex: number,
  sourceMap: ExpansionSourceMap | undefined,
  args: {
    statement?: Statement;
    elements?: readonly SceneElement[];
    pathItemSourceMaps?: WeakMap<PathItem, ExpansionSourceMap>;
  } = {}
): void {
  const pathItemLookup = args.statement?.kind === "Path" ? buildPathItemLookup(args.statement) : undefined;
  if (!sourceMap && !pathItemLookup) {
    return;
  }
  for (let index = fromIndex; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index];
    if (!diagnostic) {
      continue;
    }
    const itemSourceMap =
      pathItemLookup && args.pathItemSourceMaps
        ? resolvePathItemForSourceRef("", diagnostic.span, pathItemLookup, { allowSpanContainment: true })
        : undefined;
    const effectiveSourceMap = composePathItemSourceMap(
      itemSourceMap && args.pathItemSourceMaps ? args.pathItemSourceMaps.get(itemSourceMap) : undefined,
      sourceMap
    );
    if (!effectiveSourceMap) {
      continue;
    }
    const mappedElementSpan = shouldUseExpansionSourceSpan(diagnostic)
      ? findMappedElementDiagnosticSpan(args.elements, diagnostic)
      : undefined;
    diagnostics[index] = {
      ...diagnostic,
      span: mapDiagnosticExpansionSpan(
        effectiveSourceMap,
        diagnostic,
        itemSourceMap?.span ?? args.statement?.span,
        mappedElementSpan
      )
    };
  }
}

function findMappedElementDiagnosticSpan(
  elements: readonly SceneElement[] | undefined,
  diagnostic: Diagnostic
): Span | undefined {
  if (!elements || elements.length === 0) {
    return undefined;
  }
  const exactOwner = elements.find((element) =>
    element.identityRef?.sourceSpan && spanContains(element.identityRef.sourceSpan, diagnostic.span)
  );
  if (exactOwner) {
    return exactOwner.sourceRef.sourceSpan;
  }
  const overlappingOwner = elements.find((element) =>
    element.identityRef?.sourceSpan && spansOverlap(element.identityRef.sourceSpan, diagnostic.span)
  );
  return overlappingOwner?.sourceRef.sourceSpan ?? elements[0]?.sourceRef.sourceSpan;
}

export function finalizeExpandedStatementElements(args: {
  statement: Statement;
  elements: SceneElement[];
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>;
  statementSourceMap: ExpansionSourceMap | undefined;
  pathItemForeachStack: WeakMap<PathItem, ExpansionForeachOriginFrame[]>;
  pathItemSourceMaps: WeakMap<PathItem, ExpansionSourceMap>;
  statementMacroAttribution: WeakMap<Statement, MacroOriginFrame[]>;
  templateLocalIdByExpandedId: ReadonlyMap<string, string>;
}): SceneElement[] {
  const {
    statement,
    elements,
    statementAttribution,
    statementSourceMap,
    pathItemForeachStack,
    pathItemSourceMaps,
    statementMacroAttribution,
    templateLocalIdByExpandedId
  } = args;
  if (elements.length === 0) {
    return elements;
  }

  const attribution = statementAttribution.get(statement);
  const shouldOverrideSource =
    attribution != null &&
    (attribution.sourceId !== statement.id || attribution.foreachStack.length > 0);
  const statementMacroStack = statementMacroAttribution.get(statement);
  const pathItemsById = statement.kind === "Path" ? buildPathItemLookup(statement) : undefined;
  const pathFallbackStack =
    statement.kind === "Path" ? resolveFirstPathItemForeachStack(statement.items, pathItemForeachStack) : undefined;

  return elements.map((element) => {
    const itemStack =
      statement.kind === "Path" && pathItemsById
        ? resolvePathItemForeachStackForElement(element, statement, pathItemsById.byId, pathItemForeachStack)
        : undefined;
    const pathItem =
      statement.kind === "Path" && pathItemsById
        ? resolvePathItemForElement(element, statement, pathItemsById)
        : undefined;
    const itemSourceMap = pathItem ? pathItemSourceMaps.get(pathItem) : undefined;
    const effectiveSourceMap = composePathItemSourceMap(itemSourceMap, statementSourceMap);
    const fallbackStack =
      (itemStack && itemStack.length > 0
        ? itemStack
        : pathFallbackStack && pathFallbackStack.length > 0
          ? pathFallbackStack
          : attribution?.foreachStack);
    const foreachStack =
      fallbackStack && fallbackStack.length > 0
        ? cloneForeachStack(fallbackStack)
        : element.origin?.foreachStack
          ? cloneForeachStack(element.origin.foreachStack)
          : [];
    const macroStack =
      statementMacroStack && statementMacroStack.length > 0
        ? cloneMacroOriginStack(statementMacroStack)
        : element.origin?.macroStack
          ? cloneMacroOriginStack(element.origin.macroStack)
          : undefined;
    const foreachTemplateLocalTargetId =
      attribution != null && attribution.sourceId !== statement.id
        ? templateLocalIdByExpandedId.get(element.sourceRef.sourceId) ?? element.sourceRef.sourceId
        : element.origin?.foreachTemplateLocalTargetId;
    const picStack = element.origin?.picStack ? clonePicStack(element.origin.picStack) : undefined;
    const picTemplateLocalTargetId = element.origin?.picTemplateLocalTargetId;
    const nextOrigin =
      foreachStack.length > 0
      || foreachTemplateLocalTargetId != null
      || picTemplateLocalTargetId != null
      || (picStack != null && picStack.length > 0)
      || (macroStack != null && macroStack.length > 0)
        ? {
            foreachStack,
            foreachTemplateLocalTargetId,
            picStack,
            picTemplateLocalTargetId,
            macroStack
          }
        : undefined;

    const identityRef = effectiveSourceMap
      ? {
          sourceId: itemSourceMap && pathItem ? pathItem.id : element.sourceRef.sourceId,
          sourceSpan: { ...element.sourceRef.sourceSpan },
          sourceKind: "expanded-element"
        }
      : element.identityRef;
    const nextSourceId = itemSourceMap && !statementSourceMap
      ? element.sourceRef.sourceId
      : shouldOverrideSource
        ? attribution.sourceId
        : element.sourceRef.sourceId;
    const nextSourceSpan = effectiveSourceMap
      ? mapExpansionSpan(effectiveSourceMap, element.sourceRef.sourceSpan)
      : shouldOverrideSource
        ? attribution.sourceSpan
        : element.sourceRef.sourceSpan;
    return {
      ...element,
      sourceRef: {
        ...element.sourceRef,
        sourceId: nextSourceId,
        sourceSpan: nextSourceSpan
      },
      identityRef,
      styleChain: remapStyleChainSourceRefs(element.styleChain, effectiveSourceMap),
      origin: nextOrigin
    };
  });
}

export function finalizeExpandedStatementHandles(args: {
  statement: Statement;
  handles: EditHandle[];
  startIndex: number;
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>;
  statementSourceMap: ExpansionSourceMap | undefined;
  pathItemSourceMaps: WeakMap<PathItem, ExpansionSourceMap>;
  source: string;
}): void {
  const { statement, handles, startIndex, statementAttribution, statementSourceMap, pathItemSourceMaps, source } = args;
  const attribution = statementAttribution.get(statement);
  const shouldOverrideSource =
    attribution != null &&
    (attribution.sourceId !== statement.id || attribution.foreachStack.length > 0);
  const pathItemsById = statement.kind === "Path" ? buildPathItemLookup(statement) : undefined;
  if (!shouldOverrideSource && !pathItemsById) {
    return;
  }

  for (let index = startIndex; index < handles.length; index += 1) {
    const handle = handles[index];
    if (!handle) {
      continue;
    }
    const pathItem = pathItemsById ? resolvePathItemForSourceRef(handle.sourceRef.sourceId, handle.sourceRef.sourceSpan, pathItemsById) : undefined;
    const itemSourceMap = pathItem ? pathItemSourceMaps.get(pathItem) : undefined;
    const effectiveSourceMap = composePathItemSourceMap(itemSourceMap, statementSourceMap);
    if (!effectiveSourceMap && (!shouldOverrideSource || !attribution)) {
      continue;
    }
    const mappedSpan = effectiveSourceMap ? mapExpansionSpan(effectiveSourceMap, handle.sourceRef.sourceSpan) : handle.sourceRef.sourceSpan;
    handles[index] = {
      ...handle,
      identityRef: effectiveSourceMap
        ? {
            sourceId: itemSourceMap && pathItem ? pathItem.id : handle.sourceRef.sourceId,
            sourceSpan: { ...handle.sourceRef.sourceSpan },
            sourceKind: "expanded-handle"
          }
        : handle.identityRef,
      sourceText: effectiveSourceMap
        ? source.slice(mappedSpan.from, mappedSpan.to)
        : handle.sourceText,
      sourceRef: {
        ...handle.sourceRef,
        sourceId: (itemSourceMap && !statementSourceMap) || !attribution ? handle.sourceRef.sourceId : attribution.sourceId,
        sourceSpan: mappedSpan
      }
    };
  }
}

function composePathItemSourceMap(
  itemSourceMap: ExpansionSourceMap | undefined,
  statementSourceMap: ExpansionSourceMap | undefined
): ExpansionSourceMap | undefined {
  if (!itemSourceMap) {
    return statementSourceMap;
  }
  if (!statementSourceMap) {
    return itemSourceMap;
  }
  return {
    sourceId: statementSourceMap.sourceId,
    sourceSpan: statementSourceMap.sourceSpan,
    sourceKind: itemSourceMap.sourceKind,
    mapSpan: (span) => {
      const itemMapped = itemSourceMap.mapSpan(span);
      return itemMapped ? statementSourceMap.mapSpan(itemMapped) : null;
    }
  };
}

function remapStyleChainSourceRefs(
  styleChain: StyleChainEntry[],
  sourceMap: ExpansionSourceMap | undefined
): StyleChainEntry[] {
  if (!sourceMap || styleChain.length === 0) {
    return styleChain;
  }
  return styleChain.map((entry) => {
    if (!entry.sourceRef?.sourceSpan) {
      return entry;
    }
    return {
      ...entry,
      sourceRef: {
        ...entry.sourceRef,
        sourceId: sourceMap.sourceId,
        sourceSpan: mapExpansionSpan(sourceMap, entry.sourceRef.sourceSpan),
        identityRef: {
          sourceId: entry.sourceRef.sourceId,
          sourceSpan: { ...entry.sourceRef.sourceSpan },
          sourceKind: entry.sourceRef.sourceKind
        }
      }
    };
  });
}

type PathItemLookup = {
  byId: Map<string, PathItem>;
  items: PathItem[];
};

function buildPathItemLookup(statement: PathStatement): PathItemLookup {
  const lookup: PathItemLookup = {
    byId: new Map<string, PathItem>(),
    items: []
  };
  collectPathItemsById(statement.items, lookup);
  return lookup;
}

function resolvePathItemForElement(
  element: SceneElement,
  statement: PathStatement,
  lookup: PathItemLookup
): PathItem | undefined {
  const itemPayload = extractElementItemPayload(element.id, statement.id);
  if (itemPayload) {
    const matched = resolvePathItemByPayload(itemPayload, lookup.byId);
    if (matched) {
      return matched;
    }
  }
  return resolvePathItemForSourceRef(element.sourceRef.sourceId, element.sourceRef.sourceSpan, lookup);
}

function resolvePathItemForSourceRef(
  sourceId: string,
  sourceSpan: Span,
  lookup: PathItemLookup,
  options: { allowSpanContainment?: boolean } = {}
): PathItem | undefined {
  const bySource = lookup.byId.get(sourceId);
  if (bySource) {
    return bySource;
  }
  return lookup.items.find((item) => spansEqual(item.span, sourceSpan))
    ?? (options.allowSpanContainment ? findSmallestContainingItem(sourceSpan, lookup.items) : undefined);
}

function findSmallestContainingItem(sourceSpan: Span, items: PathItem[]): PathItem | undefined {
  let best: PathItem | undefined;
  for (const item of items) {
    if (item.span.from > sourceSpan.from || item.span.to < sourceSpan.to) {
      continue;
    }
    if (!best || (item.span.to - item.span.from) < (best.span.to - best.span.from)) {
      best = item;
    }
  }
  return best;
}

function resolvePathItemForeachStackForElement(
  element: SceneElement,
  statement: PathStatement,
  pathItemsById: Map<string, PathItem>,
  pathItemForeachStack: WeakMap<PathItem, ExpansionForeachOriginFrame[]>
): ExpansionForeachOriginFrame[] | undefined {
  const itemPayload = extractElementItemPayload(element.id, statement.id);
  if (!itemPayload) {
    return undefined;
  }

  const item = resolvePathItemByPayload(itemPayload, pathItemsById);
  return item ? pathItemForeachStack.get(item) : undefined;
}

function resolvePathItemByPayload(
  itemPayload: string,
  pathItemsById: Map<string, PathItem>
): PathItem | undefined {
  let matchedItemId: string | undefined;
  for (const itemId of pathItemsById.keys()) {
    if (itemPayload === itemId || itemPayload.startsWith(`${itemId}:`)) {
      if (!matchedItemId || itemId.length > matchedItemId.length) {
        matchedItemId = itemId;
      }
    }
  }

  if (!matchedItemId) {
    return undefined;
  }
  return pathItemsById.get(matchedItemId);
}

function resolveFirstPathItemForeachStack(
  items: PathItem[],
  pathItemForeachStack: WeakMap<PathItem, ExpansionForeachOriginFrame[]>
): ExpansionForeachOriginFrame[] | undefined {
  for (const item of items) {
    const stack = pathItemForeachStack.get(item);
    if (stack && stack.length > 0) {
      return stack;
    }
    if (item.kind === "ChildOperation") {
      const nested = resolveFirstPathItemForeachStack(item.body, pathItemForeachStack);
      if (nested && nested.length > 0) {
        return nested;
      }
    }
  }
  return undefined;
}

function collectPathItemsById(items: PathItem[], lookup: PathItemLookup): void {
  for (const item of items) {
    lookup.byId.set(item.id, item);
    lookup.items.push(item);
    if (item.kind === "ChildOperation") {
      collectPathItemsById(item.body, lookup);
    }
  }
}

function spansEqual(left: Span, right: Span): boolean {
  return left.from === right.from && left.to === right.to;
}

function spanContains(outer: Span, inner: Span): boolean {
  return outer.from <= inner.from && outer.to >= inner.to;
}

function spansOverlap(left: Span, right: Span): boolean {
  return left.from < right.to && right.from < left.to;
}

function extractElementItemPayload(elementId: string, sourceId: string): string | undefined {
  const prefixes = [
    "scene-path:",
    "scene-rectangle:",
    "scene-node-box:",
    "scene-node-ellipse:",
    "scene-grid-x:",
    "scene-grid-y:",
    "scene-text:"
  ];

  for (const prefix of prefixes) {
    if (!elementId.startsWith(prefix)) {
      continue;
    }
    const withoutPrefix = elementId.slice(prefix.length);
    if (!withoutPrefix.startsWith(`${sourceId}:`)) {
      return undefined;
    }
    return withoutPrefix.slice(sourceId.length + 1);
  }

  return undefined;
}

function cloneForeachStack(stack: ExpansionForeachOriginFrame[]): ExpansionForeachOriginFrame[] {
  return stack.map((frame) => ({
    loopId: frame.loopId,
    loopSpan: frame.loopSpan,
    iterationIndex: frame.iterationIndex,
    bindings: { ...frame.bindings }
  }));
}

function cloneMacroOriginStack(stack: MacroOriginFrame[]): MacroOriginFrame[] {
  return stack.map((origin) => ({
    macroName: origin.macroName,
    definitionId: origin.definitionId,
    definitionSpan: {
      from: origin.definitionSpan.from,
      to: origin.definitionSpan.to
    },
    commandRaw: origin.commandRaw
  }));
}

function clonePicStack(stack: PicOriginFrame[]): PicOriginFrame[] {
  return stack.map((origin) => ({
    invocationId: origin.invocationId,
    invocationSpan: {
      from: origin.invocationSpan.from,
      to: origin.invocationSpan.to
    },
    picType: origin.picType,
    codeSpan: origin.codeSpan
      ? {
          from: origin.codeSpan.from,
          to: origin.codeSpan.to
        }
      : undefined,
    codeSource: origin.codeSource,
    parameterized: origin.parameterized
  }));
}
