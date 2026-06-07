export interface Ot1EncodedChar {
  readonly code: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export function encodeOt1Text(text: string, sourceStart = 0): Ot1EncodedChar[] {
  const encoded: Ot1EncodedChar[] = [];
  for (let index = 0; index < text.length; index++) {
    const localStart = index;
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      continue;
    }
    const sourceEnd = sourceStart + localStart + (codePoint > 0xffff ? 2 : 1);
    if (codePoint > 0xffff) {
      index += 1;
    }
    encoded.push({
      code: encodeOt1CodePoint(codePoint),
      sourceStart: sourceStart + localStart,
      sourceEnd,
    });
  }
  return encoded;
}

function encodeOt1CodePoint(codePoint: number): number {
  if (codePoint >= 0x20 && codePoint <= 0x7e) {
    return codePoint;
  }
  throw new Error(`Unsupported OT1 character U+${codePoint.toString(16).toUpperCase()}.`);
}
