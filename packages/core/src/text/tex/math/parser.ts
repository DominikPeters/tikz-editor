import type {
  TexMathAtom,
  TexMathAtomClass,
  TexMathAccentCommand,
  TexMathAlphabetCommand,
  TexMathAlignedCell,
  TexMathAlignedRow,
  TexMathArrayColumnAlignment,
  TexMathDiagnostic,
  TexMathDiagnosticCode,
  TexMathDelimiter,
  TexMathGlue,
  TexMathItem,
  TexMathLineCommand,
  TexMathList,
  TexMathMatrixEnvironment,
  TexMathNucleus,
  TexMathOperatorCommand,
  TexMathOperatorLimits,
  TexMathOperatorNamePart,
  TexMathParseResult,
  TexMathScript,
  TexMathSourceSpan,
  TexMathStyle,
  TexMathToken,
  TexMathTokenKind,
  TexMathUnsupportedItem,
} from "./ir.js";

interface ParseListOptions {
  readonly stopAtGroupClose: boolean;
  readonly stopAtRight?: boolean;
  readonly stopAtAlignmentTab?: boolean;
  readonly stopAtRowBreak?: boolean;
  readonly stopAtEnvironmentEnd?: string;
  readonly suppressEllipsisGlueBeforeAlignmentTab?: boolean;
}

export interface ParseTexMathOptions {
  readonly sourceOffset?: number;
}

export function parseTexMath(
  source: string,
  options: ParseTexMathOptions = {}
): TexMathParseResult {
  const sourceOffset = options.sourceOffset ?? 0;
  const tokens = tokenizeTexMath(source, sourceOffset);
  const parser = new TexMathParser(tokens, sourceOffset, source.length);
  const list = parser.parseList({ stopAtGroupClose: false });
  return {
    list,
    tokens,
    diagnostics: parser.diagnostics,
  };
}

export function parseTexMathAlignedBody(
  source: string,
  options: ParseTexMathOptions = {}
): TexMathParseResult {
  const sourceOffset = options.sourceOffset ?? 0;
  const tokens = tokenizeTexMath(source, sourceOffset);
  const parser = new TexMathParser(tokens, sourceOffset, source.length);
  const atom = parser.parseAlignedBody({
    beginSourceSpan: { start: sourceOffset, end: sourceOffset },
    initialSourceSpan: { start: sourceOffset, end: sourceOffset },
    allowScripts: false,
  });
  return {
    list: {
      kind: "math-list",
      items: [atom],
      sourceSpan: atom.sourceSpan,
    },
    tokens,
    diagnostics: parser.diagnostics,
  };
}

export function tokenizeTexMath(
  source: string,
  sourceOffset = 0
): readonly TexMathToken[] {
  const tokens: TexMathToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? "";
    const start = sourceOffset + index;
    if (/\s/.test(char)) {
      const spaceStart = index;
      index++;
      while (index < source.length && /\s/.test(source[index] ?? "")) {
        index++;
      }
      tokens.push({
        kind: "space",
        text: source.slice(spaceStart, index),
        sourceSpan: { start, end: sourceOffset + index },
      });
      continue;
    }
    if (char === "\\") {
      const commandStart = index;
      index++;
      if (index < source.length && /[A-Za-z]/.test(source[index] ?? "")) {
        while (index < source.length && /[A-Za-z]/.test(source[index] ?? "")) {
          index++;
        }
      } else if (index < source.length) {
        index++;
      }
      tokens.push({
        kind: "command",
        text: source.slice(commandStart, index),
        sourceSpan: { start, end: sourceOffset + index },
      });
      continue;
    }
    tokens.push({
      kind: tokenKindForCharacter(char),
      text: char,
      sourceSpan: { start, end: start + 1 },
    });
    index++;
  }
  return tokens;
}

function tokenKindForCharacter(char: string): TexMathTokenKind {
  switch (char) {
    case "{":
      return "group-open";
    case "}":
      return "group-close";
    case "_":
      return "subscript";
    case "^":
      return "superscript";
    default:
      return "character";
  }
}

class TexMathParser {
  readonly diagnostics: TexMathDiagnostic[] = [];
  private index = 0;

  constructor(
    private readonly tokens: readonly TexMathToken[],
    private readonly sourceOffset: number,
    private readonly sourceLength: number
  ) {}

