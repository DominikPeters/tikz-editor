import type { SyntaxNode, Tree } from "@lezer/common";

import type { Diagnostic } from "../diagnostics/types.js";
import type {
  ColorletStatement,
  DefineColorStatement,
  MacroAliasStatement,
  MacroCommandDefinitionStatement,
  MacroDefinitionStatement,
  Statement,
  TikzFigure,
  TikzFigureInventoryItem
} from "../ast/types.js";
import {
  colorletStatementId,
  defineColorStatementId,
  macroAliasStatementId,
  macroCommandDefinitionStatementId,
  macroDefinitionStatementId
} from "../ast/ids.js";
import { mapBodyStatements, mapStatementNode, unwrapStatementLikeNode } from "../domains/statements/parse.js";
import { parseOptionListRaw } from "../options/parse.js";
import { findFirstChildByName, findFirstNodeByName, forEachChild, walk } from "../syntax/cursor.js";
import { parseSyntax } from "@tikz-editor/lezer-tikz";
import { collectParseErrorDiagnostics, collectStructuralDiagnostics } from "../diagnostics/collect.js";
import { buildLineStarts, lineForOffset } from "../text/line-map.js";
import { scanTikzFigures, type ScannedFigure } from "../parser/figure-scan.js";

export type CstToAstResult = {
  figure: TikzFigure;
  figures: TikzFigureInventoryItem[];
  activeFigureId: string | null;
  diagnostics: Diagnostic[];
};

export type CstToIrResult = CstToAstResult;

export type CstToAstOptions = {
  activeFigureId?: string | null;
  includeContextDefinitions?: boolean;
  contextDefinitions?: Statement[];
  scannedFigures?: readonly ScannedFigure[];
};

type FigureNodeEntry = {
  id: string;
  node: SyntaxNode | null;
  inventory: TikzFigureInventoryItem;
};

export function fromCst(tree: Tree, source: string, opts: CstToAstOptions = {}): CstToAstResult {
  const diagnostics: Diagnostic[] = [];
  collectParseErrorDiagnostics(tree.topNode, source, diagnostics);

  const figureEntries = collectFigureNodes(tree, source, opts.scannedFigures);
  const activeFigureEntry = resolveActiveFigureEntry(figureEntries, opts.activeFigureId);
  if (figureEntries.length === 0) {
    const inlineNode = findFirstNodeByName(tree.topNode, "TikzInline");
    if (inlineNode) {
      const state = { nextStatementIndex: 0 };
      const inlineBody = mapBodyStatements(inlineNode, source, state);
      const optionsNode = findFirstChildByName(inlineNode, "OptionList");
      return {
        figure: {
          kind: "Figure",
          span: { from: inlineNode.from, to: inlineNode.to },
          options: optionsNode
            ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from)
            : recoverInlineTikzOptions(inlineNode, source),
          body: inlineBody
        },
        figures: [],
        activeFigureId: null,
        diagnostics
      };
    }
  }
  if (!activeFigureEntry) {
    if (figureEntries.length === 0 && source.trim().length > 0) {
      diagnostics.push({
        severity: "warning",
        message: "No tikzpicture environment found; wrap the code in `\\begin{tikzpicture}` ... `\\end{tikzpicture}`.",
        span: { from: 0, to: source.length },
        code: "missing-tikzpicture"
      });
    }

    return {
      figure: {
        kind: "Figure",
        span: { from: 0, to: source.length },
        body: []
      },
      figures: figureEntries.map((entry) => entry.inventory),
      activeFigureId: null,
      diagnostics
    };
  }

  const activeSyntax = resolveActiveSyntaxNode(source, activeFigureEntry);
  if (!activeSyntax) {
    return {
      figure: {
        kind: "Figure",
        span: activeFigureEntry.inventory.span,
        body: []
      },
      figures: figureEntries.map((entry) => entry.inventory),
      activeFigureId: activeFigureEntry.id,
      diagnostics
    };
  }
  const activeState = { nextStatementIndex: 0 };
  const priorDefinitions = opts.includeContextDefinitions
    ? (opts.contextDefinitions ?? collectPriorDefinitions(tree, source, activeFigureEntry.inventory.span.from, { nextStatementIndex: 0 }))
    : [];
  if (opts.includeContextDefinitions) {
    activeState.nextStatementIndex = priorDefinitions.filter((statement) => !isMacroContextStatement(statement)).length;
  }
  const activeBody = mapBodyStatements(activeSyntax.node, activeSyntax.parseSource, activeState);
  const body = [...priorDefinitions, ...activeBody];
  const optionsNode = findFirstChildByName(activeSyntax.node, "OptionList");

  const structuralDiagnostics: Diagnostic[] = [];
  collectStructuralDiagnostics(activeSyntax.node, activeSyntax.parseSource, structuralDiagnostics);
  diagnostics.push(...structuralDiagnostics);

  return {
    figure: {
      kind: "Figure",
      span: activeFigureEntry.inventory.span,
      options: optionsNode
        ? parseOptionListRaw(activeSyntax.parseSource.slice(optionsNode.from, optionsNode.to), optionsNode.from)
        : undefined,
      body
    },
    figures: figureEntries.map((entry) => entry.inventory),
    activeFigureId: activeFigureEntry.id,
    diagnostics
  };
}

