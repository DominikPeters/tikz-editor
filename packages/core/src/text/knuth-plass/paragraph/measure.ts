import type { AnyWrapper, ParagraphRun } from './types.js';

export interface MeasurementStats {
  textCacheEntries: number;
  wordPrefixEntries: number;
  mathCacheEntries: number;
}

export interface MeasurementService {
  measureText(text: string, mtextWrapper: AnyWrapper | null | undefined): number;
  measureWord(word: string, mtextWrapper: AnyWrapper | null | undefined): number;
  measurePrefix(word: string, n: number, mtextWrapper: AnyWrapper | null | undefined): number;
  measureSlice?(
    word: string,
    start: number,
    end: number,
    mtextWrapper: AnyWrapper | null | undefined
  ): number;
  measureHyphenatedPrefix?(
    word: string,
    start: number,
    end: number,
    hyphen: string,
    mtextWrapper: AnyWrapper | null | undefined
  ): number;
  measureDiscretionary?(
    word: string,
    start: number,
    end: number,
    hyphen: string,
    mtextWrapper: AnyWrapper | null | undefined
  ): DiscretionaryMeasurement;
  measureMath(wrapper: AnyWrapper | null | undefined): number;
  precomputeWord(word: string, mtextWrapper: AnyWrapper | null | undefined): void;
  primeRuns(runs: ParagraphRun[]): void;
  getStats(): MeasurementStats;
}

export interface DiscretionaryMeasurement {
  preBreakText: string;
  postBreakText: string;
  replaceText: string;
  replaceStart: number;
  replaceEnd: number;
  preBreakWidth: number;
  sourcePrefixWidth: number;
  insertedWidth: number;
}

interface InternalStats {
  mathEntries: number;
}

export function createMeasurementService(): MeasurementService {
  const textWidthCache = new Map<string, number>();
  const wordPrefixWidthCache = new Map<string, number[]>();
  const mathWidthCache = new WeakMap<object, number>();
  const wrapperIds = new WeakMap<object, number>();
  let nextWrapperId = 1;
  const stats: InternalStats = {
    mathEntries: 0,
  };

  const getWrapperId = (wrapper: AnyWrapper | null | undefined): number => {
    if (!wrapper || typeof wrapper !== 'object') return 0;
    if (!wrapperIds.has(wrapper)) {
      wrapperIds.set(wrapper, nextWrapperId++);
    }
    return wrapperIds.get(wrapper) as number;
  };

  const textKey = (text: string, wrapper: AnyWrapper | null | undefined): string => {
    return `${getWrapperId(wrapper)}::${text}`;
  };

  const measureText = (text: string, mtextWrapper: AnyWrapper | null | undefined): number => {
    const key = textKey(text, mtextWrapper);
    const cached = textWidthCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    if (!mtextWrapper || typeof mtextWrapper.textWidth !== 'function') {
      throw new Error('Missing textWidth() on mtext wrapper for strict measurement.');
    }
    const width = Number(mtextWrapper.textWidth(text)) || 0;

    textWidthCache.set(key, width);
    return width;
  };

  const buildPrefixWidths = (
    word: string,
    mtextWrapper: AnyWrapper | null | undefined
  ): number[] => {
    const key = textKey(word, mtextWrapper);
    const existing = wordPrefixWidthCache.get(key);
    if (existing) {
      return existing;
    }

    const widths = Array.from({ length: word.length + 1 }, () => 0);
    widths[0] = 0;
    for (let i = 1; i <= word.length; i++) {
      widths[i] = measureText(word.slice(0, i), mtextWrapper);
    }

    wordPrefixWidthCache.set(key, widths);
    return widths;
  };

  const precomputeWord = (word: string, mtextWrapper: AnyWrapper | null | undefined): void => {
    void measureText(word, mtextWrapper);
  };

  const measureWord = (word: string, mtextWrapper: AnyWrapper | null | undefined): number => {
    return measureText(word, mtextWrapper);
  };

  const measurePrefix = (
    word: string,
    n: number,
    mtextWrapper: AnyWrapper | null | undefined
  ): number => {
    const widths = buildPrefixWidths(word, mtextWrapper);
    const clamped = Math.max(0, Math.min(n, word.length));
    return widths[clamped] || 0;
  };

  const measureHyphenatedPrefix = (
    word: string,
    start: number,
    end: number,
    hyphen: string,
    mtextWrapper: AnyWrapper | null | undefined
  ): number => {
    const clampedStart = Math.max(0, Math.min(start, word.length));
    const clampedEnd = Math.max(clampedStart, Math.min(end, word.length));
    const prefix = word.slice(clampedStart, clampedEnd);
    return measureText(prefix + hyphen, mtextWrapper) - measureText(prefix, mtextWrapper);
  };

  const measureDiscretionary = (
    word: string,
    start: number,
    end: number,
    hyphen: string,
    mtextWrapper: AnyWrapper | null | undefined
  ): DiscretionaryMeasurement => {
    const clampedStart = Math.max(0, Math.min(start, word.length));
    const clampedEnd = Math.max(clampedStart, Math.min(end, word.length));
    const sourcePrefix = word.slice(clampedStart, clampedEnd);
    const insertedWidth = measureHyphenatedPrefix(
      word,
      clampedStart,
      clampedEnd,
      hyphen,
      mtextWrapper
    );
    return {
      preBreakText: hyphen,
      postBreakText: '',
      replaceText: '',
      replaceStart: clampedEnd,
      replaceEnd: clampedEnd,
      preBreakWidth: insertedWidth,
      sourcePrefixWidth: measureText(sourcePrefix, mtextWrapper),
      insertedWidth,
    };
  };

  const measureMath = (wrapper: AnyWrapper | null | undefined): number => {
    if (!wrapper || typeof wrapper !== 'object') return 0;

    const cached = mathWidthCache.get(wrapper);
    if (cached !== undefined) {
      return cached;
    }

    const bbox =
      typeof wrapper.getOuterBBox === 'function'
        ? wrapper.getOuterBBox()
        : typeof wrapper.getBBox === 'function'
          ? wrapper.getBBox()
          : null;
    const width = bbox
      ? (Number(bbox.L) || 0) + (Number(bbox.w) || 0) + (Number(bbox.R) || 0)
      : 0;

    mathWidthCache.set(wrapper, width);
    stats.mathEntries += 1;
    return width;
  };

  const primeRuns = (runs: ParagraphRun[]): void => {
    for (const run of runs) {
      if (run.kind === 'text') {
        precomputeWord(run.text, run.wrapper);
      } else if (run.kind === 'space') {
        if (run.breakRef.kind === 'mspace') {
          measureMath(run.wrapper);
        } else {
          measureText(' ', run.wrapper);
        }
      } else if (run.kind === 'penalty') {
        continue;
      } else {
        measureMath(run.wrapper);
      }
    }
  };

  const getStats = (): MeasurementStats => {
    return {
      textCacheEntries: textWidthCache.size,
      wordPrefixEntries: wordPrefixWidthCache.size,
      mathCacheEntries: stats.mathEntries,
    };
  };

  return {
    measureText,
    measureWord,
    measurePrefix,
    measureHyphenatedPrefix,
    measureDiscretionary,
    measureMath,
    precomputeWord,
    primeRuns,
    getStats,
  };
}
