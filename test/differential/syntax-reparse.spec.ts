import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Tree } from "@lezer/common";
import { beamerDocumentParser } from "@tikz-editor/lezer-tex";
import { buildTexSyntaxIndex, type TexSyntaxIndex } from "../../packages/core/src/text/tex/syntax-index.js";
import { longDeck, makeRng } from "./compute-fuzz.js";

// A deck's syntax index reparses from the previous one; its tree must be the
// one a fresh parse of the same text gives, while masks (as canvas text edits
// and notes apply) appear, move and vanish. Only an error-free tree is
// checked: how Lezer recovers from an error depends on what it reused, even
// before the error, so a broken text's reparse can differ from a fresh parse.
// Scale with SYNTAX_FUZZ_CASES / SYNTAX_FUZZ_SEED.
const CASES = Number(process.env.SYNTAX_FUZZ_CASES ?? 60);
const SEED = Number(process.env.SYNTAX_FUZZ_SEED ?? 1);

function texFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? texFiles(path) : path.endsWith(".tex") ? [path] : [];
  });
}

function containsError(tree: Tree): boolean {
  let found = false;
  tree.iterate({ enter: (node) => { if (node.type.isError) found = true; return !found; } });
  return found;
}

// Lezer reuses only whole subtrees, which short decks lack: join the bodies
// of the beamer fixtures that parse cleanly into one long deck, and repeat a small one.
function bundle(): string {
  const bodies = texFiles("test/fixtures/beamer").map((path) => readFileSync(path, "utf8"))
    .filter((source) => source.includes("\\begin{document}") && !containsError(beamerDocumentParser.parse(source)))
    .map((source) => source.slice(source.indexOf("\\begin{document}") + "\\begin{document}".length, source.lastIndexOf("\\end{document}")));
  return `\\documentclass{beamer}\n\\begin{document}${bodies.join("\n")}\\end{document}\n`;
}

const DOCUMENTS = [
  bundle(),
  longDeck({ label: "deck", source: readFileSync("test/fixtures/differential/mixed-deck.tex", "utf8") }, 25).source
];

// Balanced pieces keep a clean text clean; wild ones break it.
const BALANCED = ["x", " ", "\n", "{x}", "[a]", "$x$", "\\[x\\]", "\\(x\\)", "\\item", "%c\n", "\\only<2>{x}", "\\note{x}",
  "\\begin{itemize}\\item a\\end{itemize}", "\\end{frame}\n\\begin{frame}", "\\begin{verbatim}x\\end{verbatim}"];
const WILD = ["{", "}", "[", "]", "<", ">", "$", "$$", "\\", "%", "&", "^", "_",
  "\\begin{itemize}", "\\end{itemize}", "\\begin{frame}", "\\end{frame}", "\\[", "\\]", "\\(", "\\)",
  "\\only<2>{", "\\note{", "\\begin{verbatim}", "\\end{verbatim}", "\\begin{align}", "\\end{align}"];

type Span = { from: number; to: number };

function edit(source: string, rng: () => number): string {
  const at = Math.floor(rng() * source.length);
  if (rng() < 0.85) return source.slice(0, at) + BALANCED[Math.floor(rng() * BALANCED.length)] + source.slice(at);
  const removed = rng() < 0.4 ? Math.floor(rng() * 12) : 0;
  const inserted = rng() < 0.7 ? WILD[Math.floor(rng() * WILD.length)] : "";
  return source.slice(0, at) + inserted + source.slice(Math.min(source.length, at + removed));
}

/** The inside of a random group, as note bodies and canvas text edits are masked. */
function groupInterior(source: string, rng: () => number): Span | null {
  const open = source.indexOf("{", Math.floor(rng() * source.length));
  if (open < 0) return null;
  for (let at = open + 1, depth = 1; at < source.length; at += 1) {
    if (source[at] === "\\") at += 1;
    else if (source[at] === "{") depth += 1;
    else if (source[at] === "}" && --depth === 0) return at > open + 1 ? { from: open + 1, to: at } : null;
  }
  return null;
}

function mask(source: string, masks: readonly Span[]): string {
  let result = source;
  for (const { from, to } of masks) {
    const end = Math.min(result.length, to);
    if (from < end) result = result.slice(0, from) + result.slice(from, end).replace(/[^\n]/gu, " ") + result.slice(end);
  }
  return result;
}

function nextMasks(source: string, masks: Span[], rng: () => number): Span[] {
  const roll = rng();
  if (roll < 0.25) {
    const span = groupInterior(source, rng);
    return span ? [...masks, span] : masks;
  }
  if (roll < 0.4) return masks.slice(1);
  return masks;
}

describe("syntax index reparse", () => {
  it("gives the tree of a fresh parse after edits and mask changes", () => {
    const rng = makeRng(SEED);
    let checked = 0;
    for (let index = 0; index < CASES; index += 1) {
      let source = DOCUMENTS[index % DOCUMENTS.length];
      let masks: Span[] = [];
      let previous: TexSyntaxIndex = buildTexSyntaxIndex(source, beamerDocumentParser);
      for (let step = 0; step < 6; step += 1) {
        const [before, masksBefore] = [source, masks];
        for (let edits = 1 + Math.floor(rng() * 2); edits > 0; edits -= 1) source = edit(source, rng);
        masks = nextMasks(source, masks, rng);
        const parseSource = mask(source, masks);
        const reparsed = buildTexSyntaxIndex(source, beamerDocumentParser, { parseSource, previous });
        const fresh = beamerDocumentParser.parse(parseSource);
        if (!containsError(fresh)) {
          expect(reparsed.tree.toString(), `seed ${SEED}, case ${index}, step ${step}`).toBe(fresh.toString());
          checked += 1;
        } else if (rng() < 0.7) {
          // Usually the breakage is undone next, reparsing a broken tree into clean text.
          [source, masks] = [before, masksBefore];
        }
        previous = reparsed;
      }
    }
    if (process.env.SYNTAX_FUZZ_VERBOSE) console.log({ checked, reparses: CASES * 6 });
    expect(checked, "too few reparses gave an error-free tree to check").toBeGreaterThan(CASES);
  }, 300_000);
});