function recoverInlineTikzOptions(node: SyntaxNode, source: string) {
  const commandNode = findFirstChildByName(node, "InlineTikzCmd");
  if (!commandNode) {
    return;
  }

  const commandRaw = source.slice(commandNode.from, commandNode.to);
  if (!commandRaw.endsWith("[")) {
    return;
  }

  const optionStart = commandNode.to - 1;
  const optionEnd = findMatchingInlineOptionBracket(source, optionStart);
  if (optionEnd < 0) {
    return;
  }

  return parseOptionListRaw(source.slice(optionStart, optionEnd + 1), optionStart);
}

function findMatchingInlineOptionBracket(source: string, from: number): number {
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function collectFigureNodes(
  tree: Tree,
  source: string,
  scannedFigures: readonly ScannedFigure[] | undefined
): FigureNodeEntry[] {
  const nodes: FigureNodeEntry[] = [];
  const scanned = scanFigureInventories(source, scannedFigures);
  if (scanned.length === 0) {
    return nodes;
  }
  const parsedNodesBySpan = collectParsedFigureNodesBySpan(tree);
  for (let index = 0; index < scanned.length; index += 1) {
    const inventory = scanned[index];
    const id = `figure:${index}`;
    const parsedNode = parsedNodesBySpan.get(spanKey(inventory.span)) ?? null;
    nodes.push({
      id,
      node: parsedNode,
      inventory: {
        id,
        span: inventory.span,
        beginSpan: inventory.beginSpan,
        endSpan: inventory.endSpan,
        optionsSpan: inventory.optionsSpan,
        startLine: inventory.startLine,
        endLine: inventory.endLine
      }
    });
  }
  nodes.sort((left, right) => left.inventory.span.from - right.inventory.span.from);
  return nodes;
}

function resolveActiveFigureEntry(entries: FigureNodeEntry[], requestedId: string | null | undefined): FigureNodeEntry | null {
  if (entries.length === 0) {
    return null;
  }
  if (requestedId === null) {
    return null;
  }
  if (requestedId === undefined || requestedId.length === 0) {
    return entries[0];
  }
  const directMatch = entries.find((entry) => entry.id === requestedId);
  if (directMatch) {
    return directMatch;
  }
  const requestedIndex = parseFigureIndexFromId(requestedId);
  if (requestedIndex == null || requestedIndex < 0 || requestedIndex >= entries.length) {
    return entries[0];
  }
  return entries[requestedIndex];
}

function parseFigureIndexFromId(figureId: string): number | null {
  const match = /^figure:(\d+)(?::|$)/u.exec(figureId.trim());
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectPriorDefinitions(
  tree: Tree,
  source: string,
  activeFrom: number,
  state: { nextStatementIndex: number }
): Statement[] {
  const defs: Statement[] = [];
  const beginDocumentOffset = findBeginDocumentOffset(source);

  forEachChild(tree.topNode, (child) => {
    if (child.from >= activeFrom) {
      return;
    }
    if (child.type.name === "TikzEnvironment") {
      defs.push(...collectRelevantStatementsFromNode(child, source, state));
      return;
    }
    if (child.type.name === "TikzInline") {
      return;
    }
    if (child.to <= beginDocumentOffset || child.from < activeFrom) {
      const unwrapped = unwrapStatementLikeNode(child);
      if (!isRelevantDefinitionNode(unwrapped)) {
        return;
      }
      const mapped = mapStatementNode(unwrapped, source, state);
      if (mapped) {
        defs.push(mapped);
      }
    }
  });

  return defs;
}

export function collectContextDefinitions(source: string): Statement[] {
  if (source.length === 0) {
    return [];
  }
  const tree = parseSyntax(source);
  const state = { nextStatementIndex: 0 };
  const collected = collectPriorDefinitions(tree, source, source.length, state);
  const parserMacros = collected.filter(isMacroContextStatement);
  const parserColorDefs = collected.filter(isColorContextStatement);
  const parserNonMacros = collected.filter(
    (statement) => !isMacroContextStatement(statement) && !isColorContextStatement(statement)
  );
  const scopedMacros = collectScopedMacroDefinitionsFromStream(source, parserMacros);
  const scopedColorDefs = collectScopedColorDefinitionsFromStream(source, parserColorDefs);
  const merged = [...parserNonMacros, ...scopedMacros, ...scopedColorDefs];
  const deduped = new Map<string, Statement>();
  for (const statement of merged) {
    deduped.set(`${statement.span.from}:${statement.span.to}:${statement.kind}`, statement);
  }
  const dedupedValues = [...deduped.values()];
  dedupedValues.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return left.span.from - right.span.from;
    }
    return left.span.to - right.span.to;
  });
  return dedupedValues;
}

