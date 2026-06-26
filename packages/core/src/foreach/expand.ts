import {
  colorletStatementId,
  defineColorStatementId,
  childForeachClauseId,
  childOperationItemId,
  coordinateItemId,
  coordinateOperationItemId,
  decorateOperationItemId,
  edgeOperationItemId,
  edgeFromParentOperationItemId,
  foreachStatementId,
  letOperationItemId,
  macroAliasStatementId,
  macroCommandDefinitionStatementId,
  macroDefinitionStatementId,
  pgfkeysStatementId,
  nodeForeachClauseId,
  nodeItemId,
  pathCommentItemId,
  pathForeachItemId,
  pathKeywordItemId,
  pathOptionItemId,
  picForeachClauseId,
  picOperationItemId,
  plotOperationItemId,
  pathStatementId,
  scopeStatementId,
  tikzLibraryStatementId,
  tikzSetStatementId,
  tikzStyleStatementId,
  svgOperationItemId,
  toOperationItemId,
  unknownPathItemId,
  unknownStatementId
} from "../ast/ids.js";
import type {
  ChildOperationItem,
  ForeachStatement,
  MacroAliasStatement,
  MacroCommandDefinitionStatement,
  MacroDefinitionStatement,
  NodeItem,
  PathForeachItem,
  PathItem,
  PathStatement,
  PicOperationItem,
  ScopeStatement,
  Span,
  Statement,
  TikzFigure,
  UnknownStatement
} from "../ast/types.js";
import { expandMacroBindings, isControlSequenceToken } from "../macros/expand.js";
import type { MacroBinding, MacroOriginFrame as MacroOriginFrameType } from "../macros/types.js";
import { buildForeachIterations } from "./options.js";
import {
  parsePathItemsFromFragmentWithSyntheticMapping,
  parseStatementsFromBody,
  parseStatementsFromBodyWithMapping
} from "./snippet-parse.js";
import { expandTexConditionals } from "../conditionals/expand.js";
import { substituteForeachBindingsWithMap } from "./substitute.js";
import type {
  ExpansionSourceMap,
  ForeachExpansionDiagnostic,
  ForeachExpansionResult,
  ForeachOriginFrame,
  ForeachStatementAttribution
} from "./types.js";

type ExpandContext = {
  maxForeachExpansions: number;
  expansionCount: number;
  macroExpansionCount: number;
  maxMacroStatementExpansions: number;
  diagnostics: ForeachExpansionDiagnostic[];
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>;
  statementSourceMaps: WeakMap<Statement, ExpansionSourceMap>;
  pathItemForeachStack: WeakMap<PathItem, ForeachOriginFrame[]>;
  pathItemSourceMaps: WeakMap<PathItem, ExpansionSourceMap>;
  statementMacroAttribution: WeakMap<Statement, MacroOriginFrameType[]>;
  macroBindings: Map<string, MacroBinding>;
  breakforeachWarned: Set<string>;
  templateLocalIdByExpandedId: Map<string, string>;
};

type TemplateSource = {
  sourceId: string;
  sourceSpan: { from: number; to: number };
};

export function expandForeachFigure(
  figure: TikzFigure,
  _source: string,
  maxForeachExpansions = 10_000
): ForeachExpansionResult {
  const macroBindings = collectMacroBindings(figure.body);

  const context: ExpandContext = {
    maxForeachExpansions,
    expansionCount: 0,
    macroExpansionCount: 0,
    maxMacroStatementExpansions: 1_000,
    diagnostics: [],
    statementAttribution: new WeakMap<Statement, ForeachStatementAttribution>(),
    statementSourceMaps: new WeakMap<Statement, ExpansionSourceMap>(),
    pathItemForeachStack: new WeakMap<PathItem, ForeachOriginFrame[]>(),
    pathItemSourceMaps: new WeakMap<PathItem, ExpansionSourceMap>(),
    statementMacroAttribution: new WeakMap<Statement, MacroOriginFrameType[]>(),
    macroBindings,
    breakforeachWarned: new Set<string>(),
    templateLocalIdByExpandedId: new Map<string, string>()
  };

  const expandedBody = expandStatements(figure.body, [], {}, context);
  reindexStatements(expandedBody, context.statementAttribution, context.templateLocalIdByExpandedId);

  return {
    figureBody: expandedBody,
    diagnostics: context.diagnostics,
    statementAttribution: context.statementAttribution,
    statementSourceMaps: context.statementSourceMaps,
    pathItemForeachStack: context.pathItemForeachStack,
    pathItemSourceMaps: context.pathItemSourceMaps,
    statementMacroAttribution: context.statementMacroAttribution,
    templateLocalIdByExpandedId: context.templateLocalIdByExpandedId
  };
}

function expandStatements(
  statements: Statement[],
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext,
  templateSource?: TemplateSource
): Statement[] {
  const expanded: Statement[] = [];
  for (const statement of statements) {
    expanded.push(...expandStatement(statement, stack, inheritedBindings, context, templateSource));
  }
  return expanded;
}

function expandStatement(
  statement: Statement,
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext,
  templateSource: TemplateSource | undefined
): Statement[] {
  if (statement.kind === "Foreach") {
    return expandForeachStatement(statement, stack, inheritedBindings, context);
  }

  if (statement.kind === "MacroDefinition") {
    collectMacroDefinition(statement, context.macroBindings);
    maybeRecordStatementAttribution(statement, stack, context, templateSource);
    return [statement];
  }

  if (statement.kind === "MacroCommandDefinition") {
    collectMacroCommandDefinition(statement, context.macroBindings);
    maybeRecordStatementAttribution(statement, stack, context, templateSource);
    return [statement];
  }

  if (statement.kind === "MacroAlias") {
    collectMacroAlias(statement, context.macroBindings);
    maybeRecordStatementAttribution(statement, stack, context, templateSource);
    return [statement];
  }

  if (statement.kind === "Scope") {
    const scope = statement;
    const expandedBody = expandStatements(
      scope.body,
      stack,
      inheritedBindings,
      context,
      templateSource
    );
    const expandedScope: ScopeStatement = {
      ...scope,
      body: expandedBody
    };
    maybeRecordStatementAttribution(expandedScope, stack, context, templateSource);
    return [expandedScope];
  }

  if (statement.kind === "Path") {
    const expandedPath = expandPathStatement(statement, stack, inheritedBindings, context);
    maybeRecordStatementAttribution(expandedPath, stack, context, templateSource);
    return [expandedPath];
  }

  if (statement.kind === "UnknownStatement") {
    const macroExpanded = tryExpandMacroStatement(statement, stack, context, templateSource);
    if (macroExpanded != null) {
      return macroExpanded;
    }
  }

  maybeRecordStatementAttribution(statement, stack, context, templateSource);
  return [statement];
}

