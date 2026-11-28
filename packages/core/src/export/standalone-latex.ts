import type { PgfMathStatement, Span, Statement } from "../ast/types.js";
import type { OptionListAst } from "../options/types.js";
import { readTexBalancedDelimited, readTexControlSequence, skipTexComment, skipTexWhitespaceAndComments } from "../parser/tex-lexical.js";
import { pgfplotsTableReadFormat } from "../pgfplots/table-io.js";
import { parseTikz } from "../parser/index.js";
import { parseDocumentRootId } from "../document/root-id.js";
import { scanBeamerDocument } from "../beamer/scan.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import { nestedStatements } from "../ast/walk.js";
import { collectPgfplotsPreamble, pgfplotsPackageLines, type PgfplotsPreamble } from "../pgfplots/preamble.js";

export const STANDALONE_LATEX_EXPORT_MIME_TYPE = "application/x-tex;charset=utf-8";
export const DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME = "tikz-export.tex";

export type StandaloneExportDiagnostic = {
  code: string;
  message: string;
  severity: "warning" | "error";
  span?: { from: number; to: number };
  symbolKind?: "macro" | "color" | "style" | "key" | "library" | "file";
  symbolName?: string;
};

export type StandaloneLatexExportArtifact = {
  fileName: string;
  mimeType: "application/x-tex;charset=utf-8";
  text: string;
  complete: boolean;
  diagnostics: StandaloneExportDiagnostic[];
};

export type MinimalTikzSourceArtifact = {
  text: string;
  complete: boolean;
  diagnostics: StandaloneExportDiagnostic[];
  definitionCount: number;
  activeFigureSource: string;
};

export type CreateStandaloneLatexExportArtifactOptions = {
  source: string;
  /** A picture id of the parse (`figure:N`), or a deck picture's document root id (`frame:i:tikzpicture:j`). */
  activeFigureId: string | null;
  fileName?: string;
  documentClassOptions?: readonly string[];
  /**
   * The lengths where the picture is set (a slide picture in a column): the
   * export sets those the picture names, since the standalone class has
   * article's `\textwidth`.
   */
  documentLengths?: Readonly<Partial<Record<"textwidth" | "textheight" | "linewidth" | "columnwidth" | "paperwidth" | "paperheight", number>>>;
};

/** The parse's id of the picture a deck root id (`frame:i:tikzpicture:j`) names; other ids unchanged. */
function exportFigureId(source: string, activeFigureId: string | null): string | null {
  const ref = parseDocumentRootId(activeFigureId ?? "");
  if (ref?.kind !== "beamer-frame-tikz" || ref.layer) return activeFigureId;
  const picture = scanBeamerDocument(source).frames[ref.frameIndex]?.children[ref.index];
  if (!picture) return activeFigureId;
  return parseTikz(source, { recover: true }).figures.find((figure) => figure.span.from === picture.span.from)?.id ?? activeFigureId;
}

/**
 * `\setlength` lines for the document lengths the picture names (the class
 * default otherwise). `\begin{document}` sets `\columnwidth` and `\linewidth`
 * from `\textwidth`, so the preamble sets `\textwidth`; a `\linewidth` a list
 * narrowed is set again at the start of the body (with `%`: no space).
 */
function documentLengthLines(figureSource: string, lengths: CreateStandaloneLatexExportArtifactOptions["documentLengths"]): { preamble: string[]; body: string[] } {
  const named = (name: string) => new RegExp(`\\\\${name}(?![A-Za-z@])`, "u").test(figureSource);
  const value = (name: keyof NonNullable<typeof lengths>) => lengths?.[name];
  const line = (name: string, length: number) => `\\setlength{\\${name}}{${String(Math.round(length * 100000) / 100000)}pt}`;
  const preamble: string[] = []; const body: string[] = [];
  const textwidth = value("textwidth");
  if (textwidth !== undefined && ["textwidth", "linewidth", "columnwidth"].some(named)) preamble.push(line("textwidth", textwidth));
  for (const name of ["textheight", "paperwidth", "paperheight"] as const) {
    const length = value(name);
    if (length !== undefined && named(name)) preamble.push(line(name, length));
  }
  const linewidth = value("linewidth");
  if (linewidth !== undefined && named("linewidth") && Math.abs(linewidth - (textwidth ?? linewidth)) > 1e-6) body.push(`${line("linewidth", linewidth)}%`);
  return { preamble, body };
}