function collectParsedFigureNodesBySpan(tree: Tree): Map<string, SyntaxNode> {
  const nodes = new Map<string, SyntaxNode>();
  walk(tree.topNode, (node) => {
    if (node.type.name === "TikzEnvironment") {
      nodes.set(spanKey(node), node);
    }
  });
  return nodes;
}

function spanKey(span: { from: number; to: number }): string {
  return `${span.from}:${span.to}`;
}

function resolveActiveSyntaxNode(
  source: string,
  activeFigureEntry: FigureNodeEntry
): { node: SyntaxNode; parseSource: string } | null {
  if (activeFigureEntry.node) {
    return { node: activeFigureEntry.node, parseSource: source };
  }
  const maskedSource = maskSourceToFigure(source, activeFigureEntry.inventory.span.from, activeFigureEntry.inventory.span.to);
  const tree = parseSyntax(maskedSource);
  const node = findFirstNodeByName(tree.topNode, "TikzEnvironment");
  if (!node) {
    return null;
  }
  return {
    node,
    parseSource: maskedSource
  };
}

function maskSourceToFigure(source: string, from: number, to: number): string {
  const safeFrom = Math.max(0, Math.min(source.length, from));
  const safeTo = Math.max(safeFrom, Math.min(source.length, to));
  const prefix = source
    .slice(0, safeFrom)
    .replace(/[^\n]/g, " ");
  const figure = source.slice(safeFrom, safeTo);
  return `${prefix}${figure}`;
}

function scanFigureInventories(
  source: string,
  scannedFigures: readonly ScannedFigure[] | undefined
): Array<Omit<TikzFigureInventoryItem, "id">> {
  const figures: Array<Omit<TikzFigureInventoryItem, "id">> = [];
  const scanned = scannedFigures ?? scanTikzFigures(source);
  let lineStarts: number[] | null = null;
  for (const figure of scanned) {
    if (figure.isTemplate) {
      continue;
    }
    lineStarts ??= buildLineStarts(source);
    const beginFrom = figure.beginSpan.from;
    const beginTo = figure.beginSpan.to;
    const endFrom = figure.endSpan.from;
    const endTo = figure.endSpan.to;
    const optionsSpan = scanFigureOptionsSpan(source, beginTo, endFrom);
    figures.push({
      span: { from: beginFrom, to: endTo },
      beginSpan: { from: beginFrom, to: beginTo },
      endSpan: { from: endFrom, to: endTo },
      optionsSpan,
      startLine: lineForOffset(beginFrom, lineStarts),
      endLine: lineForOffset(Math.max(beginFrom, endTo - 1), lineStarts)
    });
  }

  return figures;
}