function expandForeachStatement(
  statement: ForeachStatement,
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext
): Statement[] {
  const variablesRaw = statement.variablesRaw?.trim() ?? "";
  const listRaw = statement.listRaw?.trim() ?? "";
  if (variablesRaw.length === 0 || listRaw.length === 0) {
    context.diagnostics.push({
      severity: "warning",
      code: "invalid-foreach-header",
      message: "Could not parse foreach loop header.",
      span: statement.span
    });
    return [];
  }

  const { iterations, diagnostics } = buildForeachIterations({
    variablesRaw,
    listRaw,
    options: statement.options,
    baseBindings: inheritedBindings,
    loopSpan: statement.span
  });
  context.diagnostics.push(...diagnostics);
  maybeWarnUnsupportedBreakforeach(statement.id, statement.bodyRaw, statement.span, context);
  if (iterations.length === 0) {
    return [];
  }

  const expanded: Statement[] = [];
  for (const iteration of iterations) {
    if (!consumeExpansionBudget(context, statement.span)) {
      break;
    }

    const combinedBindings = {
      ...inheritedBindings,
      ...iteration.bindings
    };
    const frame: ForeachOriginFrame = {
      loopId: statement.id,
      loopSpan: statement.span,
      iterationIndex: iteration.index,
      bindings: { ...iteration.bindings }
    };
    const nextStack = [...stack, frame];

    const substituted = substituteForeachBindingsWithMap(statement.bodyRaw, combinedBindings);
    const macroExpandedBodyRaw = expandTexConditionals(expandMacroBindings(substituted.output, context.macroBindings));
    const parsedMacroExpandedBody = parseStatementsFromBodyWithMapping(macroExpandedBodyRaw, { from: 0, to: macroExpandedBodyRaw.length });
    const substitutedBodyRaw = expandTexConditionals(substituted.output);
    const parsedSubstitutedBody = parsedMacroExpandedBody.hasParseError
      ? parseStatementsFromBodyWithMapping(substitutedBodyRaw, { from: 0, to: substitutedBodyRaw.length })
      : null;
    const parsedBody = parsedSubstitutedBody && !parsedSubstitutedBody.hasParseError
      ? parsedSubstitutedBody
      : parsedMacroExpandedBody;
    const canMapSubstitutedBody = parsedBody === parsedSubstitutedBody
      ? substitutedBodyRaw === substituted.output
      : macroExpandedBodyRaw === substituted.output;
    if (parsedBody.hasParseError) {
      context.diagnostics.push({
        severity: "warning",
        code: "foreach-body-parse-error",
        message: "Could not parse expanded foreach body.",
        span: statement.span
      });
    }

    const expandedIteration = expandStatements(
      parsedBody.parseResult.figure.body,
      nextStack,
      combinedBindings,
      context,
      { sourceId: statement.id, sourceSpan: statement.span }
    );
    recordStatementSourceMaps(expandedIteration, {
      sourceId: statement.id,
      sourceSpan: statement.span,
      sourceKind: "foreach",
      mapSpan: (span) => {
        const generatedSpan = parsedBody.sourceMapper.mapSpan(span);
        if (!generatedSpan) {
          return null;
        }
        return canMapSubstitutedBody && statement.bodySpan
          ? offsetSpan(substituted.mapSpan(generatedSpan), statement.bodySpan.from)
          : null;
      }
    }, context);
    expanded.push(...expandedIteration);
  }

  return expanded;
}

function expandPathStatement(
  statement: PathStatement,
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext
): PathStatement {
  const expandedItems = expandPathItems(statement.items, stack, inheritedBindings, context);
  return {
    ...statement,
    items: expandedItems
  };
}

function recordStatementSourceMaps(
  statements: Statement[],
  sourceMap: ExpansionSourceMap,
  context: ExpandContext
): void {
  for (const statement of statements) {
    const existing = context.statementSourceMaps.get(statement);
    context.statementSourceMaps.set(statement, existing ? composeExpansionSourceMaps(existing, sourceMap) : sourceMap);
    if (statement.kind === "Scope") {
      recordStatementSourceMaps(statement.body, sourceMap, context);
    }
  }
}

function recordPathItemSourceMaps(
  items: PathItem[],
  sourceMap: ExpansionSourceMap,
  context: ExpandContext
): void {
  for (const item of items) {
    const existing = context.pathItemSourceMaps.get(item);
    context.pathItemSourceMaps.set(item, existing ? composeExpansionSourceMaps(existing, sourceMap) : sourceMap);
    if (item.kind === "ChildOperation") {
      recordPathItemSourceMaps(item.body, sourceMap, context);
    }
  }
}

function composeExpansionSourceMaps(inner: ExpansionSourceMap, outer: ExpansionSourceMap): ExpansionSourceMap {
  return {
    sourceId: outer.sourceId,
    sourceSpan: outer.sourceSpan,
    sourceKind: inner.sourceKind,
    mapSpan: (span) => {
      const innerMapped = inner.mapSpan(span);
      return innerMapped ? outer.mapSpan(innerMapped) : null;
    }
  };
}

type TemplateSourceMapper = {
  mapSpan: (span: { from: number; to: number }) => { from: number; to: number } | null;
};

function mapSubstitutedFragmentSpan(
  span: { from: number; to: number },
  mapSubstitutionSpan: (span: { from: number; to: number }) => { from: number; to: number } | null,
  templateMapper: TemplateSourceMapper
): { from: number; to: number } | null {
  const templateSpan = mapSubstitutionSpan(span);
  return templateSpan ? templateMapper.mapSpan(templateSpan) : null;
}

