export interface Ot1EncodedChar {
  readonly code: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export function encodeOt1Text(
  text: string,
  sourceStart = 0,
  sourceEndOverride?: number
): Ot1EncodedChar[] {
  const encoded: Ot1EncodedChar[] = [];
  for (let index = 0; index < text.length;) {
    const localStart = index;
    const ascii = text.charCodeAt(index);
    if (ascii >= 0x20 && ascii <= 0x7e && !isCombiningMark(text.charCodeAt(index + 1))) {
      // A standalone ASCII character is already NFC. Keep the cluster path
      // below for letters followed by combining marks and for Unicode input.
      index += 1;
      encoded.push({
        code: ascii,
        sourceStart: sourceStart + localStart,
        sourceEnd: sourceEndOverride !== undefined && localStart === 0 && index === text.length
          ? sourceEndOverride
          : sourceStart + index,
      });
      continue;
    }
    const firstCodePoint = text.codePointAt(index);
    if (firstCodePoint === undefined) {
      break;
    }
    index += firstCodePoint > 0xffff ? 2 : 1;
    // LuaLaTeX/OpenType composes the common `letter + combining mark` input
    // before glyph selection.  Keep the whole source cluster attached to the
    // resulting glyph so caret and hit-test ranges remain honest.
    while (index < text.length) {
      const next = text.codePointAt(index);
      if (next === undefined || !isCombiningMark(next)) {
        break;
      }
      index += next > 0xffff ? 2 : 1;
    }
    const cluster = text.slice(localStart, index).normalize("NFC");
    const clusterSourceEnd =
      sourceEndOverride !== undefined && localStart === 0 && index === text.length
        ? sourceEndOverride
        : sourceStart + index;
    for (const char of cluster) {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) {
        continue;
      }
      encoded.push({
        code: encodeOt1CodePoint(codePoint),
        sourceStart: sourceStart + localStart,
        sourceEnd: clusterSourceEnd,
      });
    }
  }
  return encoded;
}

function encodeOt1CodePoint(codePoint: number): number {
  if (codePoint === 0xa0) {
    return 0x20;
  }
  if (codePoint >= 0x20 && codePoint <= 0x10ffff) {
    return codePoint;
  }
  throw new Error(`Unsupported OT1 character U+${codePoint.toString(16).toUpperCase()}.`);
}

function isCombiningMark(codePoint: number): boolean {
  return (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f);
}
