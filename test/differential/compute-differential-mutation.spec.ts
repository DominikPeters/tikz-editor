import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { generateOps, longDeck, runOps, type FuzzDocument } from "./compute-fuzz.js";
import { freshComputeModule, type ModuleMock } from "./compute-instances.js";

// Each sabotage breaks one shortcut the way a real bug would. The fuzzer must
// catch every one within a small budget, or it is not reaching that shortcut
// or not checking what the shortcut produces.

const fixture = (path: string): FuzzDocument => ({ label: path, source: readFileSync(`test/fixtures/${path}`, "utf8") });
const tikz = [fixture("differential/node-graph.tex")];
const deck = [fixture("differential/mixed-deck.tex")];
const long = [longDeck(fixture("differential/mixed-deck.tex"), 25)];
const layers = [fixture("beamer/overlay-pictures-fidelity/pictures.tex"), fixture("beamer/overlay-pictures-fidelity/drawing-layer-tikzlayer.tex")];

type Sabotage = { name: string; documents: FuzzDocument[]; mocks: ModuleMock[] };

const SABOTAGES: Sabotage[] = [
  {
    name: "SVG reuse keeps the old markup of changed elements",
    documents: tikz,
    mocks: [{
      path: "../../packages/core/src/svg/index.js",
      factory: async (importOriginal) => {
        const original = await importOriginal() as typeof import("../../packages/core/src/svg/index.js");
        return { ...original, emitSvg: ((scene, options) => original.emitSvg(scene, options?.reuse
          ? { ...options, reuse: { ...options.reuse, affectedSourceIds: ["(nothing)"] } } : options)) as typeof original.emitSvg };
      }
    }]
  },
  {
    name: "invalidation forgets the statements that depend on a changed one",
    documents: tikz,
    mocks: [{
      path: "../../packages/core/src/semantic/dependencies.js",
      factory: async (importOriginal) => {
        const original = await importOriginal() as typeof import("../../packages/core/src/semantic/dependencies.js");
        // Only the changed statements are affected; edges to a moved node keep their old ends.
        return { ...original, collectGeometryInvalidation: ((graph, query) => {
          const result = original.collectGeometryInvalidation(graph, query);
          return { ...result, affectedSourceIds: result.affectedSourceIds.filter((id) => query.changedSourceIds.includes(id)) };
        }) as typeof original.collectGeometryInvalidation };
      }
    }]
  },
  {
    name: "a deck reparses from its previous tree as if nothing had changed",
    documents: long,
    mocks: [{
      path: "../../packages/core/src/text/tex/syntax-index.js",
      factory: async (importOriginal) => {
        const original = await importOriginal() as typeof import("../../packages/core/src/text/tex/syntax-index.js");
        return { ...original, buildTexSyntaxIndex: ((source, parser, options = {}) => original.buildTexSyntaxIndex(source, parser, options.previous
          // The previous parse claims the new text, so Lezer reuses its subtrees at their old offsets.
          ? { ...options, previous: { ...options.previous, parseSource: options.parseSource ?? source } }
          : options)) as typeof original.buildTexSyntaxIndex };
      }
    }]
  },
  {
    name: "the shared syntax index cache is keyed too coarsely",
    documents: deck,
    mocks: [{
      path: "../../packages/core/src/text/tex/syntax-index.js",
      factory: async (importOriginal) => {
        const original = await importOriginal() as typeof import("../../packages/core/src/text/tex/syntax-index.js");
        const byLength = new Map<string, ReturnType<typeof original.getTexSyntaxIndex>>();
        return { ...original, getTexSyntaxIndex: ((source, parser) => {
          // Keyed by length, as if lengths identified texts: a same-length edit gets the old index.
          const key = `${source.length}`;
          const cached = byLength.get(key);
          if (cached) return cached;
          const index = original.getTexSyntaxIndex(source, parser);
          byLength.set(key, index);
          return index;
        }) as typeof original.getTexSyntaxIndex };
      }
    }]
  },
  {
    name: "a slide laid out under a drawing layer stands after the layer changes length",
    documents: layers,
    mocks: [{
      path: "../../packages/app/src/beamer-overlay-page.js",
      factory: async (importOriginal) => {
        const original = await importOriginal() as typeof import("../../packages/app/src/beamer-overlay-page.js");
        // Offsets after the layer then point where its old end was.
        return { ...original, undrawnLayerPageStands: ((before, source, span) =>
          before.source.slice(0, before.span.from) === source.slice(0, span.from) &&
          before.source.slice(before.span.to) === source.slice(span.to)) as typeof original.undrawnLayerPageStands };
      }
    }]
  },
  {
    name: "the deck page cache ignores the overlay step",
    documents: deck,
    mocks: [{
      path: "../../packages/app/src/bounded-lru.js",
      factory: async (importOriginal) => {
        const original = await importOriginal() as typeof import("../../packages/app/src/bounded-lru.js");
        const firstStep = (key: unknown) => typeof key === "string" ? key.replace(/:\d+$/u, ":1") : key;
        class SabotagedLru<K, V> extends original.BoundedLru<K, V> {
          override get(key: K): V | undefined { return super.get(firstStep(key) as K); }
          override set(key: K, value: V, weight: number): void { super.set(firstStep(key) as K, value, weight); }
          override fork(): SabotagedLru<K, V> {
            const copy = new SabotagedLru<K, V>(this.maxEntries, this.maxBytes);
            Object.assign(copy, { entries: new Map((this as unknown as { entries: Map<K, unknown> }).entries), bytes: this.retainedBytes });
            return copy;
          }
        }
        return { ...original, BoundedLru: SabotagedLru };
      }
    }]
  }
];

describe("compute differential fuzzer catches sabotaged shortcuts", () => {
  for (const sabotage of SABOTAGES) {
    it(sabotage.name, async () => {
      let caught = false;
      for (let seed = 1; seed <= 6 && !caught; seed += 1) {
        const ops = await generateOps(sabotage.documents, 7000 + seed, 24);
        const result = await runOps(sabotage.documents, ops, () => freshComputeModule(sabotage.mocks));
        if (result.failure?.what === "threw" && process.env.COMPUTE_FUZZ_VERBOSE) console.log(result.failure.differences[0]);
        caught = result.failure != null && result.failure.what !== "threw";
      }
      expect(caught).toBe(true);
    }, 600_000);
  }
});