function scanFigureOptionsSpan(source: string, cursor: number, figureEnd: number): { from: number; to: number } | undefined {
  let index = cursor;
  while (index < figureEnd && /\s/u.test(source[index] ?? "")) {
    index += 1;
  }
  if ((source[index] ?? "") !== "[") {
    return undefined;
  }
  let depth = 0;
  for (let i = index; i < figureEnd; i += 1) {
    const ch = source[i] ?? "";
    if (ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return { from: index, to: i + 1 };
      }
    }
  }
  return undefined;
}

function collectRelevantStatementsFromNode(
  node: SyntaxNode,
  source: string,
  state: { nextStatementIndex: number }
): Statement[] {
  const statements: Statement[] = [];
  forEachChild(node, (child) => {
    const unwrapped = unwrapStatementLikeNode(child);
    if (!isRelevantDefinitionNode(unwrapped)) {
      return;
    }
    const mapped = mapStatementNode(unwrapped, source, state);
    if (mapped) {
      statements.push(mapped);
    }
  });
  return statements;
}

function isRelevantDefinitionNode(node: SyntaxNode): boolean {
  const typeName = node.type.name;
  if (
    typeName === "MacroDefinitionStatement" ||
    typeName === "MacroAliasStatement" ||
    typeName === "MacroCommandDefinitionStatement" ||
    typeName === "PgfMathStatement" ||
    typeName === "StyleDefinitionStatement" ||
    typeName === "TikzSetStatement" ||
    typeName === "TikzStyleStatement" ||
    typeName === "PgfkeysStatement" ||
    typeName === "TikzLibraryStatement" ||
    typeName === "ColorletStatement" ||
    typeName === "DefineColorStatement" ||
    typeName === "FontSizeStatement"
  ) {
    return true;
  }
  return false;
}

function findBeginDocumentOffset(source: string): number {
  const match = /\\begin\s*\{\s*document\s*\}/.exec(source);
  if (!match) {
    return source.length;
  }
  return match.index;
}

function isMacroContextStatement(statement: Statement): statement is MacroDefinitionStatement | MacroAliasStatement | MacroCommandDefinitionStatement {
  return (
    statement.kind === "MacroDefinition" ||
    statement.kind === "MacroAlias" ||
    statement.kind === "MacroCommandDefinition"
  );
}

function isColorContextStatement(statement: Statement): statement is ColorletStatement | DefineColorStatement {
  return statement.kind === "Colorlet" || statement.kind === "DefineColor";
}

