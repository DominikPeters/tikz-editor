import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import type { EditHandle, SceneElement } from "./types.js";
import type { StyleChainEntry } from "./style-chain.js";

/** One document transition, never a chain of historical coordinate systems. */
export function createSourceSpanResolver(patches: readonly SourcePatch[]): (span: Span) => Span {
  const sorted = [...patches].sort((a, b) => b.oldSpan.from - a.oldSpan.from);
  return (span) => {
    let from = span.from, to = span.to;
    for (const { oldSpan: old, replacement } of sorted) {
      const delta = replacement.length - (old.to - old.from);
      if (old.to <= from) { from += delta; to += delta; }
      else if (old.from >= to) continue;
      else if (old.from >= from && old.to <= to) to += delta;
      else throw new Error("A reused source binding overlaps replaced source");
    }
    return from === span.from && to === span.to ? span : { from, to };
  };
}

/**
 * Scene envelopes expose current source locations for existing edit APIs. Only
 * their source bindings change; path commands, styles, transforms, and layout
 * are immutable payloads shared with the preceding scene.
 */
export function createSceneSourceBinder(resolveSpan: (span: Span) => Span, sourceFingerprint: string) {
  const rebound = new WeakMap<object, unknown>();

  // Used only on source metadata, never on the scene's geometry/style graph.
  function metadata<T>(value: T): T {
    if (!value || typeof value !== "object") return value;
    const known = rebound.get(value);
    if (known) return known as T;
    const record = value as Record<string, unknown>;
    if (typeof record.from === "number" && typeof record.to === "number" && Object.keys(record).length === 2) {
      const result = resolveSpan(value as unknown as Span);
      rebound.set(value, result);
      return result as T;
    }
    let result: Record<string, unknown> | undefined;
    for (const key of Object.keys(record)) {
      // Generated identity coordinates address the expansion, not the document.
      if (key === "identityRef") continue;
      const next = key === "sourceFingerprint" ? sourceFingerprint : metadata(record[key]);
      if (next !== record[key]) {
        result ??= (Array.isArray(value) ? [...value] : { ...record }) as Record<string, unknown>;
        result[key] = next;
      }
    }
    const bound = (result ?? value) as T;
    rebound.set(value, bound);
    return bound;
  }

  function styleChain(chain: StyleChainEntry[]): StyleChainEntry[] {
    const known = rebound.get(chain);
    if (known) return known as StyleChainEntry[];
    const result = chain.map(entry => {
      const sourceRef = metadata(entry.sourceRef);
      const rawOptions = entry.sourceRef?.identityRef ? entry.rawOptions : metadata(entry.rawOptions);
      return sourceRef === entry.sourceRef && rawOptions === entry.rawOptions
        ? entry : { ...entry, sourceRef, rawOptions };
    });
    const bound = result.every((entry, index) => entry === chain[index]) ? chain : result;
    rebound.set(chain, bound);
    return bound;
  }

  function element(element: SceneElement): SceneElement {
    return {
      ...element,
      sourceRef: metadata(element.sourceRef),
      styleChain: styleChain(element.styleChain),
      ...(element.matrixCell && { matrixCell: metadata(element.matrixCell) }),
      ...(element.treeChild && { treeChild: metadata(element.treeChild) }),
      ...(element.adornment && { adornment: metadata(element.adornment) }),
      ...(element.origin && { origin: metadata(element.origin) }),
      ...(element.clipChain && { clipChain: element.clipChain.map(clip => ({ ...clip, sourceRef: metadata(clip.sourceRef) })) }),
      ...(element.kind === "Text" && element.textSourceSpan && { textSourceSpan: resolveSpan(element.textSourceSpan) })
    };
  }

  function handle(handle: EditHandle): EditHandle {
    return { ...handle, sourceRef: metadata(handle.sourceRef) };
  }

  return { element, handle, metadata };
}
