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
  | "duplicate-script"
  | "empty-script"
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
  | "quad"
  | "qquad";

export type TexMathNucleus =
  | TexMathGlyphNucleus
  | TexMathListNucleus
  | TexMathFractionNucleus
  | TexMathRadicalNucleus
  | TexMathAccentNucleus
  | TexMathOperatorNucleus
  | TexMathLeftRightNucleus
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
  | "rceil";

export interface TexMathGlyphNucleus {
  readonly kind: "glyph";
  readonly text: string;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathListNucleus {
  readonly kind: "list";
  readonly list: TexMathList;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathFractionNucleus {
  readonly kind: "fraction";
  readonly numerator: TexMathList;
  readonly denominator: TexMathList;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathRadicalNucleus {
  readonly kind: "radical";
  readonly radicand: TexMathList;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathAccentCommand =
  | "bar"
  | "dot"
  | "ddot"
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

export type TexMathOperatorCommand =
  | "bigcap"
  | "bigcup"
  | "coprod"
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

export interface TexMathLeftRightNucleus {
  readonly kind: "left-right";
  readonly leftDelimiter: TexMathDelimiter;
  readonly rightDelimiter: TexMathDelimiter;
  readonly body: TexMathList;
  readonly leftDelimiterSourceSpan: TexMathSourceSpan;
  readonly rightDelimiterSourceSpan: TexMathSourceSpan;
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
  | TexMathStyleChange
  | TexMathUnsupportedItem;

export interface TexMathList {
  readonly kind: "math-list";
  readonly items: readonly TexMathItem[];
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathParseResult {
  readonly list: TexMathList;
  readonly tokens: readonly TexMathToken[];
  readonly diagnostics: readonly TexMathDiagnostic[];
}
