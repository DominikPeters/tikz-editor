import { LRLanguage, LanguageSupport, foldNodeProp, foldInside, foldService, syntaxTree } from "@codemirror/language";
import { parseMixed, type Input, type SyntaxNodeRef } from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";
import {
  beamerDocumentParser,
  texDocumentParser,
  texFragmentParser,
} from "@tikz-editor/lezer-tex";
import { parser as baseTikzParser } from "@tikz-editor/lezer-tikz";

const tikzHighlighting = styleTags({
  Comment: t.lineComment,

  // Environment delimiters
  "BeginTikz EndTikz BeginScope EndScope": t.keyword,

  // Path commands and definition-style commands
  "DrawCmd PathCmd FillDrawCmd FillCmd PatternCmd ClipCmd ShadeCmd ShadeDrawCmd UseAsBoundingBoxCmd MatrixCmd ColorletCmd DefineColorCmd DefCmd LetDefCmd NewCommandCmd RenewCommandCmd TikzSetCmd TikzStyleCmd PgfkeysCmd":
    t.keyword,

  // \node and \coordinate commands
  "NodeCmd CoordinateCmd": t.keyword,

  // Inline keywords in path context only (avoid styling style names like `every node`)
  "NodeItem/NodeKw CoordinateOperation/CoordinateKw ToOperation/ToKw EdgeOperation/EdgeKw EdgeFromParentOperation/EdgeKw":
    t.keyword,

  // Positioning/library words inside option lists.
  "OptionPart/IdentifierLike/OfKw OptionPart/PathKeyword/AndKw OptionPart/Group/GroupPart/PathKeyword/AndKw":
    t.keyword,

  // Shape/operation keywords in actual path operations.
  "PathItem/PathKeyword/CircleKw PathItem/PathKeyword/RectangleKw PathItem/PathKeyword/EllipseKw PathItem/PathKeyword/ArcKw PathItem/PathKeyword/GridKw PathItem/PathKeyword/ParabolaKw PathItem/PathKeyword/SinKw PathItem/PathKeyword/CosKw PathItem/PathKeyword/PlotKw SvgOperation/SvgKw":
    t.typeName,

  // Modifier keywords in recognized path/node/pic contexts.
  "PathItem/PathKeyword/AtKw PathItem/PathKeyword/BendKw PathItem/PathKeyword/CycleKw PathItem/PathKeyword/ControlsKw PathItem/PathKeyword/AndKw NodeCommandItem/PathKeyword/AtKw NodePlacement/AtKw PicPlacement/AtKw ToTarget/CycleKw":
    t.keyword,

  // Foreach / let / in loop constructs.
  "ForeachStatement/ForeachCmd ForeachStatement/InKw PathForeachOperation/ForeachCmd PathForeachOperation/ForeachKw PathForeachOperation/InKw NodeForeachClause/ForeachCmd NodeForeachClause/ForeachKw NodeForeachClause/InKw PicForeachClause/ForeachCmd PicForeachClause/ForeachKw PicForeachClause/InKw ChildForeachClause/ForeachCmd ChildForeachClause/ForeachKw ChildForeachClause/InKw LetOperation/LetKw LetOperation/InKw":
    t.keyword,

  // Font size commands
  FontSizeCmd: t.keyword,

  // Unknown commands (\somecommand) — meta color (#404740)
  CommandName: t.meta,

  // Literals
  Number: t.literal,
  QuotedSvg: t.string,

  // Identifiers in option lists — labelName (#219, blue)
  "OptionPart/*/Identifier": t.labelName,
  "OptionPart/NodeKw StylePayloadPart/NodeKw": t.labelName,
  "StylePayloadPart/IdentifierLike/Identifier": t.labelName,
  "StylePayloadPart/OptionPunct": t.punctuation,

  // Node text uses a dedicated grammar branch so prose is not highlighted as TikZ syntax.
  "NodeTextGroup/NodeTextPart/NodeTextChunk NodeTextGroup/NodeTextPart/NodeTextPunct": t.string,
  "NodeTextDollarMath/NodeTextMathPart/NodeTextChunk NodeTextDollarMath/NodeTextMathPart/NodeTextPunct NodeTextDollarMath/NodeTextMathPart/CommandName":
    t.special(t.string),
  "NodeTextDollarMath/Dollar NodeTextDollarMath/DoubleDollar": t.regexp,

  // General identifiers (fallback) — className (#167, dark teal)
  Identifier: t.className,

  // Coordinates get a distinct look
  "Coordinate/( Coordinate/)": t.special(t.paren),
  "CoordPart/Number": t.literal,

  // Brackets
  "( )": t.paren,
  "[ ]": t.squareBracket,
  "{ }": t.brace,

  // Operators
  PathOperator: t.operator,
  GroupPathOperator: t.operator,
  RelativePrefix: t.operator,
  LetPunct: t.operator,

  // Punctuation
  "OptionPunct GroupPunct": t.punctuation,
  "MatrixRowSepCmd EscapedAmpersandCmd": t.punctuation,
  StraySymbol: t.punctuation,

  // Errors
  "⚠": t.invalid,
});

