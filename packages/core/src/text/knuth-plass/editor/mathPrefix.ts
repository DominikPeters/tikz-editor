import type { MathDelimiterKind, MathSourceSpan } from './sourceParser.js';
import { extendTeXControlWordPrefixEnd } from '../../prefix-width.js';
import { clamp } from '../../../utils/math.js';

const TRAILING_ESCAPE_DISCHARGE_SUFFIX = 'phantom{}';
const MATH_MODE_NONE = 'none';
const MATH_MODE_DOLLAR = 'dollar';
const MATH_MODE_PAREN = 'paren';
const DEFAULT_PREFIX_CACHE_LIMIT = 64;

interface PrefixState {
  inMath: boolean;
  mathMode: 'none' | 'dollar' | 'paren';
  braceDepth: number;
  trailingEscape: boolean;
  unclosedLeftCount: number;
}

type MathJaxAdaptor = {
  firstChild(node: unknown): unknown;
  getAttribute(node: unknown, name: string): string | null;
};

type RenderedMathNode = {
  firstElementChild?: RenderedMathNode | null;
  getAttribute?(name: string): string | null;
  getBBox?(): { width?: number };
  querySelector?(selector: string): RenderedMathNode | null;
  viewBox?: { baseVal?: { width?: number } };
};

type MathJaxRuntime = {
  tex2svg?: Tex2Svg;
};

type OutputJaxLike = MathJaxRuntime & {
  mathjax?: MathJaxRuntime;
  constructor?: { mathjax?: MathJaxRuntime };
};

export interface MathPrefixCache {
  getOrBuild(
    outputJax: unknown,
    span: MathSourceSpan
  ): Promise<number[]>;
}

function normalizeIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.floor(value), 0, max);
}

export function hasDanglingMathScriptOperator(text: string): boolean {
  let index = text.length - 1;
  while (index >= 0 && /\s/.test(text.charAt(index))) {
    index -= 1;
  }
  if (index < 0) {
    return false;
  }

  const char = text.charAt(index);
  if (char !== '^' && char !== '_') {
    return false;
  }

  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text.charAt(cursor) === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 0;
}

export function scanTeXPrefixState(text: string): PrefixState {
  let braceDepth = 0;
  let mathMode: PrefixState['mathMode'] = MATH_MODE_NONE;
  let unclosedLeftCount = 0;
  let trailingEscape = false;

  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);

    if (char === '\\') {
      const nextIndex = index + 1;
      if (nextIndex >= text.length) {
        trailingEscape = true;
        break;
      }

      const nextChar = text.charAt(nextIndex);
      if (nextChar === '(') {
        if (mathMode === MATH_MODE_NONE) {
          mathMode = MATH_MODE_PAREN;
        }
        index += 2;
        continue;
      }

      if (nextChar === ')') {
        if (mathMode === MATH_MODE_PAREN) {
          mathMode = MATH_MODE_NONE;
        }
        index += 2;
        continue;
      }

      if (/[A-Za-z]/.test(nextChar)) {
        let commandEnd = nextIndex + 1;
        while (commandEnd < text.length && /[A-Za-z]/.test(text.charAt(commandEnd))) {
          commandEnd += 1;
        }
        const command = text.slice(nextIndex, commandEnd);
        if (mathMode !== MATH_MODE_NONE && command === 'left') {
          unclosedLeftCount += 1;
        } else if (mathMode !== MATH_MODE_NONE && command === 'right') {
          unclosedLeftCount = Math.max(0, unclosedLeftCount - 1);
        }
        index = commandEnd;
        continue;
      }

      index += 2;
      continue;
    }

    if (char === '$') {
      if (mathMode === MATH_MODE_NONE) {
        mathMode = MATH_MODE_DOLLAR;
      } else if (mathMode === MATH_MODE_DOLLAR) {
        mathMode = MATH_MODE_NONE;
      }
      index += 1;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      index += 1;
      continue;
    }

    if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      index += 1;
      continue;
    }

    index += 1;
  }

  return {
    inMath: mathMode !== MATH_MODE_NONE,
    mathMode,
    braceDepth,
    trailingEscape,
    unclosedLeftCount,
  };
}

export function stabilizePrefixForMeasurement(prefix: string): string {
  let stabilized = prefix;
  let state = scanTeXPrefixState(stabilized);

  if (state.trailingEscape) {
    stabilized += TRAILING_ESCAPE_DISCHARGE_SUFFIX;
    state = scanTeXPrefixState(stabilized);
  }

  if (state.braceDepth > 0) {
    stabilized += '}'.repeat(state.braceDepth);
    state = scanTeXPrefixState(stabilized);
  }

  if (state.inMath && state.unclosedLeftCount > 0) {
    stabilized += '\\right.'.repeat(state.unclosedLeftCount);
    state = scanTeXPrefixState(stabilized);
  }

  if (state.inMath && hasDanglingMathScriptOperator(stabilized)) {
    stabilized += '{}';
    state = scanTeXPrefixState(stabilized);
  }

  if (state.inMath) {
    if (state.trailingEscape) {
      stabilized += TRAILING_ESCAPE_DISCHARGE_SUFFIX;
    }
    stabilized += state.mathMode === MATH_MODE_PAREN ? '\\)' : '$';
  }

  return stabilized;
}

