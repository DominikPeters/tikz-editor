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
  TexMathDelimiterSizeCommand,
  TexMathExtensibleArrowCommand,
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
  TexMathTextPart,
  TexMathToken,
  TexMathTokenKind,
  TexMathUnsupportedItem,
} from "./ir.js";

interface ParseListOptions {
  readonly stopAtGroupClose: boolean;
  readonly stopAtRight?: boolean;
  readonly stopAtAlignmentTab?: boolean;
  readonly stopAtRowBreak?: boolean;
  readonly stopAtAlignmentMetadata?: boolean;
  readonly stopAtEnvironmentEnd?: string;
  readonly stopAtOptionalBracketClose?: boolean;
  readonly allowInfixFraction?: boolean;
  readonly suppressEllipsisGlueBeforeAlignmentTab?: boolean;
  readonly suppressTerminalEllipsisGlue?: boolean;
  readonly alignmentColumnSeparation?: "align" | "none" | "gather" | "multline";
}

type InfixFractionPrimitive =
  | "above"
  | "abovewithdelims"
  | "over"
  | "choose"
  | "atop"
  | "brack"
  | "brace"
  | "overwithdelims"
  | "atopwithdelims";

interface DeclaredMathOperator {
  readonly parts: readonly TexMathOperatorNamePart[];
  readonly limits: TexMathOperatorLimits;
}

export interface ParseTexMathOptions {
  readonly sourceOffset?: number;
  readonly suppressTerminalEllipsisGlue?: boolean;
}

interface ParseTexMathAlignedBodyOptions extends ParseTexMathOptions {
  readonly columnSeparation?: "align" | "none" | "gather" | "multline";
  readonly allowDisplayBreak?: boolean;
}

export function parseTexMath(
  source: string,
  options: ParseTexMathOptions = {}
): TexMathParseResult {
  const sourceOffset = options.sourceOffset ?? 0;
  const tokens = tokenizeTexMath(source, sourceOffset);
  const parser = new TexMathParser(tokens, sourceOffset, source.length, options);
  const list = parser.parseList({ stopAtGroupClose: false });
  parser.reportTopLevelTagDiagnostics();
  return {
    list,
    tokens,
    diagnostics: parser.diagnostics,
  };
}