function collectScopedMacroDefinitionsFromStream(
  source: string,
  parserMacros: readonly (MacroDefinitionStatement | MacroAliasStatement | MacroCommandDefinitionStatement)[]
): Array<MacroDefinitionStatement | MacroAliasStatement | MacroCommandDefinitionStatement> {
  type ScopeFrame = {
    statements: Array<MacroDefinitionStatement | MacroAliasStatement | MacroCommandDefinitionStatement>;
  };
  const parserBySpan = new Map<string, MacroDefinitionStatement | MacroAliasStatement | MacroCommandDefinitionStatement>();
  for (const statement of parserMacros) {
    parserBySpan.set(`${statement.span.from}:${statement.span.to}`, statement);
  }

  const scopes: ScopeFrame[] = [{ statements: [] }];
  let nextStatementIndex = parserMacros.length;
  let cursor = 0;

  while (cursor < source.length) {
    const char = source[cursor] ?? "";

    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }

    if (char === "\\") {
      const command = readControlSequence(source, cursor);
      if (!command) {
        cursor += 1;
        continue;
      }

      cursor = command.to;
      const commandName = command.raw;
      if (commandName === "\\begingroup" || commandName === "\\bgroup") {
        scopes.push({ statements: [] });
        continue;
      }
      if (commandName === "\\endgroup" || commandName === "\\egroup") {
        if (scopes.length > 1) {
          scopes.pop();
        }
        continue;
      }

      if (commandName === "\\begin" || commandName === "\\end") {
        const argCursor = skipWhitespaceAndComments(source, cursor);
        const envGroup = readBalancedDelimited(source, argCursor, "{", "}");
        if (envGroup) {
          cursor = envGroup.to;
          if (commandName === "\\begin") {
            scopes.push({ statements: [] });
          } else if (scopes.length > 1) {
            scopes.pop();
          }
        }
        continue;
      }

      if (commandName === "\\def") {
        const parsed = tryParseDefStatement(source, command.from, cursor, nextStatementIndex);
        if (parsed) {
          cursor = parsed.to;
          nextStatementIndex += 1;
          const key = `${parsed.statement.span.from}:${parsed.statement.span.to}`;
          scopes[scopes.length - 1]?.statements.push(parserBySpan.get(key) ?? parsed.statement);
        }
        continue;
      }

      if (commandName === "\\let") {
        const parsed = tryParseLetStatement(source, command.from, cursor, nextStatementIndex);
        if (parsed) {
          cursor = parsed.to;
          nextStatementIndex += 1;
          const key = `${parsed.statement.span.from}:${parsed.statement.span.to}`;
          scopes[scopes.length - 1]?.statements.push(parserBySpan.get(key) ?? parsed.statement);
        }
        continue;
      }

      if (isMacroCommandDefinitionName(commandName)) {
        const parsed = tryParseNewCommandStatement(
          source,
          commandName,
          command.from,
          cursor,
          nextStatementIndex
        );
        if (parsed) {
          cursor = parsed.to;
          nextStatementIndex += 1;
          const key = `${parsed.statement.span.from}:${parsed.statement.span.to}`;
          scopes[scopes.length - 1]?.statements.push(parserBySpan.get(key) ?? parsed.statement);
        }
        continue;
      }

      continue;
    }

    if (char === "{") {
      scopes.push({ statements: [] });
      cursor += 1;
      continue;
    }
    if (char === "}") {
      if (scopes.length > 1) {
        scopes.pop();
      }
      cursor += 1;
      continue;
    }

    cursor += 1;
  }

  const visible: Array<MacroDefinitionStatement | MacroAliasStatement | MacroCommandDefinitionStatement> = [];
  for (const scope of scopes) {
    visible.push(...scope.statements);
  }
  visible.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return left.span.from - right.span.from;
    }
    return left.span.to - right.span.to;
  });
  return visible;
}

function tryParseDefStatement(
  source: string,
  commandFrom: number,
  fromCursor: number,
  statementIndex: number
): { statement: MacroDefinitionStatement; to: number } | null {
  let cursor = skipWhitespaceAndComments(source, fromCursor);
  const nameToken = readControlSequence(source, cursor);
  if (!nameToken) {
    return null;
  }
  cursor = skipWhitespaceAndComments(source, nameToken.to);
  const valueGroup = readBalancedDelimited(source, cursor, "{", "}");
  if (!valueGroup) {
    return null;
  }
  const spanTo = valueGroup.to;
  return {
    statement: {
      kind: "MacroDefinition",
      id: macroDefinitionStatementId(statementIndex),
      span: { from: commandFrom, to: spanTo },
      raw: source.slice(commandFrom, spanTo),
      commandRaw: "\\def",
      nameRaw: nameToken.raw,
      nameSpan: { from: nameToken.from, to: nameToken.to },
      valueRaw: valueGroup.content,
      valueSpan: { from: valueGroup.from + 1, to: valueGroup.to - 1 }
    },
    to: spanTo
  };
}