  parseList(options: ParseListOptions): TexMathList {
    const start = this.peek()?.sourceSpan.start ?? this.sourceOffset;
    const items: TexMathItem[] = [];
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (!token) {
        break;
      }
      if (token.kind === "group-close") {
        if (options.stopAtGroupClose) {
          break;
        }
        this.addDiagnostic(
          "error",
          "unexpected-group-close",
          "Unexpected closing brace in math formula.",
          token.sourceSpan
        );
        this.advance();
        continue;
      }
      if (token.kind === "command" && commandName(token.text) === "right" && options.stopAtRight) {
        break;
      }
      if (token.kind === "character" && token.text === "&" && options.stopAtAlignmentTab) {
        break;
      }
      if (isMathRowBreakToken(token) && options.stopAtRowBreak) {
        break;
      }
      if (
        token.kind === "command" &&
        commandName(token.text) === "end" &&
        options.stopAtEnvironmentEnd &&
        this.peekEnvironmentName(this.index + 1) === options.stopAtEnvironmentEnd
      ) {
        break;
      }
      if (token.kind === "space") {
        this.advance();
        continue;
      }
      if (token.kind === "subscript" || token.kind === "superscript") {
        this.addDiagnostic(
          "error",
          "missing-script-target",
          `Math ${token.kind === "subscript" ? "subscript" : "superscript"} has no preceding atom.`,
          token.sourceSpan
        );
        this.advance();
        const script = this.parseScriptArgument(token.sourceSpan);
        if (script) {
          items.push(makeUnsupportedItem("<missing-script-target>", spanUnion(token.sourceSpan, script.sourceSpan)));
        }
        continue;
      }
      const item = this.parseItem(true, options);
      if (item) {
        items.push(item);
      }
    }
    const end = items.at(-1)?.sourceSpan.end ?? start;
    return {
      kind: "math-list",
      items,
      sourceSpan: {
        start,
        end: Math.max(start, end),
      },
    };
  }

  private parseItem(
    allowScripts = true,
    listOptions: ParseListOptions = { stopAtGroupClose: false }
  ): TexMathItem | null {
    const token = this.peek();
    if (!token) {
      return null;
    }
    if (token.kind === "command") {
      const spacing = spacingCommandName(token.text);
      if (spacing) {
        this.advance();
        return {
          kind: "glue",
          command: spacing,
          sourceSpan: token.sourceSpan,
        } satisfies TexMathGlue;
      }
      const style = styleCommandName(token.text);
      if (style) {
        this.advance();
        return {
          kind: "style-change",
          style,
          sourceSpan: token.sourceSpan,
        };
      }
      const fractionStyle = fractionCommandStyle(token.text);
      if (fractionStyle !== null) {
        return this.parseFraction(fractionStyle, allowScripts);
      }
      const binomialStyle = binomialCommandStyle(token.text);
      if (binomialStyle !== null) {
        return this.parseBinomial(binomialStyle, allowScripts);
      }
      if (commandName(token.text) === "sqrt") {
        return this.parseRadical(allowScripts);
      }
      const lineCommand = lineCommandName(token.text);
      if (lineCommand) {
        return this.parseLine(lineCommand, allowScripts);
      }
      if (commandName(token.text) === "text") {
        return this.parseText(allowScripts);
      }
      if (commandName(token.text) === "operatorname") {
        return this.parseOperatorName(allowScripts);
      }
      const ellipsis = ellipsisCommandName(token.text);
      if (ellipsis) {
        return this.parseEllipsis(
          ellipsis,
          allowScripts,
          listOptions.suppressEllipsisGlueBeforeAlignmentTab === true
        );
      }
      if (commandName(token.text) === "substack") {
        return this.parseSubstack(allowScripts);
      }
      const alphabet = alphabetCommandName(token.text);
      if (alphabet) {
        return this.parseAlphabet(alphabet, allowScripts);
      }
      const accent = accentCommandName(token.text);
      if (accent) {
        return this.parseAccent(accent, allowScripts);
      }
      const operator = operatorCommandName(token.text);
      if (operator) {
        return this.parseOperator(operator, allowScripts);
      }
      if (commandName(token.text) === "not") {
        return this.parseNot(allowScripts);
      }
      const namedSymbol = namedSymbolCommand(token.text);
      if (namedSymbol) {
        this.advance();
        return this.maybeParseScripts({
          kind: "atom",
          atomClass: namedSymbol.atomClass,
          nucleus: {
            kind: "glyph",
            text: token.text,
            sourceSpan: token.sourceSpan,
          },
          sourceSpan: token.sourceSpan,
        }, allowScripts);
      }
      if (commandName(token.text) === "left") {
        return this.parseLeftRight(allowScripts);
      }
      if (commandName(token.text) === "begin") {
        return this.parseEnvironment(allowScripts);
      }
      const classCommand = atomClassCommandName(token.text);
      if (classCommand) {
        return this.parseClassCommand(classCommand, allowScripts);
      }
      this.advance();
      this.addDiagnostic(
        "warning",
        "unsupported-command",
        `Unsupported math command ${token.text}.`,
        token.sourceSpan
      );
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "ord",
        nucleus: {
          kind: "unsupported",
          command: token.text,
          sourceSpan: token.sourceSpan,
        },
        sourceSpan: token.sourceSpan,
      }, allowScripts);
    }
    if (token.kind === "group-open") {
      return this.parseGroupedAtom(allowScripts);
    }
    if (token.kind === "character") {
      this.advance();
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: atomClassForCharacter(token.text),
        nucleus: {
          kind: "glyph",
          text: token.text,
          sourceSpan: token.sourceSpan,
        },
        sourceSpan: token.sourceSpan,
      }, allowScripts);
    }
    this.advance();
    return null;
  }

  private parseGroupedAtom(allowScripts: boolean): TexMathAtom {
    const open = this.expectGroupOpen();
    const list = this.parseList({ stopAtGroupClose: true });
    const close = this.consumeGroupClose(open.sourceSpan);
    const sourceSpan = spanUnion(open.sourceSpan, close?.sourceSpan ?? list.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "list",
        list,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseFraction(
    style: "display" | "text" | undefined,
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    const numerator = this.parseRequiredGroup(command.sourceSpan, `${command.text} numerator`);
    const denominator = this.parseRequiredGroup(command.sourceSpan, `${command.text} denominator`);
    const sourceSpan = spanUnion(
      command.sourceSpan,
      denominator?.sourceSpan ?? numerator?.sourceSpan ?? command.sourceSpan
    );
    const nucleus: TexMathNucleus = {
      kind: "fraction",
      numerator: numerator?.list ?? emptyList(command.sourceSpan.end),
      denominator: denominator?.list ?? emptyList(command.sourceSpan.end),
      ...(style ? { style } : {}),
      sourceSpan,
    };
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus,
      sourceSpan,
    }, allowScripts);
  }

  private parseBinomial(
    style: "display" | "text" | undefined,
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    const numerator = this.parseRequiredGroup(command.sourceSpan, `${command.text} numerator`);
    const denominator = this.parseRequiredGroup(command.sourceSpan, `${command.text} denominator`);
    const sourceSpan = spanUnion(
      command.sourceSpan,
      denominator?.sourceSpan ?? numerator?.sourceSpan ?? command.sourceSpan
    );
    const nucleus: TexMathNucleus = {
      kind: "fraction",
      numerator: numerator?.list ?? emptyList(command.sourceSpan.end),
      denominator: denominator?.list ?? emptyList(command.sourceSpan.end),
      leftDelimiter: "(",
      rightDelimiter: ")",
      ruleThickness: 0,
      ...(style ? { style } : {}),
      sourceSpan,
    };
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus,
      sourceSpan,
    }, allowScripts);
  }

  private parseRadical(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const radicand = this.parseRequiredGroup(command.sourceSpan, "\\sqrt radicand");
    const sourceSpan = spanUnion(command.sourceSpan, radicand?.sourceSpan ?? command.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "radical",
        radicand: radicand?.list ?? emptyList(command.sourceSpan.end),
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseLine(commandNameValue: TexMathLineCommand, allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const body = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} body`);
    const sourceSpan = spanUnion(command.sourceSpan, body?.sourceSpan ?? command.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "line",
        command: commandNameValue,
        body: body?.list ?? emptyList(command.sourceSpan.end),
        commandSourceSpan: command.sourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseText(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const content = this.parseRequiredTextGroup(command.sourceSpan, "\\text content");
    const sourceSpan = spanUnion(command.sourceSpan, content?.sourceSpan ?? command.sourceSpan);
    if (!content || content.unsupported) {
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "ord",
        nucleus: {
          kind: "unsupported",
          command: "\\text",
          sourceSpan,
        },
        sourceSpan,
      }, allowScripts);
    }
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "text",
        text: content.text,
        textSourceSpan: content.textSourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseSubstack(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const open = this.expectGroupOpen();
    const rows: TexMathAlignedRow[] = [];
    let sourceSpan = spanUnion(command.sourceSpan, open.sourceSpan);

    while (!this.isAtEnd()) {
      if (this.peek()?.kind === "group-close") {
        break;
      }
      const list = this.parseList({
        stopAtGroupClose: true,
        stopAtRowBreak: true,
      });
      sourceSpan = spanUnion(sourceSpan, list.sourceSpan);
      const rowEndToken = this.peek();
      if (isMathRowBreakToken(rowEndToken)) {
        const rowBreak = this.advance();
        sourceSpan = spanUnion(sourceSpan, rowBreak.sourceSpan);
        rows.push({
          cells: [{ list, sourceSpan: list.sourceSpan }],
          sourceSpan: spanUnion(list.sourceSpan, rowBreak.sourceSpan),
          rowBreakSourceSpan: rowBreak.sourceSpan,
        });
        continue;
      }
      rows.push({
        cells: [{ list, sourceSpan: list.sourceSpan }],
        sourceSpan: list.sourceSpan,
      });
      break;
    }

    const close = this.consumeGroupClose(open.sourceSpan);
    sourceSpan = spanUnion(sourceSpan, close?.sourceSpan ?? open.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "substack",
        rows,
        commandSourceSpan: command.sourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseAlphabet(
    alphabet: TexMathAlphabetCommand,
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    const content = this.parseRequiredGroup(command.sourceSpan, `${command.text} content`);
    const sourceSpan = spanUnion(command.sourceSpan, content?.sourceSpan ?? command.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "alphabet",
        alphabet,
        list: content?.list ?? emptyList(command.sourceSpan.end),
        commandSourceSpan: command.sourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseAccent(commandNameValue: TexMathAccentCommand, allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const base = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} base`);
    const sourceSpan = spanUnion(command.sourceSpan, base?.sourceSpan ?? command.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "accent",
        command: commandNameValue,
        base: base?.list ?? emptyList(command.sourceSpan.end),
        commandSourceSpan: command.sourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseOperator(commandNameValue: TexMathOperatorCommand, allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const atom = this.parseOperatorLimitSwitch({
      kind: "atom",
      atomClass: "op",
      nucleus: {
        kind: "operator",
        command: commandNameValue,
        sourceSpan: command.sourceSpan,
      },
      sourceSpan: command.sourceSpan,
    }, allowScripts);
    return this.maybeParseScripts(atom, allowScripts);
  }

  private parseOperatorName(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    let commandSourceSpan = command.sourceSpan;
    let limits: TexMathOperatorLimits = "nolimits";
    const star = this.peek();
    if (star?.kind === "character" && star.text === "*") {
      this.advance();
      commandSourceSpan = spanUnion(commandSourceSpan, star.sourceSpan);
      limits = "display";
    }
    const content = this.parseRequiredOperatorNameGroup(commandSourceSpan);
    const sourceSpan = spanUnion(commandSourceSpan, content?.sourceSpan ?? commandSourceSpan);
    if (!content || content.unsupported) {
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "op",
        nucleus: {
          kind: "unsupported",
          command: commandSourceSpan.end > command.sourceSpan.end ? "\\operatorname*" : "\\operatorname",
          sourceSpan,
        },
        limits,
        sourceSpan,
      }, allowScripts);
    }
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "op",
      nucleus: {
        kind: "operator-name",
        parts: content.parts,
        commandSourceSpan,
        nameSourceSpan: content.nameSourceSpan,
        sourceSpan,
      },
      limits,
      sourceSpan,
    }, allowScripts);
  }

  private parseEllipsis(
    ellipsis: "ldots" | "cdots" | "dots",
    allowScripts: boolean,
    suppressTrailingGlueBeforeAlignmentTab: boolean
  ): TexMathAtom {
    const command = this.advance();
    const resolved = ellipsis === "dots" ? this.amsDotsKind() : ellipsis;
    const dotText: "." | "\\cdot" = resolved === "cdots" ? "\\cdot" : ".";
    const items: TexMathItem[] = [
      ellipsisDotAtom(dotText, command.sourceSpan),
      ellipsisDotAtom(dotText, command.sourceSpan),
      ellipsisDotAtom(dotText, command.sourceSpan),
    ];
    if (shouldAddAmsEllipsisTrailingGlue(
      ellipsis,
      this.peekSignificantToken(),
      suppressTrailingGlueBeforeAlignmentTab
    )) {
      items.push({
        kind: "glue",
        command: ",",
        sourceSpan: command.sourceSpan,
      });
    }
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "inner",
      nucleus: {
        kind: "list",
        list: {
          kind: "math-list",
          items,
          sourceSpan: command.sourceSpan,
        },
        role: "ellipsis",
        ellipsisCommand: ellipsis,
        sourceSpan: command.sourceSpan,
      },
      sourceSpan: command.sourceSpan,
    }, allowScripts);
  }

  private amsDotsKind(): "ldots" | "cdots" {
    const next = this.peekSignificantToken();
    if (!next) {
      return "ldots";
    }
    if (next.kind === "character" && "+=<>-*".includes(next.text)) {
      return "cdots";
    }
    if (next.kind !== "command") {
      return "ldots";
    }
    if (commandName(next.text) === "not") {
      return "cdots";
    }
    const atomClass = atomClassForToken(next);
    return atomClass === "bin" || atomClass === "rel" ? "cdots" : "ldots";
  }

  private parseNot(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    this.skipSpaces();
    const target = this.peek();
    if (!target) {
      this.addDiagnostic(
        "warning",
        "unsupported-command",
        "Unsupported math command \\not.",
        command.sourceSpan
      );
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "rel",
        nucleus: {
          kind: "unsupported",
          command: "\\not",
          sourceSpan: command.sourceSpan,
        },
        sourceSpan: command.sourceSpan,
      }, allowScripts);
    }
    const atomClass = notCompositeAtomClass(target);
    if (!atomClass) {
      this.addDiagnostic(
        "warning",
        "unsupported-command",
        `Unsupported math command \\not${target.text}.`,
        spanUnion(command.sourceSpan, target.sourceSpan)
      );
      this.advance();
      const sourceSpan = spanUnion(command.sourceSpan, target.sourceSpan);
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "rel",
        nucleus: {
          kind: "unsupported",
          command: `\\not${target.text}`,
          sourceSpan,
        },
        sourceSpan,
      }, allowScripts);
    }
    this.advance();
    const sourceSpan = spanUnion(command.sourceSpan, target.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass,
      nucleus: {
        kind: "glyph",
        text: `\\not${target.text}`,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseOperatorLimitSwitch(atom: TexMathAtom, allowLimits: boolean): TexMathAtom {
    if (!allowLimits) {
      return atom;
    }
    this.skipSpaces();
    const token = this.peek();
    if (token?.kind !== "command") {
      return atom;
    }
    const limits = operatorLimitsCommandName(token.text);
    if (!limits) {
      return atom;
    }
    this.advance();
    return {
      ...atom,
      limits,
      sourceSpan: spanUnion(atom.sourceSpan, token.sourceSpan),
    };
  }

  private parseLeftRight(allowScripts: boolean): TexMathAtom {
    const leftCommand = this.advance();
    const leftDelimiter = this.parseDelimiter(leftCommand.sourceSpan, "\\left delimiter");
    const body = this.parseList({ stopAtGroupClose: false, stopAtRight: true });
    const rightCommand = this.peek();
    let rightDelimiter: { delimiter: TexMathDelimiter; sourceSpan: TexMathSourceSpan } | null = null;
    if (rightCommand?.kind === "command" && commandName(rightCommand.text) === "right") {
      this.advance();
      rightDelimiter = this.parseDelimiter(rightCommand.sourceSpan, "\\right delimiter");
    } else {
      this.addDiagnostic(
        "error",
        "missing-right",
        "Expected \\right to close \\left in math formula.",
        rightCommand?.sourceSpan ?? body.sourceSpan
      );
    }

    const fallbackSpan = leftDelimiter?.sourceSpan ?? leftCommand.sourceSpan;
    const sourceSpan = spanUnion(leftCommand.sourceSpan, rightDelimiter?.sourceSpan ?? body.sourceSpan);
    if (!leftDelimiter || !rightDelimiter) {
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "inner",
        nucleus: {
          kind: "unsupported",
          command: "\\left...\\right",
          sourceSpan,
        },
        sourceSpan,
      }, allowScripts);
    }
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "inner",
      nucleus: {
        kind: "left-right",
        leftDelimiter: leftDelimiter.delimiter,
        rightDelimiter: rightDelimiter.delimiter,
        body,
        leftDelimiterSourceSpan: fallbackSpan,
        rightDelimiterSourceSpan: rightDelimiter.sourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseDelimiter(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): { delimiter: TexMathDelimiter; sourceSpan: TexMathSourceSpan } | null {
    this.skipSpaces();
    const token = this.peek();
    if (!token || token.kind === "space" || token.kind === "group-close" || token.kind === "subscript" || token.kind === "superscript") {
      this.addDiagnostic(
        "error",
        "missing-delimiter",
        `Expected a ${label}.`,
        token?.sourceSpan ?? fallbackSpan
      );
      return null;
    }
    const delimiter = delimiterForToken(token);
    if (delimiter) {
      this.advance();
      return { delimiter, sourceSpan: token.sourceSpan };
    }
    this.advance();
    this.addDiagnostic(
      "warning",
      "unsupported-command",
      `Unsupported math delimiter ${token.text}.`,
      token.sourceSpan
    );
    return null;
  }

  private parseClassCommand(
    atomClass: TexMathAtomClass,
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    const content = this.parseRequiredGroup(command.sourceSpan, `${command.text} content`);
    const sourceSpan = spanUnion(command.sourceSpan, content?.sourceSpan ?? command.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass,
      nucleus: {
        kind: "list",
        list: content?.list ?? emptyList(command.sourceSpan.end),
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseEnvironment(allowScripts: boolean): TexMathAtom {
    const beginCommand = this.advance();
    const environmentName = this.parseEnvironmentNameGroup(
      beginCommand.sourceSpan,
      "\\begin environment name"
    );
    if (environmentName?.name === "aligned") {
      return this.parseAlignedEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
    }
    if (environmentName?.name === "array") {
      return this.parseArrayEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
    }
    if (environmentName?.name === "cases") {
      return this.parseCasesEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
    }
    if (environmentName?.name === "smallmatrix") {
      return this.parseSmallMatrixEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
    }
    const matrixEnvironment = matrixEnvironmentName(environmentName?.name);
    if (environmentName && matrixEnvironment) {
      return this.parseMatrixEnvironment(beginCommand.sourceSpan, environmentName, matrixEnvironment, allowScripts);
    }

    const sourceSpan = spanUnion(beginCommand.sourceSpan, environmentName?.sourceSpan ?? beginCommand.sourceSpan);
    this.addDiagnostic(
      "warning",
      "unsupported-command",
      `Unsupported math environment ${environmentName?.name ?? "\\begin"}.`,
      sourceSpan
    );
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "inner",
      nucleus: {
        kind: "unsupported",
        command: environmentName ? `\\begin{${environmentName.name}}` : "\\begin",
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseAlignedEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    allowScripts: boolean
  ): TexMathAtom {
    return this.parseAlignedBody({
      beginSourceSpan,
      initialSourceSpan: spanUnion(beginSourceSpan, environmentName.sourceSpan),
      stopAtEnvironmentEnd: "aligned",
      allowScripts,
    });
  }

  private parseMatrixEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    environment: TexMathMatrixEnvironment,
    allowScripts: boolean
  ): TexMathAtom {
    return this.parseMatrixBody({
      beginSourceSpan,
      initialSourceSpan: spanUnion(beginSourceSpan, environmentName.sourceSpan),
      stopAtEnvironmentEnd: environment,
      environment,
      allowScripts,
    });
  }

  private parseArrayEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    allowScripts: boolean
  ): TexMathAtom {
    const preamble = this.parseArrayPreambleGroup(beginSourceSpan);
    const initialSourceSpan = spanUnion(
      spanUnion(beginSourceSpan, environmentName.sourceSpan),
      preamble?.sourceSpan ?? environmentName.sourceSpan
    );
    if (!preamble || preamble.alignments.length === 0) {
      const sourceSpan = this.consumeUnsupportedEnvironmentBody("array", initialSourceSpan);
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "ord",
        nucleus: {
          kind: "unsupported",
          command: "\\begin{array}",
          sourceSpan,
        },
        sourceSpan,
      }, allowScripts);
    }

    return this.parseArrayBody({
      beginSourceSpan,
      initialSourceSpan,
      preambleSourceSpan: preamble.sourceSpan,
      columnAlignments: preamble.alignments,
      allowScripts,
    });
  }

  private parseCasesEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    allowScripts: boolean
  ): TexMathAtom {
    return this.parseCasesBody({
      beginSourceSpan,
      initialSourceSpan: spanUnion(beginSourceSpan, environmentName.sourceSpan),
      allowScripts,
    });
  }

  private parseSmallMatrixEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    allowScripts: boolean
  ): TexMathAtom {
    return this.parseSmallMatrixBody({
      beginSourceSpan,
      initialSourceSpan: spanUnion(beginSourceSpan, environmentName.sourceSpan),
      allowScripts,
    });
  }

  parseAlignedBody(params: {
    readonly beginSourceSpan: TexMathSourceSpan;
    readonly initialSourceSpan: TexMathSourceSpan;
    readonly stopAtEnvironmentEnd?: string;
    readonly allowScripts: boolean;
  }): TexMathAtom {
    const rows: TexMathAlignedRow[] = [];
    let endSourceSpan: TexMathSourceSpan | undefined;
    let sourceSpan = params.initialSourceSpan;

    while (!this.isAtEnd()) {
      if (params.stopAtEnvironmentEnd && this.isEnvironmentEnd(params.stopAtEnvironmentEnd)) {
        endSourceSpan = this.consumeEnvironmentEnd(params.stopAtEnvironmentEnd);
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        return this.maybeParseScripts(
          alignedAtom(rows, params.beginSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }

      const cells: TexMathAlignedCell[] = [];
      let pendingRowSourceSpan: TexMathSourceSpan | undefined;
      while (!this.isAtEnd()) {
        const cellList = this.parseList({
          stopAtGroupClose: false,
          stopAtAlignmentTab: true,
          stopAtRowBreak: true,
          stopAtEnvironmentEnd: params.stopAtEnvironmentEnd,
          suppressEllipsisGlueBeforeAlignmentTab: true,
        });
        cells.push({
          list: cellList,
          sourceSpan: cellList.sourceSpan,
        });
        sourceSpan = spanUnion(sourceSpan, cellList.sourceSpan);
        pendingRowSourceSpan = spanUnion(
          pendingRowSourceSpan ?? cellList.sourceSpan,
          cellList.sourceSpan
        );

        const separator = this.peek();
        if (separator?.kind === "character" && separator.text === "&") {
          this.advance();
          sourceSpan = spanUnion(sourceSpan, separator.sourceSpan);
          continue;
        }
        break;
      }

      const rowEndToken = this.peek();
      if (isMathRowBreakToken(rowEndToken)) {
        const rowBreak = this.advance();
        sourceSpan = spanUnion(sourceSpan, rowBreak.sourceSpan);
        rows.push({
          cells,
          sourceSpan: spanUnion(cells[0]?.sourceSpan ?? rowBreak.sourceSpan, rowBreak.sourceSpan),
          rowBreakSourceSpan: rowBreak.sourceSpan,
        });
        continue;
      }
      if (params.stopAtEnvironmentEnd && this.isEnvironmentEnd(params.stopAtEnvironmentEnd)) {
        endSourceSpan = this.consumeEnvironmentEnd(params.stopAtEnvironmentEnd);
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? endSourceSpan,
        });
        return this.maybeParseScripts(
          alignedAtom(rows, params.beginSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }
      if (cells.length > 0) {
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? cells[0]?.sourceSpan ?? sourceSpan,
        });
      }
    }

    if (params.stopAtEnvironmentEnd) {
      this.addDiagnostic(
        "error",
        "missing-environment-end",
        `Expected \\end{${params.stopAtEnvironmentEnd}} to close math environment.`,
        params.beginSourceSpan
      );
    }
    return this.maybeParseScripts(
      alignedAtom(rows, params.beginSourceSpan, undefined, sourceSpan),
      params.allowScripts
    );
  }

  private parseMatrixBody(params: {
    readonly beginSourceSpan: TexMathSourceSpan;
    readonly initialSourceSpan: TexMathSourceSpan;
    readonly stopAtEnvironmentEnd: TexMathMatrixEnvironment;
    readonly environment: TexMathMatrixEnvironment;
    readonly allowScripts: boolean;
  }): TexMathAtom {
    const rows: TexMathAlignedRow[] = [];
    let endSourceSpan: TexMathSourceSpan | undefined;
    let sourceSpan = params.initialSourceSpan;

    while (!this.isAtEnd()) {
      if (this.isEnvironmentEnd(params.stopAtEnvironmentEnd)) {
        endSourceSpan = this.consumeEnvironmentEnd(params.stopAtEnvironmentEnd);
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        return this.maybeParseScripts(
          matrixAtom(params.environment, rows, params.beginSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }

      const cells: TexMathAlignedCell[] = [];
      let pendingRowSourceSpan: TexMathSourceSpan | undefined;
      while (!this.isAtEnd()) {
        const cellList = this.parseList({
          stopAtGroupClose: false,
          stopAtAlignmentTab: true,
          stopAtRowBreak: true,
          stopAtEnvironmentEnd: params.stopAtEnvironmentEnd,
        });
        cells.push({
          list: cellList,
          sourceSpan: cellList.sourceSpan,
        });
        sourceSpan = spanUnion(sourceSpan, cellList.sourceSpan);
        pendingRowSourceSpan = spanUnion(
          pendingRowSourceSpan ?? cellList.sourceSpan,
          cellList.sourceSpan
        );

        const separator = this.peek();
        if (separator?.kind === "character" && separator.text === "&") {
          this.advance();
          sourceSpan = spanUnion(sourceSpan, separator.sourceSpan);
          continue;
        }
        break;
      }

      const rowEndToken = this.peek();
      if (isMathRowBreakToken(rowEndToken)) {
        const rowBreak = this.advance();
        sourceSpan = spanUnion(sourceSpan, rowBreak.sourceSpan);
        rows.push({
          cells,
          sourceSpan: spanUnion(cells[0]?.sourceSpan ?? rowBreak.sourceSpan, rowBreak.sourceSpan),
          rowBreakSourceSpan: rowBreak.sourceSpan,
        });
        continue;
      }
      if (this.isEnvironmentEnd(params.stopAtEnvironmentEnd)) {
        endSourceSpan = this.consumeEnvironmentEnd(params.stopAtEnvironmentEnd);
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? endSourceSpan,
        });
        return this.maybeParseScripts(
          matrixAtom(params.environment, rows, params.beginSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }
      if (cells.length > 0) {
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? cells[0]?.sourceSpan ?? sourceSpan,
        });
      }
    }

    this.addDiagnostic(
      "error",
      "missing-environment-end",
      `Expected \\end{${params.stopAtEnvironmentEnd}} to close math environment.`,
      params.beginSourceSpan
    );
    return this.maybeParseScripts(
      matrixAtom(params.environment, rows, params.beginSourceSpan, undefined, sourceSpan),
      params.allowScripts
    );
  }

  private parseArrayBody(params: {
    readonly beginSourceSpan: TexMathSourceSpan;
    readonly initialSourceSpan: TexMathSourceSpan;
    readonly preambleSourceSpan: TexMathSourceSpan;
    readonly columnAlignments: readonly TexMathArrayColumnAlignment[];
    readonly allowScripts: boolean;
  }): TexMathAtom {
    const rows: TexMathAlignedRow[] = [];
    let endSourceSpan: TexMathSourceSpan | undefined;
    let sourceSpan = params.initialSourceSpan;

    while (!this.isAtEnd()) {
      if (this.isEnvironmentEnd("array")) {
        endSourceSpan = this.consumeEnvironmentEnd("array");
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        return this.maybeParseScripts(
          arrayAtom(rows, params.columnAlignments, params.beginSourceSpan, params.preambleSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }

      const cells: TexMathAlignedCell[] = [];
      let pendingRowSourceSpan: TexMathSourceSpan | undefined;
      while (!this.isAtEnd()) {
        const cellList = this.parseList({
          stopAtGroupClose: false,
          stopAtAlignmentTab: true,
          stopAtRowBreak: true,
          stopAtEnvironmentEnd: "array",
        });
        cells.push({
          list: cellList,
          sourceSpan: cellList.sourceSpan,
        });
        sourceSpan = spanUnion(sourceSpan, cellList.sourceSpan);
        pendingRowSourceSpan = spanUnion(
          pendingRowSourceSpan ?? cellList.sourceSpan,
          cellList.sourceSpan
        );

        const separator = this.peek();
        if (separator?.kind === "character" && separator.text === "&") {
          this.advance();
          sourceSpan = spanUnion(sourceSpan, separator.sourceSpan);
          continue;
        }
        break;
      }

      const rowEndToken = this.peek();
      if (isMathRowBreakToken(rowEndToken)) {
        const rowBreak = this.advance();
        sourceSpan = spanUnion(sourceSpan, rowBreak.sourceSpan);
        rows.push({
          cells,
          sourceSpan: spanUnion(cells[0]?.sourceSpan ?? rowBreak.sourceSpan, rowBreak.sourceSpan),
          rowBreakSourceSpan: rowBreak.sourceSpan,
        });
        continue;
      }
      if (this.isEnvironmentEnd("array")) {
        endSourceSpan = this.consumeEnvironmentEnd("array");
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? endSourceSpan,
        });
        return this.maybeParseScripts(
          arrayAtom(rows, params.columnAlignments, params.beginSourceSpan, params.preambleSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }
      if (cells.length > 0) {
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? cells[0]?.sourceSpan ?? sourceSpan,
        });
      }
    }

    this.addDiagnostic(
      "error",
      "missing-environment-end",
      "Expected \\end{array} to close math environment.",
      params.beginSourceSpan
    );
    return this.maybeParseScripts(
      arrayAtom(rows, params.columnAlignments, params.beginSourceSpan, params.preambleSourceSpan, undefined, sourceSpan),
      params.allowScripts
    );
  }

  private parseCasesBody(params: {
    readonly beginSourceSpan: TexMathSourceSpan;
    readonly initialSourceSpan: TexMathSourceSpan;
    readonly allowScripts: boolean;
  }): TexMathAtom {
    const rows: TexMathAlignedRow[] = [];
    let endSourceSpan: TexMathSourceSpan | undefined;
    let sourceSpan = params.initialSourceSpan;

    while (!this.isAtEnd()) {
      if (this.isEnvironmentEnd("cases")) {
        endSourceSpan = this.consumeEnvironmentEnd("cases");
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        return this.maybeParseScripts(
          casesAtom(rows, params.beginSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }

      const cells: TexMathAlignedCell[] = [];
      let pendingRowSourceSpan: TexMathSourceSpan | undefined;
      while (!this.isAtEnd()) {
        const cellList = this.parseList({
          stopAtGroupClose: false,
          stopAtAlignmentTab: true,
          stopAtRowBreak: true,
          stopAtEnvironmentEnd: "cases",
        });
        cells.push({
          list: cellList,
          sourceSpan: cellList.sourceSpan,
        });
        sourceSpan = spanUnion(sourceSpan, cellList.sourceSpan);
        pendingRowSourceSpan = spanUnion(
          pendingRowSourceSpan ?? cellList.sourceSpan,
          cellList.sourceSpan
        );

        const separator = this.peek();
        if (separator?.kind === "character" && separator.text === "&") {
          this.advance();
          sourceSpan = spanUnion(sourceSpan, separator.sourceSpan);
          continue;
        }
        break;
      }

      const rowEndToken = this.peek();
      if (isMathRowBreakToken(rowEndToken)) {
        const rowBreak = this.advance();
        sourceSpan = spanUnion(sourceSpan, rowBreak.sourceSpan);
        rows.push({
          cells,
          sourceSpan: spanUnion(cells[0]?.sourceSpan ?? rowBreak.sourceSpan, rowBreak.sourceSpan),
          rowBreakSourceSpan: rowBreak.sourceSpan,
        });
        continue;
      }
      if (this.isEnvironmentEnd("cases")) {
        endSourceSpan = this.consumeEnvironmentEnd("cases");
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? endSourceSpan,
        });
        return this.maybeParseScripts(
          casesAtom(rows, params.beginSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }
      if (cells.length > 0) {
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? cells[0]?.sourceSpan ?? sourceSpan,
        });
      }
    }

    this.addDiagnostic(
      "error",
      "missing-environment-end",
      "Expected \\end{cases} to close math environment.",
      params.beginSourceSpan
    );
    return this.maybeParseScripts(
      casesAtom(rows, params.beginSourceSpan, undefined, sourceSpan),
      params.allowScripts
    );
  }

  private parseSmallMatrixBody(params: {
    readonly beginSourceSpan: TexMathSourceSpan;
    readonly initialSourceSpan: TexMathSourceSpan;
    readonly allowScripts: boolean;
  }): TexMathAtom {
    const rows: TexMathAlignedRow[] = [];
    let endSourceSpan: TexMathSourceSpan | undefined;
    let sourceSpan = params.initialSourceSpan;

    while (!this.isAtEnd()) {
      if (this.isEnvironmentEnd("smallmatrix")) {
        endSourceSpan = this.consumeEnvironmentEnd("smallmatrix");
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        return this.maybeParseScripts(
          smallMatrixAtom(rows, params.beginSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }

      const cells: TexMathAlignedCell[] = [];
      let pendingRowSourceSpan: TexMathSourceSpan | undefined;
      while (!this.isAtEnd()) {
        const cellList = this.parseList({
          stopAtGroupClose: false,
          stopAtAlignmentTab: true,
          stopAtRowBreak: true,
          stopAtEnvironmentEnd: "smallmatrix",
        });
        cells.push({
          list: cellList,
          sourceSpan: cellList.sourceSpan,
        });
        sourceSpan = spanUnion(sourceSpan, cellList.sourceSpan);
        pendingRowSourceSpan = spanUnion(
          pendingRowSourceSpan ?? cellList.sourceSpan,
          cellList.sourceSpan
        );

        const separator = this.peek();
        if (separator?.kind === "character" && separator.text === "&") {
          this.advance();
          sourceSpan = spanUnion(sourceSpan, separator.sourceSpan);
          continue;
        }
        break;
      }

      const rowEndToken = this.peek();
      if (isMathRowBreakToken(rowEndToken)) {
        const rowBreak = this.advance();
        sourceSpan = spanUnion(sourceSpan, rowBreak.sourceSpan);
        rows.push({
          cells,
          sourceSpan: spanUnion(cells[0]?.sourceSpan ?? rowBreak.sourceSpan, rowBreak.sourceSpan),
          rowBreakSourceSpan: rowBreak.sourceSpan,
        });
        continue;
      }
      if (this.isEnvironmentEnd("smallmatrix")) {
        endSourceSpan = this.consumeEnvironmentEnd("smallmatrix");
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? endSourceSpan,
        });
        return this.maybeParseScripts(
          smallMatrixAtom(rows, params.beginSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }
      if (cells.length > 0) {
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? cells[0]?.sourceSpan ?? sourceSpan,
        });
      }
    }

    this.addDiagnostic(
      "error",
      "missing-environment-end",
      "Expected \\end{smallmatrix} to close math environment.",
      params.beginSourceSpan
    );
    return this.maybeParseScripts(
      smallMatrixAtom(rows, params.beginSourceSpan, undefined, sourceSpan),
      params.allowScripts
    );
  }

  private parseArrayPreambleGroup(
    fallbackSpan: TexMathSourceSpan
  ): { alignments: readonly TexMathArrayColumnAlignment[]; sourceSpan: TexMathSourceSpan } | null {
    this.skipSpaces();
    const next = this.peek();
    if (next?.kind !== "group-open") {
      this.addDiagnostic(
        "error",
        "missing-group",
        "Expected a braced \\begin{array} column preamble.",
        next?.sourceSpan ?? fallbackSpan
      );
      return null;
    }

    const open = this.expectGroupOpen();
    const alignments: TexMathArrayColumnAlignment[] = [];
    let lastSpan = open.sourceSpan;
    let unsupported = false;
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (!token || token.kind === "group-close") {
        break;
      }
      this.advance();
      lastSpan = token.sourceSpan;
      if (token.kind === "space") {
        continue;
      }
      const alignment = arrayPreambleAlignment(token);
      if (alignment) {
        alignments.push(alignment);
        continue;
      }
      unsupported = true;
      this.addDiagnostic(
        "warning",
        "unsupported-command",
        `Unsupported array column specifier ${token.text}.`,
        token.sourceSpan
      );
    }
    const close = this.consumeGroupClose(open.sourceSpan);
    const sourceSpan = spanUnion(open.sourceSpan, close?.sourceSpan ?? lastSpan);
    if (unsupported) {
      return { alignments: [], sourceSpan };
    }
    return { alignments, sourceSpan };
  }

  private consumeUnsupportedEnvironmentBody(
    environmentName: string,
    initialSourceSpan: TexMathSourceSpan
  ): TexMathSourceSpan {
    let sourceSpan = initialSourceSpan;
    while (!this.isAtEnd()) {
      if (this.isEnvironmentEnd(environmentName)) {
        return spanUnion(sourceSpan, this.consumeEnvironmentEnd(environmentName));
      }
      sourceSpan = spanUnion(sourceSpan, this.advance().sourceSpan);
    }
    return sourceSpan;
  }

  private parseEnvironmentNameGroup(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): { name: string; sourceSpan: TexMathSourceSpan } | null {
    this.skipSpaces();
    const open = this.peek();
    if (open?.kind !== "group-open") {
      this.addDiagnostic(
        "error",
        "missing-group",
        `Expected a braced ${label}.`,
        open?.sourceSpan ?? fallbackSpan
      );
      return null;
    }
    this.advance();
    let name = "";
    let lastSpan = open.sourceSpan;
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (!token || token.kind === "group-close") {
        break;
      }
      this.advance();
      name += token.text;
      lastSpan = token.sourceSpan;
    }
    const close = this.consumeGroupClose(open.sourceSpan);
    return {
      name,
      sourceSpan: spanUnion(open.sourceSpan, close?.sourceSpan ?? lastSpan),
    };
  }

  private parseRequiredGroup(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): { list: TexMathList; sourceSpan: TexMathSourceSpan } | null {
    this.skipSpaces();
    const next = this.peek();
    if (next?.kind !== "group-open") {
      this.addDiagnostic(
        "error",
        "missing-group",
        `Expected a braced ${label}.`,
        next?.sourceSpan ?? fallbackSpan
      );
      return null;
    }
    const open = this.expectGroupOpen();
    const list = this.parseList({ stopAtGroupClose: true });
    const close = this.consumeGroupClose(open.sourceSpan);
    return {
      list,
      sourceSpan: spanUnion(open.sourceSpan, close?.sourceSpan ?? list.sourceSpan),
    };
  }

  private parseRequiredTextGroup(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): {
    text: string;
    sourceSpan: TexMathSourceSpan;
    textSourceSpan: TexMathSourceSpan;
    unsupported: boolean;
  } | null {
    this.skipSpaces();
    const next = this.peek();
    if (next?.kind !== "group-open") {
      this.addDiagnostic(
        "error",
        "missing-group",
        `Expected a braced ${label}.`,
        next?.sourceSpan ?? fallbackSpan
      );
      return null;
    }
    const open = this.expectGroupOpen();
    let text = "";
    let lastSpan: TexMathSourceSpan = open.sourceSpan;
    let unsupported = false;
    let depth = 0;
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (!token) {
        break;
      }
      if (token.kind === "group-close" && depth === 0) {
        break;
      }
      this.advance();
      lastSpan = token.sourceSpan;
      if (token.kind === "group-open") {
        depth += 1;
        continue;
      }
      if (token.kind === "group-close") {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (token.kind === "character" || token.kind === "space") {
        text += token.text;
        continue;
      }
      unsupported = true;
      this.addDiagnostic(
        "warning",
        "unsupported-command",
        `Unsupported content in \\text: ${token.text}.`,
        token.sourceSpan
      );
    }
    const close = this.consumeGroupClose(open.sourceSpan);
    const contentStart = open.sourceSpan.end;
    const contentEnd = close?.sourceSpan.start ?? lastSpan.end;
    return {
      text,
      sourceSpan: spanUnion(open.sourceSpan, close?.sourceSpan ?? lastSpan),
      textSourceSpan: { start: contentStart, end: Math.max(contentStart, contentEnd) },
      unsupported,
    };
  }

  private parseRequiredOperatorNameGroup(
    fallbackSpan: TexMathSourceSpan
  ): {
    parts: readonly TexMathOperatorNamePart[];
    sourceSpan: TexMathSourceSpan;
    nameSourceSpan: TexMathSourceSpan;
    unsupported: boolean;
  } | null {
    this.skipSpaces();
    const next = this.peek();
    if (next?.kind !== "group-open") {
      this.addDiagnostic(
        "error",
        "missing-group",
        "Expected a braced \\operatorname name.",
        next?.sourceSpan ?? fallbackSpan
      );
      return null;
    }
    const open = this.expectGroupOpen();
    const parts: TexMathOperatorNamePart[] = [];
    let lastSpan: TexMathSourceSpan = open.sourceSpan;
    let unsupported = false;
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (!token || token.kind === "group-close") {
        break;
      }
      this.advance();
      lastSpan = token.sourceSpan;
      if (token.kind === "space") {
        continue;
      }
      if (token.kind === "character") {
        parts.push({
          kind: "text",
          text: token.text,
          sourceSpan: token.sourceSpan,
        });
        continue;
      }
      if (token.kind === "command") {
        const spacing = spacingCommandName(token.text);
        if (spacing) {
          parts.push({
            kind: "spacing",
            command: spacing,
            sourceSpan: token.sourceSpan,
          });
          continue;
        }
      }
      unsupported = true;
      this.addDiagnostic(
        "warning",
        "unsupported-command",
        `Unsupported content in \\operatorname: ${token.text}.`,
        token.sourceSpan
      );
    }
    const close = this.consumeGroupClose(open.sourceSpan);
    const contentStart = open.sourceSpan.end;
    const contentEnd = close?.sourceSpan.start ?? lastSpan.end;
    return {
      parts,
      sourceSpan: spanUnion(open.sourceSpan, close?.sourceSpan ?? lastSpan),
      nameSourceSpan: { start: contentStart, end: Math.max(contentStart, contentEnd) },
      unsupported,
    };
  }

  private parseRequiredMathArgument(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): { list: TexMathList; sourceSpan: TexMathSourceSpan } | null {
    this.skipSpaces();
    const next = this.peek();
    if (!next || next.kind === "group-close" || next.kind === "subscript" || next.kind === "superscript") {
      this.addDiagnostic(
        "error",
        "missing-group",
        `Expected a math atom or braced ${label}.`,
        next?.sourceSpan ?? fallbackSpan
      );
      return null;
    }
    if (next.kind === "group-open") {
      const open = this.expectGroupOpen();
      const list = this.parseList({ stopAtGroupClose: true });
      const close = this.consumeGroupClose(open.sourceSpan);
      return {
        list,
        sourceSpan: spanUnion(open.sourceSpan, close?.sourceSpan ?? list.sourceSpan),
      };
    }
    const item = this.parseItem(false);
    const list = {
      kind: "math-list",
      items: item ? [item] : [],
      sourceSpan: item?.sourceSpan ?? fallbackSpan,
    } satisfies TexMathList;
    return {
      list,
      sourceSpan: list.sourceSpan,
    };
  }

  private parseScriptArgument(operatorSpan: TexMathSourceSpan): TexMathScript | null {
    this.skipSpaces();
    const next = this.peek();
    if (!next || next.kind === "group-close" || next.kind === "subscript" || next.kind === "superscript") {
      this.addDiagnostic(
        "error",
        "empty-script",
        "Expected a math atom or braced group after script marker.",
        next?.sourceSpan ?? operatorSpan
      );
      return null;
    }
    if (next.kind === "group-open") {
      const open = this.expectGroupOpen();
      const list = this.parseList({ stopAtGroupClose: true });
      const close = this.consumeGroupClose(open.sourceSpan);
      return {
        list,
        sourceSpan: spanUnion(operatorSpan, close?.sourceSpan ?? list.sourceSpan),
      };
    }
    const item = this.parseItem(false);
    const list = {
      kind: "math-list",
      items: item ? [item] : [],
      sourceSpan: item?.sourceSpan ?? operatorSpan,
    } satisfies TexMathList;
    return {
      list,
      sourceSpan: spanUnion(operatorSpan, list.sourceSpan),
    };
  }

  private maybeParseScripts(atom: TexMathAtom, allowScripts: boolean): TexMathAtom {
    return allowScripts ? this.parseScripts(atom) : atom;
  }

  private parseScripts(atom: TexMathAtom): TexMathAtom {
    let subscript: TexMathScript | undefined;
    let superscript: TexMathScript | undefined;
    let sourceSpan = atom.sourceSpan;
    while (true) {
      const token = this.peek();
      if (!token || (token.kind !== "subscript" && token.kind !== "superscript")) {
        break;
      }
      this.advance();
      const script = this.parseScriptArgument(token.sourceSpan);
      if (!script) {
        sourceSpan = spanUnion(sourceSpan, token.sourceSpan);
        continue;
      }
      if (token.kind === "subscript") {
        if (subscript) {
          this.addDiagnostic("error", "duplicate-script", "Duplicate math subscript.", token.sourceSpan);
        }
        subscript = script;
      } else {
        if (superscript) {
          this.addDiagnostic("error", "duplicate-script", "Duplicate math superscript.", token.sourceSpan);
        }
        superscript = script;
      }
      sourceSpan = spanUnion(sourceSpan, script.sourceSpan);
    }
    return {
      ...atom,
      ...(subscript ? { subscript } : {}),
      ...(superscript ? { superscript } : {}),
      sourceSpan,
    };
  }

  private expectGroupOpen(): TexMathToken {
    const token = this.advance();
    if (token.kind !== "group-open") {
      throw new Error("Internal TeX math parser error: expected group-open token.");
    }
    return token;
  }

  private consumeGroupClose(openSpan: TexMathSourceSpan): TexMathToken | null {
    const token = this.peek();
    if (token?.kind === "group-close") {
      return this.advance();
    }
    this.addDiagnostic(
      "error",
      "missing-group",
      "Expected a closing brace in math formula.",
      openSpan
    );
    return null;
  }

  private addDiagnostic(
    severity: "warning" | "error",
    code: TexMathDiagnosticCode,
    message: string,
    sourceSpan: TexMathSourceSpan
  ): void {
    this.diagnostics.push({ severity, code, message, sourceSpan });
  }

  private peek(): TexMathToken | null {
    return this.tokens[this.index] ?? null;
  }

  private peekSignificantToken(): TexMathToken | null {
    let cursor = this.index;
    while (this.tokens[cursor]?.kind === "space") {
      cursor += 1;
    }
    return this.tokens[cursor] ?? null;
  }

  private peekEnvironmentName(startIndex: number): string | null {
    let cursor = startIndex;
    while (this.tokens[cursor]?.kind === "space") {
      cursor += 1;
    }
    const open = this.tokens[cursor];
    if (open?.kind !== "group-open") {
      return null;
    }
    cursor += 1;
    let name = "";
    while (cursor < this.tokens.length) {
      const token = this.tokens[cursor];
      if (!token || token.kind === "group-close") {
        return name;
      }
      name += token.text;
      cursor += 1;
    }
    return null;
  }

  private isEnvironmentEnd(name: string): boolean {
    const token = this.peek();
    return token?.kind === "command" &&
      commandName(token.text) === "end" &&
      this.peekEnvironmentName(this.index + 1) === name;
  }

  private consumeEnvironmentEnd(name: string): TexMathSourceSpan {
    const endCommand = this.advance();
    const environmentName = this.parseEnvironmentNameGroup(
      endCommand.sourceSpan,
      "\\end environment name"
    );
    if (environmentName?.name !== name) {
      this.addDiagnostic(
        "error",
        "missing-environment-end",
        `Expected \\end{${name}} to close math environment.`,
        environmentName?.sourceSpan ?? endCommand.sourceSpan
      );
    }
    return spanUnion(endCommand.sourceSpan, environmentName?.sourceSpan ?? endCommand.sourceSpan);
  }

  private advance(): TexMathToken {
    const token = this.tokens[this.index];
    if (!token) {
      const at = this.sourceOffset + this.sourceLength;
      return { kind: "character", text: "", sourceSpan: { start: at, end: at } };
    }
    this.index++;
    return token;
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private skipSpaces(): void {
    while (this.peek()?.kind === "space") {
      this.advance();
    }
  }
}

