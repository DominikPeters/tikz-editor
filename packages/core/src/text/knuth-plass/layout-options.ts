import type { ParagraphAlignment } from "./alignment.js";

export type KnuthPlassLayoutMode =
  | "wrap"
  | "fixed-lines"
  | "wrapped-explicit";

export interface WrappedTextGap {
  readonly sourceStart: number;
  readonly widthEm: number;
  readonly stretchEm?: number;
  readonly shrinkEm?: number;
  readonly spaceFactor?: number;
}

export interface KnuthPlassConfig {
  readonly alignment?: ParagraphAlignment;
  readonly layoutMode?: KnuthPlassLayoutMode;
  readonly wrappedTextGaps?: readonly WrappedTextGap[];
  readonly pretolerance?: number;
  readonly tolerance?: number;
  readonly linepenalty?: number;
  readonly hyphenpenalty?: number;
  readonly exhyphenpenalty?: number;
  readonly adjdemerits?: number;
  readonly doublehyphendemerits?: number;
  readonly finalhyphendemerits?: number;
  readonly lefthyphenmin?: number;
  readonly righthyphenmin?: number;
}