export type CreateMinimalTikzSourceArtifactOptions = {
  source: string;
  activeFigureId: string | null;
};

function normalizeDocumentClassOptions(options: readonly string[] = []): string[] {
  const unique = new Set<string>();
  for (const option of options) {
    const normalized = option.trim();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

export function normalizeStandaloneLatexExportFileName(fileName?: string): string {
  const candidate = fileName?.trim();
  if (!candidate) {
    return DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME;
  }
  if (/\.tex$/i.test(candidate)) {
    return candidate;
  }
  return `${candidate}.tex`;
}

/** The macro `\pgfmathsetmacro`/`\pgfmathtruncatemacro` defines. */
function definedPgfMathMacro(statement: PgfMathStatement): string | null {
  if (statement.commandRaw !== "\\pgfmathsetmacro" && statement.commandRaw !== "\\pgfmathtruncatemacro") return null;
  const name = (statement.argsRaw[0] ?? "").trim().replace(/^\{\s*|\s*\}$/gu, "");
  return /^\\[A-Za-z@]+$/u.test(name) ? name : null;
}

/**
 * A definition from the document outside the exported picture: where it is,
 * the names it defines (control sequences, or pgfmath function names) and the
 * text it reads (which may name further definitions).
 */
type ContextDefinition = { span: Span; names: string[]; reads: string[] };

/** The names a parsed definition statement defines, and the text it reads. */
function statementDefinition(statement: Statement, source: string): ContextDefinition | null {
  switch (statement.kind) {
    case "MacroDefinition":
      return { span: statement.span, names: [statement.nameRaw.trim()], reads: [statement.valueRaw] };
    case "MacroAlias":
      return { span: statement.span, names: [statement.nameRaw.trim()], reads: [statement.targetRaw] };
    case "MacroCommandDefinition":
      return { span: statement.span, names: [statement.nameRaw.trim()], reads: [statement.bodyRaw, statement.optionalDefaultRaw ?? ""] };
    case "PgfMath": {
      const name = definedPgfMathMacro(statement);
      return name ? { span: statement.span, names: [name], reads: statement.argsRaw.slice(1) } : null;
    }
    case "PgfplotsTableRead":
      return { span: statement.span, names: [statement.macroName.trim()], reads: [statement.options?.raw ?? ""] };
    // Colour names are words: a colour named only in a `\pgfplotsset` cycle list is still found.
    case "DefineColor":
      return { span: statement.span, names: [statement.nameRaw.trim()], reads: [statement.specificationRaw] };
    case "Colorlet":
      return { span: statement.span, names: [statement.nameRaw.trim()], reads: [statement.valueRaw] };
    // Carried when the evaluator saw the picture use them (styles, keys, libraries).
    case "TikzSet":
    case "TikzStyle":
    case "Pgfkeys":
    case "TikzLibrary":
      return { span: statement.span, names: [], reads: [source.slice(statement.span.from, statement.span.to)] };
    // The pgfplots settings and the layer declarations are carried on their own; the rest are not definitions.
    case "PgfplotsSet":
    case "PgfLayer":
    case "PgfplotsLibrary":
    case "Path":
    case "Scope":
    case "Foreach":
    case "OverlayGroup":
    case "OverlayDeclaration":
    case "Axis":
    case "UnknownStatement":
      return null;
  }
}

const TEXT_DEFINITION_COMMAND = /\\(newlength|setlength|addtolength|pgfmathdeclarefunction\*?)(?![A-Za-z@])/gu;

/**
 * Definitions the parser keeps no statement for, read from the text: length
 * registers (`\newlength`, `\setlength`, `\addtolength`, which pgfplots axis
 * options read) and `\pgfmathdeclarefunction{name}{n}{body}`.
 */
function scanTextDefinitions(source: string, limit: number, excluded: readonly Span[]): ContextDefinition[] {
  const definitions: ContextDefinition[] = [];
  const masked = maskComments(source.slice(0, limit));
  for (const match of masked.matchAll(TEXT_DEFINITION_COMMAND)) {
    const from = match.index;
    if (excluded.some((span) => from >= span.from && from < span.to)) continue;
    const command = match[1] ?? "";
    const args: string[] = [];
    let cursor = from + match[0].length;
    const argumentCount = command.startsWith("pgfmathdeclarefunction") ? 3 : command === "newlength" ? 1 : 2;
    while (args.length < argumentCount) {
      cursor = skipTexWhitespaceAndComments(masked, cursor, limit);
      if (masked.charAt(cursor) === "{") {
        const group = readTexBalancedDelimited(masked, cursor, "{", "}", limit);
        if (!group) break;
        args.push(source.slice(group.from + 1, group.to - 1));
        cursor = group.to;
      } else if (masked.charAt(cursor) === "\\" && args.length === 0) {
        const name = readTexControlSequence(masked, cursor);
        if (!name) break;
        args.push(name.raw);
        cursor = name.to;
      } else {
        break;
      }
    }
    if (args.length < argumentCount) continue;
    const name = (args[0] ?? "").trim();
    definitions.push({ span: { from, to: cursor }, names: [name], reads: args.slice(1) });
  }
  return definitions;
}

/** The text with comments blanked, offsets kept. */
function maskComments(text: string): string {
  let result = "";
  let cursor = 0;
  while (cursor < text.length) {
    const char = text.charAt(cursor);
    if (char === "\\") {
      result += text.slice(cursor, cursor + 2);
      cursor += 2;
    } else if (char === "%") {
      const end = skipTexComment(text, cursor);
      result += text.slice(cursor, end).replace(/[^\n\r]/gu, " ");
      cursor = end;
    } else {
      result += char;
      cursor += 1;
    }
  }
  return result;
}

/** Control sequences and words (pgfmath function names) in a text. */
function referencedNames(text: string): string[] {
  return [...text.matchAll(/\\[A-Za-z@]+|[A-Za-z][A-Za-z0-9_]*/gu)].map((match) => match[0]);
}

function collectStatementsById(statements: readonly Statement[]): Map<string, Statement[]> {
  const byId = new Map<string, Statement[]>();
  const visit = (entries: readonly Statement[]): void => {
    for (const statement of entries) {
      byId.set(statement.id, [...(byId.get(statement.id) ?? []), statement]);
      const nested = nestedStatements(statement);
      if (nested) {
        visit(nested);
      }
    }
  };
  visit(statements);
  return byId;
}

function collectUsedSourceIds(
  semantic: ReturnType<typeof evaluateTikzFigure>
): Set<string> {
  const used = new Set<string>();
  for (const element of semantic.scene.elements) {
    used.add(element.sourceRef.sourceId);
    if (element.origin?.macroStack) {
      for (const macroOrigin of element.origin.macroStack) {
        used.add(macroOrigin.definitionId);
      }
    }
    for (const styleLayer of element.styleChain) {
      if (styleLayer.sourceRef?.sourceId) {
        used.add(styleLayer.sourceRef.sourceId);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of semantic.symbolDependencyEdges) {
      if (!used.has(edge.consumerStatementId)) {
        continue;
      }
      if (used.has(edge.providerStatementId)) {
        continue;
      }
      used.add(edge.providerStatementId);
      changed = true;
    }
  }
  return used;
}

/**
 * The definitions from outside the picture that it needs, in source order:
 * those the evaluator saw it use (symbol dependencies), then, by name, every
 * definition whose name appears in the picture, in the carried pgfplots
 * settings or in a definition already carried.
 */
function collectContextDefinitionSpans(
  definitions: readonly ContextDefinition[],
  usedDefinitions: ReadonlySet<ContextDefinition>,
  seedTexts: readonly string[]
): Span[] {
  const byName = new Map<string, ContextDefinition[]>();
  for (const definition of definitions) {
    for (const name of definition.names) {
      if (name.length > 0) byName.set(name, [...(byName.get(name) ?? []), definition]);
    }
  }
  const carried = new Set<ContextDefinition>();
  const seenNames = new Set<string>();
  const queue: string[] = [];
  const carry = (definition: ContextDefinition): void => {
    if (carried.has(definition)) return;
    carried.add(definition);
    for (const text of definition.reads) queue.push(...referencedNames(text));
  };
  for (const text of seedTexts) queue.push(...referencedNames(text));
  for (const definition of usedDefinitions) carry(definition);
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || seenNames.has(name)) continue;
    seenNames.add(name);
    for (const definition of byName.get(name) ?? []) carry(definition);
  }
  return [...carried].map((definition) => definition.span).sort((left, right) => left.from - right.from || left.to - right.to);
}

function pickActiveFigureSource(
  source: string,
  parseResult: ReturnType<typeof parseTikz>
): string {
  if (!parseResult.activeFigureId) {
    return source.trim();
  }
  const entry = parseResult.figures.find((figure) => figure.id === parseResult.activeFigureId);
  if (!entry) {
    return source.trim();
  }
  return source.slice(entry.span.from, entry.span.to).trim();
}

function renderDiagnosticsCommentBlock(diagnostics: readonly StandaloneExportDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return "";
  }
  const lines = ["% tikz-editor standalone export diagnostics:"];
  for (const diagnostic of diagnostics) {
    const symbolSuffix =
      diagnostic.symbolKind && diagnostic.symbolName
        ? ` [${diagnostic.symbolKind}:${diagnostic.symbolName}]`
        : "";
    lines.push(`% - (${diagnostic.severity}) ${diagnostic.code}: ${diagnostic.message}${symbolSuffix}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Data files the picture reads: `\\addplot table {file}`, `\\addplot file {…}`
 * and `\\addplot graphics {…}` in the picture, and file-name
 * `\\pgfplotstableread`s in it or carried with it.
 */
function collectExternalDataFiles(
  pictureStatements: readonly Statement[],
  carriedStatements: readonly Statement[],
  settings: readonly OptionListAst[]
): Array<{ name: string; span: Span }> {
  const files: Array<{ name: string; span: Span }> = [];
  const visit = (statement: Statement): void => {
    if (statement.kind === "PgfplotsTableRead" && !pgfplotsTableReadFormat(statement, settings).inline) {
      files.push({ name: statement.dataRaw.trim(), span: statement.dataSpan });
    }
    if (statement.kind === "Axis") {
      for (const item of statement.body) {
        if (item.kind !== "AddPlot") continue;
        const input = item.input;
        if (input.kind === "table" && input.source.kind === "file") files.push({ name: input.source.name, span: input.source.span });
        if (input.kind === "other" && (input.name === "file" || input.name === "graphics") && input.argumentRaw !== undefined) {
          files.push({ name: input.argumentRaw.trim(), span: input.argumentSpan ?? input.span });
        }
      }
    }
    for (const nested of nestedStatements(statement) ?? []) visit(nested);
  };
  for (const statement of [...carriedStatements, ...pictureStatements]) visit(statement);
  return files;
}

/**
 * `\pgfdeclarelayer` and `\pgfsetlayers` from the document before the
 * picture, in source order, when the picture puts anything on a layer: its
 * `{pgfonlayer}` environments name layers only those commands set up.
 */
function collectLayerDeclarationSpans(
  contextStatements: readonly Statement[],
  pictureStatements: readonly Statement[],
  elements: readonly { layer: string }[]
): Span[] {
  let usesLayers = elements.some((element) => element.layer !== "main");
  const visit = (statement: Statement): void => {
    if (statement.kind === "Scope" && statement.environment?.name === "pgfonlayer") usesLayers = true;
    for (const nested of nestedStatements(statement) ?? []) visit(nested);
  };
  for (const statement of pictureStatements) visit(statement);
  if (!usesLayers) return [];
  return contextStatements.filter((statement) => statement.kind === "PgfLayer").map((statement) => statement.span);
}

function analyzeMinimalFigureDependencies(
  options: CreateMinimalTikzSourceArtifactOptions
): {
  diagnostics: StandaloneExportDiagnostic[];
  complete: boolean;
  /** The document's definitions and pgfplots settings the picture needs, in source order. */
  definitionChunks: string[];
  figureSource: string;
  requiredLibraries: readonly string[];
  /** Set when the picture needs pgfplots: what the document's preamble says about it. */
  pgfplots: PgfplotsPreamble | null;
} {
  const parseResult = parseTikz(options.source, {
    recover: true,
    activeFigureId: exportFigureId(options.source, options.activeFigureId),
    includeContextDefinitions: true
  });
  const semanticResult = evaluateTikzFigure(parseResult.figure, parseResult.source);

  const diagnostics: StandaloneExportDiagnostic[] = [];
  for (const diagnostic of parseResult.diagnostics) {
    diagnostics.push({
      code: diagnostic.code ?? "parse-diagnostic",
      message: diagnostic.message,
      severity: diagnostic.severity,
      span: diagnostic.span
    });
  }
  for (const diagnostic of semanticResult.diagnostics) {
    diagnostics.push({
      code: diagnostic.code ?? "semantic-diagnostic",
      message: diagnostic.message,
      severity: diagnostic.severity,
      span: diagnostic.span
    });
  }
  for (const unresolved of semanticResult.unresolvedSymbols) {
    diagnostics.push({
      code: "unresolved-symbol",
      message: `Could not resolve ${unresolved.kind} '${unresolved.name}'.`,
      severity: "error",
      symbolKind: unresolved.kind,
      symbolName: unresolved.name
    });
  }

  const activeFigure = parseResult.figures.find((figure) => figure.id === parseResult.activeFigureId);
  const pictureSpan: Span = activeFigure?.span ?? parseResult.figure.span;
  const otherFigureSpans = parseResult.figures.filter((figure) => figure !== activeFigure).map((figure) => figure.span);
  const inside = (span: Span, outer: Span): boolean => span.from >= outer.from && span.to <= outer.to;
  // The document's definitions in scope for the picture: outside it, and not local to another picture.
  // (Statement ids are only unique within the picture or within the context, so they map to lists.)
  const contextStatements = [...collectStatementsById(parseResult.figure.body).values()].flat()
    .filter((statement) => !inside(statement.span, pictureSpan) && !otherFigureSpans.some((span) => inside(statement.span, span)));
  const figureSource = pickActiveFigureSource(options.source, parseResult);
  const pgfplots = semanticResult.scene.requiredPackages?.includes("pgfplots")
    ? collectPgfplotsPreamble(options.source, contextStatements, pictureSpan.from)
    : null;

  const usedIds = collectUsedSourceIds(semanticResult);
  const definitionByStatement = new Map<Statement, ContextDefinition>();
  for (const statement of contextStatements) {
    const definition = statementDefinition(statement, options.source);
    if (definition) definitionByStatement.set(statement, definition);
  }
  const usedDefinitions = new Set([...definitionByStatement].filter(([statement]) => usedIds.has(statement.id)).map(([, definition]) => definition));
  const definitions = [
    ...definitionByStatement.values(),
    ...scanTextDefinitions(options.source, pictureSpan.from, otherFigureSpans)
  ];
  const settingsText = pgfplots?.settings.map((setting) => setting.raw) ?? [];
  const definitionSpans = [
    ...collectContextDefinitionSpans(definitions, usedDefinitions, [figureSource, ...settingsText]),
    ...collectLayerDeclarationSpans(contextStatements, parseResult.figure.body.filter((statement) => inside(statement.span, pictureSpan)), semanticResult.scene.elements)
  ];
  // The document's `\pgfplotsset`/`\pgfplotstableset` settings go among the definitions in source order
  // (a `\pgfplotstableset{col sep=…}` must precede the `\pgfplotstableread` it formats).
  const definitionChunks = [...definitionSpans, ...(pgfplots?.settings.map((setting) => setting.span) ?? [])]
    .sort((left, right) => left.from - right.from || left.to - right.to)
    .map((span) => options.source.slice(span.from, span.to).trim())
    .filter((chunk) => chunk.length > 0);

  const externalFiles = collectExternalDataFiles(
    parseResult.figure.body.filter((statement) => inside(statement.span, pictureSpan)),
    contextStatements.filter((statement) => definitionSpans.some((span) => span.from === statement.span.from && span.to === statement.span.to)),
    pgfplots?.settings.map((setting) => setting.optionList) ?? []
  );
  for (const file of externalFiles) {
    diagnostics.push({
      code: "standalone-export-external-file",
      message: `The picture reads the data file '${file.name}', which the export references by name but does not include: the exported document compiles only next to that file.`,
      severity: "warning",
      span: file.span,
      symbolKind: "file",
      symbolName: file.name
    });
  }
  return {
    diagnostics,
    complete: !diagnostics.some((diagnostic) => diagnostic.severity === "error") && externalFiles.length === 0,
    definitionChunks,
    figureSource,
    requiredLibraries: semanticResult.scene.requiredTikzLibraries,
    pgfplots
  };
}

function mergeDefinitionChunksWithInferredLibraries(
  definitionChunks: readonly string[],
  requiredLibraries: readonly string[],
  pgfplots: PgfplotsPreamble | null
): string[] {
  // The document's own pgfplots libraries (its settings are among the definitions); the package itself is the including document's.
  const pgfplotsChunks = pgfplots && pgfplots.libraries.length > 0 ? [`\\usepgfplotslibrary{${pgfplots.libraries.join(",")}}`] : [];
  if (requiredLibraries.length === 0) {
    return [...pgfplotsChunks, ...definitionChunks];
  }
  return [`\\usetikzlibrary{${requiredLibraries.join(",")}}`, ...pgfplotsChunks, ...definitionChunks];
}

export function createMinimalTikzSourceArtifact(
  options: CreateMinimalTikzSourceArtifactOptions
): MinimalTikzSourceArtifact {
  const analysis = analyzeMinimalFigureDependencies(options);
  const definitionChunks = mergeDefinitionChunksWithInferredLibraries(
    analysis.definitionChunks,
    analysis.requiredLibraries,
    analysis.pgfplots
  );
  const chunks = [...definitionChunks, analysis.figureSource].filter((chunk) => chunk.trim().length > 0);
  return {
    text: `${chunks.join("\n")}\n`,
    complete: analysis.complete,
    diagnostics: analysis.diagnostics,
    definitionCount: definitionChunks.length,
    activeFigureSource: analysis.figureSource
  };
}

export function createStandaloneLatexExportArtifact(
  options: CreateStandaloneLatexExportArtifactOptions
): StandaloneLatexExportArtifact {
  const analysis = analyzeMinimalFigureDependencies(options);
  const definitionChunks = analysis.definitionChunks;
  const classOptions = normalizeDocumentClassOptions(options.documentClassOptions);
  const classOptionsText = classOptions.length > 0 ? `[${classOptions.join(",")}]` : "";
  const requiredLibraries = analysis.requiredLibraries;

  const lines: string[] = [];
  lines.push(`\\documentclass${classOptionsText}{standalone}`);
  lines.push("\\usepackage{tikz}");
  if (requiredLibraries.length > 0) {
    lines.push(`\\usetikzlibrary{${requiredLibraries.join(",")}}`);
  }
  if (analysis.pgfplots) {
    lines.push(...pgfplotsPackageLines(analysis.pgfplots));
  }
  // Definitions go in the preamble: in the body, the spaces between them would widen the standalone page.
  lines.push(...definitionChunks);
  const lengthLines = documentLengthLines(analysis.figureSource, options.documentLengths);
  lines.push(...lengthLines.preamble);
  lines.push("\\begin{document}");
  lines.push(...lengthLines.body);
  lines.push(analysis.figureSource);
  lines.push("\\end{document}");
  const diagnosticsComment = renderDiagnosticsCommentBlock(analysis.diagnostics);
  const text = `${diagnosticsComment}${lines.join("\n")}\n`;

  return {
    fileName: normalizeStandaloneLatexExportFileName(options.fileName),
    mimeType: STANDALONE_LATEX_EXPORT_MIME_TYPE,
    text,
    complete: analysis.complete,
    diagnostics: analysis.diagnostics
  };
}