function emptyList(at: number): TexMathList {
  return {
    kind: "math-list",
    items: [],
    sourceSpan: { start: at, end: at },
  };
}

function makeUnsupportedItem(
  command: string,
  sourceSpan: TexMathSourceSpan
): TexMathUnsupportedItem {
  return {
    kind: "unsupported",
    command,
    sourceSpan,
  };
}

function ellipsisDotAtom(
  text: "." | "\\cdot",
  sourceSpan: TexMathSourceSpan
): TexMathAtom {
  return {
    kind: "atom",
    atomClass: "punct",
    nucleus: {
      kind: "glyph",
      text,
      sourceSpan,
    },
    sourceSpan,
  };
}

function shouldAddAmsEllipsisTrailingGlue(
  ellipsis: "ldots" | "cdots" | "dots",
  next: TexMathToken | null,
  suppressBeforeAlignmentTab = false
): boolean {
  if (ellipsis === "ldots") {
    return false;
  }
  if (!next) {
    return true;
  }
  if (next.kind === "character" && next.text === "&") {
    return !suppressBeforeAlignmentTab;
  }
  if (ellipsis === "cdots" && next.kind === "character" && [",", ";", "."].includes(next.text)) {
    return true;
  }
  return isAmsDotsRightDelimiter(next);
}