const texHighlighting = styleTags({
  Comment: t.lineComment,

  "BeginCommand EndCommand": t.keyword,
  "EnvironmentName MathEnvironmentName": t.typeName,
  "IncludeGraphicsCmd": t.keyword,
  "BeamerPartCmd BeamerSectionLevelCmd BeamerSubsectionCmd BeamerSubsubsectionCmd BeamerFrameStartCmd BeamerFrameTitleCmd BeamerFrameSubtitleCmd BeamerOnlyCmd BeamerUncoverCmd BeamerVisibleCmd BeamerInvisibleCmd BeamerAltCmd BeamerTemporalCmd BeamerOnslideCmd BeamerPauseCmd":
    t.keyword,

  "ControlWord ControlSymbol MathTextCmd": t.meta,
  "Text/WordToken Text/NumberToken Text/OperatorToken Text/PunctuationToken Text/OtherTextToken":
    t.string,

  "InlineMath/Dollar DisplayMath/DoubleDollar InlineMathOpen InlineMathClose DisplayMathOpen DisplayMathClose":
    t.regexp,
  "MathIdentifier/WordToken MathIdentifier/OtherTextToken": t.variableName,
  "MathNumber/NumberToken": t.number,
  "MathOperator/OperatorToken MathOperator/Star MathOperator/AngleText MathScript/Superscript MathScript/Subscript AlignmentTab":
    t.operator,
  "MathPunctuation/PunctuationToken": t.punctuation,

  "( )": t.paren,
  "[ ]": t.squareBracket,
  "{ }": t.brace,
  "< >": t.angleBracket,
  "⚠": t.invalid,
});

const texFoldProps = foldNodeProp.add({
  Environment: foldInside,
  MathEnvironment: foldInside,
  Group: foldInside,
  OptionalArgument: foldInside,
  OverlaySpecification: foldInside,
  InlineMath: foldInside,
  DisplayMath: foldInside,
  MathGroup: foldInside,
});

const highlightedTexFragmentParser = texFragmentParser.configure({
  props: [texHighlighting, texFoldProps],
});

const mixedTikzParser = baseTikzParser.configure({
  props: [
    tikzHighlighting,
    foldNodeProp.add({
      TikzEnvironment: foldInside,
      ScopeStatement: foldInside,
      Group: foldInside,
    }),
  ],
  wrap: parseMixed((node) =>
    node.name === "NodeTextGroup"
      ? {
          parser: highlightedTexFragmentParser,
          bracketed: true,
        }
      : null
  ),
});

function isTikzEnvironment(node: SyntaxNodeRef, input: Input): boolean {
  if (node.name !== "Environment") {
    return false;
  }
  const prefix = input.read(node.from, Math.min(node.to, node.from + 96));
  return /^\\begin\{tikzpicture\*?\}/u.test(prefix);
}

