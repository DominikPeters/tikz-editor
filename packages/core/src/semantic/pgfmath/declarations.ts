import type { PgfMathDeclaredFunction } from "./compile.js";

/**
 * Read the value of `/pgf/declare function`: `f(\x)=\x*\x; g(\a,\b)=\a+\b; c=3;`.
 *
 * As `\pgfmath@local@functions` does: definitions end at `;`, the name runs
 * to `(` or `=` (spaces dropped), parameters are macros separated by commas,
 * and the body is everything after the first `=`. Returns null when a
 * definition is malformed.
 */
export function parsePgfMathFunctionDeclarations(raw: string): PgfMathDeclaredFunction[] | null {
  const value = stripOuterBraces(raw.trim());
  const definitions: PgfMathDeclaredFunction[] = [];
  for (const chunk of splitTopLevel(value, ";")) {
    if (chunk.trim().length === 0) {
      continue;
    }
    const equals = indexOfTopLevel(chunk, "=");
    if (equals < 0) {
      return null;
    }
    const head = chunk.slice(0, equals).replace(/\s+/gu, "");
    const body = chunk.slice(equals + 1).trim();
    const open = head.indexOf("(");
    const name = open < 0 ? head : head.slice(0, open);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || body.length === 0) {
      return null;
    }
    let params: string[] = [];
    if (open >= 0) {
      if (!head.endsWith(")")) {
        return null;
      }
      const inner = head.slice(open + 1, -1);
      params = inner.length === 0 ? [] : inner.split(",");
      if (params.some((param) => !/^\\[A-Za-z@]+$/u.test(param))) {
        return null;
      }
    }
    definitions.push({ name, params, body });
  }
  return definitions;
}

/** Serialize declared functions so equal scopes share compiled code. */
export function pgfMathFunctionsSignature(functions: ReadonlyMap<string, PgfMathDeclaredFunction> | undefined): string {
  if (!functions || functions.size === 0) {
    return "";
  }
  let signature = "";
  for (const definition of functions.values()) {
    signature += `${definition.name}(${definition.params.join(",")})=${definition.body};`;
  }
  return signature;
}

function stripOuterBraces(value: string): string {
  let current = value;
  while (current.startsWith("{") && current.endsWith("}")) {
    let depth = 0;
    let balanced = true;
    for (const char of current.slice(1, -1)) {
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth < 0) {
        balanced = false;
        break;
      }
    }
    if (!balanced || depth !== 0) {
      break;
    }
    current = current.slice(1, -1).trim();
  }
  return current;
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function indexOfTopLevel(value: string, target: string): number {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (char === target && depth === 0) {
      return index;
    }
  }
  return -1;
}
