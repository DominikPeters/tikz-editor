import { LRLanguage, LanguageSupport, foldNodeProp, foldInside, foldService, syntaxTree } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from "tikz-editor/syntax/grammar/tikz-parser";

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

  // Shape/operation keywords: circle, rectangle, arc, etc.
  "CircleKw RectangleKw EllipseKw ArcKw GridKw ParabolaKw SinKw CosKw PlotKw SvgKw": t.typeName,

  // Modifier keywords: at, bend, cycle, controls, and
  "AtKw BendKw CycleKw ControlsKw AndKw": t.keyword,

  // Foreach / let / in — loop constructs
  "ForeachCmd ForeachKw LetKw InKw": t.keyword,

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

const tikzLRLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      tikzHighlighting,
      foldNodeProp.add({
        TikzEnvironment: foldInside,
        ScopeStatement: foldInside,
        Group: foldInside,
      })
    ],
  }),
  languageData: {
    commentTokens: { line: "%" },
  },
});

export function tikzLanguage(): LanguageSupport {
  return new LanguageSupport(tikzLRLanguage, [tikzEnvironmentFolding]);
}