function tryParseLetStatement(
  source: string,
  commandFrom: number,
  fromCursor: number,
  statementIndex: number
): { statement: MacroAliasStatement; to: number } | null {
  let cursor = skipWhitespaceAndComments(source, fromCursor);
  const nameToken = readControlSequence(source, cursor);
  if (!nameToken) {
    return null;
  }
  cursor = skipWhitespaceAndComments(source, nameToken.to);
  if ((source[cursor] ?? "") === "=") {
    cursor += 1;
  }
  cursor = skipWhitespaceAndComments(source, cursor);

  let targetSpan: { from: number; to: number } | undefined;
  const targetControl = readControlSequence(source, cursor);
  let targetRaw: string;
  if (targetControl) {
    targetRaw = targetControl.raw;
    targetSpan = { from: targetControl.from, to: targetControl.to };
    cursor = targetControl.to;
  } else {
    const targetGroup = readBalancedDelimited(source, cursor, "{", "}");
    if (!targetGroup) {
      return null;
    }
    targetRaw = targetGroup.content;
    targetSpan = { from: targetGroup.from + 1, to: targetGroup.to - 1 };
    cursor = targetGroup.to;
  }

  return {
    statement: {
      kind: "MacroAlias",
      id: macroAliasStatementId(statementIndex),
      span: { from: commandFrom, to: cursor },
      raw: source.slice(commandFrom, cursor),
      commandRaw: "\\let",
      nameRaw: nameToken.raw,
      nameSpan: { from: nameToken.from, to: nameToken.to },
      targetRaw,
      targetSpan
    },
    to: cursor
  };
}

function tryParseNewCommandStatement(
  source: string,
  commandRaw: "\\newcommand" | "\\renewcommand" | "\\providecommand" | "\\DeclareRobustCommand" | "\\DeclareMathOperator",
  commandFrom: number,
  fromCursor: number,
  statementIndex: number
): { statement: MacroCommandDefinitionStatement; to: number } | null {
  let cursor = skipWhitespaceAndComments(source, fromCursor);
  let starred = false;
  if ((source[cursor] ?? "") === "*") {
    starred = true;
    cursor += 1;
  }
  cursor = skipWhitespaceAndComments(source, cursor);

  let nameSpan: { from: number; to: number } | undefined;
  const directName = readControlSequence(source, cursor);
  let nameRaw: string;
  if (directName) {
    nameRaw = directName.raw;
    nameSpan = { from: directName.from, to: directName.to };
    cursor = directName.to;
  } else {
    const nameGroup = readBalancedDelimited(source, cursor, "{", "}");
    if (!nameGroup) {
      return null;
    }
    const parsedName = /\\(?:[A-Za-z@]+|.)/u.exec(nameGroup.content);
    if (!parsedName) {
      return null;
    }
    const nameFrom = (nameGroup.from + 1) + (parsedName.index ?? 0);
    nameRaw = parsedName[0];
    nameSpan = { from: nameFrom, to: nameFrom + nameRaw.length };
    cursor = nameGroup.to;
  }

  let arity = 0;
  let aritySpan: { from: number; to: number } | undefined;
  let optionalDefaultRaw: string | undefined;
  let optionalDefaultSpan: { from: number; to: number } | undefined;
  if (commandRaw !== "\\DeclareMathOperator") {
    cursor = skipWhitespaceAndComments(source, cursor);
    const arityGroup = readBalancedDelimited(source, cursor, "[", "]");
    if (arityGroup && /^\d+$/u.test(arityGroup.content.trim())) {
      arity = Number.parseInt(arityGroup.content.trim(), 10);
      aritySpan = { from: arityGroup.from + 1, to: arityGroup.to - 1 };
      cursor = arityGroup.to;
    }

    cursor = skipWhitespaceAndComments(source, cursor);
    const optionalGroup = readBalancedDelimited(source, cursor, "[", "]");
    if (optionalGroup) {
      optionalDefaultRaw = optionalGroup.content;
      optionalDefaultSpan = { from: optionalGroup.from + 1, to: optionalGroup.to - 1 };
      cursor = optionalGroup.to;
    }
  }

  cursor = skipWhitespaceAndComments(source, cursor);
  const bodyGroup = readBalancedDelimited(source, cursor, "{", "}");
  if (!bodyGroup) {
    return null;
  }
  cursor = bodyGroup.to;

  return {
    statement: {
      kind: "MacroCommandDefinition",
      id: macroCommandDefinitionStatementId(statementIndex),
      span: { from: commandFrom, to: cursor },
      raw: source.slice(commandFrom, cursor),
      commandRaw,
      nameRaw,
      nameSpan,
      arity,
      aritySpan,
      optionalDefaultRaw,
      optionalDefaultSpan,
      bodyRaw: commandRaw === "\\DeclareMathOperator"
        ? `${starred ? "\\operatorname*" : "\\operatorname"}{${bodyGroup.content}}`
        : bodyGroup.content,
      bodySpan: { from: bodyGroup.from + 1, to: bodyGroup.to - 1 },
      starred
    },
    to: cursor
  };
}

