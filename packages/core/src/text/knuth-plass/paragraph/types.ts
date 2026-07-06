export interface MathJaxAttributes {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
}

export interface MathJaxNode {
  kind?: string;
  attributes?: MathJaxAttributes;
  getText?(): string;
  isKind?(kind: string): boolean;
  setText?(text: string): void;
}

export interface MathJaxBBox {
  L?: number;
  R?: number;
  w?: number;
  h?: number;
  d?: number;
  dh?: number;
  lineLeading?: number;
}

export type MathJaxWrapperConstructor = {
  new (...args: never[]): AnyWrapper;
  prototype?: AnyWrapper;
};

export interface MathJaxWrapperFactoryLike {
  nodeMap?: {
    get(name: string): unknown;
  };
}

export interface AnyWrapper {
  node?: MathJaxNode;
  childNodes?: AnyWrapper[];
  parent?: AnyWrapper;
  jax?: { linebreaks?: unknown; knuthPlassOptions?: unknown };
  lineBBox?: MathJaxBBox[];
  containerWidth?: number;
  breakToWidth?(width: number): void;
  clearBreakPoints?(): void;
  computeBBox?(bbox: MathJaxBBox, recompute?: boolean): void;
  computeLineBBox?(index: number): (MathJaxBBox & { getIndentData?(node: MathJaxNode): unknown }) | null;
  getBBox?(): MathJaxBBox;
  getOuterBBox?(): MathJaxBBox;
  invalidateBBox?(): void;
  place?(x: number, y: number, parent: unknown): void;
  placeLines?(parents: unknown[]): void;
  set?(x: number, y: number): void;
  setBBoxDimens?(bbox: MathJaxBBox): void;
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
  sourceStart: number;
  sourceEnd: number;
}

export interface TextRun extends BaseRun {
  kind: 'text';
  text: string;
  wrapper: AnyWrapper;
  childIndex: number;
  wordIndex: number;
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
  };
}

export interface MathRun extends BaseRun {
  kind: 'math';
  wrapper: AnyWrapper;
}

export type ParagraphRun = TextRun | SpaceRun | MathRun;

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

export interface BreakDecision {
  kind: 'space' | 'hyphen' | 'forced';
  runIndex: number;
  sourceOffset: number;
  visibleHyphen: boolean;
  lineLeading?: string;
  hyphenSource?: 'automatic' | 'explicit';
  splitOffset?: number;
  flagged?: boolean;
}

export interface GreedyResult {
  lines: GreedyLine[];
  errors: string[];
}