function isAmsDotsRightDelimiter(token: TexMathToken): boolean {
  if (token.kind === "group-close") {
    return false;
  }
  if (token.kind === "character") {
    return [")", "]"].includes(token.text);
  }
  if (token.kind !== "command") {
    return false;
  }
  return [
    "right",
    "rbrace",
    "rangle",
    "rceil",
    "rfloor",
  ].includes(commandName(token.text));
}

function alignedAtom(
  rows: readonly TexMathAlignedRow[],
  beginSourceSpan: TexMathSourceSpan,
  endSourceSpan: TexMathSourceSpan | undefined,
  sourceSpan: TexMathSourceSpan
): TexMathAtom {
  return {
    kind: "atom",
    atomClass: "inner",
    nucleus: {
      kind: "aligned",
      rows,
      beginSourceSpan,
      ...(endSourceSpan ? { endSourceSpan } : {}),
      sourceSpan,
    },
    sourceSpan,
  };
}

function matrixAtom(
  environment: TexMathMatrixEnvironment,
  rows: readonly TexMathAlignedRow[],
  beginSourceSpan: TexMathSourceSpan,
  endSourceSpan: TexMathSourceSpan | undefined,
  sourceSpan: TexMathSourceSpan
): TexMathAtom {
  return {
    kind: "atom",
    atomClass: environment === "matrix" ? "ord" : "inner",
    nucleus: {
      kind: "matrix",
      environment,
      rows,
      beginSourceSpan,
      ...(endSourceSpan ? { endSourceSpan } : {}),
      sourceSpan,
    },
    sourceSpan,
  };
}