function isMacroCommandDefinitionName(
  commandName: string
): commandName is "\\newcommand" | "\\renewcommand" | "\\providecommand" | "\\DeclareRobustCommand" | "\\DeclareMathOperator" {
  return (
    commandName === "\\newcommand" ||
    commandName === "\\renewcommand" ||
    commandName === "\\providecommand" ||
    commandName === "\\DeclareRobustCommand" ||
    commandName === "\\DeclareMathOperator"
  );
}

function collectScopedColorDefinitionsFromStream(
  source: string,
  parserColorDefs: readonly (ColorletStatement | DefineColorStatement)[]
): Array<ColorletStatement | DefineColorStatement> {
  type ScopeFrame = {
    statements: Array<ColorletStatement | DefineColorStatement>;
  };
  const parserBySpan = new Map<string, ColorletStatement | DefineColorStatement>();
  for (const statement of parserColorDefs) {
    parserBySpan.set(`${statement.span.from}:${statement.span.to}`, statement);
  }

  const scopes: ScopeFrame[] = [{ statements: [] }];
  let nextStatementIndex = parserColorDefs.length;
  let cursor = 0;

  while (cursor < source.length) {
    const char = source[cursor] ?? "";

    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }

    if (char === "\\") {
      const command = readControlSequence(source, cursor);
      if (!command) {
        cursor += 1;
        continue;
      }

      cursor = command.to;
      const commandName = command.raw;
      if (commandName === "\\begingroup" || commandName === "\\bgroup") {
        scopes.push({ statements: [] });
        continue;
      }
      if (commandName === "\\endgroup" || commandName === "\\egroup") {
        if (scopes.length > 1) {
          scopes.pop();
        }
        continue;
      }
      if (commandName === "\\begin" || commandName === "\\end") {
        const argCursor = skipWhitespaceAndComments(source, cursor);
        const envGroup = readBalancedDelimited(source, argCursor, "{", "}");
        if (envGroup) {
          cursor = envGroup.to;
          if (commandName === "\\begin") {
            scopes.push({ statements: [] });
          } else if (scopes.length > 1) {
            scopes.pop();
          }
        }
        continue;
      }

      if (commandName === "\\colorlet") {
        const parsed = tryParseColorletStatement(source, command.from, cursor, nextStatementIndex);
        if (parsed) {
          cursor = parsed.to;
          nextStatementIndex += 1;
          const key = `${parsed.statement.span.from}:${parsed.statement.span.to}`;
          scopes[scopes.length - 1]?.statements.push(parserBySpan.get(key) ?? parsed.statement);
        }
        continue;
      }

      if (commandName === "\\definecolor") {
        const parsed = tryParseDefineColorStatement(source, command.from, cursor, nextStatementIndex);
        if (parsed) {
          cursor = parsed.to;
          nextStatementIndex += 1;
          const key = `${parsed.statement.span.from}:${parsed.statement.span.to}`;
          scopes[scopes.length - 1]?.statements.push(parserBySpan.get(key) ?? parsed.statement);
        }
        continue;
      }

      continue;
    }

    if (char === "{") {
      scopes.push({ statements: [] });
      cursor += 1;
      continue;
    }
    if (char === "}") {
      if (scopes.length > 1) {
        scopes.pop();
      }
      cursor += 1;
      continue;
    }
    cursor += 1;
  }

  const visible: Array<ColorletStatement | DefineColorStatement> = [];
  for (const scope of scopes) {
    visible.push(...scope.statements);
  }
  visible.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return left.span.from - right.span.from;
    }
    return left.span.to - right.span.to;
  });
  return visible;
}

