import type { EditParseOptions } from "../parse-options.js";
import { resolvePropertyTarget, type PropertyTargetResolution } from "../property-target.js";

export type InspectorTargetResolver = (targetId: string) => PropertyTargetResolution;

export function createInspectorTargetResolver(
  source: string,
  parseOptions: EditParseOptions = {}
): InspectorTargetResolver {
  const cache = new Map<string, PropertyTargetResolution>();
  return (targetId: string) => {
    const cached = cache.get(targetId);
    if (cached) {
      return cached;
    }
    const resolved = resolvePropertyTarget(source, targetId, parseOptions);
    cache.set(targetId, resolved);
    return resolved;
  };
}
