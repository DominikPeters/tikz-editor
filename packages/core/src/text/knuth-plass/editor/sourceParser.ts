import { requireArrayValue } from "../../../utils/collections.js";
export type MathDelimiterKind = 'dollar' | 'paren';

export interface TextSourceSpan {
  kind: 'text';
  rawStart: number;
  rawEnd: number;
  text: string;
}

export interface MathSourceSpan {
  kind: 'math';
  rawStart: number;
  rawEnd: number;
  delimiter: MathDelimiterKind;
  contentStart: number;
  contentEnd: number;
  source: string;
  content: string;
}

export type SourceSpan = TextSourceSpan | MathSourceSpan;

export interface SourceParseError {
  code: 'unclosed-math' | 'unexpected-close-delimiter';
  message: string;
  index: number;
}

export interface SourceParseResult {
  spans: SourceSpan[];
  error: SourceParseError | null;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text.charAt(i) === '\\'; i--) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

export function parseSourceSpans(sourceText: string): SourceParseResult {
  const spans: SourceSpan[] = [];
  const len = sourceText.length;
  let cursor = 0;

  while (cursor < len) {
    const char = sourceText.charAt(cursor);

    if (char === '\\' && sourceText.charAt(cursor + 1) === ')' && !isEscaped(sourceText, cursor)) {
      return {
        spans: [],
        error: {
          code: 'unexpected-close-delimiter',
          message: 'Encountered closing \\) without matching opening \\(.',
          index: cursor,
        },
      };
    }

    const startsParenMath =
      char === '\\' &&
      sourceText.charAt(cursor + 1) === '(' &&
      !isEscaped(sourceText, cursor);
    const startsDollarMath = char === '$' && !isEscaped(sourceText, cursor);

    if (!startsParenMath && !startsDollarMath) {
      cursor += 1;
      continue;
    }

    if (cursor > 0) {
      const previous = spans.at(-1);
      const previousEnd = previous ? previous.rawEnd : 0;
      if (cursor > previousEnd) {
        spans.push({
          kind: 'text',
          rawStart: previousEnd,
          rawEnd: cursor,
          text: sourceText.slice(previousEnd, cursor),
        });
      }
    }

    if (!spans.length && cursor > 0) {
      spans.push({
        kind: 'text',
        rawStart: 0,
        rawEnd: cursor,
        text: sourceText.slice(0, cursor),
      });
    }

    const delimiter: MathDelimiterKind = startsParenMath ? 'paren' : 'dollar';
    const openLength = delimiter === 'paren' ? 2 : 1;
    const closeLength = delimiter === 'paren' ? 2 : 1;
    const rawStart = cursor;
    const contentStart = rawStart + openLength;

    let end = -1;
    let i = contentStart;
    while (i < len) {
      if (delimiter === 'dollar') {
        if (sourceText.charAt(i) === '$' && !isEscaped(sourceText, i)) {
          end = i + closeLength;
          break;
        }
        i += 1;
        continue;
      }

      if (
        sourceText.charAt(i) === '\\' &&
        sourceText.charAt(i + 1) === ')' &&
        !isEscaped(sourceText, i)
      ) {
        end = i + closeLength;
        break;
      }
      i += 1;
    }

    if (end < 0) {
      return {
        spans: [],
        error: {
          code: 'unclosed-math',
          message:
            delimiter === 'dollar'
              ? 'Encountered opening $ without closing $. '
              : 'Encountered opening \\( without closing \\).',
          index: rawStart,
        },
      };
    }

    const contentEnd = end - closeLength;
    spans.push({
      kind: 'math',
      rawStart,
      rawEnd: end,
      delimiter,
      contentStart,
      contentEnd,
      source: sourceText.slice(rawStart, end),
      content: sourceText.slice(contentStart, contentEnd),
    });

    cursor = end;
  }

  const finalEnd = spans.length ? requireArrayValue(spans, spans.length - 1).rawEnd : 0;
  if (finalEnd < len) {
    spans.push({
      kind: 'text',
      rawStart: finalEnd,
      rawEnd: len,
      text: sourceText.slice(finalEnd),
    });
  }

  return { spans, error: null };
}
