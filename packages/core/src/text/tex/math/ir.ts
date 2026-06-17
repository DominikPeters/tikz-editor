export interface TexMathSourceSpan {
  readonly start: number;
  readonly end: number;
}

export type TexMathDiagnosticSeverity = "warning" | "error";

export type TexMathStyle =
  | "display"
  | "text"
  | "script"
  | "scriptscript";

export type TexMathDiagnosticCode =
  | "ambiguous-infix-fraction"
  | "duplicate-script"
  | "empty-script"
  | "extra-alignment-tab"
  | "invalid-environment-nesting"
  | "invalid-environment-argument"
  | "invalid-math-style"
  | "invalid-tex-dimension"
  | "missing-environment-end"
  | "missing-delimiter"
  | "missing-group"
  | "missing-right"
  | "missing-script-target"
  | "unexpected-group-close"
  | "unsupported-command";

export interface TexMathDiagnostic {
  readonly severity: TexMathDiagnosticSeverity;
  readonly code: TexMathDiagnosticCode;
  readonly message: string;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathTokenKind =
  | "character"
  | "command"
  | "group-open"
  | "group-close"
  | "space"
  | "subscript"
  | "superscript";

export interface TexMathToken {
  readonly kind: TexMathTokenKind;
  readonly text: string;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathAtomClass =
  | "ord"
  | "op"
  | "bin"
  | "rel"
  | "open"
  | "close"
  | "punct"
  | "inner";

export type TexMathSpacingCommand =
  | ","
  | ":"
  | ";"
  | "!"
  | "nobreakspace"
  | "negmedspace"
  | "negthickspace"
  | "quad"
  | "qquad";

export type TexMathNucleus =
  | TexMathGlyphNucleus
  | TexMathSizedDelimiterNucleus
  | TexMathListNucleus
  | TexMathFractionNucleus
  | TexMathRadicalNucleus
  | TexMathLineNucleus
  | TexMathAccentNucleus
  | TexMathAlphabetNucleus
  | TexMathTextNucleus
  | TexMathOperatorNucleus
  | TexMathOperatorNameNucleus
  | TexMathExtensibleArrowNucleus
  | TexMathLeftRightNucleus
  | TexMathAlignedNucleus
  | TexMathSubstackNucleus
  | TexMathSubarrayNucleus
  | TexMathArrayNucleus
  | TexMathCasesNucleus
  | TexMathSmallMatrixNucleus
  | TexMathMatrixNucleus
  | TexMathUnsupportedNucleus;

export type TexMathDelimiter =
  | "."
  | "("
  | ")"
  | "["
  | "]"
  | "lbrace"
  | "rbrace"
  | "vert"
  | "Vert"
  | "slash"
  | "backslash"
  | "langle"
  | "rangle"
  | "lfloor"
  | "rfloor"
  | "lceil"
  | "rceil"
  | "ulcorner"
  | "urcorner";

export interface TexMathGlyphNucleus {
  readonly kind: "glyph";
  readonly text: string;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathDelimiterSizeCommand =
  | "big"
  | "Big"
  | "bigg"
  | "Bigg";

export interface TexMathSizedDelimiterNucleus {
  readonly kind: "sized-delimiter";
  readonly command: TexMathDelimiterSizeCommand;
  readonly delimiter: TexMathDelimiter;
  readonly commandSourceSpan: TexMathSourceSpan;
  readonly delimiterSourceSpan: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathListNucleus {
  readonly kind: "list";
  readonly list: TexMathList;
  readonly role?: "ellipsis";
  readonly ellipsisCommand?: "ldots" | "cdots" | "dots";
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathFractionNucleus {
  readonly kind: "fraction";
  readonly numerator: TexMathList;
  readonly denominator: TexMathList;
  readonly leftDelimiter?: TexMathDelimiter;
  readonly rightDelimiter?: TexMathDelimiter;
  readonly ruleThickness?: number;
  readonly style?: TexMathStyle;
  readonly continued?: {
    readonly numeratorAlignment: "left" | "center" | "right";
  };
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathRadicalNucleus {
  readonly kind: "radical";
  readonly radicand: TexMathList;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathLineCommand =
  | "overline"
  | "underline";

export interface TexMathLineNucleus {
  readonly kind: "line";
  readonly command: TexMathLineCommand;
  readonly body: TexMathList;
  readonly commandSourceSpan: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathAccentCommand =
  | "bar"
  | "dot"
  | "ddot"
  | "dddot"
  | "ddddot"
  | "hat"
  | "tilde"
  | "vec";

export interface TexMathAccentNucleus {
  readonly kind: "accent";
  readonly command: TexMathAccentCommand;
  readonly base: TexMathList;
  readonly commandSourceSpan: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathAlphabetCommand =
  | "mathbf"
  | "mathcal"
  | "mathit"
  | "mathrm"
  | "mathsf"
  | "mathtt";

export interface TexMathAlphabetNucleus {
  readonly kind: "alphabet";
  readonly alphabet: TexMathAlphabetCommand;
  readonly list: TexMathList;
  readonly commandSourceSpan: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathTextPart =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly sourceSpan: TexMathSourceSpan;
    }
  | {
      readonly kind: "math";
      readonly content: string;
      readonly list: TexMathList;
      readonly sourceSpan: TexMathSourceSpan;
      readonly contentSourceSpan: TexMathSourceSpan;
    };

export interface TexMathTextNucleus {
  readonly kind: "text";
  readonly text: string;
  readonly parts?: readonly TexMathTextPart[];
  readonly textSourceSpan: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathOperatorCommand =
  | "bigcap"
  | "bigcup"
  | "coprod"
  | "idotsint"
  | "iint"
  | "iiint"
  | "iiiint"
  | "int"
  | "lim"
  | "oint"
  | "prod"
  | "sum";

export type TexMathOperatorLimits =
  | "display"
  | "limits"
  | "nolimits";

export interface TexMathOperatorNucleus {
  readonly kind: "operator";
  readonly command: TexMathOperatorCommand;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathOperatorNamePart =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly sourceSpan: TexMathSourceSpan;
    }
  | {
      readonly kind: "spacing";
      readonly command: TexMathSpacingCommand;
      readonly sourceSpan: TexMathSourceSpan;
    };

export interface TexMathOperatorNameNucleus {
  readonly kind: "operator-name";
  readonly parts: readonly TexMathOperatorNamePart[];
  readonly commandSourceSpan: TexMathSourceSpan;
  readonly nameSourceSpan: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathExtensibleArrowCommand =
  | "xleftarrow"
  | "xrightarrow";

export interface TexMathExtensibleArrowNucleus {
  readonly kind: "extensible-arrow";
  readonly command: TexMathExtensibleArrowCommand;
  readonly above: TexMathList;
  readonly below?: TexMathList;
  readonly commandSourceSpan: TexMathSourceSpan;
  readonly aboveSourceSpan: TexMathSourceSpan;
  readonly belowSourceSpan?: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathLeftRightNucleus {
  readonly kind: "left-right";
  readonly leftDelimiter: TexMathDelimiter;
  readonly rightDelimiter: TexMathDelimiter;
  readonly body: TexMathList;
  readonly leftDelimiterSourceSpan: TexMathSourceSpan;
  readonly rightDelimiterSourceSpan: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathAlignedCell {
  readonly list: TexMathList;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathAlignedRow {
  readonly cells: readonly TexMathAlignedCell[];
  readonly sourceSpan: TexMathSourceSpan;
  readonly rowBreakSourceSpan?: TexMathSourceSpan;
  readonly intertextsBefore?: readonly TexMathAlignedIntertext[];
  readonly suppressTag?: boolean;
  readonly labels?: readonly TexMathAlignedRowLabel[];
  readonly multlineShove?: "left" | "right";
}

export interface TexMathAlignedIntertext {
  readonly text: string;
  readonly parts: readonly TexMathTextPart[];
  readonly sourceSpan: TexMathSourceSpan;
  readonly textSourceSpan: TexMathSourceSpan;
}

export interface TexMathAlignedRowLabel {
  readonly text: string;
  readonly sourceSpan: TexMathSourceSpan;
  readonly textSourceSpan: TexMathSourceSpan;
  readonly explicit?: boolean;
}

export interface TexMathAlignedNucleus {
  readonly kind: "aligned";
  readonly rows: readonly TexMathAlignedRow[];
  readonly columnSeparation?: "align" | "none" | "gather" | "multline" | "eqnarray";
  readonly maxFields?: number;
  readonly beginSourceSpan: TexMathSourceSpan;
  readonly preambleSourceSpan?: TexMathSourceSpan;
  readonly endSourceSpan?: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathSubstackNucleus {
  readonly kind: "substack";
  readonly rows: readonly TexMathAlignedRow[];
  readonly commandSourceSpan: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathSubarrayNucleus {
  readonly kind: "subarray";
  readonly rows: readonly TexMathAlignedRow[];
  readonly columnAlignment: "left" | "center";
  readonly beginSourceSpan: TexMathSourceSpan;
  readonly preambleSourceSpan: TexMathSourceSpan;
  readonly endSourceSpan?: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathArrayColumnAlignment =
  | "left"
  | "center"
  | "right";

export interface TexMathArrayVerticalRule {
  readonly beforeColumn: number;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathArrayNucleus {
  readonly kind: "array";
  readonly rows: readonly TexMathAlignedRow[];
  readonly columnAlignments: readonly TexMathArrayColumnAlignment[];
  readonly verticalRules?: readonly TexMathArrayVerticalRule[];
  readonly beginSourceSpan: TexMathSourceSpan;
  readonly preambleSourceSpan: TexMathSourceSpan;
  readonly endSourceSpan?: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathCasesNucleus {
  readonly kind: "cases";
  readonly rows: readonly TexMathAlignedRow[];
  readonly beginSourceSpan: TexMathSourceSpan;
  readonly endSourceSpan?: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathSmallMatrixNucleus {
  readonly kind: "smallmatrix";
  readonly environment?: TexMathSmallMatrixEnvironment;
  readonly rows: readonly TexMathAlignedRow[];
  readonly columnAlignment?: TexMathArrayColumnAlignment;
  readonly beginSourceSpan: TexMathSourceSpan;
  readonly endSourceSpan?: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathSmallMatrixEnvironment =
  | "smallmatrix"
  | "psmallmatrix"
  | "bsmallmatrix"
  | "Bsmallmatrix"
  | "vsmallmatrix"
  | "Vsmallmatrix";

export type TexMathMatrixEnvironment =
  | "matrix"
  | "pmatrix"
  | "bmatrix"
  | "Bmatrix"
  | "vmatrix"
  | "Vmatrix";

export interface TexMathMatrixNucleus {
  readonly kind: "matrix";
  readonly environment: TexMathMatrixEnvironment;
  readonly rows: readonly TexMathAlignedRow[];
  readonly columnAlignment?: TexMathArrayColumnAlignment;
  readonly beginSourceSpan: TexMathSourceSpan;
  readonly endSourceSpan?: TexMathSourceSpan;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathUnsupportedNucleus {
  readonly kind: "unsupported";
  readonly command: string;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathScript {
  readonly list: TexMathList;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathAtom {
  readonly kind: "atom";
  readonly atomClass: TexMathAtomClass;
  readonly nucleus: TexMathNucleus;
  readonly subscript?: TexMathScript;
  readonly superscript?: TexMathScript;
  readonly limits?: TexMathOperatorLimits;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathGlue {
  readonly kind: "glue";
  readonly command: TexMathSpacingCommand;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathMuGlue {
  readonly kind: "mu-glue";
  readonly mu: number;
  readonly displayMu?: number;
  readonly stretchMu?: number;
  readonly shrinkMu?: number;
  readonly omitInScript?: boolean;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathStyleChange {
  readonly kind: "style-change";
  readonly style: TexMathStyle;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathUnsupportedItem {
  readonly kind: "unsupported";
  readonly command: string;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathItem =
  | TexMathAtom
  | TexMathGlue
  | TexMathMuGlue
  | TexMathStyleChange
  | TexMathUnsupportedItem;

export interface TexMathList {
  readonly kind: "math-list";
  readonly items: readonly TexMathItem[];
  readonly sourceSpan: TexMathSourceSpan;
  readonly displayLabels?: readonly TexMathAlignedRowLabel[];
  readonly suppressDisplayTag?: boolean;
}

export interface TexMathParseResult {
  readonly list: TexMathList;
  readonly tokens: readonly TexMathToken[];
  readonly diagnostics: readonly TexMathDiagnostic[];
}
