export function lineBreakWidthAt(source: string, index: number): 0 | 1 | 2 {
  const ch = source[index];
  if (ch === "\n") {
    return 1;
  }
  if (ch !== "\r") {
    return 0;
  }
  return source[index + 1] === "\n" ? 2 : 1;
}

export function buildLineStarts(source: string): number[] {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    const lineBreakWidth = lineBreakWidthAt(source, i);
    if (lineBreakWidth === 0) {
      continue;
    }
    lineStarts.push(i + lineBreakWidth);
    i += lineBreakWidth - 1;
  }
  return lineStarts;
}

export function lineForOffset(offset: number, lineStarts: number[]): number {
  let low = 0;
  let high = lineStarts.length - 1;
  let answer = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = lineStarts[mid];
    if (start === undefined) {
      throw new Error(`Missing line start at index ${mid}`);
    }
    if (start <= offset) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer + 1;
}

export function findLineEndOffset(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length && lineBreakWidthAt(source, cursor) === 0) {
    cursor += 1;
  }
  return cursor;
}
