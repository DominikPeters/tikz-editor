import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import type { EditHandle, SceneElement } from "./types.js";
import type { StyleChainEntry } from "./style-chain.js";
import { inheritSceneGeometry } from "./geometry-identity.js";

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
        ? entry : { ...entry, ...(sourceRef === undefined ? {} : { sourceRef: sourceRef }), rawOptions };
    });
    const bound = result.every((entry, index) => entry === chain[index]) ? chain : result;
    rebound.set(chain, bound);
    return bound;
  }

  function element(element: SceneElement): SceneElement {
    return inheritSceneGeometry(element, {
      ...element,
      sourceRef: metadata(element.sourceRef),
      styleChain: styleChain(element.styleChain),
      ...(element.matrixCell && { matrixCell: metadata(element.matrixCell) }),
      ...(element.treeChild && { treeChild: metadata(element.treeChild) }),
      ...(element.adornment && { adornment: metadata(element.adornment) }),
      ...(element.origin && { origin: metadata(element.origin) }),
      ...(element.clipChain && { clipChain: element.clipChain.map(clip => ({ ...clip, sourceRef: metadata(clip.sourceRef) })) }),
      ...(element.kind === "Text" && element.textSourceSpan && { textSourceSpan: resolveSpan(element.textSourceSpan) })
    });
  }

  function handle(handle: EditHandle): EditHandle {
    return { ...handle, sourceRef: metadata(handle.sourceRef) };
  }

  return { element, handle, metadata };
}

/**
 * The least span holding every source location a binder would move in these
 * elements and diagnostics, and `span`. While a source transition leaves it
 * where it was, none of them moves and binding would change nothing.
 */
export function sceneSourceExtent(elements: readonly SceneElement[], diagnostics: unknown, span: Span): Span {
  let from = span.from;
  let to = span.to;
  const seen = new WeakSet<object>();
  // As the binder's metadata: what it would resolve, it reaches.
  function visit(value: unknown): void {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.from === "number" && typeof record.to === "number" && Object.keys(record).length === 2) {
      from = Math.min(from, record.from);
      to = Math.max(to, record.to);
      return;
    }
    for (const key of Object.keys(record)) {
      if (key !== "identityRef") visit(record[key]);
    }
  }
  for (const element of elements) {
    visit(element.sourceRef);
    for (const entry of element.styleChain) {
      visit(entry.sourceRef);
      if (!entry.sourceRef?.identityRef) visit(entry.rawOptions);
    }
    visit(element.matrixCell);
    visit(element.treeChild);
    visit(element.adornment);
    visit(element.origin);
    for (const clip of element.clipChain ?? []) visit(clip.sourceRef);
    if (element.kind === "Text" && element.textSourceSpan) visit(element.textSourceSpan);
  }
  visit(diagnostics);
  return { from, to };
}
