import type {
  TexMathAtom,
  TexMathAtomClass,
  TexMathAccentCommand,
  TexMathAlphabetCommand,
  TexMathAlignedCell,
  TexMathAlignedIntertext,
  TexMathAlignedRow,
  TexMathArrayCellInsert,
  TexMathArrayColumnAlignment,
  TexMathArrayPreambleInsert,
  TexMathArrayPreambleItem,
  TexMathArrayRowRule,
  TexMathArrayVerticalRule,
  TexMathDiagnostic,
  TexMathDiagnosticCode,
  TexMathDelimiter,
  TexMathDelimiterSizeCommand,
  TexMathExtensibleArrowCommand,
  TexMathGlue,
  TexMathItem,
  TexMathKern,
  TexMathLineCommand,
  TexMathList,
  TexMathMatrixEnvironment,
  TexMathMuGlue,
  TexMathNucleus,
  TexMathOperatorCommand,
  TexMathOperatorLimits,
  TexMathOperatorNamePart,
  TexMathPenalty,
  TexMathParseResult,
  TexMathScript,
  TexMathSkipGlue,
  TexMathSmallMatrixEnvironment,
  TexMathSourceSpan,
  TexMathStyle,
  TexMathTextPart,
  TexMathToken,
  TexMathTokenKind,
  TexMathUnsupportedItem,
  TexMathVarLimitCommand,
} from "./ir.js";
import { texMathSymbolDeclaration } from "./symbol-definitions.js";
import {
  parseSimpleTexInlineNodes,
  simpleTexTextBoxAlignment,
  type SimpleTexFontCommandName,
  type SimpleTexTextBoxAlignment,
  type SimpleTexTextBoxCommandName,
  type SimpleTexInlineNode,
} from "../ir.js";
import { parseTexDimensionText, texDimensionUnitFactor } from "../dimensions.js";

