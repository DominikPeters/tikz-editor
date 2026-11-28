/**
 * The arguments of `{pgflowlevelscope}{code}` and `{pgfviewboxscope}`
 * (pgfcoretransformations.code.tex): PGF's transformation commands and
 * points, read as far as they are plain numbers and lengths.
 */
import type { WorldTransform } from "../coords/transforms.js";
import { parseLength } from "./coords/parse-length.js";
import { applyMatrix, identityMatrix, multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "./transform.js";
import { worldTransform } from "../coords/transforms.js";
import { worldPoint, type WorldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";

type Reader = { text: string; index: number };

function skipSpace(reader: Reader): void {
  while (reader.index < reader.text.length) {
    const char = reader.text.charAt(reader.index);
    if (/\s/u.test(char)) {
      reader.index += 1;
    } else if (char === "%") {
      while (reader.index < reader.text.length && reader.text.charAt(reader.index) !== "\n") reader.index += 1;
    } else {
      return;
    }
  }
}

function readCommand(reader: Reader): string | null {
  skipSpace(reader);
  const match = /^\\([A-Za-z@]+)/u.exec(reader.text.slice(reader.index));
  if (!match) return null;
  reader.index += match[0].length;
  return match[1] ?? null;
}

function readGroup(reader: Reader): string | null {
  skipSpace(reader);
  if (reader.text.charAt(reader.index) !== "{") return null;
  let depth = 0;
  for (let cursor = reader.index; cursor < reader.text.length; cursor += 1) {
    const char = reader.text.charAt(cursor);
    if (char === "\\") {
      cursor += 1;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const inner = reader.text.slice(reader.index + 1, cursor);
        reader.index = cursor + 1;
        return inner;
      }
    }
  }
  return null;
}

function readNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/u.test(trimmed)) return null;
  return Number(trimmed);
}

function readLength(raw: string | null): number | null {
  return raw === null ? null : parseLength(raw.trim(), "pt");
}

/** `\pgfpoint{x}{y}`, `\pgfpointorigin`, `\pgfpointpolar{angle}{radius}`; null for anything else. */
export function parsePgfPoint(raw: string): WorldPoint | null {
  const reader: Reader = { text: raw, index: 0 };
  const point = readPoint(reader);
  skipSpace(reader);
  return point && reader.index === raw.length ? point : null;
}

function readPoint(reader: Reader): WorldPoint | null {
  const command = readCommand(reader);
  if (command === "pgfpointorigin") return worldPoint(pt(0), pt(0));
  if (command === "pgfpoint") {
    const x = readLength(readGroup(reader));
    const y = readLength(readGroup(reader));
    return x === null || y === null ? null : worldPoint(pt(x), pt(y));
  }
  if (command === "pgfpointpolar") {
    const angle = readNumber(readGroup(reader));
    const radius = readLength(readGroup(reader));
    if (angle === null || radius === null) return null;
    const radians = (angle * Math.PI) / 180;
    return worldPoint(pt(radius * Math.cos(radians)), pt(radius * Math.sin(radians)));
  }
  return null;
}

/**
 * The transformation `code` builds from a reset matrix, as `\pgflowlevel`
 * reads it; null when the code holds anything else. PGF's commands
 * concatenate on the right: the last one acts on coordinates first.
 */
export function parsePgfTransformationCode(code: string): WorldTransform | null {
  const reader: Reader = { text: code, index: 0 };
  let matrix = identityMatrix();
  for (;;) {
    skipSpace(reader);
    if (reader.index >= code.length) return matrix;
    const command = readCommand(reader);
    if (command === "pgftransformreset") {
      matrix = identityMatrix();
      continue;
    }
    const next = command === null ? null : readTransformationCommand(command, reader);
    if (!next) return null;
    matrix = multiplyMatrix(matrix, next);
  }
}

/** One of PGF's coordinate transformation commands, with its arguments. */
function readTransformationCommand(command: string, reader: Reader): WorldTransform | null {
  const number = (): number | null => readNumber(readGroup(reader));
  switch (command) {
    case "pgftransformshift": {
      const point = readPointGroup(reader);
      return point ? translationMatrix(point.x, point.y) : null;
    }
    case "pgftransformxshift": {
      const length = readLength(readGroup(reader));
      return length === null ? null : translationMatrix(length, 0);
    }
    case "pgftransformyshift": {
      const length = readLength(readGroup(reader));
      return length === null ? null : translationMatrix(0, length);
    }
    case "pgftransformscale": {
      const factor = number();
      return factor === null ? null : scaleMatrix(factor, factor);
    }
    case "pgftransformxscale": {
      const factor = number();
      return factor === null ? null : scaleMatrix(factor, 1);
    }
    case "pgftransformyscale": {
      const factor = number();
      return factor === null ? null : scaleMatrix(1, factor);
    }
    case "pgftransformrotate": {
      const degrees = number();
      return degrees === null ? null : rotationMatrix(degrees);
    }
    case "pgftransformxslant": {
      const factor = number();
      return factor === null ? null : worldTransform(1, 0, factor, 1, 0, 0);
    }
    case "pgftransformyslant": {
      const factor = number();
      return factor === null ? null : worldTransform(1, factor, 0, 1, 0, 0);
    }
    case "pgftransformcm": {
      const [a, b, c, d] = [number(), number(), number(), number()];
      const point = readPointGroup(reader);
      return a === null || b === null || c === null || d === null || !point ? null : worldTransform(a, b, c, d, point.x, point.y);
    }
    default:
      return null;
  }
}

function readPointGroup(reader: Reader): WorldPoint | null {
  const raw = readGroup(reader);
  return raw === null ? null : parsePgfPoint(raw);
}

/**
 * `\pgfviewboxscope{ll1}{ur1}{ll2}{ur2}{meet|slice}`, with the corners in
 * canvas coordinates (the picture's transformation applied, as
 * `\pgf@pos@transform@glob` does): the source rectangle scaled uniformly and
 * centred on the target, as large as fits (`meet`) or as small as covers
 * (`slice`) (pgfsys.code.tex, `\pgfsys@viewboxmeet`).
 */
export function viewBoxTransform(
  source: readonly [WorldPoint, WorldPoint],
  target: readonly [WorldPoint, WorldPoint],
  mode: "meet" | "slice"
): WorldTransform | null {
  const sourceWidth = Math.abs(source[1].x - source[0].x);
  const sourceHeight = Math.abs(source[1].y - source[0].y);
  const targetWidth = Math.abs(target[1].x - target[0].x);
  const targetHeight = Math.abs(target[1].y - target[0].y);
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  const scale = mode === "meet" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  const sourceCenter = { x: (source[0].x + source[1].x) / 2, y: (source[0].y + source[1].y) / 2 };
  const targetCenter = { x: (target[0].x + target[1].x) / 2, y: (target[0].y + target[1].y) / 2 };
  return multiplyMatrix(
    translationMatrix(targetCenter.x, targetCenter.y),
    multiplyMatrix(scaleMatrix(scale, scale), translationMatrix(-sourceCenter.x, -sourceCenter.y))
  );
}

export { applyMatrix };