function createContiguousTemplateMapper(sourceSpan: { from: number; to: number } | null): TemplateSourceMapper {
  return {
    mapSpan: (span) => sourceSpan ? offsetSpan(span, sourceSpan.from) : null
  };
}

function createTemplateMapper(item: NodeItem | ChildOperationItem | PicOperationItem): TemplateSourceMapper {
  const clauses = item.foreachClauses ?? [];
  if (clauses.length === 0) {
    return createContiguousTemplateMapper(item.span);
  }

  const lastClauseEnd = clauses.reduce((max, clause) => Math.max(max, clause.span.to), clauses[0]?.span.to ?? item.span.from);
  const suffixLength = item.span.to - lastClauseEnd;
  const prefixLength = item.templateRaw.length - suffixLength;
  const prefixSourceSpan = { from: item.span.from, to: item.span.from + prefixLength };
  const suffixSourceSpan = { from: lastClauseEnd, to: item.span.to };

  return {
    mapSpan: (span) => {
      if (span.to <= prefixLength) {
        return {
          from: prefixSourceSpan.from + span.from,
          to: prefixSourceSpan.from + span.to
        };
      }
      if (span.from >= prefixLength) {
        return {
          from: suffixSourceSpan.from + (span.from - prefixLength),
          to: suffixSourceSpan.from + (span.to - prefixLength)
        };
      }
      return {
        from: prefixSourceSpan.from + span.from,
        to: suffixSourceSpan.from + (span.to - prefixLength)
      };
    }
  };
}

function resolvePathForeachBodySpan(item: PathForeachItem): { from: number; to: number } | null {
  if (item.bodyRaw.length === 0) {
    return null;
  }
  const bodyOffset = item.raw.lastIndexOf(item.bodyRaw);
  if (bodyOffset < 0) {
    return null;
  }
  return {
    from: item.span.from + bodyOffset,
    to: item.span.from + bodyOffset + item.bodyRaw.length
  };
}

function offsetSpan(span: { from: number; to: number } | null, offset: number): { from: number; to: number } | null {
  return span ? { from: span.from + offset, to: span.to + offset } : null;
}

function expandPathItems(
  items: PathItem[],
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext
): PathItem[] {
  const expanded: PathItem[] = [];

  for (const item of items) {
    if (item.kind === "PathForeach") {
      const variablesRaw = item.variablesRaw?.trim() ?? "";
      const listRaw = item.listRaw?.trim() ?? "";
      if (variablesRaw.length === 0 || listRaw.length === 0) {
        context.diagnostics.push({
          severity: "warning",
          code: "invalid-foreach-header",
          message: "Could not parse path foreach loop header.",
          span: item.span
        });
        continue;
      }

      const { iterations, diagnostics } = buildForeachIterations({
        variablesRaw,
        listRaw,
        options: item.options,
        baseBindings: inheritedBindings,
        loopSpan: item.span
      });
      context.diagnostics.push(...diagnostics);
      maybeWarnUnsupportedBreakforeach(item.id, item.bodyRaw, item.span, context);
      for (const iteration of iterations) {
        if (!consumeExpansionBudget(context, item.span)) {
          break;
        }

        const combinedBindings = {
          ...inheritedBindings,
          ...iteration.bindings
        };
        const frame: ForeachOriginFrame = {
          loopId: item.id,
          loopSpan: item.span,
          iterationIndex: iteration.index,
          bindings: { ...iteration.bindings }
        };
        const nextStack = [...stack, frame];
        const substituted = substituteForeachBindingsWithMap(item.bodyRaw, combinedBindings);
        const macroExpandedBodyRaw = expandMacroBindings(substituted.output, context.macroBindings);
        const bodyRaw = expandTexConditionals(macroExpandedBodyRaw);
        const canMapBody = bodyRaw === substituted.output;
        const parsedItems = parsePathItemsFromFragmentWithSyntheticMapping(bodyRaw, { from: 0, to: bodyRaw.length });
        if (parsedItems.hasParseError) {
          context.diagnostics.push({
            severity: "warning",
            code: "foreach-body-parse-error",
            message: "Could not parse expanded path foreach body.",
            span: item.span
          });
        }

        const expandedItems = expandPathItems(parsedItems.value, nextStack, combinedBindings, context);
        recordPathItemSourceMaps(expandedItems, {
          sourceId: item.id,
          sourceSpan: item.span,
          sourceKind: "foreach",
          mapSpan: (span) => {
            const generatedSpan = parsedItems.sourceMapper.mapSpan(span);
            if (!generatedSpan || !canMapBody) {
              return null;
            }
            return mapSubstitutedFragmentSpan(generatedSpan, substituted.mapSpan, createContiguousTemplateMapper(resolvePathForeachBodySpan(item)));
          }
        }, context);
        for (const expandedItem of expandedItems) {
          markPathItemForeachStack(expandedItem, nextStack, context);
        }
        expanded.push(...expandedItems);
      }

      continue;
    }

    if (item.kind === "ChildOperation") {
      const expandedChildren = expandChildOperationItem(item, stack, inheritedBindings, context);
      expanded.push(...expandedChildren);
      continue;
    }

    if (item.kind === "Node" && (item).foreachClauses && (item).foreachClauses.length > 0) {
      const expandedNodes = expandNodeForeachItem(item, stack, inheritedBindings, context);
      expanded.push(...expandedNodes);
      continue;
    }

    if (item.kind === "PicOperation" && item.foreachClauses && item.foreachClauses.length > 0) {
      const expandedPics = expandPicForeachItem(item, stack, inheritedBindings, context);
      expanded.push(...expandedPics);
      continue;
    }

    if (stack.length > 0) {
      markPathItemForeachStack(item, stack, context);
    }
    expanded.push(item);
  }

  return expanded;
}