interface ParseListOptions {
  readonly stopAtGroupClose: boolean;
  readonly stopAtRight?: boolean;
  readonly stopAtAlignmentTab?: boolean;
  readonly stopAtRowBreak?: boolean;
  readonly stopAtAlignmentMetadata?: boolean;
  readonly stopAtEnvironmentEnd?: string;
  readonly stopAtOptionalBracketClose?: boolean;
  readonly stopAtRootOf?: boolean;
  readonly stopAtBuildrelOver?: boolean;
  readonly allowInfixFraction?: boolean;
  readonly suppressEllipsisGlueBeforeAlignmentTab?: boolean;
  readonly suppressTerminalEllipsisGlue?: boolean;
  readonly alignmentColumnSeparation?: "align" | "none" | "gather" | "multline" | "eqnarray" | "xalignat" | "xxalignat" | "flalign";
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

interface PendingArrayCellInsert {
  readonly list: TexMathList;
  readonly commandSourceSpan: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface ParseTexMathOptions {
  readonly sourceOffset?: number;
  readonly suppressTerminalEllipsisGlue?: boolean;
}

interface ParseTexMathAlignedBodyOptions extends ParseTexMathOptions {
  readonly columnSeparation?: "align" | "none" | "gather" | "multline" | "eqnarray" | "xalignat" | "xxalignat" | "flalign";
  readonly allowDisplayBreak?: boolean;
  readonly allowIntertext?: boolean;
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
    allowIntertext: options.allowIntertext ?? false,
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
      if (token.kind === "command" && commandName(token.text) === "of" && options.stopAtRootOf) {
        break;
      }
      if (token.kind === "command" && commandName(token.text) === "over" && options.stopAtBuildrelOver) {
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
      const alphabetDeclaration = alphabetDeclarationCommandName(token.text);
      if (alphabetDeclaration) {
        this.advance();
        return {
          kind: "alphabet-change",
          alphabet: alphabetDeclaration,
          sourceSpan: token.sourceSpan,
        };
      }
      const kern = this.parseKernCommand();
      if (kern) {
        return kern;
      }
      const skip = this.parseSkipCommand();
      if (skip) {
        return skip;
      }
      const penalty = this.parsePenaltyCommand();
      if (penalty) {
        return penalty;
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
      if (commandName(token.text) === "root") {
        return this.parsePlainRoot(allowScripts);
      }
      if (commandName(token.text) === "boxed") {
        return this.parseBoxed(allowScripts);
      }
      const phantomCommand = phantomCommandName(token.text);
      if (phantomCommand) {
        return this.parsePhantom(phantomCommand, allowScripts);
      }
      if (commandName(token.text) === "smash") {
        return this.parseSmash(allowScripts);
      }
      if (commandName(token.text) === "rule") {
        return this.parseRule(allowScripts);
      }
      if (commandName(token.text) === "raise" || commandName(token.text) === "lower") {
        return this.parseShiftBox(commandName(token.text) === "raise" ? "raise" : "lower", allowScripts);
      }
      if (commandName(token.text) === "vcenter") {
        return this.parseVCenter(allowScripts);
      }
      const lineCommand = lineCommandName(token.text);
      if (lineCommand) {
        return this.parseLine(lineCommand, allowScripts);
      }
      const varLimit = varLimitCommandName(token.text);
      if (varLimit) {
        return this.parseVarLimit(varLimit, allowScripts);
      }
      if (mathTextCommandName(token.text)) {
        return this.parseText(allowScripts);
      }
      if (commandName(token.text) === "cases") {
        return this.parseCasesMacro(allowScripts);
      }
      const modularCommand = modularArithmeticCommandName(token.text);
      if (modularCommand) {
        return this.parseModularArithmeticCommand(modularCommand, allowScripts);
      }
      if (commandName(token.text) === "models") {
        return this.parseModelsRelation(allowScripts);
      }
      const amsImplication = amsImplicationCommandName(token.text);
      if (amsImplication) {
        return this.parseAmsImplication(amsImplication, allowScripts);
      }
      const mathtoolsColonRelation = mathtoolsColonRelationCommandName(token.text);
      if (mathtoolsColonRelation) {
        return this.parseMathtoolsColonRelation(mathtoolsColonRelation, allowScripts);
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
      const amsNamedOperator = amsNamedOperatorDeclaration(token.text);
      if (amsNamedOperator) {
        return this.parseGeneratedOperatorName(amsNamedOperator, allowScripts);
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
      if (commandName(token.text) === "sideset") {
        return this.parseSideset(allowScripts);
      }
      if (commandName(token.text) === "buildrel") {
        return this.parseBuildrel(allowScripts);
      }
      const stackCommand = stackingCommandName(token.text);
      if (stackCommand) {
        return this.parseStackingCommand(stackCommand, allowScripts);
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
      if (commandName(token.text) === "middle") {
        return this.parseMiddleDelimiter();
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
      if (token.text === "'") {
        return this.maybeParseScripts({
          kind: "atom",
          atomClass: "ord",
          nucleus: {
            kind: "glyph",
            text: "\\prime",
            sourceSpan: token.sourceSpan,
          },
          sourceSpan: token.sourceSpan,
        }, allowScripts);
      }
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

  private parseSideset(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const prescript = this.parseRequiredSidesetSideGroup(command.sourceSpan, `${command.text} left side`);
    const postscript = this.parseRequiredSidesetSideGroup(command.sourceSpan, `${command.text} right side`);
    const base = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} base`);
    const sourceSpan = spanUnion(
      command.sourceSpan,
      base?.sourceSpan ?? postscript?.sourceSpan ?? prescript?.sourceSpan ?? command.sourceSpan
    );
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "op",
      nucleus: {
        kind: "sideset",
        prescript: prescript?.list ?? emptyList(command.sourceSpan.end),
        postscript: postscript?.list ?? emptyList(command.sourceSpan.end),
        base: base?.list ?? emptyList(command.sourceSpan.end),
        commandSourceSpan: command.sourceSpan,
        sourceSpan,
      },
      limits: "display",
      sourceSpan,
    }, allowScripts);
  }

  private parseStackingCommand(
    stackCommand: "overset" | "underset" | "overunderset",
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    const above = stackCommand === "underset"
      ? null
      : this.parseRequiredMathArgument(command.sourceSpan, `${command.text} superscript`);
    const below = stackCommand === "overset"
      ? null
      : this.parseRequiredMathArgument(command.sourceSpan, `${command.text} subscript`);
    const base = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} base`);
    const sourceSpan = spanUnion(
      command.sourceSpan,
      base?.sourceSpan ?? below?.sourceSpan ?? above?.sourceSpan ?? command.sourceSpan
    );
    const baseList = base?.list ?? emptyList(command.sourceSpan.end);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: atomClassForStackingBase(baseList),
      nucleus: {
        kind: "list",
        list: baseList,
        sourceSpan: base?.sourceSpan ?? command.sourceSpan,
      },
      ...(below ? { subscript: { list: below.list, sourceSpan: below.sourceSpan } } : {}),
      ...(above ? { superscript: { list: above.list, sourceSpan: above.sourceSpan } } : {}),
      limits: "limits",
      sourceSpan,
    }, allowScripts);
  }

  private parseBuildrel(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    this.skipSpaces();
    const above = this.parseList({
      stopAtGroupClose: true,
      stopAtBuildrelOver: true,
      allowInfixFraction: false,
    });
    const over = this.peek();
    if (over?.kind !== "command" || commandName(over.text) !== "over") {
      this.addDiagnostic(
        "error",
        "missing-group",
        String.raw`Expected \over in \buildrel expression.`,
        over?.sourceSpan ?? command.sourceSpan
      );
      const sourceSpan = spanUnion(command.sourceSpan, above.sourceSpan);
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "rel",
        nucleus: {
          kind: "unsupported",
          command: command.text,
          sourceSpan,
        },
        sourceSpan,
      }, allowScripts);
    }
    this.advance();
    const base = this.parseRequiredMathArgument(over.sourceSpan, `${command.text} base`);
    const baseList = base?.list ?? emptyList(over.sourceSpan.end);
    const sourceSpan = spanUnion(command.sourceSpan, base?.sourceSpan ?? above.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "rel",
      nucleus: {
        kind: "list",
        list: baseList,
        leadingKern: 0,
        sourceSpan: base?.sourceSpan ?? over.sourceSpan,
      },
      superscript: {
        list: above,
        sourceSpan: above.sourceSpan,
      },
      limits: "limits",
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
    const degree = this.parseOptionalBracketMathArgument(command.sourceSpan);
    const radicand = this.parseRequiredMathArgument(command.sourceSpan, "\\sqrt radicand");
    const sourceSpan = spanUnion(command.sourceSpan, radicand?.sourceSpan ?? degree?.sourceSpan ?? command.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "radical",
        ...(degree ? { degree: degree.list } : {}),
        radicand: radicand?.list ?? emptyList(command.sourceSpan.end),
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parsePlainRoot(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    this.skipSpaces();
    const degree = this.parseList({
      stopAtGroupClose: false,
      stopAtRootOf: true,
      allowInfixFraction: false,
    });
    const of = this.peek();
    if (of?.kind !== "command" || commandName(of.text) !== "of") {
      this.addDiagnostic(
        "error",
        "missing-command",
        "Could not find \\of for \\root.",
        degree.sourceSpan.end > degree.sourceSpan.start ? degree.sourceSpan : command.sourceSpan
      );
      const sourceSpan = spanUnion(command.sourceSpan, degree.sourceSpan);
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "ord",
        nucleus: {
          kind: "unsupported",
          command: "\\root",
          sourceSpan,
        },
        sourceSpan,
      }, allowScripts);
    }
    this.advance();
    const radicand = this.parseRequiredMathArgument(of.sourceSpan, "\\root radicand");
    const sourceSpan = spanUnion(command.sourceSpan, radicand?.sourceSpan ?? of.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "radical",
        degree,
        radicand: radicand?.list ?? emptyList(of.sourceSpan.end),
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parsePenaltyCommand(): TexMathPenalty | null {
    const token = this.peek();
    if (token?.kind !== "command") {
      return null;
    }
    const name = commandName(token.text);
    if (name === "allowbreak") {
      this.advance();
      return {
        kind: "penalty",
        command: "allowbreak",
        penalty: 0,
        sourceSpan: token.sourceSpan,
      };
    }
    if (name === "break") {
      this.advance();
      return {
        kind: "penalty",
        command: "break",
        penalty: -10_000,
        sourceSpan: token.sourceSpan,
      };
    }
    if (name === "nobreak") {
      this.advance();
      return {
        kind: "penalty",
        command: "nobreak",
        penalty: 10_000,
        sourceSpan: token.sourceSpan,
      };
    }
    if (name !== "penalty") {
      return null;
    }

    const command = this.advance();
    this.skipSpaces();
    const start = this.peek();
    let sign = "";
    if (start?.kind === "character" && (start.text === "+" || start.text === "-")) {
      sign = this.advance().text;
    }
    let digits = "";
    let sourceSpan = sign ? spanUnion(command.sourceSpan, start?.sourceSpan ?? command.sourceSpan) : command.sourceSpan;
    while (this.peek()?.kind === "character" && /^\d$/.test(this.peek()?.text ?? "")) {
      const digit = this.advance();
      digits += digit.text;
      sourceSpan = spanUnion(sourceSpan, digit.sourceSpan);
    }
    if (digits === "") {
      this.addDiagnostic(
        "error",
        "missing-group",
        "Expected an integer after \\penalty.",
        start?.sourceSpan ?? command.sourceSpan
      );
      return {
        kind: "penalty",
        command: "penalty",
        penalty: 0,
        sourceSpan,
      };
    }
    return {
      kind: "penalty",
      command: "penalty",
      penalty: Number.parseInt(`${sign}${digits}`, 10),
      sourceSpan,
    };
  }

  private parseKernCommand(): TexMathKern | TexMathUnsupportedItem | null {
    const token = this.peek();
    if (token?.kind !== "command") {
      return null;
    }
    const name = commandName(token.text);
    if (name !== "kern" && name !== "mkern") {
      return null;
    }

    const command = this.advance();
    if (name === "kern") {
      const amount = this.parseTexDimension(command.sourceSpan, "\\kern amount");
      if (!amount) {
        return makeUnsupportedItem(command.text, command.sourceSpan);
      }
      return {
        kind: "kern",
        command: "kern",
        widthPt: amount.valuePt,
        commandSourceSpan: command.sourceSpan,
        amountSourceSpan: amount.sourceSpan,
        sourceSpan: spanUnion(command.sourceSpan, amount.sourceSpan),
      };
    }

    const amount = this.parseTexMuDimension(command.sourceSpan, "\\mkern amount");
    if (!amount) {
      return makeUnsupportedItem(command.text, command.sourceSpan);
    }
    return {
      kind: "kern",
      command: "mkern",
      mu: amount.valueMu,
      commandSourceSpan: command.sourceSpan,
      amountSourceSpan: amount.sourceSpan,
      sourceSpan: spanUnion(command.sourceSpan, amount.sourceSpan),
    };
  }

  private parseSkipCommand(): TexMathSkipGlue | TexMathUnsupportedItem | null {
    const token = this.peek();
    if (token?.kind !== "command") {
      return null;
    }
    const name = commandName(token.text);
    if (name !== "hskip" && name !== "mskip") {
      return null;
    }

    const command = this.advance();
    if (name === "hskip") {
      const amount = this.parseTexDimension(command.sourceSpan, "\\hskip amount");
      if (!amount) {
        return makeUnsupportedItem(command.text, command.sourceSpan);
      }
      const stretch = this.parseOptionalTexDimensionKeyword("plus", "\\hskip stretch");
      const shrink = this.parseOptionalTexDimensionKeyword("minus", "\\hskip shrink");
      return {
        kind: "skip-glue",
        command: "hskip",
        widthPt: amount.valuePt,
        ...(stretch ? { stretchPt: stretch.valuePt } : {}),
        ...(shrink ? { shrinkPt: shrink.valuePt } : {}),
        commandSourceSpan: command.sourceSpan,
        amountSourceSpan: amount.sourceSpan,
        sourceSpan: spanUnion(command.sourceSpan, shrink?.sourceSpan ?? stretch?.sourceSpan ?? amount.sourceSpan),
      };
    }

    const amount = this.parseTexMuDimension(command.sourceSpan, "\\mskip amount");
    if (!amount) {
      return makeUnsupportedItem(command.text, command.sourceSpan);
    }
    const stretch = this.parseOptionalTexMuDimensionKeyword("plus", "\\mskip stretch");
    const shrink = this.parseOptionalTexMuDimensionKeyword("minus", "\\mskip shrink");
    return {
      kind: "skip-glue",
      command: "mskip",
      mu: amount.valueMu,
      ...(stretch ? { stretchMu: stretch.valueMu } : {}),
      ...(shrink ? { shrinkMu: shrink.valueMu } : {}),
      commandSourceSpan: command.sourceSpan,
      amountSourceSpan: amount.sourceSpan,
      sourceSpan: spanUnion(command.sourceSpan, shrink?.sourceSpan ?? stretch?.sourceSpan ?? amount.sourceSpan),
    };
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

  private parseVarLimit(commandNameValue: TexMathVarLimitCommand, allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "op",
      nucleus: {
        kind: "var-limit",
        command: commandNameValue,
        commandSourceSpan: command.sourceSpan,
        sourceSpan: command.sourceSpan,
      },
      limits: "display",
      sourceSpan: command.sourceSpan,
    }, allowScripts);
  }

  private parseBoxed(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const body = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} body`);
    const sourceSpan = spanUnion(command.sourceSpan, body?.sourceSpan ?? command.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "boxed",
        body: body?.list ?? emptyList(command.sourceSpan.end),
        commandSourceSpan: command.sourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseSmash(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const option = this.parseOptionalBracketTextArgument(command.sourceSpan, `${command.text} option`);
    const body = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} body`);
    const optionText = option?.text.trim() ?? "tb";
    const smashHeight = optionText.includes("t");
    const smashDepth = optionText.includes("b");
    if (option && !/^[tb]+$/u.test(optionText)) {
      this.addDiagnostic(
        "warning",
        "unsupported-command",
        `Unsupported \\smash option [${optionText}].`,
        option.contentSourceSpan
      );
    }
    const sourceSpan = spanUnion(
      command.sourceSpan,
      body?.sourceSpan ?? option?.sourceSpan ?? command.sourceSpan
    );
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "smash",
        body: body?.list ?? emptyList(command.sourceSpan.end),
        smashHeight: !option || smashHeight,
        smashDepth: !option || smashDepth,
        commandSourceSpan: command.sourceSpan,
        ...(option ? { optionSourceSpan: option.sourceSpan } : {}),
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parsePhantom(
    commandNameValue: "phantom" | "hphantom" | "vphantom",
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    const body = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} body`);
    const sourceSpan = spanUnion(command.sourceSpan, body?.sourceSpan ?? command.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "phantom",
        body: body?.list ?? emptyList(command.sourceSpan.end),
        preserveWidth: commandNameValue === "phantom" || commandNameValue === "hphantom",
        preserveVertical: commandNameValue === "phantom" || commandNameValue === "vphantom",
        command: commandNameValue,
        commandSourceSpan: command.sourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseRule(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const raise = this.parseOptionalBracketDimensionArgument(command.sourceSpan, `${command.text} raise`);
    const width = this.parseRequiredDimensionArgument(command, "width");
    const height = this.parseRequiredDimensionArgument(command, "height");
    const sourceSpan = spanUnion(
      command.sourceSpan,
      height?.sourceSpan ?? width?.sourceSpan ?? raise?.sourceSpan ?? command.sourceSpan
    );
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "rule",
        width: width?.valuePt ?? 0,
        height: height?.valuePt ?? 0,
        raise: raise?.valuePt ?? 0,
        commandSourceSpan: command.sourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseShiftBox(direction: "raise" | "lower", allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const amount = this.parseTexDimension(command.sourceSpan, `${command.text} amount`);
    this.skipSpaces();
    const next = this.peek();
    if (next?.kind !== "command" || commandName(next.text) !== "hbox") {
      this.addDiagnostic(
        "error",
        "missing-command",
        `Expected \\hbox after ${command.text}.`,
        next?.sourceSpan ?? command.sourceSpan
      );
      const sourceSpan = spanUnion(command.sourceSpan, amount?.sourceSpan ?? command.sourceSpan);
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "ord",
        nucleus: {
          kind: "unsupported",
          command: command.text,
          sourceSpan,
        },
        sourceSpan,
      }, allowScripts);
    }

    const box = this.parseText(false);
    const body = listFromItems([box], box.sourceSpan);
    const sourceSpan = spanUnion(command.sourceSpan, box.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "shift-box",
        direction,
        amount: amount?.valuePt ?? 0,
        body,
        commandSourceSpan: command.sourceSpan,
        amountSourceSpan: amount?.sourceSpan ?? command.sourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseVCenter(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const body = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} body`);
    const sourceSpan = spanUnion(command.sourceSpan, body?.sourceSpan ?? command.sourceSpan);
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "ord",
      nucleus: {
        kind: "vcenter",
        body: body?.list ?? emptyList(command.sourceSpan.end),
        commandSourceSpan: command.sourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseText(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    const name = mathTextCommandName(command.text) ?? "text";
    let boxWidth: number | undefined;
    let boxAlign: SimpleTexTextBoxAlignment | undefined;
    let argumentSpan = command.sourceSpan;
    if (name === "makebox") {
      const widthArgument = this.parseOptionalBracketDimensionArgument(
        command.sourceSpan,
        `${command.text} width`
      );
      if (widthArgument) {
        boxWidth = widthArgument.valuePt;
        boxAlign = "center";
        argumentSpan = spanUnion(argumentSpan, widthArgument.sourceSpan);
        const alignArgument = this.parseOptionalBracketTextArgument(
          command.sourceSpan,
          `${command.text} alignment`
        );
        if (alignArgument) {
          boxAlign = simpleTexTextBoxAlignment(alignArgument.text.trim());
          argumentSpan = spanUnion(argumentSpan, alignArgument.sourceSpan);
        }
      }
    } else if (name === "llap") {
      boxWidth = 0;
      boxAlign = "right";
    } else if (name === "rlap") {
      boxWidth = 0;
      boxAlign = "left";
    }
    const content = this.parseRequiredTextGroup(command.sourceSpan, `${command.text} content`);
    const sourceSpan = spanUnion(argumentSpan, content?.sourceSpan ?? argumentSpan);
    if (!content || content.unsupported) {
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "ord",
        nucleus: {
          kind: "unsupported",
          command: `\\${name}`,
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
        command: name,
        text: content.text,
        nodes: content.nodes,
        parts: content.parts,
        boxWidth,
        boxAlign,
        textSourceSpan: content.textSourceSpan,
        sourceSpan,
      },
      sourceSpan,
    }, allowScripts);
  }