function arrayAtom(
  rows: readonly TexMathAlignedRow[],
  columnAlignments: readonly TexMathArrayColumnAlignment[],
  beginSourceSpan: TexMathSourceSpan,
  preambleSourceSpan: TexMathSourceSpan,
  endSourceSpan: TexMathSourceSpan | undefined,
  sourceSpan: TexMathSourceSpan
): TexMathAtom {
  return {
    kind: "atom",
    atomClass: "ord",
    nucleus: {
      kind: "array",
      rows,
      columnAlignments,
      beginSourceSpan,
      preambleSourceSpan,
      ...(endSourceSpan ? { endSourceSpan } : {}),
      sourceSpan,
    },
    sourceSpan,
  };
}

function casesAtom(
  rows: readonly TexMathAlignedRow[],
  beginSourceSpan: TexMathSourceSpan,
  endSourceSpan: TexMathSourceSpan | undefined,
  sourceSpan: TexMathSourceSpan
): TexMathAtom {
  return {
    kind: "atom",
    atomClass: "inner",
    nucleus: {
      kind: "cases",
      rows,
      beginSourceSpan,
      ...(endSourceSpan ? { endSourceSpan } : {}),
      sourceSpan,
    },
    sourceSpan,
  };
}

function smallMatrixAtom(
  rows: readonly TexMathAlignedRow[],
  beginSourceSpan: TexMathSourceSpan,
  endSourceSpan: TexMathSourceSpan | undefined,
  sourceSpan: TexMathSourceSpan
): TexMathAtom {
  return {
    kind: "atom",
    atomClass: "ord",
    nucleus: {
      kind: "smallmatrix",
      rows,
      beginSourceSpan,
      ...(endSourceSpan ? { endSourceSpan } : {}),
      sourceSpan,
    },
    sourceSpan,
  };
}