function expandChildOperationItem(
  item: ChildOperationItem,
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext
): PathItem[] {
  const clauses = item.foreachClauses ?? [];

  if (clauses.length === 0) {
    const expandedBody = expandPathItems(item.body, stack, inheritedBindings, context);
    const expandedChild: ChildOperationItem = {
      ...item,
      body: expandedBody
    };
    if (stack.length > 0) {
      markPathItemForeachStack(expandedChild, stack, context);
    }
    return [expandedChild];
  }

  let variants: Array<{ bindings: Record<string, string>; stack: ForeachOriginFrame[] }> = [
    { bindings: { ...inheritedBindings }, stack: [...stack] }
  ];

  for (const clause of clauses) {
    const nextVariants: Array<{ bindings: Record<string, string>; stack: ForeachOriginFrame[] }> = [];
    for (const variant of variants) {
      const variablesRaw = clause.variablesRaw?.trim() ?? "";
      const listRaw = clause.listRaw?.trim() ?? "";
      if (variablesRaw.length === 0 || listRaw.length === 0) {
        context.diagnostics.push({
          severity: "warning",
          code: "invalid-foreach-header",
          message: "Could not parse child foreach loop header.",
          span: clause.span
        });
        continue;
      }

      const { iterations, diagnostics } = buildForeachIterations({
        variablesRaw,
        listRaw,
        options: clause.options,
        baseBindings: variant.bindings,
        loopSpan: clause.span
      });
      context.diagnostics.push(...diagnostics);
      maybeWarnUnsupportedBreakforeach(clause.id, item.bodyRaw, clause.span, context);

      for (const iteration of iterations) {
        if (!consumeExpansionBudget(context, clause.span)) {
          break;
        }

        const combinedBindings = {
          ...variant.bindings,
          ...iteration.bindings
        };
        const frame: ForeachOriginFrame = {
          loopId: clause.id,
          loopSpan: clause.span,
          iterationIndex: iteration.index,
          bindings: { ...iteration.bindings }
        };
        nextVariants.push({
          bindings: combinedBindings,
          stack: [...variant.stack, frame]
        });
      }
    }
    variants = nextVariants;
  }

  const expanded: PathItem[] = [];
  for (const variant of variants) {
    const substituted = substituteForeachBindingsWithMap(item.templateRaw, variant.bindings);
    const macroExpandedChildRaw = expandMacroBindings(substituted.output, context.macroBindings);
    const childRaw = expandTexConditionals(macroExpandedChildRaw);
    const canMapChild = childRaw === substituted.output;
    const parsed = parsePathItemsFromFragmentWithSyntheticMapping(childRaw, { from: 0, to: childRaw.length });
    if (parsed.hasParseError) {
      context.diagnostics.push({
        severity: "warning",
        code: "foreach-body-parse-error",
        message: "Could not parse expanded child foreach body.",
        span: item.span
      });
    }

    const expandedChildren = parsed.value.filter((entry): entry is ChildOperationItem => entry.kind === "ChildOperation");
    if (expandedChildren.length === 0) {
      continue;
    }

    for (const expandedChildItem of expandedChildren) {
      const expandedBody = expandPathItems(expandedChildItem.body, variant.stack, variant.bindings, context);
      const expandedChild: ChildOperationItem = {
        ...expandedChildItem,
        body: expandedBody
      };
      const sourceMap: ExpansionSourceMap = {
        sourceId: item.id,
        sourceSpan: item.span,
        sourceKind: "foreach",
        mapSpan: (span) => {
          const generatedSpan = parsed.sourceMapper.mapSpan(span);
          if (!generatedSpan || !canMapChild) {
            return null;
          }
          return mapSubstitutedFragmentSpan(generatedSpan, substituted.mapSpan, createTemplateMapper(item));
        }
      };
      recordPathItemSourceMaps([expandedChild], sourceMap, context);
      markPathItemForeachStack(expandedChild, variant.stack, context);
      expanded.push(expandedChild);
    }
  }

  return expanded;
}

function maybeWarnUnsupportedBreakforeach(
  loopId: string,
  bodyRaw: string,
  span: { from: number; to: number },
  context: ExpandContext
): void {
  if (context.breakforeachWarned.has(loopId)) {
    return;
  }
  if (!/\\breakforeach\b/.test(bodyRaw)) {
    return;
  }
  context.breakforeachWarned.add(loopId);
  context.diagnostics.push({
    severity: "warning",
    code: "unsupported-breakforeach",
    message: "\\breakforeach is not supported yet.",
    span
  });
}

function expandNodeForeachItem(
  item: NodeItem,
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext
): PathItem[] {
  const clauses = item.foreachClauses ?? [];
  if (clauses.length === 0) {
    if (stack.length > 0) {
      markPathItemForeachStack(item, stack, context);
    }
    return [item];
  }

  let variants: Array<{ bindings: Record<string, string>; stack: ForeachOriginFrame[] }> = [
    { bindings: { ...inheritedBindings }, stack: [...stack] }
  ];

  for (const clause of clauses) {
    const nextVariants: Array<{ bindings: Record<string, string>; stack: ForeachOriginFrame[] }> = [];
    for (const variant of variants) {
      const variablesRaw = clause.variablesRaw?.trim() ?? "";
      const listRaw = clause.listRaw?.trim() ?? "";
      if (variablesRaw.length === 0 || listRaw.length === 0) {
        context.diagnostics.push({
          severity: "warning",
          code: "invalid-foreach-header",
          message: "Could not parse node foreach loop header.",
          span: clause.span
        });
        continue;
      }

      const { iterations, diagnostics } = buildForeachIterations({
        variablesRaw,
        listRaw,
        options: clause.options,
        baseBindings: variant.bindings,
        loopSpan: clause.span
      });
      context.diagnostics.push(...diagnostics);

      for (const iteration of iterations) {
        if (!consumeExpansionBudget(context, clause.span)) {
          break;
        }

        const combinedBindings = {
          ...variant.bindings,
          ...iteration.bindings
        };
        const frame: ForeachOriginFrame = {
          loopId: clause.id,
          loopSpan: clause.span,
          iterationIndex: iteration.index,
          bindings: { ...iteration.bindings }
        };
        nextVariants.push({
          bindings: combinedBindings,
          stack: [...variant.stack, frame]
        });
      }
    }
    variants = nextVariants;
  }

  const expanded: PathItem[] = [];
  for (const variant of variants) {
    const substituted = substituteForeachBindingsWithMap(item.templateRaw, variant.bindings);
    const macroExpandedNodeRaw = expandMacroBindings(substituted.output, context.macroBindings);
    const nodeRaw = expandTexConditionals(macroExpandedNodeRaw);
    const canMapNode = nodeRaw === substituted.output;
    const parsed = parsePathItemsFromFragmentWithSyntheticMapping(nodeRaw, { from: 0, to: nodeRaw.length });
    if (parsed.hasParseError) {
      context.diagnostics.push({
        severity: "warning",
        code: "foreach-body-parse-error",
        message: "Could not parse expanded node foreach body.",
        span: item.span
      });
    }

    const expandedItems = expandPathItems(parsed.value, variant.stack, variant.bindings, context);
    recordPathItemSourceMaps(expandedItems, {
      sourceId: item.id,
      sourceSpan: item.span,
      sourceKind: "foreach",
      mapSpan: (span) => {
        const generatedSpan = parsed.sourceMapper.mapSpan(span);
        if (!generatedSpan || !canMapNode) {
          return null;
        }
        return mapSubstitutedFragmentSpan(generatedSpan, substituted.mapSpan, createTemplateMapper(item));
      }
    }, context);
    for (const expandedItem of expandedItems) {
      markPathItemForeachStack(expandedItem, variant.stack, context);
    }
    expanded.push(...expandedItems);
  }

  return expanded;
}

