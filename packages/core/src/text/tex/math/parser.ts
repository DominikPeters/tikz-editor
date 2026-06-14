import type {
  TexMathAtom,
  TexMathAtomClass,
  TexMathDiagnostic,
  TexMathDiagnosticCode,
  TexMathGlue,
  TexMathItem,
  TexMathList,
  TexMathNucleus,
  TexMathParseResult,
  TexMathScript,
  TexMathSourceSpan,
  TexMathToken,
  TexMathTokenKind,
  TexMathUnsupportedItem,
} from "./ir.js";

interface ParseListOptions {
  readonly stopAtGroupClose: boolean;
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
      if (commandName(token.text) === "frac") {
        return this.parseFraction(allowScripts);
      }
      if (commandName(token.text) === "sqrt") {
        return this.parseRadical(allowScripts);
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
      atomClass: "inner",
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

  private parseRequiredGroup(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): { list: TexMathList; sourceSpan: TexMathSourceSpan } | null {
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

  private parseScriptArgument(operatorSpan: TexMathSourceSpan): TexMathScript | null {
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

function commandName(command: string): string {
  return command.startsWith("\\") ? command.slice(1) : command;
}

function spacingCommandName(command: string): TexMathGlue["command"] | null {
  const name = commandName(command);
  if (name === "," || name === ":" || name === ";" || name === "!" || name === "quad" || name === "qquad") {
    return name;
  }
  return null;
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

function spanUnion(a: TexMathSourceSpan, b: TexMathSourceSpan): TexMathSourceSpan {
  return {
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
  };
}