function commandName(command: string): string {
  return command.startsWith("\\") ? command.slice(1) : command;
}

function arrayPreambleAlignment(token: TexMathToken): TexMathArrayColumnAlignment | null {
  if (token.kind !== "character") {
    return null;
  }
  switch (token.text) {
    case "l":
      return "left";
    case "c":
      return "center";
    case "r":
      return "right";
    default:
      return null;
  }
}

function matrixEnvironmentName(name: string | undefined): TexMathMatrixEnvironment | null {
  if (!name) {
    return null;
  }
  switch (name) {
    case "matrix":
    case "pmatrix":
    case "bmatrix":
    case "Bmatrix":
    case "vmatrix":
    case "Vmatrix":
      return name;
    default:
      return null;
  }
}

function isMathRowBreakToken(token: TexMathToken | null): boolean {
  return token?.kind === "command" && token.text === String.raw`\\`;
}

function spacingCommandName(command: string): TexMathGlue["command"] | null {
  const name = commandName(command);
  if (name === "," || name === ":" || name === ";" || name === "!" || name === "quad" || name === "qquad") {
    return name;
  }
  return null;
}

function fractionCommandStyle(command: string): "display" | "text" | undefined | null {
  switch (commandName(command)) {
    case "frac":
      return undefined;
    case "dfrac":
      return "display";
    case "tfrac":
      return "text";
    default:
      return null;
  }
}

