import type { SimpleTexDisplayMathDelimiter } from "@tikz-editor/core/text/tex/index.js";

export const TEX_FUZZ_SCHEMA_VERSION = 1 as const;
export const TEX_FUZZ_GENERATOR_VERSION = "shared-adversarial-v1";

export type TexFuzzFeatureId =
  | "text.literal"
  | "text.space"
  | "text.group"
  | "text.bold"
  | "text.italic"
  | "text.color"
  | "text.accent"
  | "math.inline"
  | `math.node.${TexFuzzMathNode["kind"]}`
  | `math.fraction.${TexFuzzMathFractionCommand}`
  | `math.accent.${TexFuzzMathAccentCommand}`
  | `math.alphabet.${TexFuzzMathAlphabetCommand}`
  | `math.line.${TexFuzzMathLineCommand}`
  | `math.operator.${TexFuzzMathOperatorCommand}`
  | `math.xarrow.${TexFuzzMathArrowCommand}`
  | `math.matrix.${TexFuzzMathMatrixEnvironment}`
  | `math.text.${TexFuzzMathTextCommand}`
  | `math.display.${TexFuzzDisplayMathDelimiter}`
  | "box.fbox"
  | `text.font-command.${TexFuzzFontCommand}`
  | `text.font-declaration.${TexFuzzFontDeclaration}`
  | `text.style-declaration.${TexFuzzSizeDeclaration | "color" | "fontsize"}`
  | "text.line-break"
  | `box.text.${TexFuzzTextBoxCommand}`
  | `box.dimension.${TexFuzzDimensionBoxCommand}`
  | "box.raisebox"
  | "box.rule"
  | "document.paragraph-break"
  | "document.noindent"
  | `document.alignment.${"centering" | "raggedright" | "raggedleft"}`
  | `document.environment.${TexFuzzEnvironment}`
  | "document.item"
  | `document.vertical-glue.${"smallskip" | "medskip" | "bigskip" | "vfill" | "vspace" | "vskip"}`
  | "document.penalty"
  | "document.vertical-rule"
  | `document.box.${"parbox" | "minipage"}`
  | "oracle.supported-command";

export type TexFuzzDimensionUnit = "pt" | "pc" | "in" | "bp" | "cm" | "mm" | "dd" | "cc" | "sp" | "em" | "ex";

/** A literal TeX dimension; relative units intentionally retain their surrounding-font semantics. */
export interface TexFuzzDimension {
  readonly amount: number;
  readonly unit: TexFuzzDimensionUnit;
}

export type TexFuzzFontCommand =
  | "textnormal"
  | "textit"
  | "textbf"
  | "textmd"
  | "textsl"
  | "texttt"
  | "textup"
  | "textrm"
  | "textsf"
  | "textsc"
  | "emph";

export type TexFuzzFontDeclaration =
  | "normalfont"
  | "bfseries"
  | "mdseries"
  | "rmfamily"
  | "sffamily"
  | "ttfamily"
  | "itshape"
  | "slshape"
  | "upshape"
  | "scshape"
  | "it"
  | "bf"
  | "rm"
  | "sf"
  | "sl"
  | "sc"
  | "tt"
  | "em";

export type TexFuzzSizeDeclaration =
  | "tiny"
  | "scriptsize"
  | "footnotesize"
  | "small"
  | "normalsize"
  | "large"
  | "Large"
  | "LARGE"
  | "huge"
  | "Huge";

export type TexFuzzTextBoxCommand =
  | "framebox"
  | "fcolorbox"
  | "colorbox"
  | "makebox"
  | "underline"
  | "mbox"
  | "fbox"
  | "llap"
  | "rlap";

export type TexFuzzNaturalTextBoxCommand = "underline" | "mbox" | "fbox" | "llap" | "rlap";

export type TexFuzzDimensionBoxCommand = "hphantom" | "vphantom" | "phantom" | "smash";

export type TexFuzzDisplayMathDelimiter = SimpleTexDisplayMathDelimiter;

export type TexFuzzEnvironment =
  | "quote"
  | "quotation"
  | "center"
  | "flushleft"
  | "flushright"
  | "itemize"
  | "enumerate"
  | "description";

export type TexFuzzMathFractionCommand = "frac" | "dfrac" | "tfrac" | "binom";
export type TexFuzzMathAccentCommand = "hat" | "bar" | "tilde" | "vec" | "dot" | "ddot" | "widehat" | "widetilde";
export type TexFuzzMathAlphabetCommand = "mathrm" | "mathbf" | "mathit" | "mathsf" | "mathtt" | "mathcal" | "mathbb" | "mathfrak" | "boldsymbol";
export type TexFuzzMathLineCommand = "overline" | "underline" | "overbrace" | "underbrace";
export type TexFuzzMathOperatorCommand = "sum" | "prod" | "int" | "lim" | "bigcup" | "bigcap";
export type TexFuzzMathArrowCommand = "xleftarrow" | "xrightarrow";
export type TexFuzzMathMatrixEnvironment = "matrix" | "pmatrix" | "bmatrix" | "smallmatrix" | "cases";
export type TexFuzzMathTextCommand = "text" | "mathrm" | "mathbf";