export function parseTexMathAlignedBody(
  source: string,
  options: ParseTexMathAlignedBodyOptions = {}
): TexMathParseResult {
  const sourceOffset = options.sourceOffset ?? 0;
  const tokens = tokenizeTexMath(source, sourceOffset);
  const parser = new TexMathParser(tokens, sourceOffset, source.length, options);
  const atom = parser.parseAlignedBody({
    beginSourceSpan: { start: sourceOffset, end: sourceOffset },
    initialSourceSpan: { start: sourceOffset, end: sourceOffset },
    columnSeparation: options.columnSeparation,
    allowDisplayBreak: options.allowDisplayBreak ?? false,
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

export function parseTexMathDisplayBody(
  source: string,
  options: ParseTexMathOptions = {}
): TexMathParseResult {
  const sourceOffset = options.sourceOffset ?? 0;
  const tokens = tokenizeTexMath(source, sourceOffset);
  const parser = new TexMathParser(tokens, sourceOffset, source.length, options);
  const list = parser.parseDisplayBody();
  parser.reportTopLevelTagDiagnostics();
  return {
    list,
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
  private readonly activeAlignmentEnvironments: string[] = [];
  private readonly declaredMathOperators = new Map<string, DeclaredMathOperator>();

  constructor(
    private readonly tokens: readonly TexMathToken[],
    private readonly sourceOffset: number,
    private readonly sourceLength: number,
    private readonly options: ParseTexMathOptions = {}
  ) {}

  reportTopLevelTagDiagnostics(): void {
    const tagTokens = this.tokens.filter((token) =>
      token.kind === "command" && alignmentMetadataCommand(token.text) === "tag"
    );
    if (tagTokens.length <= 1) {
      return;
    }
    this.addDiagnostic(
      "error",
      "unsupported-command",
      String.raw`Multiple \tag`,
      spanUnion(tagTokens[0]?.sourceSpan, tagTokens[1]?.sourceSpan)
    );
  }

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
      if (token.kind === "command" && options.stopAtAlignmentMetadata && alignmentMetadataCommand(token.text)) {
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
      if (token.kind === "character" && token.text === "]" && options.stopAtOptionalBracketClose) {
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
      const infixFraction = token.kind === "command" ? infixFractionPrimitive(token.text) : null;
      if (infixFraction) {
        if (options.allowInfixFraction === false) {
          this.addDiagnostic(
            "error",
            "ambiguous-infix-fraction",
            `Ambiguous use of ${token.text}.`,
            token.sourceSpan
          );
          this.advance();
          items.push(makeUnsupportedItem(token.text, token.sourceSpan));
          continue;
        }
        return this.parseInfixFractionList(items, infixFraction, options);
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

  parseDisplayBody(): TexMathList {
    const list = this.parseList({
      stopAtGroupClose: false,
      stopAtAlignmentMetadata: true,
      suppressTerminalEllipsisGlue: this.options.suppressTerminalEllipsisGlue === true,
    });
    const metadata = this.consumeAlignmentRowMetadata(true, { allowDisplayBreak: false });
    return {
      ...list,
      sourceSpan: spanUnion(list.sourceSpan, metadata.sourceSpan ?? list.sourceSpan),
      ...(metadata.labels.length > 0 ? { displayLabels: metadata.labels } : {}),
      ...(metadata.suppressTag ? { suppressDisplayTag: true } : {}),
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
      if (commandName(token.text) === "cfrac") {
        return this.parseContinuedFraction(allowScripts);
      }
      if (commandName(token.text) === "genfrac") {
        return this.parseGenfrac(allowScripts);
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
      if (commandName(token.text) === "DeclareMathOperator") {
        this.parseDeclareMathOperator();
        return null;
      }
      const extensibleArrow = extensibleArrowCommandName(token.text);
      if (extensibleArrow) {
        return this.parseExtensibleArrow(extensibleArrow, allowScripts);
      }
      const bigDelimiter = bigDelimiterCommand(token.text);
      if (bigDelimiter) {
        return this.parseBigDelimiter(bigDelimiter, allowScripts);
      }
      const declaredOperator = this.declaredMathOperators.get(commandName(token.text));
      if (declaredOperator) {
        return this.parseDeclaredMathOperator(declaredOperator, allowScripts);
      }
      const namedOperator = namedOperatorCommandName(token.text);
      if (namedOperator) {
        return this.parseNamedOperator(namedOperator, allowScripts);
      }
      const ellipsis = ellipsisCommandName(token.text);
      if (ellipsis) {
        return this.parseEllipsis(
          ellipsis,
          allowScripts,
          listOptions.suppressEllipsisGlueBeforeAlignmentTab === true,
          listOptions.suppressTerminalEllipsisGlue === true
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
      const shove = shoveCommandName(token.text);
      if (shove) {
        return this.parseMisplacedShoveCommand(listOptions.alignmentColumnSeparation);
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
    const numerator = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} numerator`);
    const denominator = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} denominator`);
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

  private parseContinuedFraction(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const alignmentOption = this.consumeOptionalCfracAlignment();
    const numerator = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} numerator`);
    const denominator = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} denominator`);
    const sourceSpan = spanUnion(
      command.sourceSpan,
      denominator?.sourceSpan ?? numerator?.sourceSpan ?? alignmentOption?.sourceSpan ?? command.sourceSpan
    );
    const nucleus: TexMathNucleus = {
      kind: "fraction",
      numerator: numerator?.list ?? emptyList(command.sourceSpan.end),
      denominator: denominator?.list ?? emptyList(command.sourceSpan.end),
      style: "display",
      continued: {
        numeratorAlignment: alignmentOption?.alignment ?? "center",
      },
      sourceSpan,
    };
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus,
      sourceSpan,
    }, allowScripts);
  }

  private parseGenfrac(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const leftDelimiter = this.parseGenfracDelimiterArgument(command, "left delimiter");
    const rightDelimiter = this.parseGenfracDelimiterArgument(command, "right delimiter");
    const thickness = this.parseGenfracThicknessArgument(command);
    const style = this.parseGenfracStyleArgument(command);
    const numerator = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} numerator`);
    const denominator = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} denominator`);
    const sourceSpan = spanUnion(
      command.sourceSpan,
      denominator?.sourceSpan ??
        numerator?.sourceSpan ??
        style.sourceSpan ??
        thickness.sourceSpan ??
        rightDelimiter.sourceSpan ??
        leftDelimiter.sourceSpan
    );
    const nucleus: TexMathNucleus = {
      kind: "fraction",
      numerator: numerator?.list ?? emptyList(command.sourceSpan.end),
      denominator: denominator?.list ?? emptyList(command.sourceSpan.end),
      ...(leftDelimiter.delimiter ? { leftDelimiter: leftDelimiter.delimiter } : {}),
      ...(rightDelimiter.delimiter ? { rightDelimiter: rightDelimiter.delimiter } : {}),
      ...(thickness.ruleThickness !== undefined ? { ruleThickness: thickness.ruleThickness } : {}),
      ...(style.style ? { style: style.style } : {}),
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
    const numerator = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} numerator`);
    const denominator = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} denominator`);
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
    const radicand = this.parseRequiredMathArgument(command.sourceSpan, "\\sqrt radicand");
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
        parts: content.parts,
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
    const base = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} base`, {
      stopAtGroupClose: true,
      suppressTerminalEllipsisGlue: true,
    });
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

  private parseDeclareMathOperator(): void {
    const command = this.advance();
    let commandSourceSpan = command.sourceSpan;
    let limits: TexMathOperatorLimits = "nolimits";
    const star = this.peek();
    if (star?.kind === "character" && star.text === "*") {
      this.advance();
      commandSourceSpan = spanUnion(commandSourceSpan, star.sourceSpan);
      limits = "display";
    }
    const declaredCommand = this.parseRequiredControlSequenceGroup(
      commandSourceSpan,
      `${command.text} command name`
    );
    const content = this.parseRequiredOperatorNameGroup(commandSourceSpan);
    if (!declaredCommand || !content || content.unsupported) {
      return;
    }
    this.declaredMathOperators.set(declaredCommand.name, {
      parts: content.parts,
      limits,
    });
  }

  private parseDeclaredMathOperator(
    declaration: DeclaredMathOperator,
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    const parts = declaration.parts.map((part, index): TexMathOperatorNamePart => {
      const sourceSpan = operatorPartUseSourceSpan(command.sourceSpan, index);
      return part.kind === "text"
        ? { kind: "text", text: part.text, sourceSpan }
        : { kind: "spacing", command: part.command, sourceSpan };
    });
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "op",
      nucleus: {
        kind: "operator-name",
        parts,
        commandSourceSpan: command.sourceSpan,
        nameSourceSpan: command.sourceSpan,
        sourceSpan: command.sourceSpan,
      },
      limits: declaration.limits,
      sourceSpan: command.sourceSpan,
    }, allowScripts);
  }

  private parseExtensibleArrow(
    commandNameValue: TexMathExtensibleArrowCommand,
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    const below = this.parseOptionalBracketMathArgument(command.sourceSpan);
    const above = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} label`);
    const sourceSpan = spanUnion(
      command.sourceSpan,
      above?.sourceSpan ?? below?.sourceSpan ?? command.sourceSpan
    );
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "rel",
      nucleus: {
        kind: "extensible-arrow",
        command: commandNameValue,
        above: above?.list ?? emptyList(command.sourceSpan.end),
        ...(below ? { below: below.list } : {}),
        commandSourceSpan: command.sourceSpan,
        aboveSourceSpan: above?.sourceSpan ?? command.sourceSpan,
        ...(below ? { belowSourceSpan: below.sourceSpan } : {}),
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseNamedOperator(name: string, allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const parts: TexMathOperatorNamePart[] = [...name].map((character, index) => ({
      kind: "text",
      text: character,
      sourceSpan: index === 0 ? command.sourceSpan : { start: command.sourceSpan.end, end: command.sourceSpan.end },
    }));
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "op",
      nucleus: {
        kind: "operator-name",
        parts,
        commandSourceSpan: command.sourceSpan,
        nameSourceSpan: command.sourceSpan,
        sourceSpan: command.sourceSpan,
      },
      limits: defaultNamedOperatorLimits(name),
      sourceSpan: command.sourceSpan,
    }, allowScripts);
  }

  private parseEllipsis(
    ellipsis: "ldots" | "cdots" | "dots",
    allowScripts: boolean,
    suppressTrailingGlueBeforeAlignmentTab: boolean,
    suppressTerminalEllipsisGlue: boolean
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
      suppressTrailingGlueBeforeAlignmentTab,
      suppressTerminalEllipsisGlue || this.options.suppressTerminalEllipsisGlue === true
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

  private consumeLeadingMultlineShove(): {
    readonly alignment: "left" | "right";
    readonly sourceSpan: TexMathSourceSpan;
  } | null {
    this.skipSpaces();
    const token = this.peek();
    const shove = token?.kind === "command" ? shoveCommandName(token.text) : null;
    if (!token || !shove) {
      return null;
    }
    this.advance();
    return {
      alignment: shove,
      sourceSpan: token.sourceSpan,
    };
  }

  private parseMisplacedShoveCommand(
    columnSeparation: "align" | "none" | "gather" | "multline" | undefined
  ): TexMathAtom {
    const command = this.advance();
    this.addDiagnostic(
      "error",
      "unsupported-command",
      columnSeparation === "multline"
        ? `${command.text} must come at the beginning of the line.`
        : `${command.text} only allowed in multline environment.`,
      command.sourceSpan
    );
    return {
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "unsupported",
        command: command.text,
        sourceSpan: command.sourceSpan,
      },
      sourceSpan: command.sourceSpan,
    };
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

  private parseBigDelimiter(commandNameValue: TexMathBigDelimiterCommand, allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const delimiter = this.parseDelimiter(command.sourceSpan, `${command.text} delimiter`);
    const sourceSpan = spanUnion(command.sourceSpan, delimiter?.sourceSpan ?? command.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: commandNameValue.atomClass ?? (delimiter ? atomClassForDelimiter(delimiter.delimiter) : "ord"),
      nucleus: delimiter
        ? {
            kind: "sized-delimiter",
            command: commandNameValue.size,
            delimiter: delimiter.delimiter,
            commandSourceSpan: command.sourceSpan,
            delimiterSourceSpan: delimiter.sourceSpan,
            sourceSpan,
          }
        : {
            kind: "unsupported",
            command: command.text,
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
    if (environmentName && alignedEnvironmentName(environmentName.name)) {
      const invalidNestedAlignment = this.invalidNestedAlignmentEnvironment(environmentName.name);
      if (invalidNestedAlignment) {
        const sourceSpan = this.consumeUnsupportedEnvironmentBody(
          environmentName.name,
          spanUnion(beginCommand.sourceSpan, environmentName.sourceSpan)
        );
        this.addDiagnostic(
          "error",
          "invalid-environment-nesting",
          invalidNestedAlignment.message,
          spanUnion(beginCommand.sourceSpan, environmentName.sourceSpan)
        );
        return this.maybeParseScripts({
          kind: "atom",
          atomClass: "inner",
          nucleus: {
            kind: "unsupported",
            command: `\\begin{${environmentName.name}}`,
            sourceSpan,
          },
          sourceSpan,
        }, allowScripts);
      }
      return this.parseAlignedEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
    }
    if (environmentName && alignatEnvironmentName(environmentName.name)) {
      return this.parseAlignatEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
    }
    if (environmentName?.name === "alignedat") {
      return this.parseAlignedatEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
    }
    if (environmentName && xalignatEnvironmentName(environmentName.name)) {
      return this.parseUnsupportedXalignatEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
    }
    if (environmentName?.name === "equation*") {
      return this.parseSingleBodyDisplayEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
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
    if (environmentName?.name === "subarray") {
      return this.parseSubarrayEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
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

  private parseSingleBodyDisplayEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    allowScripts: boolean
  ): TexMathAtom {
    const initialSourceSpan = spanUnion(beginSourceSpan, environmentName.sourceSpan);
    const list = this.parseList({
      stopAtGroupClose: false,
      stopAtEnvironmentEnd: environmentName.name,
      stopAtAlignmentMetadata: true,
      suppressTerminalEllipsisGlue: true,
    });
    const metadata = this.consumeAlignmentRowMetadata(true, { allowDisplayBreak: false });
    const endSourceSpan = this.isEnvironmentEnd(environmentName.name)
      ? this.consumeEnvironmentEnd(environmentName.name)
      : this.missingEnvironmentEnd(environmentName.name, metadata.sourceSpan ?? list.sourceSpan);
    const listSourceSpan = spanUnion(list.sourceSpan, metadata.sourceSpan ?? list.sourceSpan);
    const sourceSpan = spanUnion(spanUnion(initialSourceSpan, listSourceSpan), endSourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "inner",
      nucleus: {
        kind: "list",
        list: {
          ...list,
          sourceSpan: listSourceSpan,
          ...(metadata.labels.length > 0 ? { displayLabels: metadata.labels } : {}),
          ...(metadata.suppressTag ? { suppressDisplayTag: true } : {}),
        },
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
      stopAtEnvironmentEnd: environmentName.name,
      columnSeparation: gatherEnvironmentName(environmentName.name) || gatheredEnvironmentName(environmentName.name)
        ? "gather"
        : multlineEnvironmentName(environmentName.name)
          ? "multline"
          : "align",
      ...(multlineEnvironmentName(environmentName.name) ? { maxFields: 1 } : {}),
      allowAlignmentTags: displayAlignmentEnvironmentName(environmentName.name),
      allowDisplayBreak: displayAlignmentEnvironmentName(environmentName.name),
      allowScripts,
    });
  }

  private parseAlignatEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    allowScripts: boolean
  ): TexMathAtom {
    const initialSourceSpan = spanUnion(beginSourceSpan, environmentName.sourceSpan);
    const pairCount = this.parsePositiveIntegerGroup(
      initialSourceSpan,
      `\\begin{${environmentName.name}} column count`
    );
    return this.parseAlignedBody({
      beginSourceSpan,
      initialSourceSpan: spanUnion(initialSourceSpan, pairCount?.sourceSpan ?? initialSourceSpan),
      preambleSourceSpan: pairCount?.sourceSpan,
      stopAtEnvironmentEnd: environmentName.name,
      columnSeparation: "none",
      maxFields: pairCount ? pairCount.value * 2 : undefined,
      allowAlignmentTags: true,
      allowDisplayBreak: true,
      allowScripts,
    });
  }

  private parseAlignedatEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    allowScripts: boolean
  ): TexMathAtom {
    const position = this.consumeOptionalArrayPosition();
    const initialSourceSpan = spanUnion(
      spanUnion(beginSourceSpan, environmentName.sourceSpan),
      position ?? environmentName.sourceSpan
    );
    const pairCount = this.parsePositiveIntegerGroup(
      initialSourceSpan,
      "\\begin{alignedat} column count"
    );
    return this.parseAlignedBody({
      beginSourceSpan,
      initialSourceSpan: spanUnion(initialSourceSpan, pairCount?.sourceSpan ?? initialSourceSpan),
      preambleSourceSpan: pairCount?.sourceSpan,
      stopAtEnvironmentEnd: environmentName.name,
      columnSeparation: "none",
      maxFields: pairCount ? pairCount.value * 2 : undefined,
      allowAlignmentTags: false,
      allowDisplayBreak: false,
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
    const position = this.consumeOptionalArrayPosition();
    const preamble = this.parseArrayPreambleGroup(beginSourceSpan);
    const initialSourceSpan = spanUnion(
      spanUnion(spanUnion(beginSourceSpan, environmentName.sourceSpan), position ?? environmentName.sourceSpan),
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

  private parseSubarrayEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    allowScripts: boolean
  ): TexMathAtom {
    const preamble = this.parseSubarrayPreambleGroup(beginSourceSpan);
    const initialSourceSpan = spanUnion(
      spanUnion(beginSourceSpan, environmentName.sourceSpan),
      preamble?.sourceSpan ?? environmentName.sourceSpan
    );
    return this.parseSubarrayBody({
      beginSourceSpan,
      initialSourceSpan,
      preambleSourceSpan: preamble?.sourceSpan ?? environmentName.sourceSpan,
      columnAlignment: preamble?.alignment ?? "left",
      allowScripts,
    });
  }

  private parseUnsupportedXalignatEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    allowScripts: boolean
  ): TexMathAtom {
    const initialSourceSpan = spanUnion(beginSourceSpan, environmentName.sourceSpan);
    const argument = this.parseRequiredRawGroup(initialSourceSpan, `\\begin{${environmentName.name}} column count`);
    const argumentValue = argument ? Number.parseInt(argument.text.trim(), 10) : Number.NaN;
    const validArgument = Number.isInteger(argumentValue) &&
      argumentValue > 0 &&
      String(argumentValue) === argument?.text.trim();
    if (!validArgument) {
      this.addDiagnostic(
        "error",
        "invalid-environment-argument",
        `Argument to \\begin{${environmentName.name}} must be a positive integer.`,
        argument?.contentSourceSpan ?? argument?.sourceSpan ?? initialSourceSpan
      );
    }

    const body = this.consumeXalignatBody(environmentName.name, validArgument ? argumentValue : null);
    const sourceSpan = spanUnion(
      initialSourceSpan,
      body.sourceSpan ?? argument?.sourceSpan ?? initialSourceSpan
    );
    if (body.extraAlignmentTabSourceSpan) {
      this.addDiagnostic(
        "error",
        "extra-alignment-tab",
        `Extra & in row of ${environmentName.name}.`,
        body.extraAlignmentTabSourceSpan
      );
    }
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "inner",
      nucleus: {
        kind: "unsupported",
        command: `\\begin{${environmentName.name}}`,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parsePositiveIntegerGroup(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): { readonly value: number; readonly sourceSpan: TexMathSourceSpan } | null {
    const argument = this.parseRequiredRawGroup(fallbackSpan, label);
    const text = argument?.text.trim() ?? "";
    const value = Number.parseInt(text, 10);
    const valid = Number.isInteger(value) &&
      value > 0 &&
      String(value) === text;
    if (!valid) {
      this.addDiagnostic(
        "error",
        "invalid-environment-argument",
        `Argument to ${label.replace(/ column count$/u, "")} must be a positive integer.`,
        argument?.contentSourceSpan ?? argument?.sourceSpan ?? fallbackSpan
      );
      return null;
    }
    return {
      value,
      sourceSpan: argument?.sourceSpan ?? fallbackSpan,
    };
  }

  parseAlignedBody(params: {
    readonly beginSourceSpan: TexMathSourceSpan;
    readonly initialSourceSpan: TexMathSourceSpan;
    readonly preambleSourceSpan?: TexMathSourceSpan;
    readonly stopAtEnvironmentEnd?: string;
    readonly columnSeparation?: "align" | "none" | "gather" | "multline";
    readonly maxFields?: number;
    readonly allowAlignmentTags?: boolean;
    readonly allowDisplayBreak?: boolean;
    readonly allowScripts: boolean;
  }): TexMathAtom {
    if (params.stopAtEnvironmentEnd) {
      this.activeAlignmentEnvironments.push(params.stopAtEnvironmentEnd);
    }
    try {
      return this.parseAlignedBodyContent(params);
    } finally {
      if (params.stopAtEnvironmentEnd) {
        this.activeAlignmentEnvironments.pop();
      }
    }
  }

  private parseAlignedBodyContent(params: {
    readonly beginSourceSpan: TexMathSourceSpan;
    readonly initialSourceSpan: TexMathSourceSpan;
    readonly preambleSourceSpan?: TexMathSourceSpan;
    readonly stopAtEnvironmentEnd?: string;
    readonly columnSeparation?: "align" | "none" | "gather" | "multline";
    readonly maxFields?: number;
    readonly allowAlignmentTags?: boolean;
    readonly allowDisplayBreak?: boolean;
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
          alignedAtom(rows, params.beginSourceSpan, params.preambleSourceSpan, endSourceSpan, sourceSpan, {
            columnSeparation: params.columnSeparation,
            maxFields: params.maxFields,
          }),
          params.allowScripts
        );
      }

      const cells: TexMathAlignedCell[] = [];
      let suppressTag = false;
      const labels: Array<{
        readonly text: string;
        readonly sourceSpan: TexMathSourceSpan;
        readonly textSourceSpan: TexMathSourceSpan;
      }> = [];
      let multlineShove: "left" | "right" | undefined;
      let pendingRowSourceSpan: TexMathSourceSpan | undefined;
      let alignmentTabsInRow = 0;
      let extraAlignmentTabSourceSpan: TexMathSourceSpan | undefined;
      while (!this.isAtEnd()) {
        if (cells.length === 0 && params.columnSeparation === "multline") {
          let shove = this.consumeLeadingMultlineShove();
          while (shove) {
            multlineShove = shove.alignment;
            sourceSpan = spanUnion(sourceSpan, shove.sourceSpan);
            pendingRowSourceSpan = spanUnion(pendingRowSourceSpan ?? shove.sourceSpan, shove.sourceSpan);
            shove = this.consumeLeadingMultlineShove();
          }
        }
        const cellList = this.parseList({
          stopAtGroupClose: false,
          stopAtAlignmentTab: true,
          stopAtRowBreak: true,
          stopAtAlignmentMetadata: true,
          stopAtEnvironmentEnd: params.stopAtEnvironmentEnd,
          suppressEllipsisGlueBeforeAlignmentTab: true,
          alignmentColumnSeparation: params.columnSeparation,
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
        const metadata = this.consumeAlignmentRowMetadata(params.allowAlignmentTags ?? true, {
          allowDisplayBreak: params.allowDisplayBreak ?? false,
        });
        if (metadata.sourceSpan) {
          sourceSpan = spanUnion(sourceSpan, metadata.sourceSpan);
          pendingRowSourceSpan = spanUnion(pendingRowSourceSpan ?? metadata.sourceSpan, metadata.sourceSpan);
        }
        suppressTag = suppressTag || metadata.suppressTag;
        labels.push(...metadata.labels);

        const separator = this.peek();
        if (separator?.kind === "character" && separator.text === "&") {
          this.advance();
          sourceSpan = spanUnion(sourceSpan, separator.sourceSpan);
          alignmentTabsInRow += 1;
          if (!extraAlignmentTabSourceSpan && params.maxFields !== undefined && alignmentTabsInRow > params.maxFields - 1) {
            extraAlignmentTabSourceSpan = separator.sourceSpan;
          }
          continue;
        }
        break;
      }
      if (extraAlignmentTabSourceSpan) {
        this.addDiagnostic(
          "error",
          "extra-alignment-tab",
          params.columnSeparation === "multline"
            ? "The rows within the multline environment must have exactly one column."
            : "Extra & on this line.",
          extraAlignmentTabSourceSpan
        );
      }

      const rowEndToken = this.peek();
      if (isMathRowBreakToken(rowEndToken)) {
        const rowBreak = this.advance();
        sourceSpan = spanUnion(sourceSpan, rowBreak.sourceSpan);
        rows.push({
          cells,
          sourceSpan: spanUnion(pendingRowSourceSpan ?? cells[0]?.sourceSpan ?? rowBreak.sourceSpan, rowBreak.sourceSpan),
          rowBreakSourceSpan: rowBreak.sourceSpan,
          ...(suppressTag ? { suppressTag } : {}),
          ...(labels.length > 0 ? { labels } : {}),
          ...(multlineShove ? { multlineShove } : {}),
        });
        continue;
      }
      if (params.stopAtEnvironmentEnd && this.isEnvironmentEnd(params.stopAtEnvironmentEnd)) {
        endSourceSpan = this.consumeEnvironmentEnd(params.stopAtEnvironmentEnd);
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? endSourceSpan,
          ...(suppressTag ? { suppressTag } : {}),
          ...(labels.length > 0 ? { labels } : {}),
          ...(multlineShove ? { multlineShove } : {}),
        });
        return this.maybeParseScripts(
          alignedAtom(rows, params.beginSourceSpan, params.preambleSourceSpan, endSourceSpan, sourceSpan, {
            columnSeparation: params.columnSeparation,
            maxFields: params.maxFields,
          }),
          params.allowScripts
        );
      }
      if (cells.length > 0) {
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? cells[0]?.sourceSpan ?? sourceSpan,
          ...(suppressTag ? { suppressTag } : {}),
          ...(labels.length > 0 ? { labels } : {}),
          ...(multlineShove ? { multlineShove } : {}),
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
      alignedAtom(rows, params.beginSourceSpan, params.preambleSourceSpan, undefined, sourceSpan, {
        columnSeparation: params.columnSeparation,
        maxFields: params.maxFields,
      }),
      params.allowScripts
    );
  }

  private invalidNestedAlignmentEnvironment(
    candidate: string
  ): { readonly message: string } | null {
    const active = this.activeAlignmentEnvironments.at(-1);
    if (!active || !displayAlignmentEnvironmentName(active) || !displayAlignmentEnvironmentName(candidate)) {
      return null;
    }
    if (gatherEnvironmentName(active) && alignEnvironmentName(candidate)) {
      return null;
    }
    return {
      message: `Erroneous nesting of equation structures: \\begin{${candidate}} inside \\begin{${active}}.`,
    };
  }

  private consumeXalignatBody(
    environmentName: string,
    pairCount: number | null
  ): {
    readonly sourceSpan?: TexMathSourceSpan;
    readonly extraAlignmentTabSourceSpan?: TexMathSourceSpan;
  } {
    let sourceSpan: TexMathSourceSpan | undefined;
    let alignmentTabsInRow = 0;
    let extraAlignmentTabSourceSpan: TexMathSourceSpan | undefined;
    const maxAlignmentTabs = pairCount === null ? Number.POSITIVE_INFINITY : Math.max(0, 2 * pairCount - 1);
    while (!this.isAtEnd()) {
      if (this.isEnvironmentEnd(environmentName)) {
        const end = this.consumeEnvironmentEnd(environmentName);
        sourceSpan = spanUnion(sourceSpan ?? end, end);
        return {
          ...(sourceSpan ? { sourceSpan } : {}),
          ...(extraAlignmentTabSourceSpan ? { extraAlignmentTabSourceSpan } : {}),
        };
      }
      const token = this.advance();
      sourceSpan = spanUnion(sourceSpan ?? token.sourceSpan, token.sourceSpan);
      if (isMathRowBreakToken(token)) {
        alignmentTabsInRow = 0;
        continue;
      }
      if (token.kind === "character" && token.text === "&") {
        alignmentTabsInRow += 1;
        if (!extraAlignmentTabSourceSpan && alignmentTabsInRow > maxAlignmentTabs) {
          extraAlignmentTabSourceSpan = token.sourceSpan;
        }
      }
    }
    return {
      ...(sourceSpan ? { sourceSpan } : {}),
      ...(extraAlignmentTabSourceSpan ? { extraAlignmentTabSourceSpan } : {}),
    };
  }

  private consumeAlignmentRowMetadata(
    allowTags: boolean,
    options: { readonly allowDisplayBreak?: boolean } = {}
  ): {
    readonly suppressTag: boolean;
    readonly labels: readonly {
      readonly text: string;
      readonly sourceSpan: TexMathSourceSpan;
      readonly textSourceSpan: TexMathSourceSpan;
    }[];
    readonly sourceSpan?: TexMathSourceSpan;
  } {
    let suppressTag = false;
    const labels: Array<{
      readonly text: string;
      readonly sourceSpan: TexMathSourceSpan;
      readonly textSourceSpan: TexMathSourceSpan;
    }> = [];
    let sourceSpan: TexMathSourceSpan | undefined;
    while (!this.isAtEnd()) {
      this.skipSpaces();
      const token = this.peek();
      if (token?.kind !== "command") {
        break;
      }
      const metadata = alignmentMetadataCommand(token.text);
      if (!metadata) {
        break;
      }
      const command = this.advance();
      sourceSpan = spanUnion(sourceSpan ?? command.sourceSpan, command.sourceSpan);
      if (metadata === "unsupported-text") {
        const content = this.parseRequiredTextGroup(command.sourceSpan, `${command.text} text`);
        sourceSpan = spanUnion(sourceSpan, content?.sourceSpan ?? command.sourceSpan);
        this.addDiagnostic(
          "error",
          "unsupported-command",
          `Unsupported alignment command ${command.text}.`,
          spanUnion(command.sourceSpan, content?.sourceSpan ?? command.sourceSpan)
        );
        continue;
      }
      if (metadata === "displaybreak") {
        const optional = this.consumeOptionalBracketArgument();
        sourceSpan = spanUnion(sourceSpan, optional ?? command.sourceSpan);
        if (!options.allowDisplayBreak) {
          this.addDiagnostic(
            "error",
            "unsupported-command",
            `Unsupported alignment command ${command.text}.`,
            spanUnion(command.sourceSpan, optional ?? command.sourceSpan)
          );
        }
        continue;
      }
      if (metadata === "notag" || metadata === "nonumber") {
        suppressTag = true;
        continue;
      }
      const content = this.parseRequiredTextGroup(command.sourceSpan, `${command.text} label`);
      sourceSpan = spanUnion(sourceSpan, content?.sourceSpan ?? command.sourceSpan);
      if (metadata === "tag" && !allowTags) {
        this.addDiagnostic(
          "error",
          "unsupported-command",
          `Unsupported alignment command ${command.text}.`,
          spanUnion(command.sourceSpan, content?.sourceSpan ?? command.sourceSpan)
        );
        continue;
      }
      if (content && !content.unsupported) {
        labels.push({
          text: content.text,
          sourceSpan: spanUnion(command.sourceSpan, content.sourceSpan),
          textSourceSpan: content.textSourceSpan,
        });
      }
    }
    return {
      suppressTag,
      labels,
      ...(sourceSpan ? { sourceSpan } : {}),
    };
  }

  private parseInfixFractionList(
    numeratorItems: readonly TexMathItem[],
    primitive: InfixFractionPrimitive,
    listOptions: ParseListOptions
  ): TexMathList {
    const command = this.advance();
    const delimiters = this.parseInfixFractionDelimiters(primitive, command.sourceSpan);
    this.skipSpaces();
    const denominator = this.parseList({
      ...listOptions,
      allowInfixFraction: false,
    });
    const numerator = listFromItems(numeratorItems, {
      start: command.sourceSpan.start,
      end: command.sourceSpan.start,
    });
    const sourceSpan = spanUnion(
      spanUnion(numerator.sourceSpan, delimiters.sourceSpan ?? command.sourceSpan),
      denominator.sourceSpan
    );
    const fraction = {
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "fraction",
        numerator,
        denominator,
        ...(delimiters.leftDelimiter ? { leftDelimiter: delimiters.leftDelimiter } : {}),
        ...(delimiters.rightDelimiter ? { rightDelimiter: delimiters.rightDelimiter } : {}),
        ...(delimiters.ruleThickness !== undefined ? { ruleThickness: delimiters.ruleThickness } : {}),
        sourceSpan,
      },
      sourceSpan,
    } satisfies TexMathAtom;
    return {
      kind: "math-list",
      items: [fraction],
      sourceSpan,
    };
  }

  private parseInfixFractionDelimiters(
    primitive: InfixFractionPrimitive,
    commandSpan: TexMathSourceSpan
  ): {
    readonly leftDelimiter?: TexMathDelimiter;
    readonly rightDelimiter?: TexMathDelimiter;
    readonly ruleThickness?: number;
    readonly sourceSpan?: TexMathSourceSpan;
  } {
    switch (primitive) {
      case "choose":
        return { leftDelimiter: "(", rightDelimiter: ")", ruleThickness: 0 };
      case "atop":
        return { ruleThickness: 0 };
      case "brack":
        return { leftDelimiter: "[", rightDelimiter: "]", ruleThickness: 0 };
      case "brace":
        return { leftDelimiter: "lbrace", rightDelimiter: "rbrace", ruleThickness: 0 };
      case "above": {
        const dimension = this.parseTexDimension(commandSpan, `${primitive} rule thickness`);
        return {
          ...(dimension ? { ruleThickness: dimension.valuePt, sourceSpan: dimension.sourceSpan } : {}),
        };
      }
      case "abovewithdelims": {
        const leftDelimiter = this.parseDelimiter(commandSpan, `${primitive} left delimiter`);
        const rightDelimiter = this.parseDelimiter(commandSpan, `${primitive} right delimiter`);
        const dimension = this.parseTexDimension(commandSpan, `${primitive} rule thickness`);
        return {
          ...(leftDelimiter ? { leftDelimiter: leftDelimiter.delimiter } : {}),
          ...(rightDelimiter ? { rightDelimiter: rightDelimiter.delimiter } : {}),
          ...(dimension ? { ruleThickness: dimension.valuePt } : {}),
          sourceSpan: spanUnion(leftDelimiter?.sourceSpan ?? commandSpan, dimension?.sourceSpan ?? rightDelimiter?.sourceSpan ?? commandSpan),
        };
      }
      case "overwithdelims":
      case "atopwithdelims": {
        const leftDelimiter = this.parseDelimiter(commandSpan, `${primitive} left delimiter`);
        const rightDelimiter = this.parseDelimiter(commandSpan, `${primitive} right delimiter`);
        return {
          ...(leftDelimiter ? { leftDelimiter: leftDelimiter.delimiter } : {}),
          ...(rightDelimiter ? { rightDelimiter: rightDelimiter.delimiter } : {}),
          ...(primitive === "atopwithdelims" ? { ruleThickness: 0 } : {}),
          sourceSpan: spanUnion(leftDelimiter?.sourceSpan ?? commandSpan, rightDelimiter?.sourceSpan ?? commandSpan),
        };
      }
      case "over":
        return {};
    }
  }

  private parseTexDimension(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): { readonly valuePt: number; readonly sourceSpan: TexMathSourceSpan } | null {
    this.skipSpaces();
    const start = this.peek()?.sourceSpan.start ?? fallbackSpan.end;
    let text = "";
    let lastSpan: TexMathSourceSpan | null = null;
    const sign = this.peek();
    if (sign?.kind === "character" && (sign.text === "+" || sign.text === "-")) {
      text += sign.text;
      lastSpan = this.advance().sourceSpan;
    }

    let sawDigit = false;
    let sawDot = false;
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (token?.kind !== "character") {
        break;
      }
      if (/[0-9]/.test(token.text)) {
        sawDigit = true;
        text += token.text;
        lastSpan = this.advance().sourceSpan;
        continue;
      }
      if (token.text === "." && !sawDot) {
        sawDot = true;
        text += token.text;
        lastSpan = this.advance().sourceSpan;
        continue;
      }
      break;
    }

    this.skipSpaces();
    let unit = "";
    while (!this.isAtEnd() && unit.length < 2) {
      const token = this.peek();
      if (token?.kind !== "character" || !/[A-Za-z]/.test(token.text)) {
        break;
      }
      unit += token.text;
      lastSpan = this.advance().sourceSpan;
    }

    const sourceSpan = lastSpan ? { start, end: lastSpan.end } : fallbackSpan;
    const factor = texDimensionUnitFactor(unit);
    const number = Number(text);
    if (!sawDigit || !Number.isFinite(number) || factor === null) {
      this.addDiagnostic(
        "error",
        "invalid-tex-dimension",
        `Unsupported or invalid TeX dimension for ${label}.`,
        sourceSpan
      );
      return null;
    }
    return {
      valuePt: number * factor,
      sourceSpan,
    };
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

  private parseSubarrayBody(params: {
    readonly beginSourceSpan: TexMathSourceSpan;
    readonly initialSourceSpan: TexMathSourceSpan;
    readonly preambleSourceSpan: TexMathSourceSpan;
    readonly columnAlignment: "left" | "center";
    readonly allowScripts: boolean;
  }): TexMathAtom {
    const rows: TexMathAlignedRow[] = [];
    let endSourceSpan: TexMathSourceSpan | undefined;
    let sourceSpan = params.initialSourceSpan;

    while (!this.isAtEnd()) {
      if (this.isEnvironmentEnd("subarray")) {
        endSourceSpan = this.consumeEnvironmentEnd("subarray");
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        return this.maybeParseScripts(
          subarrayAtom(rows, params.columnAlignment, params.beginSourceSpan, params.preambleSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }

      const list = this.parseList({
        stopAtGroupClose: false,
        stopAtRowBreak: true,
        stopAtEnvironmentEnd: "subarray",
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
      if (this.isEnvironmentEnd("subarray")) {
        endSourceSpan = this.consumeEnvironmentEnd("subarray");
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        rows.push({
          cells: [{ list, sourceSpan: list.sourceSpan }],
          sourceSpan: list.sourceSpan,
        });
        return this.maybeParseScripts(
          subarrayAtom(rows, params.columnAlignment, params.beginSourceSpan, params.preambleSourceSpan, endSourceSpan, sourceSpan),
          params.allowScripts
        );
      }
      if (list.items.length > 0) {
        rows.push({
          cells: [{ list, sourceSpan: list.sourceSpan }],
          sourceSpan: list.sourceSpan,
        });
      }
    }

    this.addDiagnostic(
      "error",
      "missing-environment-end",
      "Expected \\end{subarray} to close math environment.",
      params.beginSourceSpan
    );
    return this.maybeParseScripts(
      subarrayAtom(rows, params.columnAlignment, params.beginSourceSpan, params.preambleSourceSpan, undefined, sourceSpan),
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

  private parseSubarrayPreambleGroup(
    fallbackSpan: TexMathSourceSpan
  ): { alignment: "left" | "center"; sourceSpan: TexMathSourceSpan } | null {
    const group = this.parseRequiredRawGroup(fallbackSpan, "\\begin{subarray} column preamble");
    if (!group) {
      return null;
    }
    const first = group.text.trimStart()[0];
    return {
      alignment: first === "c" ? "center" : "left",
      sourceSpan: group.sourceSpan,
    };
  }

  private consumeOptionalArrayPosition(): TexMathSourceSpan | null {
    this.skipSpaces();
    const open = this.peek();
    if (open?.kind !== "character" || open.text !== "[") {
      return null;
    }
    this.advance();
    let sourceSpan = open.sourceSpan;
    let value = "";
    while (!this.isAtEnd()) {
      const token = this.advance();
      sourceSpan = spanUnion(sourceSpan, token.sourceSpan);
      if (token.kind === "character" && token.text === "]") {
        break;
      }
      value += token.text;
    }
    const position = value.trim();
    if (position !== "t" && position !== "c" && position !== "b") {
      this.addDiagnostic(
        "warning",
        "unsupported-command",
        `Unsupported array vertical position ${position || "[]"}.`,
        sourceSpan
      );
    }
    return sourceSpan;
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

  private consumeOptionalCfracAlignment(): {
    readonly alignment: "left" | "center" | "right";
    readonly sourceSpan: TexMathSourceSpan;
  } | null {
    this.skipSpaces();
    const open = this.peek();
    if (open?.kind !== "character" || open.text !== "[") {
      return null;
    }
    this.advance();
    let sourceSpan = open.sourceSpan;
    let value = "";
    while (!this.isAtEnd()) {
      const token = this.advance();
      sourceSpan = spanUnion(sourceSpan, token.sourceSpan);
      if (token.kind === "character" && token.text === "]") {
        break;
      }
      value += token.text;
    }
    const trimmed = value.trim();
    return {
      alignment: trimmed === "l" ? "left" : trimmed === "r" ? "right" : "center",
      sourceSpan,
    };
  }

  private consumeOptionalBracketArgument(): TexMathSourceSpan | null {
    this.skipSpaces();
    const open = this.peek();
    if (open?.kind !== "character" || open.text !== "[") {
      return null;
    }
    this.advance();
    let sourceSpan = open.sourceSpan;
    while (!this.isAtEnd()) {
      const token = this.advance();
      sourceSpan = spanUnion(sourceSpan, token.sourceSpan);
      if (token.kind === "character" && token.text === "]") {
        break;
      }
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
    parts: readonly TexMathTextPart[];
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
    let textRun = "";
    let textRunSourceStart = open.sourceSpan.end;
    const parts: TexMathTextPart[] = [];
    let lastSpan: TexMathSourceSpan = open.sourceSpan;
    let unsupported = false;
    let depth = 0;
    const flushTextRun = (sourceEnd: number): void => {
      if (!textRun) {
        textRunSourceStart = sourceEnd;
        return;
      }
      parts.push({
        kind: "text",
        text: textRun,
        sourceSpan: { start: textRunSourceStart, end: sourceEnd },
      });
      textRun = "";
      textRunSourceStart = sourceEnd;
    };
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (!token) {
        break;
      }
      if (token.kind === "group-close" && depth === 0) {
        break;
      }
      if (depth === 0 && token.kind === "character" && token.text === "$") {
        flushTextRun(token.sourceSpan.start);
        const openMath = this.advance();
        lastSpan = openMath.sourceSpan;
        const mathStart = openMath.sourceSpan.end;
        const mathTokens: TexMathToken[] = [];
        let closeMath: TexMathToken | undefined;
        while (!this.isAtEnd()) {
          const mathToken = this.peek();
          if (!mathToken || mathToken.kind === "group-close") {
            break;
          }
          this.advance();
          lastSpan = mathToken.sourceSpan;
          if (mathToken.kind === "character" && mathToken.text === "$") {
            closeMath = mathToken;
            break;
          }
          mathTokens.push(mathToken);
        }
        if (!closeMath) {
          unsupported = true;
          text += "$";
          if (!textRun) {
            textRunSourceStart = openMath.sourceSpan.start;
          }
          textRun += "$";
          this.addDiagnostic(
            "warning",
            "unsupported-command",
            "Unsupported unterminated math shift in \\text.",
            openMath.sourceSpan
          );
          continue;
        }
        const mathSource = mathTokens.map((mathToken) => mathToken.text).join("");
        const parsed = parseTexMath(mathSource, {
          sourceOffset: mathStart,
          suppressTerminalEllipsisGlue: this.options.suppressTerminalEllipsisGlue,
        });
        this.diagnostics.push(...parsed.diagnostics);
        if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
          unsupported = true;
          continue;
        }
        parts.push({
          kind: "math",
          list: parsed.list,
          sourceSpan: spanUnion(openMath.sourceSpan, closeMath.sourceSpan),
          contentSourceSpan: { start: mathStart, end: closeMath.sourceSpan.start },
        });
        textRunSourceStart = closeMath.sourceSpan.end;
        continue;
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
        if (!textRun) {
          textRunSourceStart = token.sourceSpan.start;
        }
        textRun += token.text;
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
    flushTextRun(contentEnd);
    return {
      text,
      parts,
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

  private parseOptionalBracketMathArgument(
    fallbackSpan: TexMathSourceSpan
  ): { list: TexMathList; sourceSpan: TexMathSourceSpan } | null {
    this.skipSpaces();
    const next = this.peek();
    if (next?.kind !== "character" || next.text !== "[") {
      return null;
    }
    const open = this.advance();
    const list = this.parseList({
      stopAtGroupClose: false,
      stopAtOptionalBracketClose: true,
    });
    const close = this.peek();
    if (close?.kind === "character" && close.text === "]") {
      this.advance();
      return {
        list,
        sourceSpan: spanUnion(open.sourceSpan, close.sourceSpan),
      };
    }
    this.addDiagnostic(
      "error",
      "missing-delimiter",
      "Expected a closing bracket in optional math argument.",
      next?.sourceSpan ?? fallbackSpan
    );
    return {
      list,
      sourceSpan: spanUnion(open.sourceSpan, list.sourceSpan),
    };
  }

  private parseGenfracDelimiterArgument(
    command: TexMathToken,
    label: string
  ): {
    readonly delimiter?: TexMathDelimiter;
    readonly sourceSpan: TexMathSourceSpan;
  } {
    const group = this.parseRequiredRawGroup(command.sourceSpan, `${command.text} ${label}`);
    if (!group) {
      return { sourceSpan: command.sourceSpan };
    }
    const significant = group.tokens.filter((token) => token.kind !== "space");
    if (significant.length === 0) {
      return { sourceSpan: group.sourceSpan };
    }
    const delimiterToken = significant[0] ?? command;
    const delimiter = significant.length === 1 ? delimiterForToken(delimiterToken) : null;
    if (!delimiter) {
      this.addDiagnostic(
        "error",
        "missing-delimiter",
        `Missing or unrecognized delimiter for ${command.text}.`,
        delimiterToken.sourceSpan
      );
      return { sourceSpan: group.sourceSpan };
    }
    return { delimiter, sourceSpan: group.sourceSpan };
  }

  private parseGenfracThicknessArgument(
    command: TexMathToken
  ): {
    readonly ruleThickness?: number;
    readonly sourceSpan: TexMathSourceSpan;
  } {
    const group = this.parseRequiredRawGroup(command.sourceSpan, `${command.text} rule thickness`);
    if (!group) {
      return { sourceSpan: command.sourceSpan };
    }
    const text = group.text.trim();
    if (text === "") {
      return { sourceSpan: group.sourceSpan };
    }
    const dimension = parseTexDimensionText(text);
    if (dimension === null) {
      this.addDiagnostic(
        "error",
        "invalid-tex-dimension",
        `Unsupported or invalid TeX dimension for ${command.text} rule thickness.`,
        group.contentSourceSpan
      );
      return { sourceSpan: group.sourceSpan };
    }
    return { ruleThickness: dimension, sourceSpan: group.sourceSpan };
  }

  private parseGenfracStyleArgument(
    command: TexMathToken
  ): {
    readonly style?: TexMathStyle;
    readonly sourceSpan: TexMathSourceSpan;
  } {
    const group = this.parseRequiredRawGroup(command.sourceSpan, `${command.text} style`);
    if (!group) {
      return { sourceSpan: command.sourceSpan };
    }
    const text = group.text.trim();
    if (text === "") {
      return { sourceSpan: group.sourceSpan };
    }
    const style = genfracStyle(text);
    if (!style) {
      this.addDiagnostic(
        "error",
        "invalid-math-style",
        `Bad math style for ${command.text}.`,
        group.contentSourceSpan
      );
      return { sourceSpan: group.sourceSpan };
    }
    return {
      style,
      sourceSpan: group.sourceSpan,
    };
  }

  private parseRequiredMathArgument(
    fallbackSpan: TexMathSourceSpan,
    label: string,
    listOptions: Partial<ParseListOptions> = {}
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
      const list = this.parseList({ stopAtGroupClose: true, ...listOptions });
      const close = this.consumeGroupClose(open.sourceSpan);
      return {
        list,
        sourceSpan: spanUnion(open.sourceSpan, close?.sourceSpan ?? list.sourceSpan),
      };
    }
    const item = this.parseItem(false, { stopAtGroupClose: false, ...listOptions });
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

  private parseRequiredRawGroup(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): {
    readonly text: string;
    readonly tokens: readonly TexMathToken[];
    readonly sourceSpan: TexMathSourceSpan;
    readonly contentSourceSpan: TexMathSourceSpan;
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
    const tokens: TexMathToken[] = [];
    let lastSpan: TexMathSourceSpan = open.sourceSpan;
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
      tokens.push(token);
      lastSpan = token.sourceSpan;
      if (token.kind === "group-open") {
        depth += 1;
      } else if (token.kind === "group-close") {
        depth = Math.max(0, depth - 1);
      }
    }
    const close = this.consumeGroupClose(open.sourceSpan);
    const contentStart = open.sourceSpan.end;
    const contentEnd = close?.sourceSpan.start ?? lastSpan.end;
    return {
      text: tokens.map((token) => token.text).join(""),
      tokens,
      sourceSpan: spanUnion(open.sourceSpan, close?.sourceSpan ?? lastSpan),
      contentSourceSpan: { start: contentStart, end: Math.max(contentStart, contentEnd) },
    };
  }

  private parseRequiredControlSequenceGroup(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): {
    readonly name: string;
    readonly sourceSpan: TexMathSourceSpan;
  } | null {
    const group = this.parseRequiredRawGroup(fallbackSpan, label);
    if (!group) {
      return null;
    }
    const significant = group.tokens.filter((token) => token.kind !== "space");
    if (significant.length !== 1 || significant[0]?.kind !== "command") {
      this.addDiagnostic(
        "error",
        "unsupported-command",
        `Expected a single control sequence for ${label}.`,
        group.contentSourceSpan
      );
      return null;
    }
    return {
      name: commandName(significant[0].text),
      sourceSpan: group.sourceSpan,
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

  private missingEnvironmentEnd(name: string, fallbackSpan: TexMathSourceSpan): TexMathSourceSpan {
    this.addDiagnostic(
      "error",
      "missing-environment-end",
      `Expected \\end{${name}} to close math environment.`,
      fallbackSpan
    );
    return fallbackSpan;
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

function listFromItems(
  items: readonly TexMathItem[],
  fallbackSpan: TexMathSourceSpan
): TexMathList {
  return {
    kind: "math-list",
    items,
    sourceSpan: items.length > 0
      ? spanUnion(items[0]?.sourceSpan ?? fallbackSpan, items.at(-1)?.sourceSpan ?? fallbackSpan)
      : fallbackSpan,
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
  suppressBeforeAlignmentTab = false,
  suppressAtEnd = false
): boolean {
  if (ellipsis === "ldots") {
    return false;
  }
  if (!next) {
    return !suppressAtEnd;
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
  preambleSourceSpan: TexMathSourceSpan | undefined,
  endSourceSpan: TexMathSourceSpan | undefined,
  sourceSpan: TexMathSourceSpan,
  options: {
    readonly columnSeparation?: "align" | "none" | "gather" | "multline";
    readonly maxFields?: number;
  } = {}
): TexMathAtom {
  return {
    kind: "atom",
    atomClass: "inner",
    nucleus: {
      kind: "aligned",
      rows,
      ...(options.columnSeparation ? { columnSeparation: options.columnSeparation } : {}),
      ...(options.maxFields !== undefined ? { maxFields: options.maxFields } : {}),
      beginSourceSpan,
      ...(preambleSourceSpan ? { preambleSourceSpan } : {}),
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

function subarrayAtom(
  rows: readonly TexMathAlignedRow[],
  columnAlignment: "left" | "center",
  beginSourceSpan: TexMathSourceSpan,
  preambleSourceSpan: TexMathSourceSpan,
  endSourceSpan: TexMathSourceSpan | undefined,
  sourceSpan: TexMathSourceSpan
): TexMathAtom {
  return {
    kind: "atom",
    atomClass: "ord",
    nucleus: {
      kind: "subarray",
      rows,
      columnAlignment,
      beginSourceSpan,
      preambleSourceSpan,
      ...(endSourceSpan ? { endSourceSpan } : {}),
      sourceSpan,
    },
    sourceSpan,
  };
}

function commandName(command: string): string {
  return command.startsWith("\\") ? command.slice(1) : command;
}

function operatorPartUseSourceSpan(commandSourceSpan: TexMathSourceSpan, index: number): TexMathSourceSpan {
  return index === 0
    ? commandSourceSpan
    : { start: commandSourceSpan.end, end: commandSourceSpan.end };
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
  if (name === " ") {
    return "nobreakspace";
  }
  if (
    name === "," ||
    name === ":" ||
    name === ";" ||
    name === "!" ||
    name === "nobreakspace" ||
    name === "negmedspace" ||
    name === "negthickspace" ||
    name === "quad" ||
    name === "qquad"
  ) {
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

function genfracStyle(style: string): TexMathStyle | null {
  const normalized = style.trim();
  if (!/^[+-]?\d+$/u.test(normalized)) {
    return null;
  }
  switch (Number.parseInt(normalized, 10)) {
    case 0:
      return "display";
    case 1:
      return "text";
    case 2:
      return "script";
    default:
      return "scriptscript";
  }
}

function infixFractionPrimitive(command: string): InfixFractionPrimitive | null {
  switch (commandName(command)) {
    case "above":
      return "above";
    case "abovewithdelims":
      return "abovewithdelims";
    case "over":
      return "over";
    case "choose":
      return "choose";
    case "atop":
      return "atop";
    case "brack":
      return "brack";
    case "brace":
      return "brace";
    case "overwithdelims":
      return "overwithdelims";
    case "atopwithdelims":
      return "atopwithdelims";
    default:
      return null;
  }
}

function alignmentMetadataCommand(
  command: string
): "label" | "tag" | "notag" | "nonumber" | "unsupported-text" | "displaybreak" | null {
  switch (commandName(command)) {
    case "label":
      return "label";
    case "tag":
      return "tag";
    case "notag":
      return "notag";
    case "nonumber":
      return "nonumber";
    case "intertext":
    case "shortintertext":
      return "unsupported-text";
    case "displaybreak":
      return "displaybreak";
    default:
      return null;
  }
}

function shoveCommandName(command: string): "left" | "right" | null {
  switch (commandName(command)) {
    case "shoveleft":
      return "left";
    case "shoveright":
      return "right";
    default:
      return null;
  }
}

interface TexMathBigDelimiterCommand {
  readonly size: TexMathDelimiterSizeCommand;
  readonly atomClass?: TexMathAtomClass;
}

function bigDelimiterCommand(command: string): TexMathBigDelimiterCommand | null {
  switch (commandName(command)) {
    case "big":
      return { size: "big", atomClass: "ord" };
    case "bigl":
      return { size: "big", atomClass: "open" };
    case "bigr":
      return { size: "big", atomClass: "close" };
    case "bigm":
      return { size: "big", atomClass: "rel" };
    case "Big":
      return { size: "Big", atomClass: "ord" };
    case "Bigl":
      return { size: "Big", atomClass: "open" };
    case "Bigr":
      return { size: "Big", atomClass: "close" };
    case "Bigm":
      return { size: "Big", atomClass: "rel" };
    case "bigg":
      return { size: "bigg", atomClass: "ord" };
    case "biggl":
      return { size: "bigg", atomClass: "open" };
    case "biggr":
      return { size: "bigg", atomClass: "close" };
    case "biggm":
      return { size: "bigg", atomClass: "rel" };
    case "Bigg":
      return { size: "Bigg", atomClass: "ord" };
    case "Biggl":
      return { size: "Bigg", atomClass: "open" };
    case "Biggr":
      return { size: "Bigg", atomClass: "close" };
    case "Biggm":
      return { size: "Bigg", atomClass: "rel" };
    default:
      return null;
  }
}

function texDimensionUnitFactor(unit: string): number | null {
  switch (unit) {
    case "pt":
      return 1;
    case "in":
      return 72.27;
    case "pc":
      return 12;
    case "cm":
      return 72.27 / 2.54;
    case "mm":
      return 72.27 / 25.4;
    case "bp":
      return 72.27 / 72;
    case "dd":
      return 1238 / 1157;
    case "cc":
      return 12 * 1238 / 1157;
    case "sp":
      return 1 / 65536;
    default:
      return null;
  }
}

function parseTexDimensionText(text: string): number | null {
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([A-Za-z]{2})\s*$/.exec(text);
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  const factor = texDimensionUnitFactor(match[2] ?? "");
  return Number.isFinite(number) && factor !== null ? number * factor : null;
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
    case "dddot":
      return "dddot";
    case "ddddot":
      return "ddddot";
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
    case "idotsint":
      return "idotsint";
    case "iint":
      return "iint";
    case "iiint":
      return "iiint";
    case "iiiint":
      return "iiiint";
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

function extensibleArrowCommandName(command: string): TexMathExtensibleArrowCommand | null {
  switch (commandName(command)) {
    case "xleftarrow":
      return "xleftarrow";
    case "xrightarrow":
      return "xrightarrow";
    default:
      return null;
  }
}

function alignedEnvironmentName(name: string): boolean {
  return name === "aligned" ||
    name === "split" ||
    name === "gathered" ||
    name === "align" ||
    name === "align*" ||
    name === "gather" ||
    name === "gather*" ||
    multlineEnvironmentName(name);
}

function alignatEnvironmentName(name: string): boolean {
  return name === "alignat" || name === "alignat*";
}

function xalignatEnvironmentName(name: string): boolean {
  return name === "xalignat" || name === "xalignat*";
}

function displayAlignmentEnvironmentName(name: string): boolean {
  return alignEnvironmentName(name) || gatherEnvironmentName(name) || multlineEnvironmentName(name);
}

function alignEnvironmentName(name: string): boolean {
  return name === "align" || name === "align*";
}

function gatherEnvironmentName(name: string): boolean {
  return name === "gather" || name === "gather*";
}

function gatheredEnvironmentName(name: string): boolean {
  return name === "gathered";
}

function multlineEnvironmentName(name: string): boolean {
  return name === "multline" || name === "multline*";
}

function namedOperatorCommandName(command: string): string | null {
  switch (commandName(command)) {
    case "arccos":
    case "arcsin":
    case "arctan":
    case "arg":
    case "cos":
    case "cosh":
    case "cot":
    case "coth":
    case "csc":
    case "deg":
    case "det":
    case "dim":
    case "exp":
    case "gcd":
    case "hom":
    case "inf":
    case "ker":
    case "lg":
    case "ln":
    case "log":
    case "max":
    case "min":
    case "Pr":
    case "sec":
    case "sin":
    case "sinh":
    case "sup":
    case "tan":
    case "tanh":
      return commandName(command);
    default:
      return null;
  }
}

function defaultNamedOperatorLimits(name: string): TexMathOperatorLimits {
  switch (name) {
    case "det":
    case "gcd":
    case "inf":
    case "lim":
    case "max":
    case "min":
    case "Pr":
    case "sup":
      return "display";
    default:
      return "nolimits";
  }
}

function namedSymbolCommand(command: string): { atomClass: TexMathAtomClass } | null {
  const name = commandName(command);
  if (openNamedSymbolCommands.has(name)) {
    return { atomClass: "open" };
  }
  if (closeNamedSymbolCommands.has(name)) {
    return { atomClass: "close" };
  }
  if (punctNamedSymbolCommands.has(name)) {
    return { atomClass: "punct" };
  }
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
  "aleph", "emptyset", "ell", "flat", "Im", "imath", "jmath", "lnot", "natural", "nabla", "partial",
  "prime", "Re", "sharp", "top", "bot", "triangle", "wp",
  "Bbbk", "blacksquare", "digamma", "square", "varnothing",
]);

const binaryNamedSymbolCommands = new Set([
  "amalg", "ast", "bigcirc", "bigtriangledown", "bigtriangleup", "bullet", "cap", "cdot", "circ", "cup",
  "dagger", "ddagger", "diamond", "div", "mp", "odot", "ominus", "oplus", "oslash", "otimes", "pm",
  "setminus", "sqcap", "sqcup", "star", "times", "triangleleft", "triangleright", "uplus", "vee", "wedge", "wr",
  "boxdot", "circleddash", "dotplus",
]);

const relationNamedSymbolCommands = new Set([
  "approx", "asymp", "dashv", "downarrow", "Downarrow", "equiv", "frown", "gets", "ge", "geq", "gg",
  "in", "leftarrow", "Leftarrow", "leftharpoondown", "leftharpoonup", "leftrightarrow", "Leftrightarrow",
  "le", "leq", "ll", "mapsto", "mid", "ne", "nearrow", "neq", "ni", "notin", "nwarrow",
  "owns", "parallel", "perp", "prec", "preceq", "propto", "rightarrow", "Rightarrow", "rightharpoondown",
  "rightharpoonup", "searrow", "sim", "simeq", "smile", "sqsubseteq", "sqsupseteq", "subset", "subseteq",
  "iff", "implies", "longleftarrow", "longrightarrow", "Longleftarrow", "Longleftrightarrow", "Longrightarrow",
  "approxeq", "geqslant", "gtrsim", "leqslant", "lesssim", "ngeqslant", "nleqslant", "nVdash",
  "Subset", "Supset", "thickapprox", "Vdash",
  "succ", "succeq", "supset", "supseteq", "swarrow", "to", "uparrow", "Uparrow", "updownarrow", "Updownarrow",
  "vdash",
]);

const openNamedSymbolCommands = new Set([
  "langle", "lbrace", "lceil", "lfloor", "lvert", "lVert", "ulcorner", "{",
]);

const closeNamedSymbolCommands = new Set([
  "rangle", "rbrace", "rceil", "rfloor", "rvert", "rVert", "urcorner", "}",
]);

const punctNamedSymbolCommands = new Set([
  "colon",
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
  if (char === "=" || char === "<" || char === ">" || char === ":") {
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
    case "ulcorner":
      return "ulcorner";
    case "urcorner":
      return "urcorner";
    default:
      return null;
  }
}

function atomClassForDelimiter(delimiter: TexMathDelimiter): TexMathAtomClass {
  switch (delimiter) {
    case "(":
    case "[":
    case "langle":
    case "lbrace":
    case "lceil":
    case "lfloor":
    case "ulcorner":
      return "open";
    case ")":
    case "]":
    case "rangle":
    case "rbrace":
    case "rceil":
    case "rfloor":
    case "urcorner":
      return "close";
    case ".":
    case "vert":
    case "Vert":
    case "slash":
    case "backslash":
      return "ord";
    default:
      return "ord";
  }
}

function spanUnion(a: TexMathSourceSpan, b: TexMathSourceSpan): TexMathSourceSpan {
  return {
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
  };
}