function binomialCommandStyle(command: string): "display" | "text" | undefined | null {
  switch (commandName(command)) {
    case "binom":
      return undefined;
    case "dbinom":
      return "display";
    case "tbinom":
      return "text";
    default:
      return null;
  }
}

function styleCommandName(command: string): TexMathStyle | null {
  switch (commandName(command)) {
    case "displaystyle":
      return "display";
    case "textstyle":
      return "text";
    case "scriptstyle":
      return "script";
    case "scriptscriptstyle":
      return "scriptscript";
    default:
      return null;
  }
}

function accentCommandName(command: string): TexMathAccentCommand | null {
  switch (commandName(command)) {
    case "bar":
      return "bar";
    case "dot":
      return "dot";
    case "ddot":
      return "ddot";
    case "hat":
      return "hat";
    case "tilde":
      return "tilde";
    case "vec":
      return "vec";
    default:
      return null;
  }
}

function lineCommandName(command: string): TexMathLineCommand | null {
  switch (commandName(command)) {
    case "overline":
      return "overline";
    case "underline":
      return "underline";
    default:
      return null;
  }
}

function ellipsisCommandName(command: string): "ldots" | "cdots" | "dots" | null {
  switch (commandName(command)) {
    case "dots":
      return "dots";
    case "ldots":
      return "ldots";
    case "cdots":
      return "cdots";
    default:
      return null;
  }
}