/** Recursive, serializable math syntax used by shared cases and their shrink/replay tooling. */
export type TexFuzzMathNode =
  | { readonly kind: "atom"; readonly value: string }
  | { readonly kind: "group"; readonly body: TexFuzzMathNode }
  | { readonly kind: "sequence"; readonly items: readonly TexFuzzMathNode[]; readonly operators: readonly string[] }
  | { readonly kind: "fraction"; readonly command: TexFuzzMathFractionCommand; readonly numerator: TexFuzzMathNode; readonly denominator: TexFuzzMathNode }
  | { readonly kind: "radical"; readonly degree?: TexFuzzMathNode; readonly body: TexFuzzMathNode }
  | { readonly kind: "script"; readonly base: TexFuzzMathNode; readonly subscript?: TexFuzzMathNode; readonly superscript?: TexFuzzMathNode }
  | { readonly kind: "accent"; readonly command: TexFuzzMathAccentCommand; readonly body: TexFuzzMathNode }
  | { readonly kind: "alphabet"; readonly command: TexFuzzMathAlphabetCommand; readonly body: TexFuzzMathNode }
  | { readonly kind: "line"; readonly command: TexFuzzMathLineCommand; readonly body: TexFuzzMathNode }
  | { readonly kind: "left-right"; readonly left: string; readonly right: string; readonly body: TexFuzzMathNode }
  | { readonly kind: "operator"; readonly command: TexFuzzMathOperatorCommand; readonly script?: TexFuzzMathNode }
  | { readonly kind: "stackrel"; readonly above: TexFuzzMathNode; readonly body: TexFuzzMathNode }
  | { readonly kind: "xarrow"; readonly command: TexFuzzMathArrowCommand; readonly below?: TexFuzzMathNode; readonly above: TexFuzzMathNode }
  | { readonly kind: "matrix"; readonly environment: TexFuzzMathMatrixEnvironment; readonly cells: readonly (readonly TexFuzzMathNode[])[] }
  | { readonly kind: "text"; readonly command: TexFuzzMathTextCommand; readonly value: string };

type TexFuzzMathContent =
  | { readonly content: string; readonly body?: never }
  | { readonly body: TexFuzzMathNode; readonly content?: never };

export type TexFuzzNode =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "space"; readonly nonBreaking: boolean }
  | { readonly kind: "group"; readonly children: readonly TexFuzzNode[] }
  | {
      readonly kind: "font";
      readonly command: TexFuzzFontCommand;
      readonly children: readonly TexFuzzNode[];
    }
  | {
      /** A declaration scoped by the braces emitted around this node. */
      readonly kind: "font-declaration";
      readonly command: TexFuzzFontDeclaration;
      readonly children: readonly TexFuzzNode[];
    }
  | {
      /** A size declaration scoped by the braces emitted around this node. */
      readonly kind: "style-declaration";
      readonly command: TexFuzzSizeDeclaration;
      readonly children: readonly TexFuzzNode[];
    }
  | {
      /** A color declaration scoped by the braces emitted around this node. */
      readonly kind: "style-declaration";
      readonly command: "color";
      readonly color: "red" | "blue" | "teal";
      readonly children: readonly TexFuzzNode[];
    }
  | {
      /** The declaration includes the required trailing \selectfont. */
      readonly kind: "style-declaration";
      readonly command: "fontsize";
      readonly size: TexFuzzDimension;
      readonly baselineSkip: TexFuzzDimension;
      readonly children: readonly TexFuzzNode[];
    }
  | {
      readonly kind: "color";
      readonly color: "red" | "blue" | "teal";
      readonly children: readonly TexFuzzNode[];
    }
  | ({ readonly kind: "math"; readonly delimiter?: "dollar" | "paren" } & TexFuzzMathContent)
  | ({ readonly kind: "display-math"; readonly delimiter: TexFuzzDisplayMathDelimiter } & TexFuzzMathContent)
  | { readonly kind: "accent"; readonly command: "'" | "`" | "^"; readonly base: string }
  | {
      readonly kind: "line-break";
      readonly command: "\\";
      readonly starred?: boolean;
      readonly leading?: TexFuzzDimension;
    }
  | { readonly kind: "line-break"; readonly command: "newline" }
  | { readonly kind: "line-break"; readonly command: "linebreak"; readonly priority?: 0 | 1 | 2 | 3 | 4 }
  | {
      readonly kind: "box";
      readonly command: TexFuzzNaturalTextBoxCommand;
      readonly children: readonly TexFuzzNode[];
    }
  | {
      readonly kind: "box";
      readonly command: "makebox" | "framebox";
      readonly children: readonly TexFuzzNode[];
      readonly width?: TexFuzzDimension;
      readonly alignment?: "l" | "c" | "r" | "s";
    }
  | {
      readonly kind: "box";
      readonly command: "colorbox";
      readonly backgroundColor: "red" | "blue" | "teal";
      readonly children: readonly TexFuzzNode[];
    }
  | {
      readonly kind: "box";
      readonly command: "fcolorbox";
      readonly frameColor: "red" | "blue" | "teal";
      readonly backgroundColor: "red" | "blue" | "teal";
      readonly children: readonly TexFuzzNode[];
    }
  | {
      readonly kind: "dimension-box";
      readonly command: TexFuzzDimensionBoxCommand;
      readonly children: readonly TexFuzzNode[];
    }
  | {
      readonly kind: "raisebox";
      readonly lift: TexFuzzDimension;
      readonly height?: TexFuzzDimension;
      readonly depth?: TexFuzzDimension;
      readonly children: readonly TexFuzzNode[];
    }
  | {
      readonly kind: "rule";
      readonly raise?: TexFuzzDimension;
      readonly width: TexFuzzDimension;
      readonly height: TexFuzzDimension;
    }
  | { readonly kind: "paragraph-break"; readonly command: "par" | "blank-line" }
  | { readonly kind: "noindent" }
  | { readonly kind: "alignment"; readonly command: "centering" | "raggedright" | "raggedleft" }
  | {
      readonly kind: "environment";
      readonly name: TexFuzzEnvironment;
      readonly children: readonly TexFuzzNode[];
    }
  | { readonly kind: "item"; readonly label?: readonly TexFuzzNode[] }
  | {
      readonly kind: "vertical-glue";
      readonly command: "smallskip" | "medskip" | "bigskip" | "vfill";
    }
  | {
      readonly kind: "vertical-glue";
      readonly command: "vspace";
      readonly starred?: boolean;
      readonly size: TexFuzzDimension;
    }
  | { readonly kind: "vertical-glue"; readonly command: "vskip"; readonly size: TexFuzzDimension }
  | { readonly kind: "penalty"; readonly value: number }
  | {
      readonly kind: "vertical-rule";
      readonly width?: TexFuzzDimension;
      readonly height?: TexFuzzDimension;
      readonly depth?: TexFuzzDimension;
    }
  | {
      readonly kind: "document-box";
      readonly command: "parbox";
      readonly position?: "t" | "c" | "b";
      readonly height?: TexFuzzDimension;
      readonly innerPosition?: "t" | "c" | "b" | "s";
      readonly width: TexFuzzDimension;
      readonly children: readonly TexFuzzNode[];
    }
  | {
      readonly kind: "document-box";
      readonly command: "minipage";
      readonly position?: "t" | "c" | "b";
      readonly width: TexFuzzDimension;
      readonly children: readonly TexFuzzNode[];
    }
  | { readonly kind: "oracle-command"; readonly command: "TeX" };

