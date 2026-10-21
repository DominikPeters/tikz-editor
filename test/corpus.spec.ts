import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectTikzSnippetsFromDocs,
  type TikzSnippet,
} from "../packages/core/src/corpus/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { emitSvg } from "../packages/core/src/svg/emit.js";

describe("pgf-docs corpus regression", () => {
  const docsRoot = join(process.cwd(), "pgf-docs");

  const testCase = existsSync(docsRoot) ? it : it.skip;

  testCase("extracts snippets and tracks parse+semantic+svg quality metrics", () => {
    const snippets = collectTikzSnippetsFromDocs(docsRoot);
    const tikzPictureSnippets = snippets.filter((snippet) => snippet.kind === "tikzpicture");
    const tikzInlineSnippets = snippets.filter((snippet) => snippet.kind === "tikz-inline");
    const parserInputs = snippets
      .map((snippet) => {
        const parserInput = toParserInput(snippet);
        if (!parserInput) {
          return null;
        }
        return { snippet, parserInput };
      })
      .filter((entry): entry is { snippet: TikzSnippet; parserInput: string } => entry !== null);

    const diagnosticCounts = new Map<string, number>();
    const recoveryByFile = new Map<string, number>();
    const semanticDiagnosticCounts = new Map<string, number>();
    const unsupportedSemanticDiagnosticCounts = new Map<string, number>();
    const semanticUnsupportedByFile = new Map<string, number>();
    const svgDiagnosticCounts = new Map<string, number>();
    const hardFailures: Array<{ filePath: string; startLine: number; message: string }> = [];

    let parsedClean = 0;
    let parsedWithRecovery = 0;
    let snippetsWithPathStatements = 0;
    let snippetsWithNodeItems = 0;
    let snippetsWithCoordinateItems = 0;
    let snippetsAllUnknownStatements = 0;

    let totalStatements = 0;
    let pathStatements = 0;
    let scopeStatements = 0;
    let foreachStatements = 0;
    let unknownStatements = 0;
    let totalPathItems = 0;
    let coordinateItems = 0;
    let nodeItems = 0;
    let commentItems = 0;
    let optionItems = 0;
    let keywordItems = 0;
    let plotOperationItems = 0;
    let toOperationItems = 0;
    let svgOperationItems = 0;
    let letOperationItems = 0;
    let coordinateOperationItems = 0;
    let unknownPathItems = 0;
    let semanticErrorSnippets = 0;
    let semanticWarningSnippets = 0;
    let semanticUnsupportedSnippets = 0;
    let semanticEmptySceneSnippets = 0;
    let semanticTotalElements = 0;
    let semanticPathElements = 0;
    let semanticCircleElements = 0;
    let semanticEllipseElements = 0;
    let semanticTextElements = 0;

    for (const { snippet, parserInput } of parserInputs) {
      try {
        const result = parseTikz(parserInput, { recover: true });
        const hasParseError = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");

        if (hasParseError) {
          parsedWithRecovery += 1;
          increment(recoveryByFile, snippet.filePath);
        } else {
          parsedClean += 1;
        }

        let hasPathStatement = false;
        let hasNodeItem = false;
        let hasCoordinateItem = false;
        let allUnknown = result.figure.body.length > 0;
        const flattenedStatements = flattenStatements(result.figure.body);
        totalStatements += flattenedStatements.length;

        for (const statement of flattenedStatements) {
          if (statement.kind === "Path") {
            hasPathStatement = true;
            allUnknown = false;
            pathStatements += 1;
            totalPathItems += statement.items.length;

            for (const item of statement.items) {
              if (item.kind === "Coordinate") {
                hasCoordinateItem = true;
                coordinateItems += 1;
              } else if (item.kind === "Node") {
                hasNodeItem = true;
                nodeItems += 1;
              } else if (item.kind === "PathComment") {
                commentItems += 1;
              } else if (item.kind === "PathOption") {
                optionItems += 1;
              } else if (item.kind === "PathKeyword") {
                keywordItems += 1;
              } else if (item.kind === "PlotOperation") {
                plotOperationItems += 1;
              } else if (item.kind === "ToOperation") {
                toOperationItems += 1;
              } else if (item.kind === "SvgOperation") {
                svgOperationItems += 1;
              } else if (item.kind === "LetOperation") {
                letOperationItems += 1;
              } else if (item.kind === "CoordinateOperation") {
                coordinateOperationItems += 1;
              } else {
                unknownPathItems += 1;
              }
            }
          } else if (statement.kind === "Scope") {
            scopeStatements += 1;
          } else if (statement.kind === "Foreach") {
            foreachStatements += 1;
          } else {
            unknownStatements += 1;
          }
        }

        if (hasPathStatement) {
          snippetsWithPathStatements += 1;
        }
        if (hasNodeItem) {
          snippetsWithNodeItems += 1;
        }
        if (hasCoordinateItem) {
          snippetsWithCoordinateItems += 1;
        }
        if (allUnknown) {
          snippetsAllUnknownStatements += 1;
        }

        for (const diagnostic of result.diagnostics) {
          increment(diagnosticCounts, diagnostic.code ?? diagnostic.message);
        }

        const semantic = evaluateTikzFigure(result.figure, parserInput);
        const svg = emitSvg(semantic.scene);
        const semanticHasError = semantic.diagnostics.some((diagnostic) => diagnostic.severity === "error");
        const semanticHasWarning = semantic.diagnostics.some((diagnostic) => diagnostic.severity === "warning");
        const semanticHasUnsupported = semantic.diagnostics.some((diagnostic) =>
          (diagnostic.code ?? "").startsWith("unsupported")
        );

        if (semanticHasError) {
          semanticErrorSnippets += 1;
        }
        if (semanticHasWarning) {
          semanticWarningSnippets += 1;
        }
        if (semanticHasUnsupported) {
          semanticUnsupportedSnippets += 1;
          increment(semanticUnsupportedByFile, snippet.filePath);
        }
        if (semantic.scene.elements.length === 0) {
          semanticEmptySceneSnippets += 1;
        }

        semanticTotalElements += semantic.scene.elements.length;
        for (const element of semantic.scene.elements) {
          if (element.kind === "Path") {
            semanticPathElements += 1;
          } else if (element.kind === "Circle") {
            semanticCircleElements += 1;
          } else if (element.kind === "Ellipse") {
            semanticEllipseElements += 1;
          } else if (element.kind === "Text") {
            semanticTextElements += 1;
          }
        }

        for (const diagnostic of semantic.diagnostics) {
          const code = diagnostic.code ?? diagnostic.message;
          increment(semanticDiagnosticCounts, code);
          if (code.startsWith("unsupported")) {
            increment(unsupportedSemanticDiagnosticCounts, code);
          }
        }
        for (const diagnostic of svg.diagnostics) {
          increment(svgDiagnosticCounts, diagnostic.code);
        }
      } catch (error) {
        hardFailures.push({
          filePath: snippet.filePath,
          startLine: snippet.startLine,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const topDiagnosticCodes = [...diagnosticCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([code, count]) => ({ code, count }));

    const topRecoveryFiles = [...recoveryByFile.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([filePath, count]) => ({ filePath, count }));
    const topSemanticDiagnosticCodes = [...semanticDiagnosticCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([code, count]) => ({ code, count }));
    const topSemanticUnsupportedCodes = [...unsupportedSemanticDiagnosticCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([code, count]) => ({ code, count }));
    const topSemanticUnsupportedFiles = [...semanticUnsupportedByFile.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([filePath, count]) => ({ filePath, count }));
    const topSvgDiagnosticCodes = [...svgDiagnosticCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([code, count]) => ({ code, count }));

    const snapshot = {
      extraction: {
        filesScanned: new Set(snippets.map((snippet) => snippet.filePath)).size,
        totalSnippets: snippets.length,
        tikzPictureSnippets: tikzPictureSnippets.length,
        tikzInlineSnippets: tikzInlineSnippets.length,
        parserInputSnippets: parserInputs.length,
        parserInputInlineSnippets: parserInputs.filter((entry) => entry.snippet.kind === "tikz-inline").length,
        incompleteSnippets: snippets.filter((snippet) => snippet.incomplete).length
      },
      parse: {
        parsedClean,
        parsedWithRecovery,
        failedHard: hardFailures.length,
        recoverableRate: parserInputs.length === 0 ? 0 : Number((parsedWithRecovery / parserInputs.length).toFixed(4))
      },
      semantic: {
        semanticErrorSnippets,
        semanticWarningSnippets,
        semanticUnsupportedSnippets,
        semanticEmptySceneSnippets,
        semanticErrorRate:
          parserInputs.length === 0 ? 0 : Number((semanticErrorSnippets / parserInputs.length).toFixed(4)),
        semanticWarningRate:
          parserInputs.length === 0 ? 0 : Number((semanticWarningSnippets / parserInputs.length).toFixed(4)),
        semanticUnsupportedRate:
          parserInputs.length === 0 ? 0 : Number((semanticUnsupportedSnippets / parserInputs.length).toFixed(4)),
        semanticEmptySceneRate:
          parserInputs.length === 0 ? 0 : Number((semanticEmptySceneSnippets / parserInputs.length).toFixed(4)),
        elementTotals: {
          total: semanticTotalElements,
          paths: semanticPathElements,
          circles: semanticCircleElements,
          ellipses: semanticEllipseElements,
          texts: semanticTextElements
        }
      },
      semanticCoverage: {
        snippetsWithPathStatements,
        snippetsWithNodeItems,
        snippetsWithCoordinateItems,
        snippetsAllUnknownStatements,
        snippetPathCoverageRate:
          parserInputs.length === 0 ? 0 : Number((snippetsWithPathStatements / parserInputs.length).toFixed(4)),
        snippetNodeCoverageRate:
          parserInputs.length === 0 ? 0 : Number((snippetsWithNodeItems / parserInputs.length).toFixed(4)),
        snippetCoordinateCoverageRate:
          parserInputs.length === 0 ? 0 : Number((snippetsWithCoordinateItems / parserInputs.length).toFixed(4)),
        allUnknownSnippetRate:
          parserInputs.length === 0 ? 0 : Number((snippetsAllUnknownStatements / parserInputs.length).toFixed(4)),
        statementTotals: {
          totalStatements,
          pathStatements,
          scopeStatements,
          foreachStatements,
          unknownStatements,
          pathStatementRate: totalStatements === 0 ? 0 : Number((pathStatements / totalStatements).toFixed(4)),
          unknownStatementRate: totalStatements === 0 ? 0 : Number((unknownStatements / totalStatements).toFixed(4))
        },
        pathItemTotals: {
          totalPathItems,
          coordinateItems,
          nodeItems,
          commentItems,
          optionItems,
          keywordItems,
          plotOperationItems,
          toOperationItems,
          svgOperationItems,
          letOperationItems,
          coordinateOperationItems,
          unknownPathItems,
          coordinateItemRate: totalPathItems === 0 ? 0 : Number((coordinateItems / totalPathItems).toFixed(4)),
          nodeItemRate: totalPathItems === 0 ? 0 : Number((nodeItems / totalPathItems).toFixed(4)),
          commentItemRate: totalPathItems === 0 ? 0 : Number((commentItems / totalPathItems).toFixed(4)),
          optionItemRate: totalPathItems === 0 ? 0 : Number((optionItems / totalPathItems).toFixed(4)),
          keywordItemRate: totalPathItems === 0 ? 0 : Number((keywordItems / totalPathItems).toFixed(4)),
          plotOperationItemRate: totalPathItems === 0 ? 0 : Number((plotOperationItems / totalPathItems).toFixed(4)),
          toOperationItemRate: totalPathItems === 0 ? 0 : Number((toOperationItems / totalPathItems).toFixed(4)),
          svgOperationItemRate: totalPathItems === 0 ? 0 : Number((svgOperationItems / totalPathItems).toFixed(4)),
          letOperationItemRate: totalPathItems === 0 ? 0 : Number((letOperationItems / totalPathItems).toFixed(4)),
          coordinateOperationItemRate:
            totalPathItems === 0 ? 0 : Number((coordinateOperationItems / totalPathItems).toFixed(4)),
          unknownPathItemRate: totalPathItems === 0 ? 0 : Number((unknownPathItems / totalPathItems).toFixed(4))
        }
      },
      topDiagnosticCodes,
      topSemanticDiagnosticCodes,
      topSemanticUnsupportedCodes,
      topSemanticUnsupportedFiles,
      topSvgDiagnosticCodes,
      topRecoveryFiles,
      sampleHardFailures: hardFailures.slice(0, 5)
    };

    expect(parserInputs.length).toBeGreaterThan(50);
    expect(hardFailures).toHaveLength(0);
    expect(snapshot).toMatchSnapshot();
  }, 120000);
});

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function flattenStatements(
  statements: ReturnType<typeof parseTikz>["figure"]["body"]
): ReturnType<typeof parseTikz>["figure"]["body"] {
  const flattened: ReturnType<typeof parseTikz>["figure"]["body"] = [];
  for (const statement of statements) {
    flattened.push(statement);
    if (statement.kind === "Scope") {
      flattened.push(...flattenStatements(statement.body));
    }
  }
  return flattened;
}

function toParserInput(snippet: TikzSnippet): string | null {
  if (snippet.kind === "tikzpicture") {
    return snippet.source;
  }

  if (snippet.kind === "tikz-inline") {
    return normalizeInlineTikz(snippet.source) ?? normalizeInlineTikzBestEffort(snippet.source);
  }

  return null;
}

function normalizeInlineTikz(source: string): string | null {
  const trimmed = source.trim();
  const tikzMatch = /^\\tikz\b/u.exec(trimmed);
  if (!tikzMatch) {
    return null;
  }

  let cursor = tikzMatch[0].length;
  cursor = skipWhitespaceAndComments(trimmed, cursor);

  let options = "";
  if (trimmed[cursor] === "[") {
    const parsedOptions = readBalancedSegment(trimmed, cursor, "[", "]");
    if (!parsedOptions) {
      return null;
    }
    options = trimmed.slice(cursor, parsedOptions.end);
    cursor = skipWhitespaceAndComments(trimmed, parsedOptions.end);
  }

  let body: string;
  if (trimmed[cursor] === "{") {
    const parsedBody = readBalancedSegment(trimmed, cursor, "{", "}");
    if (!parsedBody) {
      return null;
    }
    body = trimmed.slice(cursor + 1, parsedBody.end - 1).trim();
    cursor = skipWhitespaceAndComments(trimmed, parsedBody.end);
    if (trimmed[cursor] === ";") {
      cursor += 1;
      cursor = skipWhitespaceAndComments(trimmed, cursor);
    }
    if (cursor !== trimmed.length) {
      return null;
    }
  } else {
    body = trimmed.slice(cursor).trim();
  }

  if (body.length === 0) {
    return null;
  }

  const begin = options.length > 0 ? `\\begin{tikzpicture}${options}` : "\\begin{tikzpicture}";
  return `${begin}\n${body}\n\\end{tikzpicture}`;
}

function normalizeInlineTikzBestEffort(source: string): string | null {
  const trimmed = source.trim();
  const tikzMatch = /^\\tikz\b/u.exec(trimmed);
  if (!tikzMatch) {
    return null;
  }

  let cursor = tikzMatch[0].length;
  cursor = skipWhitespaceAndComments(trimmed, cursor);

  let options = "";
  if (trimmed[cursor] === "[") {
    const parsedOptions = readBalancedSegment(trimmed, cursor, "[", "]");
    if (parsedOptions) {
      options = trimmed.slice(cursor, parsedOptions.end);
      cursor = skipWhitespaceAndComments(trimmed, parsedOptions.end);
    }
  }

  let body: string;
  if (trimmed[cursor] === "{") {
    const parsedBody = readBalancedSegment(trimmed, cursor, "{", "}");
    if (parsedBody) {
      body = trimmed.slice(cursor + 1, parsedBody.end - 1).trim();
    } else {
      body = trimmed.slice(cursor + 1).trim();
    }
  } else {
    body = trimmed.slice(cursor).trim();
  }

  if (body.length === 0) {
    return null;
  }

  const begin = options.length > 0 ? `\\begin{tikzpicture}${options}` : "\\begin{tikzpicture}";
  return `${begin}\n${body}\n\\end{tikzpicture}`;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let cursor = start;

  while (cursor < source.length) {
    const ch = source[cursor];
    if (/\s/u.test(ch)) {
      cursor += 1;
      continue;
    }
    if (ch === "%" && source[cursor - 1] !== "\\") {
      const newlineIndex = source.indexOf("\n", cursor + 1);
      if (newlineIndex === -1) {
        return source.length;
      }
      cursor = newlineIndex + 1;
      continue;
    }
    break;
  }

  return cursor;
}

function readBalancedSegment(source: string, start: number, openChar: string, closeChar: string): { end: number } | null {
  if (source[start] !== openChar) {
    return null;
  }

  let depth = 0;
  let inComment = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inComment) {
      if (ch === "\n") {
        inComment = false;
      }
      continue;
    }

    if (ch === "%" && source[i - 1] !== "\\") {
      inComment = true;
      continue;
    }

    if (ch === "\\") {
      i += 1;
      continue;
    }

    if (ch === openChar) {
      depth += 1;
      continue;
    }

    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { end: i + 1 };
      }
    }
  }

  return null;
}