function expandPicForeachItem(
  item: PicOperationItem,
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext
): PathItem[] {
  const clauses = item.foreachClauses ?? [];
  if (clauses.length === 0) {
    if (stack.length > 0) {
      markPathItemForeachStack(item, stack, context);
    }
    return [item];
  }

  let variants: Array<{ bindings: Record<string, string>; stack: ForeachOriginFrame[] }> = [
    { bindings: { ...inheritedBindings }, stack: [...stack] }
  ];

  for (const clause of clauses) {
    const nextVariants: Array<{ bindings: Record<string, string>; stack: ForeachOriginFrame[] }> = [];
    for (const variant of variants) {
      const variablesRaw = clause.variablesRaw?.trim() ?? "";
      const listRaw = clause.listRaw?.trim() ?? "";
      if (variablesRaw.length === 0 || listRaw.length === 0) {
        context.diagnostics.push({
          severity: "warning",
          code: "invalid-foreach-header",
          message: "Could not parse pic foreach loop header.",
          span: clause.span
        });
        continue;
      }

      const { iterations, diagnostics } = buildForeachIterations({
        variablesRaw,
        listRaw,
        options: clause.options,
        baseBindings: variant.bindings,
        loopSpan: clause.span
      });
      context.diagnostics.push(...diagnostics);

      for (const iteration of iterations) {
        if (!consumeExpansionBudget(context, clause.span)) {
          break;
        }

        const combinedBindings = {
          ...variant.bindings,
          ...iteration.bindings
        };
        const frame: ForeachOriginFrame = {
          loopId: clause.id,
          loopSpan: clause.span,
          iterationIndex: iteration.index,
          bindings: { ...iteration.bindings }
        };
        nextVariants.push({
          bindings: combinedBindings,
          stack: [...variant.stack, frame]
        });
      }
    }
    variants = nextVariants;
  }

  const expanded: PathItem[] = [];
  for (const variant of variants) {
    const template = normalizePicForeachTemplateRaw(item.templateRaw);
    const substituted = substituteForeachBindingsWithMap(template.raw, variant.bindings);
    const macroExpandedPicRaw = expandMacroBindings(substituted.output, context.macroBindings);
    const picRaw = expandTexConditionals(macroExpandedPicRaw);
    const canMapPic = picRaw === substituted.output;
    const parsed = parsePathItemsFromFragmentWithSyntheticMapping(picRaw, { from: 0, to: picRaw.length });
    if (parsed.hasParseError) {
      context.diagnostics.push({
        severity: "warning",
        code: "foreach-body-parse-error",
        message: "Could not parse expanded pic foreach body.",
        span: item.span
      });
    }

    const expandedItems = expandPathItems(parsed.value, variant.stack, variant.bindings, context)
      .filter((entry): entry is PicOperationItem => entry.kind === "PicOperation");
    recordPathItemSourceMaps(expandedItems, {
      sourceId: item.id,
      sourceSpan: item.span,
      sourceKind: "foreach",
      mapSpan: (span) => {
        const generatedSpan = parsed.sourceMapper.mapSpan(span);
        if (!generatedSpan || !canMapPic) {
          return null;
        }
        return mapSubstitutedFragmentSpan(
          generatedSpan,
          (substitutedSpan) => {
            const normalizedTemplateSpan = substituted.mapSpan(substitutedSpan);
            return normalizedTemplateSpan ? template.mapSpan(normalizedTemplateSpan) : null;
          },
          createTemplateMapper(item)
        );
      }
    }, context);
    for (const expandedItem of expandedItems) {
      markPathItemForeachStack(expandedItem, variant.stack, context);
    }
    expanded.push(...expandedItems);
  }

  return expanded;
}

function normalizePicForeachTemplateRaw(templateRaw: string): { raw: string; mapSpan: (span: Span) => Span | null } {
  let raw = templateRaw;
  const leadingWhitespace = raw.search(/\S/u);
  const keywordStart = leadingWhitespace < 0 ? 0 : leadingWhitespace;
  const hasTopLevelPicCommand =
    raw.startsWith("\\pic", keywordStart) && !/[A-Za-z@]/u.test(raw[keywordStart + "\\pic".length] ?? "");

  if (hasTopLevelPicCommand) {
    raw = `${raw.slice(0, keywordStart)}pic${raw.slice(keywordStart + "\\pic".length)}`;
  }

  const trailingSemicolon = /;\s*$/u.exec(raw);
  if (trailingSemicolon) {
    raw = raw.slice(0, trailingSemicolon.index);
  }

  return {
    raw,
    mapSpan: (span) => {
      if (span.from < 0 || span.to < span.from || span.to > raw.length) {
        return null;
      }

      const mapOffset = (offset: number) => hasTopLevelPicCommand && offset >= keywordStart ? offset + 1 : offset;
      return {
        from: mapOffset(span.from),
        to: mapOffset(span.to)
      };
    }
  };
}

function markPathItemForeachStack(item: PathItem, stack: ForeachOriginFrame[], context: ExpandContext): void {
  if (stack.length === 0) {
    return;
  }
  context.pathItemForeachStack.set(item, cloneForeachStack(stack));
  if (item.kind === "ChildOperation") {
    for (const nestedItem of item.body) {
      markPathItemForeachStack(nestedItem, stack, context);
    }
  }
}