function readViewBoxWidth(node: unknown, adaptor: MathJaxAdaptor | null): number {
  if (!node) {
    return 0;
  }
  const rendered = node as RenderedMathNode;

  const attr =
    adaptor
      ? adaptor.getAttribute(node, 'viewBox')
      : typeof rendered.getAttribute === 'function'
        ? rendered.getAttribute('viewBox')
        : null;
  if (typeof attr === 'string' && attr.trim()) {
    const parts = attr
      .trim()
      .split(/\s+/)
      .map((part) => Number(part));
    if (parts.length === 4 && Number.isFinite(parts[2])) {
      return parts[2];
    }
  }

  if (
    rendered.viewBox?.baseVal &&
    Number.isFinite(rendered.viewBox.baseVal.width) &&
    (rendered.viewBox.baseVal.width ?? 0) > 0
  ) {
    return Number(rendered.viewBox.baseVal.width);
  }

  const widthAttr = Number(
    adaptor
      ? adaptor.getAttribute(node, 'width')
      : typeof rendered.getAttribute === 'function'
        ? rendered.getAttribute('width')
        : Number.NaN
  );
  if (Number.isFinite(widthAttr) && widthAttr > 0) {
    return widthAttr;
  }

  const bbox = typeof rendered.getBBox === 'function' ? rendered.getBBox() : null;
  const bboxWidth = Number(bbox?.width);
  if (Number.isFinite(bboxWidth) && bboxWidth > 0) {
    return bboxWidth;
  }

  return 0;
}

function getMathJaxAdaptor(): MathJaxAdaptor | null {
  const candidate = (globalThis as { MathJax?: { startup?: { adaptor?: unknown } } }).MathJax?.startup?.adaptor;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const adaptor = candidate as Partial<MathJaxAdaptor>;
  if (typeof adaptor.firstChild !== 'function' || typeof adaptor.getAttribute !== 'function') {
    return null;
  }
  return adaptor as MathJaxAdaptor;
}

function extractRenderedWidth(rendered: RenderedMathNode | null | undefined, adaptor: MathJaxAdaptor | null): number {
  if (!rendered) {
    return 0;
  }

  if (adaptor) {
    const svg = adaptor.firstChild(rendered);
    const width = readViewBoxWidth(svg, adaptor);
    if (width > 0) {
      return width;
    }
  }

  if (typeof rendered.querySelector === 'function') {
    const svg = rendered.querySelector('svg');
    if (svg) {
      return readViewBoxWidth(svg, null);
    }
  }

  if (rendered.firstElementChild) {
    const width = readViewBoxWidth(rendered.firstElementChild, null);
    if (width > 0) {
      return width;
    }
  }

  return readViewBoxWidth(rendered, null);
}

type Tex2Svg = (tex: string, options?: { display?: boolean }) => RenderedMathNode | Promise<RenderedMathNode>;

function getTex2Svg(outputJax: unknown): Tex2Svg | null {
  const runtime = asOutputJaxLike(outputJax);
  const candidates = [
    runtime,
    runtime?.mathjax,
    runtime?.constructor?.mathjax,
    (globalThis as { MathJax?: MathJaxRuntime }).MathJax,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const tex2svg = candidate.tex2svg;
    if (typeof tex2svg === 'function') {
      return tex2svg.bind(candidate);
    }
  }

  return null;
}

async function measureTexWidth(tex2svg: Tex2Svg, tex: string): Promise<number> {
  const rendered = await Promise.resolve(tex2svg(tex, { display: false }));
  return extractRenderedWidth(rendered, getMathJaxAdaptor());
}

function stabilizeMathContentForMeasurement(prefix: string): string {
  // Reuse delimiter-balancing logic by entering math mode with a synthetic '$',
  // then strip the outer delimiters before measuring via tex2svg().
  const wrapped = `$${prefix}`;
  const stabilizedWrapped = stabilizePrefixForMeasurement(wrapped);
  let stabilized = stabilizedWrapped;
  if (stabilized.startsWith('$')) {
    stabilized = stabilized.slice(1);
  }
  if (stabilized.endsWith('$')) {
    stabilized = stabilized.slice(0, -1);
  }
  return stabilized;
}

function toInlineMathMeasurementTeX(content: string): string {
  return `\\textstyle{${content}}`;
}

export function seedPrefixWidthTable(length: number, totalWidth: number): number[] {
  const table = Array.from<number>({ length: length + 1 }).fill(Number.NaN);
  table[0] = 0;
  table[length] = totalWidth;
  return table;
}