  private parseCasesMacro(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    this.skipSpaces();
    const next = this.peek();
    if (next?.kind !== "group-open") {
      this.addDiagnostic(
        "error",
        "missing-group",
        "Expected a braced \\cases body.",
        next?.sourceSpan ?? command.sourceSpan
      );
      return this.maybeParseScripts({
        kind: "atom",
        atomClass: "inner",
        nucleus: {
          kind: "unsupported",
          command: "\\cases",
          sourceSpan: command.sourceSpan,
        },
        sourceSpan: command.sourceSpan,
      }, allowScripts);
    }

    const open = this.expectGroupOpen();
    const rows: TexMathAlignedRow[] = [];
    let sourceSpan = spanUnion(command.sourceSpan, open.sourceSpan);

    while (!this.isAtEnd()) {
      const end = this.peek();
      if (end?.kind === "group-close") {
        const close = this.advance();
        sourceSpan = spanUnion(sourceSpan, close.sourceSpan);
        return this.maybeParseScripts(
          casesAtom(rows, command.sourceSpan, undefined, sourceSpan),
          allowScripts
        );
      }

      const cells: TexMathAlignedCell[] = [];
      let pendingRowSourceSpan: TexMathSourceSpan | undefined;
      let extraAlignmentTabSourceSpan: TexMathSourceSpan | undefined;
      while (!this.isAtEnd()) {
        const cellList = this.parseList({
          stopAtGroupClose: true,
          stopAtAlignmentTab: true,
          stopAtRowBreak: true,
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
          if (!extraAlignmentTabSourceSpan && cells.length >= 2) {
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
          "Extra alignment tab in \\cases text.",
          extraAlignmentTabSourceSpan
        );
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
      if (this.peek()?.kind === "group-close") {
        rows.push({
          cells,
          sourceSpan: pendingRowSourceSpan ?? this.peek()?.sourceSpan ?? sourceSpan,
        });
        continue;
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
      "unexpected-group-close",
      "Expected } to close \\cases body.",
      open.sourceSpan
    );
    return this.maybeParseScripts(
      casesAtom(rows, command.sourceSpan, undefined, sourceSpan),
      allowScripts
    );
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
    const content = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} content`);
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

  private parseGeneratedOperatorName(
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
    return this.maybeParseScripts({
      kind: "atom",
      atomClass: "op",
      nucleus: operatorNameNucleus(name, command.sourceSpan, command.sourceSpan),
      limits: defaultNamedOperatorLimits(name),
      sourceSpan: command.sourceSpan,
    }, allowScripts);
  }

  private parseModularArithmeticCommand(
    commandNameValue: "bmod" | "pmod" | "mod",
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    if (commandNameValue === "bmod") {
      return this.maybeParseScripts(modularArithmeticAtom(
        command.sourceSpan,
        [
          nonscriptNegativeMedMu(command.sourceSpan),
          explicitMu(5, command.sourceSpan),
          generatedOperatorNameAtom("mod", "bin", command.sourceSpan, command.sourceSpan),
          explicitMu(5, command.sourceSpan),
          nonscriptNegativeMedMu(command.sourceSpan),
        ]
      ), allowScripts);
    }

    const argument = this.parseRequiredMathArgument(command.sourceSpan, `${command.text} argument`);
    const sourceSpan = spanUnion(command.sourceSpan, argument?.sourceSpan ?? command.sourceSpan);
    const argumentItems = argument?.list.items ?? [];
    if (commandNameValue === "pmod") {
      return this.maybeParseScripts(modularArithmeticAtom(
        sourceSpan,
        [
          explicitMu(8, command.sourceSpan, { displayMu: 18 }),
          generatedGlyphAtom("(", "open", command.sourceSpan),
          generatedOperatorNameAtom("mod", "ord", command.sourceSpan, command.sourceSpan),
          explicitMu(6, command.sourceSpan),
          ...argumentItems,
          generatedGlyphAtom(")", "close", command.sourceSpan),
        ]
      ), allowScripts);
    }

    return this.maybeParseScripts(modularArithmeticAtom(
      sourceSpan,
      [
        explicitMu(12, command.sourceSpan, { displayMu: 18 }),
        generatedOperatorNameAtom("mod", "ord", command.sourceSpan, command.sourceSpan),
        explicitMu(3, command.sourceSpan),
        explicitMu(3, command.sourceSpan),
        ...argumentItems,
      ]
    ), allowScripts);
  }

  private parseModelsRelation(allowScripts: boolean): TexMathAtom {
    const command = this.advance();
    return this.maybeParseScripts(generatedListAtom(
      "rel",
      command.sourceSpan,
      [
        generatedGlyphAtom("\\mid", "rel", command.sourceSpan),
        explicitMu(-3, command.sourceSpan),
        generatedGlyphAtom("=", "rel", command.sourceSpan),
      ]
    ), allowScripts);
  }

  private parseAmsImplication(
    implication: "implies" | "impliedby",
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    const arrow = implication === "implies" ? "\\Longrightarrow" : "\\Longleftarrow";
    return this.maybeParseScripts(generatedListAtom(
      "rel",
      command.sourceSpan,
      [
        explicitMu(5, command.sourceSpan),
        generatedGlyphAtom(arrow, "rel", command.sourceSpan),
        explicitMu(5, command.sourceSpan),
      ]
    ), allowScripts);
  }

  private parseMathtoolsColonRelation(
    relation: MathtoolsColonRelationCommand,
    allowScripts: boolean
  ): TexMathAtom {
    const command = this.advance();
    return this.maybeParseScripts(generatedListAtom(
      "rel",
      command.sourceSpan,
      mathtoolsColonRelationItems(relation, command.sourceSpan)
    ), allowScripts);
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
    columnSeparation: "align" | "none" | "gather" | "multline" | "eqnarray" | "xalignat" | "xxalignat" | "flalign" | undefined
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

  private parseMiddleDelimiter(): TexMathItem {
    const command = this.advance();
    const delimiter = this.parseDelimiter(command.sourceSpan, "\\middle delimiter");
    const sourceSpan = spanUnion(command.sourceSpan, delimiter?.sourceSpan ?? command.sourceSpan);
    if (!delimiter) {
      return {
        kind: "unsupported",
        command: "\\middle",
        sourceSpan,
      };
    }
    return {
      kind: "middle-delimiter",
      delimiter: delimiter.delimiter,
      commandSourceSpan: command.sourceSpan,
      delimiterSourceSpan: delimiter.sourceSpan,
      sourceSpan,
    };
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
      return this.parseXalignatEnvironment(beginCommand.sourceSpan, environmentName, "xalignat", allowScripts);
    }
    if (environmentName && xxalignatEnvironmentName(environmentName.name)) {
      return this.parseXalignatEnvironment(beginCommand.sourceSpan, environmentName, "xxalignat", allowScripts);
    }
    if (environmentName && eqnarrayEnvironmentName(environmentName.name)) {
      return this.parseEqnarrayEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
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
    if (environmentName?.name === "subarray") {
      return this.parseSubarrayEnvironment(beginCommand.sourceSpan, environmentName, allowScripts);
    }
    const smallMatrixEnvironment = smallMatrixEnvironmentName(environmentName?.name);
    if (environmentName && smallMatrixEnvironment) {
      return this.parseSmallMatrixEnvironment(beginCommand.sourceSpan, environmentName, smallMatrixEnvironment, allowScripts);
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
          : flalignEnvironmentName(environmentName.name)
            ? "flalign"
          : "align",
      ...(multlineEnvironmentName(environmentName.name) ? { maxFields: 1 } : {}),
      allowAlignmentTags: displayAlignmentEnvironmentName(environmentName.name),
      allowDisplayBreak: displayAlignmentEnvironmentName(environmentName.name),
      allowIntertext: alignEnvironmentName(environmentName.name) ||
        flalignEnvironmentName(environmentName.name) ||
        gatherEnvironmentName(environmentName.name),
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
      allowIntertext: true,
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
      allowIntertext: false,
      allowScripts,
    });
  }

  private parseEqnarrayEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    allowScripts: boolean
  ): TexMathAtom {
    return this.parseAlignedBody({
      beginSourceSpan,
      initialSourceSpan: spanUnion(beginSourceSpan, environmentName.sourceSpan),
      stopAtEnvironmentEnd: environmentName.name,
      columnSeparation: "eqnarray",
      maxFields: 3,
      allowAlignmentTags: true,
      allowDisplayBreak: false,
      allowIntertext: false,
      allowScripts,
    });
  }

  private parseMatrixEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    environment: TexMathMatrixEnvironment,
    allowScripts: boolean
  ): TexMathAtom {
    const alignment = environmentName.name.endsWith("*")
      ? this.consumeOptionalMatrixColumnAlignment() ?? { alignment: "center" as const, sourceSpan: environmentName.sourceSpan }
      : { alignment: "center" as const, sourceSpan: environmentName.sourceSpan };
    return this.parseMatrixBody({
      beginSourceSpan,
      initialSourceSpan: spanUnion(spanUnion(beginSourceSpan, environmentName.sourceSpan), alignment.sourceSpan),
      stopAtEnvironmentEnd: environmentName.name,
      environment,
      columnAlignment: alignment.alignment,
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
      verticalRules: preamble.verticalRules,
      preambleItems: preamble.preambleItems,
      cellInserts: preamble.cellInserts,
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
    environment: TexMathSmallMatrixEnvironment,
    allowScripts: boolean
  ): TexMathAtom {
    const alignment = environmentName.name.endsWith("*")
      ? this.consumeOptionalMatrixColumnAlignment() ?? { alignment: "center" as const, sourceSpan: environmentName.sourceSpan }
      : { alignment: "center" as const, sourceSpan: environmentName.sourceSpan };
    return this.parseSmallMatrixBody({
      beginSourceSpan,
      initialSourceSpan: spanUnion(spanUnion(beginSourceSpan, environmentName.sourceSpan), alignment.sourceSpan),
      stopAtEnvironmentEnd: environmentName.name,
      environment,
      columnAlignment: alignment.alignment,
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

  private parseXalignatEnvironment(
    beginSourceSpan: TexMathSourceSpan,
    environmentName: { name: string; sourceSpan: TexMathSourceSpan },
    columnSeparation: "xalignat" | "xxalignat",
    allowScripts: boolean
  ): TexMathAtom {
    const initialSourceSpan = spanUnion(beginSourceSpan, environmentName.sourceSpan);
    const pairCount = this.parsePositiveIntegerGroup(
      initialSourceSpan,
      `\\begin{${environmentName.name}} column count`
    );
    if (pairCount) {
      return this.parseAlignedBody({
        beginSourceSpan,
        initialSourceSpan: spanUnion(initialSourceSpan, pairCount.sourceSpan),
        preambleSourceSpan: pairCount.sourceSpan,
        stopAtEnvironmentEnd: environmentName.name,
        columnSeparation,
        maxFields: pairCount.value * 2,
        allowAlignmentTags: columnSeparation !== "xxalignat",
        allowDisplayBreak: true,
        allowIntertext: true,
        allowScripts,
      });
    }

    const body = this.consumeXalignatBody(environmentName.name, null);
    const sourceSpan = spanUnion(
      initialSourceSpan,
      body.sourceSpan ?? initialSourceSpan
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
    readonly columnSeparation?: "align" | "none" | "gather" | "multline" | "eqnarray" | "xalignat" | "xxalignat" | "flalign";
    readonly maxFields?: number;
    readonly allowAlignmentTags?: boolean;
    readonly allowDisplayBreak?: boolean;
    readonly allowIntertext?: boolean;
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
    readonly columnSeparation?: "align" | "none" | "gather" | "multline" | "eqnarray" | "xalignat" | "xxalignat" | "flalign";
    readonly maxFields?: number;
    readonly allowAlignmentTags?: boolean;
    readonly allowDisplayBreak?: boolean;
    readonly allowIntertext?: boolean;
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
      const intertextsBefore = this.consumeLeadingAlignmentIntertexts(params.allowIntertext ?? false);
      if (intertextsBefore.length > 0) {
        for (const intertext of intertextsBefore) {
          sourceSpan = spanUnion(sourceSpan, intertext.sourceSpan);
        }
      }
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
          ...(intertextsBefore.length > 0 ? { intertextsBefore } : {}),
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
          ...(intertextsBefore.length > 0 ? { intertextsBefore } : {}),
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
          ...(intertextsBefore.length > 0 ? { intertextsBefore } : {}),
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

  private consumeLeadingAlignmentIntertexts(
    allowIntertext: boolean
  ): readonly TexMathAlignedIntertext[] {
    const intertexts: TexMathAlignedIntertext[] = [];
    while (!this.isAtEnd()) {
      this.skipSpaces();
      const token = this.peek();
      if (token?.kind !== "command" || alignmentMetadataCommand(token.text) !== "intertext") {
        break;
      }
      const command = this.advance();
      const content = this.parseRequiredTextGroup(command.sourceSpan, `${command.text} text`);
      const sourceSpan = spanUnion(command.sourceSpan, content?.sourceSpan ?? command.sourceSpan);
      if (!allowIntertext || !content || content.unsupported) {
        this.addDiagnostic(
          "error",
          "unsupported-command",
          `Unsupported alignment command ${command.text}.`,
          sourceSpan
        );
        continue;
      }
      intertexts.push({
        text: content.text,
        parts: content.parts,
        sourceSpan,
        textSourceSpan: content.textSourceSpan,
      });
    }
    return intertexts;
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
      readonly explicit?: boolean;
    }[];
    readonly sourceSpan?: TexMathSourceSpan;
  } {
    let suppressTag = false;
    const labels: Array<{
      readonly text: string;
      readonly sourceSpan: TexMathSourceSpan;
      readonly textSourceSpan: TexMathSourceSpan;
      readonly explicit?: boolean;
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
      if (metadata === "intertext" || metadata === "unsupported-text") {
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
          explicit: true,
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

  private parseTexMuDimension(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): { readonly valueMu: number; readonly sourceSpan: TexMathSourceSpan } | null {
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
    const number = Number(text);
    if (!sawDigit || !Number.isFinite(number) || unit !== "mu") {
      this.addDiagnostic(
        "error",
        "invalid-tex-dimension",
        `Unsupported or invalid TeX mu dimension for ${label}.`,
        sourceSpan
      );
      return null;
    }
    return {
      valueMu: number,
      sourceSpan,
    };
  }

  private parseOptionalTexDimensionKeyword(
    keyword: "plus" | "minus",
    label: string
  ): { readonly valuePt: number; readonly sourceSpan: TexMathSourceSpan } | null {
    const checkpoint = this.index;
    const keywordSpan = this.consumeCharacterKeyword(keyword);
    if (!keywordSpan) {
      this.index = checkpoint;
      return null;
    }
    const dimension = this.parseTexDimension(keywordSpan, label);
    if (!dimension) {
      return null;
    }
    return {
      valuePt: dimension.valuePt,
      sourceSpan: spanUnion(keywordSpan, dimension.sourceSpan),
    };
  }

  private parseOptionalTexMuDimensionKeyword(
    keyword: "plus" | "minus",
    label: string
  ): { readonly valueMu: number; readonly sourceSpan: TexMathSourceSpan } | null {
    const checkpoint = this.index;
    const keywordSpan = this.consumeCharacterKeyword(keyword);
    if (!keywordSpan) {
      this.index = checkpoint;
      return null;
    }
    const dimension = this.parseTexMuDimension(keywordSpan, label);
    if (!dimension) {
      return null;
    }
    return {
      valueMu: dimension.valueMu,
      sourceSpan: spanUnion(keywordSpan, dimension.sourceSpan),
    };
  }

  private consumeCharacterKeyword(keyword: string): TexMathSourceSpan | null {
    this.skipSpaces();
    let sourceSpan: TexMathSourceSpan | null = null;
    for (const expected of keyword) {
      const token = this.peek();
      if (token?.kind !== "character" || token.text !== expected) {
        return null;
      }
      const consumed = this.advance();
      sourceSpan = sourceSpan ? spanUnion(sourceSpan, consumed.sourceSpan) : consumed.sourceSpan;
    }
    return sourceSpan;
  }

  private parseMatrixBody(params: {
    readonly beginSourceSpan: TexMathSourceSpan;
    readonly initialSourceSpan: TexMathSourceSpan;
    readonly stopAtEnvironmentEnd: string;
    readonly environment: TexMathMatrixEnvironment;
    readonly columnAlignment: TexMathArrayColumnAlignment;
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
          matrixAtom(params.environment, rows, params.columnAlignment, params.beginSourceSpan, endSourceSpan, sourceSpan),
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
          matrixAtom(params.environment, rows, params.columnAlignment, params.beginSourceSpan, endSourceSpan, sourceSpan),
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
      matrixAtom(params.environment, rows, params.columnAlignment, params.beginSourceSpan, undefined, sourceSpan),
      params.allowScripts
    );
  }

  private parseArrayBody(params: {
    readonly beginSourceSpan: TexMathSourceSpan;
    readonly initialSourceSpan: TexMathSourceSpan;
    readonly preambleSourceSpan: TexMathSourceSpan;
    readonly columnAlignments: readonly TexMathArrayColumnAlignment[];
    readonly verticalRules: readonly TexMathArrayVerticalRule[];
    readonly preambleItems: readonly TexMathArrayPreambleItem[];
    readonly cellInserts: readonly TexMathArrayCellInsert[];
    readonly allowScripts: boolean;
  }): TexMathAtom {
    const rows: TexMathAlignedRow[] = [];
    const rowRules: TexMathArrayRowRule[] = [];
    let endSourceSpan: TexMathSourceSpan | undefined;
    let sourceSpan = params.initialSourceSpan;

    while (!this.isAtEnd()) {
      const rules = this.consumeArrayRowRules(rows.length);
      if (rules.length > 0) {
        rowRules.push(...rules);
        sourceSpan = spanUnion(sourceSpan, rules[rules.length - 1]?.sourceSpan ?? sourceSpan);
      }
      if (this.isEnvironmentEnd("array")) {
        endSourceSpan = this.consumeEnvironmentEnd("array");
        sourceSpan = spanUnion(sourceSpan, endSourceSpan);
        return this.maybeParseScripts(
          arrayAtom(rows, params.columnAlignments, params.verticalRules, params.preambleItems, params.cellInserts, rowRules, params.beginSourceSpan, params.preambleSourceSpan, endSourceSpan, sourceSpan),
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
          arrayAtom(rows, params.columnAlignments, params.verticalRules, params.preambleItems, params.cellInserts, rowRules, params.beginSourceSpan, params.preambleSourceSpan, endSourceSpan, sourceSpan),
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
      arrayAtom(rows, params.columnAlignments, params.verticalRules, params.preambleItems, params.cellInserts, rowRules, params.beginSourceSpan, params.preambleSourceSpan, undefined, sourceSpan),
      params.allowScripts
    );
  }

  private consumeArrayRowRules(beforeRow: number): TexMathArrayRowRule[] {
    const rules: TexMathArrayRowRule[] = [];
    while (!this.isAtEnd()) {
      this.skipSpaces();
      const token = this.peek();
      if (token?.kind !== "command" || commandName(token.text) !== "hline") {
        break;
      }
      this.advance();
      rules.push({
        beforeRow,
        sourceSpan: token.sourceSpan,
      });
    }
    return rules;
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
      let extraAlignmentTabSourceSpan: TexMathSourceSpan | undefined;
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
          if (!extraAlignmentTabSourceSpan && cells.length >= 2) {
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
          "Extra alignment tab in \\cases text.",
          extraAlignmentTabSourceSpan
        );
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
    readonly stopAtEnvironmentEnd: string;
    readonly environment: TexMathSmallMatrixEnvironment;
    readonly columnAlignment: TexMathArrayColumnAlignment;
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
          smallMatrixAtom(params.environment, rows, params.columnAlignment, params.beginSourceSpan, endSourceSpan, sourceSpan),
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
          smallMatrixAtom(params.environment, rows, params.columnAlignment, params.beginSourceSpan, endSourceSpan, sourceSpan),
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
      smallMatrixAtom(params.environment, rows, params.columnAlignment, params.beginSourceSpan, undefined, sourceSpan),
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
  ): {
    readonly alignments: readonly TexMathArrayColumnAlignment[];
    readonly verticalRules: readonly TexMathArrayVerticalRule[];
    readonly preambleItems: readonly TexMathArrayPreambleItem[];
    readonly cellInserts: readonly TexMathArrayCellInsert[];
    readonly sourceSpan: TexMathSourceSpan;
  } | null {
    const group = this.parseRequiredRawGroup(fallbackSpan, "\\begin{array} column preamble");
    if (!group) {
      return null;
    }
    const parsed = this.parseArrayPreambleTokens(group.tokens);
    if (parsed.unsupported) {
      return { alignments: [], verticalRules: [], preambleItems: [], cellInserts: [], sourceSpan: group.sourceSpan };
    }
    return {
      alignments: parsed.alignments,
      verticalRules: parsed.verticalRules,
      preambleItems: parsed.preambleItems,
      cellInserts: parsed.cellInserts,
      sourceSpan: group.sourceSpan,
    };
  }

  private parseArrayPreambleTokens(
    tokens: readonly TexMathToken[]
  ): {
    readonly alignments: readonly TexMathArrayColumnAlignment[];
    readonly verticalRules: readonly TexMathArrayVerticalRule[];
    readonly preambleItems: readonly TexMathArrayPreambleItem[];
    readonly cellInserts: readonly TexMathArrayCellInsert[];
    readonly unsupported: boolean;
  } {
    const expanded = this.expandArrayPreambleRepeatTokens(tokens);
    if (expanded.unsupported) {
      return { alignments: [], verticalRules: [], preambleItems: [], cellInserts: [], unsupported: true };
    }
    const alignments: TexMathArrayColumnAlignment[] = [];
    const verticalRules: TexMathArrayVerticalRule[] = [];
    const preambleItems: TexMathArrayPreambleItem[] = [];
    const cellInserts: TexMathArrayCellInsert[] = [];
    const pendingBeforeInserts: PendingArrayCellInsert[] = [];
    let unsupported = false;
    for (let index = 0; index < expanded.tokens.length; index += 1) {
      const token = expanded.tokens[index];
      if (!token) {
        break;
      }
      if (token.kind === "space") {
        continue;
      }
      const alignment = arrayPreambleAlignment(token);
      if (alignment) {
        const columnIndex = alignments.length;
        alignments.push(alignment);
        for (const insert of pendingBeforeInserts) {
          cellInserts.push({
            columnIndex,
            position: "before",
            ...insert,
          });
        }
        pendingBeforeInserts.length = 0;
        continue;
      }
      if (token.kind === "character" && token.text === "|") {
        verticalRules.push({
          beforeColumn: alignments.length,
          sourceSpan: token.sourceSpan,
        });
        preambleItems.push({
          kind: "vertical-rule",
          beforeColumn: alignments.length,
          sourceSpan: token.sourceSpan,
        });
        continue;
      }
      if (token.kind === "character" && (token.text === "@" || token.text === "!")) {
        const argument = readPreambleArgumentGroup(expanded.tokens, index + 1);
        if (!argument) {
          unsupported = true;
          this.addDiagnostic(
            "warning",
            "unsupported-command",
            `Unsupported array column specifier ${token.text}.`,
            token.sourceSpan
          );
          continue;
        }
        const insert = this.parseArrayPreambleInsert(token, argument, alignments.length);
        if (!insert) {
          unsupported = true;
        } else {
          preambleItems.push(insert);
        }
        index = argument.nextIndex - 1;
        continue;
      }
      if (token.kind === "character" && (token.text === ">" || token.text === "<")) {
        const argument = readPreambleArgumentGroup(expanded.tokens, index + 1);
        if (!argument) {
          unsupported = true;
          this.addDiagnostic(
            "warning",
            "unsupported-command",
            `Unsupported array column specifier ${token.text}.`,
            token.sourceSpan
          );
          continue;
        }
        const insert = this.parseArrayCellInsert(token, argument);
        if (!insert) {
          unsupported = true;
        } else if (token.text === ">") {
          pendingBeforeInserts.push(insert);
        } else if (alignments.length > 0) {
          cellInserts.push({
            columnIndex: alignments.length - 1,
            position: "after",
            ...insert,
          });
        } else {
          unsupported = true;
          this.addDiagnostic(
            "warning",
            "unsupported-command",
            "Unsupported array column suffix before a column.",
            token.sourceSpan
          );
        }
        index = argument.nextIndex - 1;
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
    if (pendingBeforeInserts.length > 0) {
      unsupported = true;
      for (const insert of pendingBeforeInserts) {
        this.addDiagnostic(
          "warning",
          "unsupported-command",
          "Unsupported array column prefix without a following column.",
          insert.commandSourceSpan
        );
      }
    }
    return { alignments, verticalRules, preambleItems, cellInserts, unsupported };
  }

  private parseArrayPreambleInsert(
    token: TexMathToken,
    argument: {
      readonly tokens: readonly TexMathToken[];
      readonly sourceSpan: TexMathSourceSpan;
    },
    beforeColumn: number
  ): TexMathArrayPreambleInsert | null {
    const text = argument.tokens.map((argumentToken) => argumentToken.text).join("");
    const parsed = parseTexMath(text, {
      sourceOffset: argument.sourceSpan.start + 1,
      suppressTerminalEllipsisGlue: this.options.suppressTerminalEllipsisGlue,
    });
    this.diagnostics.push(...parsed.diagnostics);
    if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return null;
    }
    return {
      kind: "insert",
      beforeColumn,
      mode: token.text === "@" ? "replace-spacing" : "add-spacing",
      list: parsed.list,
      commandSourceSpan: token.sourceSpan,
      sourceSpan: spanUnion(token.sourceSpan, argument.sourceSpan),
    };
  }

  private parseArrayCellInsert(
    token: TexMathToken,
    argument: {
      readonly tokens: readonly TexMathToken[];
      readonly sourceSpan: TexMathSourceSpan;
    }
  ): PendingArrayCellInsert | null {
    const text = argument.tokens.map((argumentToken) => argumentToken.text).join("");
    const parsed = parseTexMath(text, {
      sourceOffset: argument.sourceSpan.start + 1,
      suppressTerminalEllipsisGlue: this.options.suppressTerminalEllipsisGlue,
    });
    this.diagnostics.push(...parsed.diagnostics);
    if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return null;
    }
    return {
      list: parsed.list,
      commandSourceSpan: token.sourceSpan,
      sourceSpan: spanUnion(token.sourceSpan, argument.sourceSpan),
    };
  }

  private expandArrayPreambleRepeatTokens(
    tokens: readonly TexMathToken[]
  ): {
    readonly tokens: readonly TexMathToken[];
    readonly unsupported: boolean;
  } {
    const expanded: TexMathToken[] = [];
    let unsupported = false;
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      if (!token) {
        break;
      }
      if (token.kind === "character" && token.text === "*") {
        const countGroup = readBalancedTokenGroup(tokens, index + 1);
        if (!countGroup) {
          unsupported = true;
          this.addDiagnostic(
            "warning",
            "unsupported-command",
            "Unsupported array column repeat without a braced count.",
            token.sourceSpan
          );
          index += 1;
          continue;
        }
        const countText = countGroup.tokens.map((countToken) => countToken.text).join("").trim();
        const repeatCount = /^[0-9]+$/u.test(countText) ? Number(countText) : Number.NaN;
        if (!Number.isSafeInteger(repeatCount)) {
          unsupported = true;
          this.addDiagnostic(
            "warning",
            "unsupported-command",
            "Unsupported array column repeat count.",
            countGroup.sourceSpan
          );
          index = countGroup.nextIndex;
          continue;
        }
        const repeated = readArrayPreambleRepeatBody(tokens, countGroup.nextIndex);
        if (!repeated) {
          unsupported = true;
          this.addDiagnostic(
            "warning",
            "unsupported-command",
            "Unsupported array column repeat without a body.",
            token.sourceSpan
          );
          index = countGroup.nextIndex;
          continue;
        }
        const nested = this.expandArrayPreambleRepeatTokens(repeated.tokens);
        unsupported ||= nested.unsupported;
        for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
          expanded.push(...nested.tokens);
        }
        index = repeated.nextIndex;
        continue;
      }
      expanded.push(token);
      index += 1;
    }
    return { tokens: expanded, unsupported };
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

  private consumeOptionalMatrixColumnAlignment(): {
    readonly alignment: TexMathArrayColumnAlignment;
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
    const alignment = trimmed === "l"
      ? "left"
      : trimmed === "c"
        ? "center"
        : trimmed === "r"
          ? "right"
          : null;
    if (!alignment) {
      this.addDiagnostic(
        "warning",
        "unsupported-command",
        `Unsupported matrix column alignment ${trimmed || "[]"}.`,
        sourceSpan
      );
      return {
        alignment: "center",
        sourceSpan,
      };
    }
    return {
      alignment,
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
    nodes: readonly SimpleTexInlineNode[];
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
    let lastSpan: TexMathSourceSpan = open.sourceSpan;
    let depth = 0;
    let raw = "";
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
      } else if (token.kind === "group-close") {
        depth = Math.max(0, depth - 1);
      }
      raw += token.text;
    }
    const close = this.consumeGroupClose(open.sourceSpan);
    const contentStart = open.sourceSpan.end;
    const contentEnd = close?.sourceSpan.start ?? lastSpan.end;
    const parsedInline = parseSimpleTexInlineNodes(raw, contentStart);
    const parts = this.mathTextPartsFromInlineNodes(parsedInline.nodes);
    const hasForcedBreak = parsedInline.nodes.some((node) => node.kind === "line-break");
    return {
      text: mathTextPlainText(parsedInline.nodes),
      nodes: parsedInline.nodes,
      parts,
      sourceSpan: spanUnion(open.sourceSpan, close?.sourceSpan ?? lastSpan),
      textSourceSpan: { start: contentStart, end: Math.max(contentStart, contentEnd) },
      unsupported: parsedInline.unsupportedCommand || hasForcedBreak,
    };
  }

  private mathTextPartsFromInlineNodes(nodes: readonly SimpleTexInlineNode[]): readonly TexMathTextPart[] {
    const parts: TexMathTextPart[] = [];
    let textRun = "";
    let textRunStart = 0;
    const flushTextRun = (sourceEnd: number): void => {
      if (!textRun) {
        textRunStart = sourceEnd;
        return;
      }
      parts.push({
        kind: "text",
        text: textRun,
        sourceSpan: { start: textRunStart, end: sourceEnd },
      });
      textRun = "";
      textRunStart = sourceEnd;
    };

    const appendText = (text: string, sourceStart: number): void => {
      if (!text) {
        return;
      }
      if (!textRun) {
        textRunStart = sourceStart;
      }
      textRun += text;
    };

    for (const node of nodes) {
      if (node.kind === "text" || node.kind === "space") {
        appendText(node.text, node.sourceStart);
        continue;
      }
      if (node.kind === "math") {
        flushTextRun(node.sourceStart);
        const parsed = parseTexMath(node.content, {
          sourceOffset: node.contentStart,
          suppressTerminalEllipsisGlue: this.options.suppressTerminalEllipsisGlue,
        });
        this.diagnostics.push(...parsed.diagnostics);
        parts.push({
          kind: "math",
          content: node.content,
          list: parsed.list,
          sourceSpan: { start: node.sourceStart, end: node.sourceEnd },
          contentSourceSpan: { start: node.contentStart, end: node.contentEnd },
        });
        textRunStart = node.sourceEnd;
        continue;
      }
      if (
        node.kind === "font-command" ||
        node.kind === "group" ||
        node.kind === "mbox" ||
        node.kind === "raisebox" ||
        node.kind === "dimension-box"
      ) {
        flushTextRun(node.sourceStart);
        parts.push(...this.mathTextPartsFromInlineNodes(node.children));
        textRunStart = node.sourceEnd;
        continue;
      }
      if (node.kind === "rule") {
        flushTextRun(node.sourceStart);
        textRunStart = node.sourceEnd;
      }
    }
    flushTextRun(nodes.at(-1)?.sourceEnd ?? 0);
    return parts;
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

  private parseOptionalBracketTextArgument(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): {
    readonly text: string;
    readonly sourceSpan: TexMathSourceSpan;
    readonly contentSourceSpan: TexMathSourceSpan;
  } | null {
    this.skipSpaces();
    const next = this.peek();
    if (next?.kind !== "character" || next.text !== "[") {
      return null;
    }
    const open = this.advance();
    const tokens: TexMathToken[] = [];
    let lastSpan: TexMathSourceSpan = open.sourceSpan;
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (!token) {
        break;
      }
      if (token.kind === "character" && token.text === "]") {
        const close = this.advance();
        return {
          text: tokens.map((part) => part.text).join(""),
          sourceSpan: spanUnion(open.sourceSpan, close.sourceSpan),
          contentSourceSpan: {
            start: open.sourceSpan.end,
            end: Math.max(open.sourceSpan.end, close.sourceSpan.start),
          },
        };
      }
      this.advance();
      tokens.push(token);
      lastSpan = token.sourceSpan;
    }
    this.addDiagnostic(
      "error",
      "missing-delimiter",
      `Expected a closing bracket in optional ${label}.`,
      next?.sourceSpan ?? fallbackSpan
    );
    return {
      text: tokens.map((part) => part.text).join(""),
      sourceSpan: spanUnion(open.sourceSpan, lastSpan),
      contentSourceSpan: {
        start: open.sourceSpan.end,
        end: Math.max(open.sourceSpan.end, lastSpan.end),
      },
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

  private parseOptionalBracketDimensionArgument(
    fallbackSpan: TexMathSourceSpan,
    label: string
  ): { readonly valuePt: number; readonly sourceSpan: TexMathSourceSpan } | null {
    this.skipSpaces();
    const next = this.peek();
    if (next?.kind !== "character" || next.text !== "[") {
      return null;
    }
    const open = this.advance();
    const tokens: TexMathToken[] = [];
    let lastSpan: TexMathSourceSpan = open.sourceSpan;
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (!token) {
        break;
      }
      if (token.kind === "character" && token.text === "]") {
        const close = this.advance();
        const text = tokens.map((part) => part.text).join("").trim();
        const sourceSpan = spanUnion(open.sourceSpan, close.sourceSpan);
        const contentSourceSpan = {
          start: open.sourceSpan.end,
          end: Math.max(open.sourceSpan.end, close.sourceSpan.start),
        };
        const dimension = parseTexDimensionText(text);
        if (dimension === null) {
          this.addDiagnostic(
            "error",
            "invalid-tex-dimension",
            `Unsupported or invalid TeX dimension for ${label}.`,
            contentSourceSpan
          );
          return { valuePt: 0, sourceSpan };
        }
        return { valuePt: dimension, sourceSpan };
      }
      this.advance();
      tokens.push(token);
      lastSpan = token.sourceSpan;
    }
    this.addDiagnostic(
      "error",
      "missing-delimiter",
      "Expected a closing bracket in optional dimension argument.",
      next?.sourceSpan ?? fallbackSpan
    );
    return {
      valuePt: 0,
      sourceSpan: spanUnion(open.sourceSpan, lastSpan),
    };
  }

  private parseRequiredDimensionArgument(
    command: TexMathToken,
    label: string
  ): { readonly valuePt: number; readonly sourceSpan: TexMathSourceSpan } | null {
    const group = this.parseRequiredRawGroup(command.sourceSpan, `${command.text} ${label}`);
    if (!group) {
      return null;
    }
    const dimension = parseTexDimensionText(group.text.trim());
    if (dimension === null) {
      this.addDiagnostic(
        "error",
        "invalid-tex-dimension",
        `Unsupported or invalid TeX dimension for ${command.text} ${label}.`,
        group.contentSourceSpan
      );
      return { valuePt: 0, sourceSpan: group.sourceSpan };
    }
    return { valuePt: dimension, sourceSpan: group.sourceSpan };
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

  private parseRequiredSidesetSideGroup(
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
    const items: TexMathItem[] = [];
    const first = this.peekSignificantToken();
    if (first?.kind === "subscript" || first?.kind === "superscript") {
      const emptyBase: TexMathAtom = {
        kind: "atom",
        atomClass: "ord",
        nucleus: {
          kind: "list",
          list: emptyList(first.sourceSpan.start),
          sourceSpan: { start: first.sourceSpan.start, end: first.sourceSpan.start },
        },
        sourceSpan: { start: first.sourceSpan.start, end: first.sourceSpan.start },
      };
      items.push(this.parseScripts(emptyBase));
    }
    const list = this.parseList({ stopAtGroupClose: true });
    items.push(...list.items);
    const close = this.consumeGroupClose(open.sourceSpan);
    const sourceSpan = spanUnion(open.sourceSpan, close?.sourceSpan ?? list.sourceSpan);
    return {
      list: listFromItems(items, { start: open.sourceSpan.end, end: open.sourceSpan.end }),
      sourceSpan,
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
    if (!allowScripts) {
      return atom;
    }
    const switched = atom.atomClass === "op"
      ? this.parseOperatorLimitSwitch(atom, true)
      : atom;
    return this.parseScripts(switched);
  }

  private parseScripts(atom: TexMathAtom): TexMathAtom {
    let subscript: TexMathScript | undefined;
    let superscript: TexMathScript | undefined;
    let sourceSpan = atom.sourceSpan;
    while (true) {
      const token = this.peek();
      if (!token || (token.kind !== "subscript" && token.kind !== "superscript" && !(token.kind === "character" && token.text === "'"))) {
        break;
      }
      if (token.kind === "character" && token.text === "'") {
        const primes: TexMathAtom[] = [];
        let primeSourceSpan = token.sourceSpan;
        while (this.peek()?.kind === "character" && this.peek()?.text === "'") {
          const prime = this.advance();
          primeSourceSpan = spanUnion(primeSourceSpan, prime.sourceSpan);
          primes.push({
            kind: "atom",
            atomClass: "ord",
            nucleus: {
              kind: "glyph",
              text: "\\prime",
              sourceSpan: prime.sourceSpan,
            },
            sourceSpan: prime.sourceSpan,
          });
        }
        if (superscript) {
          this.addDiagnostic("error", "duplicate-script", "Duplicate math superscript.", token.sourceSpan);
        }
        superscript = {
          list: listFromItems(primes, primeSourceSpan),
          sourceSpan: primeSourceSpan,
        };
        sourceSpan = spanUnion(sourceSpan, primeSourceSpan);
        continue;
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
    readonly columnSeparation?: "align" | "none" | "gather" | "multline" | "eqnarray" | "xalignat" | "xxalignat" | "flalign";
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
  columnAlignment: TexMathArrayColumnAlignment,
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
      ...(columnAlignment !== "center" ? { columnAlignment } : {}),
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
  verticalRules: readonly TexMathArrayVerticalRule[],
  preambleItems: readonly TexMathArrayPreambleItem[],
  cellInserts: readonly TexMathArrayCellInsert[],
  rowRules: readonly TexMathArrayRowRule[],
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
      ...(verticalRules.length > 0 ? { verticalRules } : {}),
      ...(preambleItems.length > 0 ? { preambleItems } : {}),
      ...(cellInserts.length > 0 ? { cellInserts } : {}),
      ...(rowRules.length > 0 ? { rowRules } : {}),
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
  environment: TexMathSmallMatrixEnvironment,
  rows: readonly TexMathAlignedRow[],
  columnAlignment: TexMathArrayColumnAlignment,
  beginSourceSpan: TexMathSourceSpan,
  endSourceSpan: TexMathSourceSpan | undefined,
  sourceSpan: TexMathSourceSpan
): TexMathAtom {
  return {
    kind: "atom",
    atomClass: environment === "smallmatrix" ? "ord" : "inner",
    nucleus: {
      kind: "smallmatrix",
      environment,
      rows,
      ...(columnAlignment !== "center" ? { columnAlignment } : {}),
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

function modularArithmeticAtom(
  sourceSpan: TexMathSourceSpan,
  items: readonly TexMathItem[]
): TexMathAtom {
  return generatedListAtom("ord", sourceSpan, items);
}

function mathtoolsColonRelationItems(
  relation: MathtoolsColonRelationCommand,
  sourceSpan: TexMathSourceSpan
): readonly TexMathItem[] {
  // Mirrors the default non-legacy centered-colon definitions in mathtools.sty.
  switch (relation) {
    case "dblcolon":
      return doubleColonItems(sourceSpan);
    case "coloneq":
      return [...vcenterColonItems(sourceSpan), explicitMu(-1.2, sourceSpan), generatedGlyphAtom("=", "rel", sourceSpan)];
    case "Coloneq":
      return [...doubleColonItems(sourceSpan), explicitMu(-1.2, sourceSpan), generatedGlyphAtom("=", "rel", sourceSpan)];
    case "eqqcolon":
      return [generatedGlyphAtom("=", "rel", sourceSpan), explicitMu(-1.2, sourceSpan), ...vcenterColonItems(sourceSpan)];
    case "Eqqcolon":
      return [generatedGlyphAtom("=", "rel", sourceSpan), explicitMu(-1.2, sourceSpan), ...doubleColonItems(sourceSpan)];
    case "colonapprox":
      return [...vcenterColonItems(sourceSpan), explicitMu(-1.2, sourceSpan), generatedGlyphAtom("\\approx", "rel", sourceSpan)];
    case "Colonapprox":
      return [...doubleColonItems(sourceSpan), explicitMu(-1.2, sourceSpan), generatedGlyphAtom("\\approx", "rel", sourceSpan)];
    case "approxcolon":
      return [generatedGlyphAtom("\\approx", "rel", sourceSpan), explicitMu(-1.2, sourceSpan), ...vcenterColonItems(sourceSpan)];
    case "Approxcolon":
      return [generatedGlyphAtom("\\approx", "rel", sourceSpan), explicitMu(-1.2, sourceSpan), ...doubleColonItems(sourceSpan)];
    case "colonsim":
      return [...vcenterColonItems(sourceSpan), explicitMu(-1.2, sourceSpan), generatedGlyphAtom("\\sim", "rel", sourceSpan)];
    case "Colonsim":
      return [...doubleColonItems(sourceSpan), explicitMu(-1.2, sourceSpan), generatedGlyphAtom("\\sim", "rel", sourceSpan)];
    case "simcolon":
      return [generatedGlyphAtom("\\sim", "rel", sourceSpan), explicitMu(-1.2, sourceSpan), ...vcenterColonItems(sourceSpan)];
    case "Simcolon":
      return [generatedGlyphAtom("\\sim", "rel", sourceSpan), explicitMu(-1.2, sourceSpan), ...doubleColonItems(sourceSpan)];
    case "colondash":
      return [...vcenterColonItems(sourceSpan), explicitMu(-1.2, sourceSpan), generatedGlyphAtom("-", "rel", sourceSpan)];
    case "Colondash":
      return [...doubleColonItems(sourceSpan), explicitMu(-1.2, sourceSpan), generatedGlyphAtom("-", "rel", sourceSpan)];
    case "dashcolon":
      return [generatedGlyphAtom("-", "rel", sourceSpan), explicitMu(-1.2, sourceSpan), ...vcenterColonItems(sourceSpan)];
    case "Dashcolon":
      return [generatedGlyphAtom("-", "rel", sourceSpan), explicitMu(-1.2, sourceSpan), ...doubleColonItems(sourceSpan)];
  }
}

function doubleColonItems(sourceSpan: TexMathSourceSpan): readonly TexMathItem[] {
  return [
    ...vcenterColonItems(sourceSpan),
    explicitMu(-0.9, sourceSpan),
    ...vcenterColonItems(sourceSpan),
  ];
}

function vcenterColonItems(sourceSpan: TexMathSourceSpan): readonly TexMathItem[] {
  return [
    generatedGlyphAtom("\\vcentcolon", "rel", sourceSpan),
  ];
}

function generatedListAtom(
  atomClass: TexMathAtomClass,
  sourceSpan: TexMathSourceSpan,
  items: readonly TexMathItem[]
): TexMathAtom {
  return {
    kind: "atom",
    atomClass,
    nucleus: {
      kind: "list",
      list: {
        kind: "math-list",
        items,
        sourceSpan,
      },
      sourceSpan,
    },
    sourceSpan,
  };
}

function atomClassForStackingBase(base: TexMathList): TexMathAtomClass {
  const atoms = base.items.filter((item): item is TexMathAtom => item.kind === "atom");
  if (atoms.length !== 1) {
    return "op";
  }
  const atomClass = atoms[0]?.atomClass;
  return atomClass === "bin" || atomClass === "rel" ? atomClass : "op";
}

function generatedOperatorNameAtom(
  name: string,
  atomClass: TexMathAtomClass,
  commandSourceSpan: TexMathSourceSpan,
  sourceSpan: TexMathSourceSpan
): TexMathAtom {
  return {
    kind: "atom",
    atomClass,
    nucleus: operatorNameNucleus(name, commandSourceSpan, sourceSpan),
    ...(atomClass === "op" ? { limits: defaultNamedOperatorLimits(name) } : {}),
    sourceSpan,
  };
}

function operatorNameNucleus(
  name: string,
  commandSourceSpan: TexMathSourceSpan,
  sourceSpan: TexMathSourceSpan
): TexMathAtom["nucleus"] {
  const parts: TexMathOperatorNamePart[] = [...name].map((character, index) => ({
    kind: "text",
    text: character,
    sourceSpan: index === 0 ? commandSourceSpan : { start: commandSourceSpan.end, end: commandSourceSpan.end },
  }));
  return {
    kind: "operator-name",
    parts,
    commandSourceSpan,
    nameSourceSpan: commandSourceSpan,
    sourceSpan,
  };
}

function generatedGlyphAtom(
  text: string,
  atomClass: TexMathAtomClass,
  sourceSpan: TexMathSourceSpan
): TexMathAtom {
  return {
    kind: "atom",
    atomClass,
    nucleus: {
      kind: "glyph",
      text,
      sourceSpan,
    },
    sourceSpan,
  };
}

function explicitMu(
  mu: number,
  sourceSpan: TexMathSourceSpan,
  options: {
    readonly displayMu?: number;
    readonly stretchMu?: number;
    readonly shrinkMu?: number;
    readonly omitInScript?: boolean;
  } = {}
): TexMathMuGlue {
  return {
    kind: "mu-glue",
    mu,
    ...(options.displayMu !== undefined ? { displayMu: options.displayMu } : {}),
    ...(options.stretchMu !== undefined ? { stretchMu: options.stretchMu } : {}),
    ...(options.shrinkMu !== undefined ? { shrinkMu: options.shrinkMu } : {}),
    ...(options.omitInScript === true ? { omitInScript: true } : {}),
    sourceSpan,
  };
}

function nonscriptNegativeMedMu(sourceSpan: TexMathSourceSpan): TexMathMuGlue {
  return explicitMu(-4, sourceSpan, {
    stretchMu: -2,
    shrinkMu: -4,
    omitInScript: true,
  });
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

function readArrayPreambleRepeatBody(
  tokens: readonly TexMathToken[],
  startIndex: number
): {
  readonly tokens: readonly TexMathToken[];
  readonly sourceSpan: TexMathSourceSpan;
  readonly nextIndex: number;
} | null {
  let index = startIndex;
  while (tokens[index]?.kind === "space") {
    index += 1;
  }
  const first = tokens[index];
  if (!first) {
    return null;
  }
  if (first.kind === "group-open") {
    return readBalancedTokenGroup(tokens, index);
  }
  return {
    tokens: [first],
    sourceSpan: first.sourceSpan,
    nextIndex: index + 1,
  };
}

function readPreambleArgumentGroup(
  tokens: readonly TexMathToken[],
  startIndex: number
): {
  readonly tokens: readonly TexMathToken[];
  readonly sourceSpan: TexMathSourceSpan;
  readonly nextIndex: number;
} | null {
  let index = startIndex;
  while (tokens[index]?.kind === "space") {
    index += 1;
  }
  return readBalancedTokenGroup(tokens, index);
}

function readBalancedTokenGroup(
  tokens: readonly TexMathToken[],
  startIndex: number
): {
  readonly tokens: readonly TexMathToken[];
  readonly sourceSpan: TexMathSourceSpan;
  readonly nextIndex: number;
} | null {
  const open = tokens[startIndex];
  if (open?.kind !== "group-open") {
    return null;
  }
  const body: TexMathToken[] = [];
  let depth = 0;
  let lastSpan = open.sourceSpan;
  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      break;
    }
    if (token.kind === "group-close" && depth === 0) {
      return {
        tokens: body,
        sourceSpan: spanUnion(open.sourceSpan, token.sourceSpan),
        nextIndex: index + 1,
      };
    }
    body.push(token);
    lastSpan = token.sourceSpan;
    if (token.kind === "group-open") {
      depth += 1;
    } else if (token.kind === "group-close") {
      depth = Math.max(0, depth - 1);
    }
  }
  return {
    tokens: body,
    sourceSpan: spanUnion(open.sourceSpan, lastSpan),
    nextIndex: tokens.length,
  };
}

function matrixEnvironmentName(name: string | undefined): TexMathMatrixEnvironment | null {
  if (!name) {
    return null;
  }
  const baseName = name.endsWith("*") ? name.slice(0, -1) : name;
  switch (baseName) {
    case "matrix":
    case "pmatrix":
    case "bmatrix":
    case "Bmatrix":
    case "vmatrix":
    case "Vmatrix":
      return baseName;
    default:
      return null;
  }
}

function eqnarrayEnvironmentName(name: string): boolean {
  return name === "eqnarray" || name === "eqnarray*";
}

function smallMatrixEnvironmentName(name: string | undefined): TexMathSmallMatrixEnvironment | null {
  if (!name) {
    return null;
  }
  const baseName = name.endsWith("*") ? name.slice(0, -1) : name;
  switch (baseName) {
    case "smallmatrix":
    case "psmallmatrix":
    case "bsmallmatrix":
    case "Bsmallmatrix":
    case "vsmallmatrix":
    case "Vsmallmatrix":
      return baseName;
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

function modularArithmeticCommandName(command: string): "bmod" | "pmod" | "mod" | null {
  switch (commandName(command)) {
    case "bmod":
      return "bmod";
    case "pmod":
      return "pmod";
    case "mod":
      return "mod";
    default:
      return null;
  }
}

function amsImplicationCommandName(command: string): "implies" | "impliedby" | null {
  switch (commandName(command)) {
    case "implies":
      return "implies";
    case "impliedby":
      return "impliedby";
    default:
      return null;
  }
}

type MathtoolsColonRelationCommand =
  | "dblcolon"
  | "coloneq"
  | "Coloneq"
  | "eqqcolon"
  | "Eqqcolon"
  | "colonapprox"
  | "Colonapprox"
  | "approxcolon"
  | "Approxcolon"
  | "colonsim"
  | "Colonsim"
  | "simcolon"
  | "Simcolon"
  | "colondash"
  | "Colondash"
  | "dashcolon"
  | "Dashcolon";

function mathtoolsColonRelationCommandName(command: string): MathtoolsColonRelationCommand | null {
  switch (commandName(command)) {
    case "dblcolon":
      return "dblcolon";
    case "coloneq":
    case "coloneqq":
      return "coloneq";
    case "Coloneq":
    case "Coloneqq":
      return "Coloneq";
    case "eqcolon":
    case "eqqcolon":
      return "eqqcolon";
    case "Eqcolon":
    case "Eqqcolon":
      return "Eqqcolon";
    case "colonapprox":
      return "colonapprox";
    case "Colonapprox":
      return "Colonapprox";
    case "approxcolon":
      return "approxcolon";
    case "Approxcolon":
      return "Approxcolon";
    case "colonsim":
      return "colonsim";
    case "Colonsim":
      return "Colonsim";
    case "simcolon":
      return "simcolon";
    case "Simcolon":
      return "Simcolon";
    case "colondash":
      return "colondash";
    case "Colondash":
      return "Colondash";
    case "dashcolon":
      return "dashcolon";
    case "Dashcolon":
      return "Dashcolon";
    default:
      return null;
  }
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
): "label" | "tag" | "notag" | "nonumber" | "intertext" | "unsupported-text" | "displaybreak" | null {
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
      return "intertext";
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
    case "mathring":
      return "mathring";
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

function varLimitCommandName(command: string): TexMathVarLimitCommand | null {
  switch (commandName(command)) {
    case "varinjlim":
      return "varinjlim";
    case "varprojlim":
      return "varprojlim";
    case "varliminf":
      return "varliminf";
    case "varlimsup":
      return "varlimsup";
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

function stackingCommandName(command: string): "overset" | "underset" | "overunderset" | null {
  switch (commandName(command)) {
    case "overset":
      return "overset";
    case "underset":
      return "underset";
    case "overunderset":
      return "overunderset";
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

function alphabetDeclarationCommandName(command: string): TexMathAlphabetCommand | null {
  switch (commandName(command)) {
    case "bf":
      return "mathbf";
    case "cal":
      return "mathcal";
    case "it":
      return "mathit";
    case "rm":
      return "mathrm";
    case "sf":
      return "mathsf";
    case "tt":
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
    flalignEnvironmentName(name) ||
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

function xxalignatEnvironmentName(name: string): boolean {
  return name === "xxalignat";
}

function flalignEnvironmentName(name: string): boolean {
  return name === "flalign" || name === "flalign*";
}

function displayAlignmentEnvironmentName(name: string): boolean {
  return alignEnvironmentName(name) ||
    alignatEnvironmentName(name) ||
    xalignatEnvironmentName(name) ||
    xxalignatEnvironmentName(name) ||
    flalignEnvironmentName(name) ||
    gatherEnvironmentName(name) ||
    multlineEnvironmentName(name);
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

function amsNamedOperatorDeclaration(command: string): DeclaredMathOperator | null {
  switch (commandName(command)) {
    case "injlim":
      return {
        parts: operatorNameParts(["i", "n", "j", ",", "l", "i", "m"]),
        limits: "display",
      };
    case "projlim":
      return {
        parts: operatorNameParts(["p", "r", "o", "j", ",", "l", "i", "m"]),
        limits: "display",
      };
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

function operatorNameParts(parts: readonly string[]): readonly TexMathOperatorNamePart[] {
  return parts.map((part, index): TexMathOperatorNamePart => {
    const sourceSpan = { start: index, end: index + 1 };
    return part === ","
      ? { kind: "spacing", command: ",", sourceSpan }
      : { kind: "text", text: part, sourceSpan };
  });
}

function mathTextCommandName(text: string): "text" | "hbox" | SimpleTexTextBoxCommandName | SimpleTexFontCommandName | null {
  const name = commandName(text);
  if (
    name === "text" ||
    name === "hbox" ||
    name === "mbox" ||
    name === "makebox" ||
    name === "llap" ||
    name === "rlap" ||
    isSimpleTexFontCommandName(name)
  ) {
    return name;
  }
  return null;
}

function phantomCommandName(text: string): "phantom" | "hphantom" | "vphantom" | null {
  const name = commandName(text);
  return name === "phantom" || name === "hphantom" || name === "vphantom"
    ? name
    : null;
}

const simpleTexFontCommandNames = new Set<SimpleTexFontCommandName>([
  "textit",
  "textbf",
  "textmd",
  "textsl",
  "texttt",
  "textup",
  "emph",
  "textrm",
  "textsf",
  "textsc",
  "textnormal",
] satisfies readonly SimpleTexFontCommandName[]);

function isSimpleTexFontCommandName(name: string): name is SimpleTexFontCommandName {
  return simpleTexFontCommandNames.has(name as SimpleTexFontCommandName);
}

function mathTextPlainText(nodes: readonly SimpleTexInlineNode[]): string {
  let text = "";
  for (const node of nodes) {
    if (node.kind === "text" || node.kind === "space") {
      text += node.text;
      continue;
    }
    if (
      node.kind === "font-command" ||
      node.kind === "group" ||
      node.kind === "mbox" ||
      node.kind === "raisebox" ||
      node.kind === "dimension-box"
    ) {
      text += mathTextPlainText(node.children);
    }
  }
  return text;
}

function namedSymbolCommand(command: string): { atomClass: TexMathAtomClass } | null {
  const name = commandName(command);
  const declaration = texMathSymbolDeclaration(name);
  if (declaration) {
    return { atomClass: declaration.atomClass };
  }
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
  "iff", "impliedby", "implies", "longleftarrow", "longrightarrow", "Longleftarrow", "Longleftrightarrow", "Longrightarrow",
  "approxeq", "geqslant", "gtrsim", "leqslant", "lesssim", "ngeqslant", "nleqslant", "nVdash",
  "Subset", "Supset", "thickapprox", "thicksim", "Vdash",
  "dasharrow", "dashleftarrow", "dashrightarrow", "Join",
  "succ", "succeq", "supset", "supseteq", "swarrow", "to", "uparrow", "Uparrow", "updownarrow", "Updownarrow",
  "vdash",
]);

const openNamedSymbolCommands = new Set([
  "langle", "lbrace", "lceil", "lfloor", "lvert", "lVert", "ulcorner", "llcorner", "{",
]);

const closeNamedSymbolCommands = new Set([
  "rangle", "rbrace", "rceil", "rfloor", "rvert", "rVert", "urcorner", "lrcorner", "}",
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
    case "lVert":
    case "rVert":
      return "Vert";
    case "vert":
    case "mid":
    case "lvert":
    case "rvert":
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
    case "llcorner":
      return "llcorner";
    case "lrcorner":
      return "lrcorner";
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
    case "llcorner":
      return "open";
    case ")":
    case "]":
    case "rangle":
    case "rbrace":
    case "rceil":
    case "rfloor":
    case "urcorner":
    case "lrcorner":
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