function maybeRecordStatementAttribution(
  statement: Statement,
  stack: ForeachOriginFrame[],
  context: ExpandContext,
  templateSource: TemplateSource | undefined
): void {
  context.statementAttribution.set(statement, {
    sourceId: templateSource?.sourceId ?? statement.id,
    sourceSpan: templateSource?.sourceSpan ?? statement.span,
    foreachStack: cloneForeachStack(stack)
  });
}

function consumeExpansionBudget(context: ExpandContext, span: { from: number; to: number }): boolean {
  if (context.expansionCount < context.maxForeachExpansions) {
    context.expansionCount += 1;
    return true;
  }

  context.diagnostics.push({
    severity: "warning",
    code: "foreach-expansion-limit",
    message: `Foreach expansion limit (${context.maxForeachExpansions}) reached.`,
    span
  });
  return false;
}

function cloneForeachStack(stack: ForeachOriginFrame[]): ForeachOriginFrame[] {
  return stack.map((frame) => ({
    loopId: frame.loopId,
    loopSpan: frame.loopSpan,
    iterationIndex: frame.iterationIndex,
    bindings: { ...frame.bindings }
  }));
}

// ---------------------------------------------------------------------------
// Macro pre-collection and statement-level expansion
// ---------------------------------------------------------------------------

const CONTROL_SEQUENCE_REGEX_MACRO = /^\\[A-Za-z@]+/;

function normalizeMacroName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isControlSequenceToken(trimmed)) {
    return null;
  }
  return trimmed;
}

function collectMacroDefinition(statement: MacroDefinitionStatement, bindings: Map<string, MacroBinding>): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) return;
  bindings.set(name, {
    kind: "text",
    value: statement.valueRaw,
    provenance: [{ macroName: name, definitionId: statement.id, definitionSpan: statement.span, commandRaw: statement.commandRaw }]
  });
}

function collectMacroCommandDefinition(statement: MacroCommandDefinitionStatement, bindings: Map<string, MacroBinding>): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) return;
  if (statement.commandRaw === "\\providecommand" && bindings.has(name)) return;
  const parameterCount = Math.min(Math.max(0, statement.arity), 9);
  const origin: MacroOriginFrameType = { macroName: name, definitionId: statement.id, definitionSpan: statement.span, commandRaw: statement.commandRaw };
  if (parameterCount === 0) {
    bindings.set(name, { kind: "text", value: statement.bodyRaw, provenance: [origin] });
  } else {
    bindings.set(name, {
      kind: "callable",
      parameterCount,
      optionalFirstArgDefault: statement.optionalDefaultRaw,
      body: statement.bodyRaw,
      provenance: [origin]
    });
  }
}

function collectMacroAlias(statement: MacroAliasStatement, bindings: Map<string, MacroBinding>): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) return;
  const targetRaw = statement.targetRaw.trim();
  if (targetRaw.length === 0) return;
  const origin: MacroOriginFrameType = { macroName: name, definitionId: statement.id, definitionSpan: statement.span, commandRaw: statement.commandRaw };
  if (isControlSequenceToken(targetRaw)) {
    const existing = bindings.get(targetRaw);
    if (existing) {
      const cloned: MacroBinding = existing.kind === "text"
        ? { kind: "text", value: existing.value, provenance: [...existing.provenance, origin] }
        : { kind: "callable", parameterCount: existing.parameterCount, optionalFirstArgDefault: existing.optionalFirstArgDefault, body: existing.body, provenance: [...existing.provenance, origin] };
      bindings.set(name, cloned);
    } else {
      bindings.set(name, { kind: "text", value: targetRaw, provenance: [origin] });
    }
  } else {
    bindings.set(name, { kind: "text", value: targetRaw, provenance: [origin] });
  }
}

function collectMacroBindings(statements: Statement[]): Map<string, MacroBinding> {
  const bindings = new Map<string, MacroBinding>();
  for (const statement of statements) {
    if (statement.kind === "MacroDefinition") {
      collectMacroDefinition(statement, bindings);
    } else if (statement.kind === "MacroCommandDefinition") {
      collectMacroCommandDefinition(statement, bindings);
    } else if (statement.kind === "MacroAlias") {
      collectMacroAlias(statement, bindings);
    } else if (statement.kind === "Scope") {
      // Collect from scope bodies too (though scoping is approximate in pre-pass)
      const scopeBindings = collectMacroBindings((statement).body);
      for (const [key, value] of scopeBindings) {
        bindings.set(key, value);
      }
    }
  }
  return bindings;
}

function tryExpandMacroStatement(
  statement: UnknownStatement,
  stack: ForeachOriginFrame[],
  context: ExpandContext,
  templateSource: TemplateSource | undefined
): Statement[] | null {
  if (context.macroBindings.size === 0) {
    return null;
  }

  const raw = statement.raw;
  const expanded = normalizeExpandedMacroStatement(
    expandTexConditionals(expandMacroBindings(raw, context.macroBindings)),
    raw
  );
  if (expanded === raw) {
    return null;
  }

  if (context.macroExpansionCount >= context.maxMacroStatementExpansions) {
    context.diagnostics.push({
      severity: "warning",
      code: "macro-statement-expansion-limit",
      message: `Macro statement expansion limit (${context.maxMacroStatementExpansions}) reached.`,
      span: statement.span
    });
    return null;
  }
  context.macroExpansionCount += 1;

  const parsed = parseStatementsFromBody(expanded);
  if (parsed.hasParseError) {
    context.diagnostics.push({
      severity: "warning",
      code: "macro-body-parse-error",
      message: "Could not parse expanded macro body as TikZ statements.",
      span: statement.span
    });
    return null;
  }

  // Determine provenance: find which macro(s) were involved
  const macroMatch = CONTROL_SEQUENCE_REGEX_MACRO.exec(raw.trim());
  const macroProvenance: MacroOriginFrameType[] = [];
  if (macroMatch) {
    const binding = context.macroBindings.get(macroMatch[0]);
    if (binding) {
      macroProvenance.push(...binding.provenance);
    }
  }

  // Recursively expand the parsed statements (they may contain more macros/foreach)
  const result = expandStatements(parsed.value, stack, {}, context, templateSource ?? {
    sourceId: statement.id,
    sourceSpan: statement.span
  });
  recordStatementSourceMaps(result, {
    sourceId: statement.id,
    sourceSpan: statement.span,
    sourceKind: "macro",
    mapSpan: () => ({ ...statement.span })
  }, context);

  // Record macro attribution on all expanded statements
  if (macroProvenance.length > 0) {
    for (const expandedStatement of result) {
      const existing = context.statementMacroAttribution.get(expandedStatement);
      if (existing) {
        context.statementMacroAttribution.set(expandedStatement, [...macroProvenance, ...existing]);
      } else {
        context.statementMacroAttribution.set(expandedStatement, [...macroProvenance]);
      }
    }
  }

  return result;
}

