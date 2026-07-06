import { parseTikz, type ParseTikzOptions } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure, type EvaluateTikzResult } from "../../packages/core/src/semantic/evaluate.js";
import type { SceneElement } from "../../packages/core/src/semantic/types.js";

export function evaluateSemantic(
  source: string,
  options?: Parameters<typeof evaluateTikzFigure>[2],
  parseOptions?: ParseTikzOptions
): EvaluateTikzResult {
  const parsed = parseTikz(source, parseOptions);
  return evaluateTikzFigure(parsed.figure, source, options);
}

export function firstElementOfKind<K extends SceneElement["kind"]>(
  elements: readonly SceneElement[],
  kind: K
): Extract<SceneElement, { kind: K }> | undefined {
  return elements.find((element): element is Extract<SceneElement, { kind: K }> => element.kind === kind);
}

export function elementsOfKind<K extends SceneElement["kind"]>(
  elements: readonly SceneElement[],
  kind: K
): Array<Extract<SceneElement, { kind: K }>> {
  return elements.filter((element): element is Extract<SceneElement, { kind: K }> => element.kind === kind);
}