function tryParseColorletStatement(
  source: string,
  commandFrom: number,
  fromCursor: number,
  statementIndex: number
): { statement: ColorletStatement; to: number } | null {
  let cursor = skipWhitespaceAndComments(source, fromCursor);
  const nameGroup = readBalancedDelimited(source, cursor, "{", "}");
  if (!nameGroup) {
    return null;
  }
  cursor = skipWhitespaceAndComments(source, nameGroup.to);
  const valueGroup = readBalancedDelimited(source, cursor, "{", "}");
  if (!valueGroup) {
    return null;
  }
  cursor = valueGroup.to;
  return {
    statement: {
      kind: "Colorlet",
      id: colorletStatementId(statementIndex),
      span: { from: commandFrom, to: cursor },
      raw: source.slice(commandFrom, cursor),
      commandRaw: "\\colorlet",
      nameRaw: nameGroup.content,
      nameSpan: { from: nameGroup.from + 1, to: nameGroup.to - 1 },
      valueRaw: valueGroup.content,
      valueSpan: { from: valueGroup.from + 1, to: valueGroup.to - 1 }
    },
    to: cursor
  };
}

function tryParseDefineColorStatement(
  source: string,
  commandFrom: number,
  fromCursor: number,
  statementIndex: number
): { statement: DefineColorStatement; to: number } | null {
  let cursor = skipWhitespaceAndComments(source, fromCursor);
  const nameGroup = readBalancedDelimited(source, cursor, "{", "}");
  if (!nameGroup) {
    return null;
  }
  cursor = skipWhitespaceAndComments(source, nameGroup.to);
  const modelGroup = readBalancedDelimited(source, cursor, "{", "}");
  if (!modelGroup) {
    return null;
  }
  cursor = skipWhitespaceAndComments(source, modelGroup.to);
  const specificationGroup = readBalancedDelimited(source, cursor, "{", "}");
  if (!specificationGroup) {
    return null;
  }
  cursor = specificationGroup.to;
  return {
    statement: {
      kind: "DefineColor",
      id: defineColorStatementId(statementIndex),
      span: { from: commandFrom, to: cursor },
      raw: source.slice(commandFrom, cursor),
      commandRaw: "\\definecolor",
      nameRaw: nameGroup.content,
      nameSpan: { from: nameGroup.from + 1, to: nameGroup.to - 1 },
      modelRaw: modelGroup.content,
      modelSpan: { from: modelGroup.from + 1, to: modelGroup.to - 1 },
      specificationRaw: specificationGroup.content,
      specificationSpan: { from: specificationGroup.from + 1, to: specificationGroup.to - 1 }
    },
    to: cursor
  };
}

function skipWhitespaceAndComments(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length) {
    const char = source[cursor] ?? "";
    if (/\s/u.test(char)) {
      cursor += 1;
      continue;
    }
    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }
    break;
  }
  return cursor;
}

function skipComment(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length) {
    const char = source[cursor] ?? "";
    cursor += 1;
    if (char === "\n" || char === "\r") {
      break;
    }
  }
  return cursor;
}

function readControlSequence(source: string, from: number): { from: number; to: number; raw: string } | null {
  if ((source[from] ?? "") !== "\\") {
    return null;
  }
  let cursor = from + 1;
  while (cursor < source.length && /[A-Za-z@]/u.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  if (cursor === from + 1) {
    cursor = Math.min(source.length, from + 2);
  }
  return {
    from,
    to: cursor,
    raw: source.slice(from, cursor)
  };
}

function readBalancedDelimited(
  source: string,
  from: number,
  openChar: "{" | "[",
  closeChar: "}" | "]"
): { from: number; to: number; content: string } | null {
  if ((source[from] ?? "") !== openChar) {
    return null;
  }
  let depth = 0;
  let cursor = from;
  while (cursor < source.length) {
    const char = source[cursor] ?? "";
    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === openChar) {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === closeChar) {
      depth -= 1;
      cursor += 1;
      if (depth === 0) {
        return {
          from,
          to: cursor,
          content: source.slice(from + 1, cursor - 1)
        };
      }
      continue;
    }
    cursor += 1;
  }
  return null;
}