function normalizeExpandedMacroStatement(expanded: string, raw: string): string {
  const rawTrimmed = raw.trimEnd();
  const expandedTrimmed = expanded.trimEnd();
  if (!rawTrimmed.endsWith(";") || !expandedTrimmed.endsWith(";;")) {
    return expanded;
  }

  return `${expandedTrimmed.slice(0, -1)}${expanded.slice(expandedTrimmed.length)}`;
}

function reindexStatements(
  statements: Statement[],
  attributionByStatement: WeakMap<Statement, ForeachStatementAttribution>,
  templateLocalIdByExpandedId: Map<string, string>
): void {
  const state = { nextStatementIndex: findNextStatementIndexSeed(statements) };
  reindexStatementsInPlace(statements, state, attributionByStatement, templateLocalIdByExpandedId);
}

function reindexStatementsInPlace(
  statements: Statement[],
  state: { nextStatementIndex: number },
  attributionByStatement: WeakMap<Statement, ForeachStatementAttribution>,
  templateLocalIdByExpandedId: Map<string, string>
): void {
  for (const statement of statements) {
    const preserveExistingId = shouldPreserveStatementId(statement, attributionByStatement);
    const statementIndex = preserveExistingId ? parseStatementIndex(statement.id) ?? state.nextStatementIndex : state.nextStatementIndex;
    if (!preserveExistingId) {
      state.nextStatementIndex += 1;
    }
    const previousId = statement.id;

    if (statement.kind === "Path") {
      if (!preserveExistingId) {
        statement.id = pathStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
        reindexPathItems(statement, statementIndex, templateLocalIdByExpandedId);
      }
      continue;
    }

    if (statement.kind === "Scope") {
      if (!preserveExistingId) {
        statement.id = scopeStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      reindexStatementsInPlace(statement.body, state, attributionByStatement, templateLocalIdByExpandedId);
      continue;
    }

    if (statement.kind === "Foreach") {
      if (!preserveExistingId) {
        statement.id = foreachStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      continue;
    }

    if (statement.kind === "MacroDefinition") {
      if (!preserveExistingId) {
        statement.id = macroDefinitionStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      continue;
    }

    if (statement.kind === "MacroAlias") {
      if (!preserveExistingId) {
        statement.id = macroAliasStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      continue;
    }

    if (statement.kind === "MacroCommandDefinition") {
      if (!preserveExistingId) {
        statement.id = macroCommandDefinitionStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      continue;
    }

    if (statement.kind === "TikzSet") {
      if (!preserveExistingId) {
        statement.id = tikzSetStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      continue;
    }

    if (statement.kind === "TikzStyle") {
      if (!preserveExistingId) {
        statement.id = tikzStyleStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      continue;
    }

    if (statement.kind === "Pgfkeys") {
      if (!preserveExistingId) {
        statement.id = pgfkeysStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      continue;
    }

    if (statement.kind === "TikzLibrary") {
      if (!preserveExistingId) {
        statement.id = tikzLibraryStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      continue;
    }

    if (statement.kind === "Colorlet") {
      if (!preserveExistingId) {
        statement.id = colorletStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      continue;
    }

    if (statement.kind === "DefineColor") {
      if (!preserveExistingId) {
        statement.id = defineColorStatementId(statementIndex);
        templateLocalIdByExpandedId.set(statement.id, previousId);
      }
      continue;
    }

    if (!preserveExistingId) {
      statement.id = unknownStatementId(statementIndex);
      templateLocalIdByExpandedId.set(statement.id, previousId);
    }
  }
}

function findNextStatementIndexSeed(statements: Statement[]): number {
  let maxIndex = -1;
  const visit = (statement: Statement): void => {
    const parsed = parseStatementIndex(statement.id);
    if (parsed != null && parsed > maxIndex) {
      maxIndex = parsed;
    }
    if (statement.kind === "Scope") {
      for (const nested of statement.body) {
        visit(nested);
      }
    }
  };
  for (const statement of statements) {
    visit(statement);
  }
  return maxIndex + 1;
}

function parseStatementIndex(statementId: string): number | null {
  const match = /:(\d+)$/.exec(statementId.trim());
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldPreserveStatementId(
  statement: Statement,
  attributionByStatement: WeakMap<Statement, ForeachStatementAttribution>
): boolean {
  const attribution = attributionByStatement.get(statement);
  if (!attribution) {
    return false;
  }
  if (attribution.foreachStack.length > 0) {
    return false;
  }
  if (attribution.sourceId !== statement.id) {
    return false;
  }
  return attribution.sourceSpan.from === statement.span.from && attribution.sourceSpan.to === statement.span.to;
}

function reindexPathItems(
  statement: PathStatement,
  statementIndex: number,
  templateLocalIdByExpandedId: Map<string, string>
): void {
  for (let itemIndex = 0; itemIndex < statement.items.length; itemIndex += 1) {
    const item = statement.items[itemIndex];
    const previousId = item.id;
    if (item.kind === "Coordinate") {
      item.id = coordinateItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "Node") {
      reindexTopLevelNodeItem(item, statementIndex, itemIndex, templateLocalIdByExpandedId);
      continue;
    }
    if (item.kind === "PathForeach") {
      item.id = pathForeachItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "PicOperation") {
      item.id = picOperationItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      if (item.foreachClauses) {
        for (let clauseIndex = 0; clauseIndex < item.foreachClauses.length; clauseIndex += 1) {
          item.foreachClauses[clauseIndex].id = picForeachClauseId(statementIndex, itemIndex, clauseIndex);
        }
      }
      continue;
    }
    if (item.kind === "PathComment") {
      item.id = pathCommentItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "PathOption") {
      item.id = pathOptionItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "PathKeyword") {
      item.id = pathKeywordItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "PlotOperation") {
      item.id = plotOperationItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "ToOperation") {
      item.id = toOperationItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "EdgeOperation") {
      item.id = edgeOperationItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      for (let nodeIndex = 0; nodeIndex < (item.nodes?.length ?? 0); nodeIndex += 1) {
        const node = item.nodes?.[nodeIndex];
        if (!node) {
          continue;
        }
        node.id = `${item.id}:node:${nodeIndex}`;
      }
      continue;
    }
    if (item.kind === "ChildOperation") {
      item.id = childOperationItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      if (item.foreachClauses) {
        for (let clauseIndex = 0; clauseIndex < item.foreachClauses.length; clauseIndex += 1) {
          item.foreachClauses[clauseIndex].id = childForeachClauseId(statementIndex, itemIndex, clauseIndex);
        }
      }
      reindexNestedPathItems(item.body, statementIndex, `${item.id}:body`, templateLocalIdByExpandedId);
      continue;
    }
    if (item.kind === "EdgeFromParentOperation") {
      item.id = edgeFromParentOperationItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      for (let nodeIndex = 0; nodeIndex < (item.nodes?.length ?? 0); nodeIndex += 1) {
        const node = item.nodes?.[nodeIndex];
        if (!node) {
          continue;
        }
        node.id = `${item.id}:node:${nodeIndex}`;
      }
      continue;
    }
    if (item.kind === "SvgOperation") {
      item.id = svgOperationItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "LetOperation") {
      item.id = letOperationItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "CoordinateOperation") {
      item.id = coordinateOperationItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "DecorateOperation") {
      item.id = decorateOperationItemId(statementIndex, itemIndex);
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    item.id = unknownPathItemId(statementIndex, itemIndex);
    templateLocalIdByExpandedId.set(item.id, previousId);
  }
}

function reindexTopLevelNodeItem(
  item: NodeItem,
  statementIndex: number,
  itemIndex: number,
  templateLocalIdByExpandedId: Map<string, string>
): void {
  const previousId = item.id;
  item.id = nodeItemId(statementIndex, itemIndex);
  templateLocalIdByExpandedId.set(item.id, previousId);
  if (item.foreachClauses) {
    for (let clauseIndex = 0; clauseIndex < item.foreachClauses.length; clauseIndex += 1) {
      item.foreachClauses[clauseIndex].id = nodeForeachClauseId(statementIndex, itemIndex, clauseIndex);
    }
  }
}

function reindexNestedPathItems(
  items: PathItem[],
  statementIndex: number,
  parentPrefix: string,
  templateLocalIdByExpandedId: Map<string, string>
): void {
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const nestedPrefix = `${parentPrefix}:${itemIndex}`;
    const previousId = item.id;

    if (item.kind === "Coordinate") {
      item.id = `coordinate:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "Node") {
      item.id = `node:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      if (item.foreachClauses) {
        for (let clauseIndex = 0; clauseIndex < item.foreachClauses.length; clauseIndex += 1) {
          item.foreachClauses[clauseIndex].id = `${item.id}:foreach:${clauseIndex}`;
        }
      }
      continue;
    }
    if (item.kind === "PathForeach") {
      item.id = `path-foreach:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "PicOperation") {
      item.id = `pic-operation:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      if (item.foreachClauses) {
        for (let clauseIndex = 0; clauseIndex < item.foreachClauses.length; clauseIndex += 1) {
          item.foreachClauses[clauseIndex].id = `${item.id}:foreach:${clauseIndex}`;
        }
      }
      continue;
    }
    if (item.kind === "PathComment") {
      item.id = `path-comment:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "PathOption") {
      item.id = `path-option:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "PathKeyword") {
      item.id = `path-keyword:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "PlotOperation") {
      item.id = `plot-operation:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "ToOperation") {
      item.id = `to-operation:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      for (let nodeIndex = 0; nodeIndex < (item.nodes?.length ?? 0); nodeIndex += 1) {
        const node = item.nodes?.[nodeIndex];
        if (node) {
          node.id = `${item.id}:node:${nodeIndex}`;
        }
      }
      continue;
    }
    if (item.kind === "EdgeOperation") {
      item.id = `edge-operation:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      for (let nodeIndex = 0; nodeIndex < (item.nodes?.length ?? 0); nodeIndex += 1) {
        const node = item.nodes?.[nodeIndex];
        if (node) {
          node.id = `${item.id}:node:${nodeIndex}`;
        }
      }
      continue;
    }
    if (item.kind === "ChildOperation") {
      item.id = `child-operation:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      if (item.foreachClauses) {
        for (let clauseIndex = 0; clauseIndex < item.foreachClauses.length; clauseIndex += 1) {
          item.foreachClauses[clauseIndex].id = `${item.id}:foreach:${clauseIndex}`;
        }
      }
      reindexNestedPathItems(item.body, statementIndex, `${item.id}:body`, templateLocalIdByExpandedId);
      continue;
    }
    if (item.kind === "EdgeFromParentOperation") {
      item.id = `edge-from-parent-operation:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      for (let nodeIndex = 0; nodeIndex < (item.nodes?.length ?? 0); nodeIndex += 1) {
        const node = item.nodes?.[nodeIndex];
        if (node) {
          node.id = `${item.id}:node:${nodeIndex}`;
        }
      }
      continue;
    }
    if (item.kind === "SvgOperation") {
      item.id = `svg-operation:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "LetOperation") {
      item.id = `let-operation:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "CoordinateOperation") {
      item.id = `coordinate-operation:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }
    if (item.kind === "DecorateOperation") {
      item.id = `decorate-operation:${statementIndex}:${nestedPrefix}`;
      templateLocalIdByExpandedId.set(item.id, previousId);
      continue;
    }

    item.id = `unknown-path-item:${statementIndex}:${nestedPrefix}`;
    templateLocalIdByExpandedId.set(item.id, previousId);
  }
}
