import type { TexFontFamily, TexFontSeries, TexFontShape } from "../ir.js";

/** Source-backed text alignments. Dimensions stay symbolic until the font is known. */
export interface TexTabularSourcePart {
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}
export interface TexTabularColumn {
  readonly alignment: "left" | "center" | "right" | "paragraph" | "middle" | "bottom";
  readonly width?: string;
  readonly before?: string;
  readonly after?: string;
  readonly beforeParts?: readonly TexTabularSourcePart[];
  readonly afterParts?: readonly TexTabularSourcePart[];
}
export interface TexTabularBoundary {
  readonly replace?: string;
  readonly insert?: string;
  readonly replaceParts?: readonly TexTabularSourcePart[];
  readonly insertParts?: readonly TexTabularSourcePart[];
  readonly rules: number;
}
export interface TexTabularPreamble {
  readonly columns: readonly TexTabularColumn[];
  readonly boundaries: readonly TexTabularBoundary[];
}
export interface TexTabularCell {
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly span: number;
  readonly preamble?: TexTabularPreamble;
}
export interface TexTabularRow {
  readonly kind: "row";
  readonly cells: readonly TexTabularCell[];
  readonly extraDepth?: string;
}
export interface TexTabularRule {
  readonly kind: "rule";
  readonly command: "hline" | "cline" | "toprule" | "midrule" | "bottomrule" | "cmidrule" | "specialrule" | "addlinespace" | "morecmidrules";
  readonly width?: string;
  readonly above?: string;
  readonly below?: string;
  readonly from?: number;
  readonly to?: number;
  readonly trimLeft?: string;
  readonly trimRight?: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}
export interface TexTabular {
  readonly preamble: TexTabularPreamble;
  readonly alignment: "top" | "center" | "bottom";
  readonly items: readonly (TexTabularRow | TexTabularRule)[];
  readonly contentStart: number;
  readonly contentEnd: number;
}
export interface TexTabularAssignmentFont {
  readonly family?: TexFontFamily;
  readonly series?: TexFontSeries;
  readonly shape?: TexFontShape;
  readonly sizePt?: number;
}
/** TeX fixes em/ex dimensions when assigning a register, before later font changes. */
export type TexTabularDimension = string | { readonly value: string; readonly font: TexTabularAssignmentFont };
export interface TexTabularRegisters {
  readonly tabcolsep?: TexTabularDimension;
  readonly arrayrulewidth?: TexTabularDimension;
  readonly doublerulesep?: TexTabularDimension;
  readonly extrarowheight?: TexTabularDimension;
  readonly arraystretch?: number;
  readonly heavyrulewidth?: TexTabularDimension;
  readonly lightrulewidth?: TexTabularDimension;
  readonly cmidrulewidth?: TexTabularDimension;
  readonly aboverulesep?: TexTabularDimension;
  readonly belowrulesep?: TexTabularDimension;
  readonly abovetopsep?: TexTabularDimension;
  readonly belowbottomsep?: TexTabularDimension;
  readonly cmidrulekern?: TexTabularDimension;
  readonly defaultaddspace?: TexTabularDimension;
}
export interface TexTabularLayoutProfile {
  /** The array package changes vertical rules from zero-width overlays to real columns. */
  readonly arrayPackage?: boolean;
  /** Document preamble register assignments inherited by each table. */
  readonly registers?: TexTabularRegisters;
  /** Ambient strut/baseline selected by the document class. */
  readonly baselineSkipPt?: number;
  /** Booktabs lengths are allocated at package load, independent of later size changes. */
  readonly booktabsFontSizePt?: number;
  readonly booktabsXHeightPt?: number;
}