export function finalizePrefixWidthTable(table: number[], totalWidth: number): number[] {
  const lastIndex = table.length - 1;
  if (lastIndex < 0) {
    return [];
  }

  const boundedTotal = Number.isFinite(totalWidth) && totalWidth > 0 ? totalWidth : 0;
  table[0] = 0;
  table[lastIndex] = boundedTotal;

  let previous = 0;
  for (let cursor = 1; cursor < lastIndex; cursor++) {
    const raw = table[cursor];
    const normalized = Number.isFinite(raw) ? Number(raw) : previous;
    const clamped = clamp(normalized, previous, boundedTotal);
    table[cursor] = clamped;
    previous = clamped;
  }

  return table;
}

export function readPrefixUnitsFromTable(
  index: number,
  sourceLength: number,
  totalWidth: number,
  table: number[]
): number {
  if (sourceLength === 0 || index <= 0) {
    return 0;
  }

  const normalized = normalizeIndex(index, sourceLength);
  if (Array.isArray(table) && table.length === sourceLength + 1) {
    const measured = table[normalized];
    if (Number.isFinite(measured)) {
      return Number(measured);
    }
  }

  return totalWidth * (normalized / sourceLength);
}

export function findNearestPrefixIndexFromTable(
  targetUnits: number,
  sourceLength: number,
  totalWidth: number,
  table: number[]
): number {
  if (sourceLength === 0 || totalWidth <= 0) {
    return 0;
  }

  const boundedTarget = clamp(targetUnits, 0, totalWidth);
  if (!Array.isArray(table) || table.length !== sourceLength + 1) {
    return normalizeIndex(Math.round((boundedTarget / totalWidth) * sourceLength), sourceLength);
  }

  let low = 0;
  let high = sourceLength;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const widthAtMid = Number(table[mid]) || 0;
    if (widthAtMid < boundedTarget) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const rightIndex = clamp(low, 0, sourceLength);
  const leftIndex = clamp(rightIndex - 1, 0, sourceLength);
  const leftDistance = Math.abs((Number(table[leftIndex]) || 0) - boundedTarget);
  const rightDistance = Math.abs((Number(table[rightIndex]) || totalWidth) - boundedTarget);
  return leftDistance <= rightDistance ? leftIndex : rightIndex;
}

export function normalizeMathSourceForCache(
  delimiter: MathDelimiterKind,
  content: string
): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  return `${delimiter}:${normalizedContent}`;
}

async function buildMeasuredPrefixWidths(
  outputJax: unknown,
  span: MathSourceSpan
): Promise<number[]> {
  const tex2svg = getTex2Svg(outputJax);
  if (!tex2svg) {
    throw new Error('No tex2svg() runtime is available on outputJax or global MathJax.');
  }

  const content = span.content;
  const table = seedPrefixWidthTable(content.length, 0);
  const measuredWidths = new Map<number, number>();

  for (let i = 1; i <= content.length; i++) {
    const extendedEnd = extendTeXControlWordPrefixEnd(content, i);
    const cached = measuredWidths.get(extendedEnd);
    if (cached !== undefined) {
      table[i] = cached;
      continue;
    }

    const prefix = content.slice(0, extendedEnd);
    const stabilized = stabilizeMathContentForMeasurement(prefix);
    let measured: number;
    try {
      measured = await measureTexWidth(tex2svg, toInlineMathMeasurementTeX(stabilized));
    } catch {
      measured = Number.NaN;
    }
    measuredWidths.set(extendedEnd, measured);
    table[i] = measured;
  }

  finalizePrefixWidthTable(table, table[content.length] ?? 0);

  const total = table[content.length] ?? 0;
  if (total > 0) {
    return table.map((entry) => clamp(entry / total, 0, 1));
  }

  const fallback = Array.from({ length: content.length + 1 }, () => 0);
  for (let i = 0; i <= content.length; i++) {
    fallback[i] = content.length > 0 ? i / content.length : 0;
  }
  return fallback;
}

export function createMathPrefixCache(limit = DEFAULT_PREFIX_CACHE_LIMIT): MathPrefixCache {
  const tableByKey = new Map<string, Promise<number[]>>();

  const touch = (key: string, value: Promise<number[]>) => {
    tableByKey.delete(key);
    tableByKey.set(key, value);
    while (tableByKey.size > limit) {
      const oldest = tableByKey.keys().next();
      if (oldest.done) {
        break;
      }
      tableByKey.delete(oldest.value);
    }
  };

  return {
    async getOrBuild(outputJax: unknown, span: MathSourceSpan): Promise<number[]> {
      const key = normalizeMathSourceForCache(span.delimiter, span.content);
      const cached = tableByKey.get(key);
      if (cached) {
        touch(key, cached);
        return cached;
      }

      const pending = buildMeasuredPrefixWidths(outputJax, span)
        .then((table) => {
          return table;
        })
        .catch((error) => {
          tableByKey.delete(key);
          throw error;
        });

      touch(key, pending);
      return pending;
    },
  };
}

function asOutputJaxLike(value: unknown): OutputJaxLike | null {
  return value && typeof value === 'object' ? value : null;
}
