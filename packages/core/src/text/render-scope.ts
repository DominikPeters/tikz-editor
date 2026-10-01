import type { SceneFigure } from "../semantic/types.js";
import type { NodeTextRenderScope } from "./types.js";

export function runTextRenderOperation<T>(scope: NodeTextRenderScope | undefined, operation: () => T): T {
  return scope ? scope.run(operation) : operation();
}

export function retainSceneTextLayout(scope: NodeTextRenderScope | undefined, scene: SceneFigure): void {
  if (!scope) return;
  const keys: string[] = [];
  for (const element of scene.elements) {
    if (element.kind === "Text" && element.textRenderInfo?.mode === "tex") keys.push(element.textRenderInfo.cacheKey);
  }
  scope.retain(keys);
}
