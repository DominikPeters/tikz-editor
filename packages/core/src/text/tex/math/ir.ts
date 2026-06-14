export interface TexMathSourceSpan {
  readonly start: number;
  readonly end: number;
}

export type TexMathDiagnosticSeverity = "warning" | "error";

export type TexMathDiagnosticCode =
  | "duplicate-script"
  | "empty-script"
  | "missing-group"
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
  | TexMathUnsupportedNucleus;

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
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathGlue {
  readonly kind: "glue";
  readonly command: TexMathSpacingCommand;
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