export interface TexFuzzChoice {
  readonly path: string;
  readonly upperExclusive: number;
  readonly value: number;
}

export interface TexFuzzSourceSpan {
  readonly path: string;
  readonly kind: TexFuzzNode["kind"] | `math.${TexFuzzMathNode["kind"]}`;
  readonly start: number;
  readonly end: number;
}

/** Raw mutations are applied in array order to UTF-16 source offsets. */
export type TexFuzzMutation =
  | { readonly kind: "truncate"; readonly offset: number }
  | { readonly kind: "insert"; readonly offset: number; readonly text: string }
  | { readonly kind: "delete"; readonly start: number; readonly end: number }
  | { readonly kind: "replace"; readonly start: number; readonly end: number; readonly text: string };

export interface TexFuzzCase {
  readonly schemaVersion: typeof TEX_FUZZ_SCHEMA_VERSION;
  readonly generatorVersion: string;
  readonly seed: number;
  readonly profile: "vertical-slice" | "canary" | "aggressive" | "supported-aggressive" | "document" | "malformed";
  readonly ast: readonly TexFuzzNode[];
  readonly source: string;
  readonly sourceMap: readonly TexFuzzSourceSpan[];
  readonly choices: readonly TexFuzzChoice[];
  readonly features: readonly TexFuzzFeatureId[];
  readonly mutations: readonly TexFuzzMutation[];
}

export type TexFuzzResultClass =
  | "hard-invariant"
  | "differential"
  | "timeout"
  | "resource-limit";

export interface TexFuzzFingerprint {
  readonly version: 1;
  readonly resultClass: TexFuzzResultClass;
  readonly code: string;
  readonly firstDivergentLayer?: string;
  readonly featureTags: readonly TexFuzzFeatureId[];
  readonly mode: "text" | "math" | "document";
  readonly structuralLocus: string;
  readonly operationKind?: string;
  readonly oracleEnvironmentFamily?: string;
  readonly severityBucket?: "small" | "medium" | "large";
}

export interface TexFuzzObservation {
  readonly fingerprint: TexFuzzFingerprint;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface TexFuzzReplayBundle {
  readonly case: TexFuzzCase;
  readonly minimizedCase?: TexFuzzCase;
  readonly observation: TexFuzzObservation;
  readonly oracleEnvironment?: Readonly<Record<string, string>>;
  readonly shrink?: {
    readonly candidatesEvaluated: number;
    readonly oracleEvaluations: number;
    readonly termination: "minimal" | "candidate-budget" | "oracle-budget" | "time-budget";
  };
}
