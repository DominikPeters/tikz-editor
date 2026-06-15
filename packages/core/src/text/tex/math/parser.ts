import type {
  TexMathAtom,
  TexMathAtomClass,
  TexMathAccentCommand,
  TexMathAlignedCell,
  TexMathAlignedRow,
  TexMathDiagnostic,
  TexMathDiagnosticCode,
  TexMathDelimiter,
  TexMathGlue,
  TexMathItem,
  TexMathList,
  TexMathNucleus,
  TexMathOperatorCommand,
  TexMathOperatorLimits,
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
      const item = this.parseItem();
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

  private parseItem(allowScripts = true): TexMathItem | null {
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
      if (commandName(token.text) === "frac") {
        return this.parseFraction(allowScripts);
      }
      if (commandName(token.text) === "sqrt") {
        return this.parseRadical(allowScripts);
      }
      const accent = accentCommandName(token.text);
      if (accent) {
        return this.parseAccent(accent, allowScripts);
      }
      const operator = operatorCommandName(token.text);
      if (operator) {
        return this.parseOperator(operator, allowScripts);
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

  private parseFraction(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const numerator = this.parseRequiredGroup(command.sourceSpan, "\\frac numerator");
    const denominator = this.parseRequiredGroup(command.sourceSpan, "\\frac denominator");
    const sourceSpan = spanUnion(
      command.sourceSpan,
      denominator?.sourceSpan ?? numerator?.sourceSpan ?? command.sourceSpan
    );
    const nucleus: TexMathNucleus = {
      kind: "fraction",
      numerator: numerator?.list ?? emptyList(command.sourceSpan.end),
      denominator: denominator?.list ?? emptyList(command.sourceSpan.end),
      sourceSpan,
    };
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "inner",
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

function commandName(command: string): string {
  return command.startsWith("\\") ? command.slice(1) : command;
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