function alphabetCommandName(command: string): TexMathAlphabetCommand | null {
  switch (commandName(command)) {
    case "mathbf":
      return "mathbf";
    case "mathcal":
      return "mathcal";
    case "mathit":
      return "mathit";
    case "mathrm":
      return "mathrm";
    case "mathsf":
      return "mathsf";
    case "mathtt":
      return "mathtt";
    default:
      return null;
  }
}

function operatorLimitsCommandName(command: string): TexMathOperatorLimits | null {
  switch (commandName(command)) {
    case "displaylimits":
      return "display";
    case "limits":
      return "limits";
    case "nolimits":
      return "nolimits";
    default:
      return null;
  }
}

function operatorCommandName(command: string): TexMathOperatorCommand | null {
  switch (commandName(command)) {
    case "bigcap":
      return "bigcap";
    case "bigcup":
      return "bigcup";
    case "coprod":
      return "coprod";
    case "int":
      return "int";
    case "lim":
      return "lim";
    case "oint":
      return "oint";
    case "prod":
      return "prod";
    case "sum":
      return "sum";
    default:
      return null;
  }
}

function namedSymbolCommand(command: string): { atomClass: TexMathAtomClass } | null {
  const name = commandName(command);
  if (ordinaryNamedSymbolCommands.has(name)) {
    return { atomClass: "ord" };
  }
  if (binaryNamedSymbolCommands.has(name)) {
    return { atomClass: "bin" };
  }
  if (relationNamedSymbolCommands.has(name)) {
    return { atomClass: "rel" };
  }
  return null;
}

function notCompositeAtomClass(token: TexMathToken): TexMathAtomClass | null {
  if (token.kind === "character") {
    return atomClassForCharacter(token.text) === "rel" ? "rel" : null;
  }
  if (token.kind !== "command") {
    return null;
  }
  return namedSymbolCommand(token.text)?.atomClass ?? null;
}

function atomClassForToken(token: TexMathToken): TexMathAtomClass | null {
  if (token.kind === "character") {
    return atomClassForCharacter(token.text);
  }
  if (token.kind !== "command") {
    return null;
  }
  const namedSymbol = namedSymbolCommand(token.text);
  if (namedSymbol) {
    return namedSymbol.atomClass;
  }
  return operatorCommandName(token.text) ? "op" : null;
}

const ordinaryNamedSymbolCommands = new Set([
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma",
  "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "exists", "forall", "infty",
]);

const binaryNamedSymbolCommands = new Set([
  "cap", "cdot", "cup", "mp", "pm", "setminus", "times", "vee", "wedge",
]);

const relationNamedSymbolCommands = new Set([
  "approx", "gets", "ge", "geq", "in", "leftarrow", "Leftarrow", "leftrightarrow", "Leftrightarrow",
  "le", "leq", "mapsto", "ne", "neq", "notin", "rightarrow", "Rightarrow", "subset", "subseteq",
  "supset", "supseteq", "to",
]);

function atomClassForCharacter(char: string): TexMathAtomClass {
  if (char === "(" || char === "[") {
    return "open";
  }
  if (char === ")" || char === "]") {
    return "close";
  }
  if (char === "," || char === ";") {
    return "punct";
  }
  if (char === "=" || char === "<" || char === ">") {
    return "rel";
  }
  if (char === "+" || char === "-" || char === "*" || char === "/") {
    return "bin";
  }
  return "ord";
}

function atomClassCommandName(command: string): TexMathAtomClass | null {
  switch (commandName(command)) {
    case "mathord":
      return "ord";
    case "mathop":
      return "op";
    case "mathbin":
      return "bin";
    case "mathrel":
      return "rel";
    case "mathopen":
      return "open";
    case "mathclose":
      return "close";
    case "mathpunct":
      return "punct";
    case "mathinner":
      return "inner";
    default:
      return null;
  }
}

function delimiterForToken(token: TexMathToken): TexMathDelimiter | null {
  if (token.kind === "character") {
    switch (token.text) {
      case ".":
      case "(":
      case ")":
      case "[":
      case "]":
        return token.text;
      case "|":
        return "vert";
      case "/":
        return "slash";
      default:
        return null;
    }
  }
  if (token.kind !== "command") {
    return null;
  }
  switch (commandName(token.text)) {
    case "{":
    case "lbrace":
      return "lbrace";
    case "}":
    case "rbrace":
      return "rbrace";
    case "|":
    case "Vert":
      return "Vert";
    case "vert":
    case "mid":
      return "vert";
    case "backslash":
      return "backslash";
    case "langle":
      return "langle";
    case "rangle":
      return "rangle";
    case "lfloor":
      return "lfloor";
    case "rfloor":
      return "rfloor";
    case "lceil":
      return "lceil";
    case "rceil":
      return "rceil";
    default:
      return null;
  }
}

function spanUnion(a: TexMathSourceSpan, b: TexMathSourceSpan): TexMathSourceSpan {
  return {
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
  };
}