const mixedTexDocumentParser = texDocumentParser.configure({
  props: [texHighlighting, texFoldProps],
  wrap: parseMixed((node, input) =>
    isTikzEnvironment(node, input)
      ? {
          parser: mixedTikzParser,
          bracketed: true,
        }
      : null
  ),
});

const mixedBeamerDocumentParser = beamerDocumentParser.configure({
  props: [texHighlighting, texFoldProps],
  wrap: parseMixed((node, input) =>
    isTikzEnvironment(node, input)
      ? {
          parser: mixedTikzParser,
          bracketed: true,
        }
      : null
  ),
});

const tikzEnvironmentFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;

  const beginMatch = text.match(/\\begin\{([^}]+)\}/);
  if (beginMatch?.index === undefined) return null;

  const beginIndex = beginMatch.index;
  const tree = syntaxTree(state);
  if (tree.resolveInner(line.from + beginIndex + 1).name === "Comment") return null;

  const envName = beginMatch[1];
  const beginToken = `\\begin{${envName}}`;
  const endToken = `\\end{${envName}}`;

  let depth = 1;
  const from = line.from + beginIndex + beginMatch[0].length;

  let searchPos = beginIndex + beginMatch[0].length;
  while (true) {
    const nextBegin = text.indexOf(beginToken, searchPos);
    const nextEnd = text.indexOf(endToken, searchPos);

    if (nextBegin !== -1 && (nextEnd === -1 || nextBegin < nextEnd)) {
      if (tree.resolveInner(line.from + nextBegin + 1).name !== "Comment") {
        depth++;
      }
      searchPos = nextBegin + beginToken.length;
    } else if (nextEnd !== -1) {
      if (tree.resolveInner(line.from + nextEnd + 1).name !== "Comment") {
        depth--;
        if (depth === 0) {
          return { from, to: line.from + nextEnd };
        }
      }
      searchPos = nextEnd + endToken.length;
    } else {
      break;
    }
  }

  for (let i = line.number + 1; i <= state.doc.lines; i++) {
    const searchLine = state.doc.line(i);
    let lineSearchPos = 0;
    const lineText = searchLine.text;

    while (true) {
      const nextBegin = lineText.indexOf(beginToken, lineSearchPos);
      const nextEnd = lineText.indexOf(endToken, lineSearchPos);

      if (nextBegin !== -1 && (nextEnd === -1 || nextBegin < nextEnd)) {
        if (tree.resolveInner(searchLine.from + nextBegin + 1).name !== "Comment") {
          depth++;
        }
        lineSearchPos = nextBegin + beginToken.length;
      } else if (nextEnd !== -1) {
        if (tree.resolveInner(searchLine.from + nextEnd + 1).name !== "Comment") {
          depth--;
          if (depth === 0) {
            return { from, to: searchLine.from + nextEnd };
          }
        }
        lineSearchPos = nextEnd + endToken.length;
      } else {
        break;
      }
    }
  }

  return null;
});

export const tikzLanguage = LRLanguage.define({
  parser: mixedTikzParser,
  languageData: {
    commentTokens: { line: "%" },
  },
});

export function tikz(): LanguageSupport {
  return new LanguageSupport(tikzLanguage, [tikzEnvironmentFolding]);
}

export const texLanguage = LRLanguage.define({
  parser: mixedTexDocumentParser,
  languageData: {
    commentTokens: { line: "%" },
  },
});

export function tex(): LanguageSupport {
  return new LanguageSupport(texLanguage);
}

export const beamerLanguage = LRLanguage.define({
  parser: mixedBeamerDocumentParser,
  languageData: {
    commentTokens: { line: "%" },
  },
});

export function beamer(): LanguageSupport {
  return new LanguageSupport(beamerLanguage);
}
