export interface ParagraphAttributes {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
}

export interface ParagraphNode {
  kind?: string;
  attributes?: ParagraphAttributes;
  getText?(): string;
  isKind?(kind: string): boolean;
  setText?(text: string): void;
}

export interface ParagraphBBox {
  L?: number;
  R?: number;
  w?: number;
  h?: number;
  d?: number;
  dh?: number;
  lineLeading?: number;
}

export type ParagraphWrapperConstructor = {
  new (...args: never[]): AnyWrapper;
  prototype?: AnyWrapper;
};

export interface ParagraphWrapperFactory {
  nodeMap?: {
    get(name: string): unknown;
  };
}

export interface AnyWrapper {
  node?: ParagraphNode;
  childNodes?: AnyWrapper[];
  parent?: AnyWrapper;
  jax?: { linebreaks?: unknown; knuthPlassOptions?: unknown };
  lineBBox?: ParagraphBBox[];
  containerWidth?: number;
  breakToWidth?(width: number): void;
  clearBreakPoints?(): void;
  computeBBox?(bbox: ParagraphBBox, recompute?: boolean): void;
  computeLineBBox?(index: number): (ParagraphBBox & { getIndentData?(node: ParagraphNode): unknown }) | null;
  getBBox?(): ParagraphBBox;
  getOuterBBox?(): ParagraphBBox;
  invalidateBBox?(): void;
  place?(x: number, y: number, parent: unknown): void;
  placeLines?(parents: unknown[]): void;
  set?(x: number, y: number): void;
  setBBoxDimens?(bbox: ParagraphBBox): void;
  setBreakAt?(index: number | [number, number], kind?: string): void;
  setBreakStyle?(style: string): void;
  setChildPWidths?(recompute: boolean, width: number): void;
  textWidth?(text: string): number;
  [key: string]: unknown;
}

export type BreakRef =
  | {
      kind: 'mtext-space';
      wrapper: AnyWrapper;
      childIndex: number;
      wordIndex: number;
    }
  | {
      kind: 'mspace';
      wrapper: AnyWrapper;
      linebreak?: string;
      isForcedLineBreak?: boolean;
      lineLeading?: string;
      lineLeadingTrim?: {
        wrapper: AnyWrapper;
        childIndex: number;
        wordIndex: number;
        consumed: number;
      };
    };

interface BaseRun {
  runIndex: number;
  role?: 'list-label';
  sourceStart: number;
  sourceEnd: number;
  literal?: {
    reason: string;
    detail?: string;
  };
}

export interface TextRun extends BaseRun {
  kind: 'text';
  text: string;
  wrapper: AnyWrapper;
  childIndex: number;
  wordIndex: number;
  allowAutomaticHyphenation?: boolean;
}

export interface SpaceRun extends BaseRun {
  kind: 'space';
  text: ' ';
  breakRef: BreakRef;
  wrapper: AnyWrapper;
  texGlue?: {
    width: number;
    stretch: number;
    shrink: number;
    spaceFactor?: number;
    breakPenalty?: number;
    preserveAtLineStart?: boolean;
    preserveAtLineEnd?: boolean;
  };
}

export interface MathRun extends BaseRun {
  kind: 'math';
  wrapper: AnyWrapper;
  texGlue?: {
    stretch: number;
    shrink: number;
  };
}

export interface PenaltyRun extends BaseRun {
  kind: 'penalty';
  penalty: number;
}

export type ParagraphRun = TextRun | SpaceRun | MathRun | PenaltyRun;

export interface FlattenResult {
  runs: ParagraphRun[];
  errors: string[];
  canProceed: boolean;
  unsupportedKinds: string[];
}

export interface GreedyLine {
  lineIndex: number;
  startRun: number;
  startTextOffset: number;
  startPendingText?: string;
  startPendingSourceStart?: number;
  startPendingSourceEnd?: number;
  endRun: number;
  endTextOffset: number | null;
  width: number;
  targetWidth?: number;
  lineNaturalWidth?: number;
  glueSetRatio?: number;
  badness?: number;
  spaceCount?: number;
  spaceDeltaPerGap?: number;
  xOffset?: number;
  break: BreakDecision | null;
}

export interface BreakDiscretionary {
  preBreakText: string;
  postBreakText: string;
  replaceText: string;
  replaceStart: number;
  replaceEnd: number;
  preBreakWidth: number;
  sourcePrefixWidth: number;
  insertedWidth: number;
}

export interface BreakDecision {
  kind: 'space' | 'hyphen' | 'forced';
  runIndex: number;
  sourceOffset: number;
  visibleHyphen: boolean;
  lineLeading?: string;
  hyphenSource?: 'automatic' | 'explicit';
  splitOffset?: number;
  flagged?: boolean;
  width?: number;
  discretionary?: BreakDiscretionary;
}

export interface GreedyResult {
  lines: GreedyLine[];
  errors: string[];
}
