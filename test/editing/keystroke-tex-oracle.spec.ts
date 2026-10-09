import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { formatMarkedSource } from "../../packages/core/src/editing/testing/index.js";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { createCommandTable } from "../../packages/core/src/editing/commands/table.js";
import { MULTI_TOKEN_SYMBOLS } from "../../packages/core/src/editing/operations/command.js";
import { beamerCorpusScopes } from "./beamer-corpus.js";
import { corpusStarts, createRandom, generateCase, runCase, type FuzzCase, type FuzzRun, type FuzzStart } from "./fuzz/keystroke-fuzz.js";
import { compileDeck, errorKey, lualatexAvailable, newErrors, oneFrameDeck, pooled, type Compilation, type TexError } from "./fuzz/tex-oracle.js";

/**
 * Keystroke fuzzing with LuaLaTeX as the oracle: the end state of every
 * random key sequence, put back into its frame and compiled (the deck cut
 * down to that frame), must not report an error the unedited frame does
 * not. A failing end state is
 * traced back to the key that introduced the error.
 *
 * Opt-in, as it needs TeX and compiles a deck per case:
 *   KEYSTROKE_TEX_ORACLE=1 npx vitest run test/editing/keystroke-tex-oracle.spec.ts
 * with KEYSTROKE_FUZZ_CASES, KEYSTROKE_FUZZ_SEED and KEYSTROKE_TEX_JOBS
 * (parallel compiles).
 */
const ENABLED = process.env.KEYSTROKE_TEX_ORACLE === "1" && lualatexAvailable();
const CASES = Number(process.env.KEYSTROKE_FUZZ_CASES ?? 100);
const SEED = Number(process.env.KEYSTROKE_FUZZ_SEED ?? 20261009);
const JOBS = Number(process.env.KEYSTROKE_TEX_JOBS ?? Math.max(1, os.cpus().length - 2));

/**
 * Commands the fuzzer types that the decks do not define: as the author's
 * own macros would be, they are defined before the document starts.
 */
const AUTHOR_MACROS = ["\\foo", "\\setm", "\\te"].map((name) => `\\providecommand{${name}}{}`).join("");

/** The deck cut down to the start's frame, with the buffer `text` in place of the start's (or as it is). */
function inDeck(start: FuzzStart, text?: string): string {
  const { source, span, frames, frame } = start.deck!;
  return oneFrameDeck(source, frames, frame, text == null ? undefined : { ...span, text })
    .replace("\\begin{document}", `${AUTHOR_MACROS}\n\\begin{document}`);
}

function editorErrors(baseline: Compilation, compiled: Compilation): TexError[] {
  const errors = newErrors(baseline.errors, compiled.errors);
  return compiled.timedOut && !baseline.timedOut ? [{ message: "compilation timed out", name: null, line: null, context: "" }, ...errors] : errors;
}

/** Finds the first state with one of `keys` (states only get the error once it is introduced, so bisect). */
async function firstFailingState(
  fuzz: FuzzCase,
  run: FuzzRun,
  baseline: Compilation,
  keys: ReadonlySet<string>
): Promise<number> {
  const fails = async (index: number) => {
    const compiled = await compileDeck(inDeck(fuzz.start, run.states[index]), fuzz.start.deck!.path);
    return editorErrors(baseline, compiled).some((error) => keys.has(errorKey(error)));
  };
  let low = 0;
  let high = run.states.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (await fails(middle)) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

function describeTexFailure(index: number, fuzz: FuzzCase, run: FuzzRun, step: number, errors: readonly TexError[]): string {
  const before = step === 0 ? fuzz.start.text : run.states[step - 1];
  return [
    `case ${index}: ${errors.map((error) => `${error.message}${error.name ? ` ${error.name}` : ""}`).join("; ")}`,
    ...errors.slice(0, 2).map((error) => `  at: l.${error.line ?? "?"} ${error.context}`),
    `  start: ${fuzz.start.label}`,
    `  keys: ${JSON.stringify(run.tokens.slice(0, step + 1).join(" "))} (the last one introduced it)`,
    `  body: ${JSON.stringify(formatMarkedSource(fuzz.start.text, { anchor: fuzz.anchor, focus: fuzz.focus }))}`,
    `  before: ${JSON.stringify(before)}`,
    `  after: ${JSON.stringify(run.states[step])}`,
  ].join("\n");
}

/**
 * Commands the editor does not know, by name: the fuzzer commits names
 * cut short (`\sum` ⌫ → `\su`), which the canvas shows as unknown (T5).
 * TeX cannot judge those, nor what follows them.
 */
function unknownCommands(start: FuzzStart, text: string): string[] {
  const tree = buildEditTree(text, { commands: start.commands });
  return tree.nodes.filter((node) => {
    if (node.kind !== "atom" || node.command == null || node.parent == null) {
      return false;
    }
    const mode = tree.slots[node.parent].mode;
    return start.commands.command(node.command, mode === "verbatim" ? "text" : mode) == null;
  }).map((node) => node.command!);
}

/**
 * Value arguments (file names, colours, URLs, options, overlay specs) as
 * written. A new one is an in-place edit of a value, or one left empty
 * (`\includegraphics{}`, input O8's pickers are to finish): TeX judges
 * those by what they mean, not by how the editor wrote them.
 */
function valueArguments(start: FuzzStart, text: string): string[] {
  const tree = buildEditTree(text, { commands: start.commands });
  return tree.nodes.flatMap((node) => node.values.map((value) =>
    `${node.command ?? node.kind} ${value.role} ${text.slice(value.contentSpan.from, value.contentSpan.to).trim()}`));
}

/** Whether `after` has a name `before` does not, as many times as it has it. */
function adds(before: readonly string[], after: readonly string[]): boolean {
  const left = [...before];
  return after.some((name) => {
    const index = left.indexOf(name);
    if (index >= 0) {
      left.splice(index, 1);
    }
    return index < 0;
  });
}

/**
 * Whether the end state is one TeX can judge: no new unknown commands or
 * value arguments, and a body left (an empty `[shrink]` frame divides by zero).
 */
function judgeable(start: FuzzStart, text: string): boolean {
  if (text.trim() === "") {
    return false;
  }
  return !adds(unknownCommands(start, start.text), unknownCommands(start, text)) &&
    !adds(valueArguments(start, start.text), valueArguments(start, text));
}

describe.skipIf(!ENABLED)("keystroke fuzzing against LuaLaTeX", () => {
  it(`compiles the end states of ${CASES} random key sequences without new errors`, async () => {
    const starts = corpusStarts(beamerCorpusScopes());
    const random = createRandom(SEED);
    const cases: { index: number; fuzz: FuzzCase; run: FuzzRun }[] = [];
    for (let index = 0; index < CASES; index += 1) {
      const fuzz = generateCase(random, starts, 24);
      const run = runCase(fuzz);
      // Contract failures are keystroke-fuzz.spec.ts's to report.
      if (!run.failure && run.finalText !== fuzz.start.text && judgeable(fuzz.start, run.finalText)) {
        cases.push({ index, fuzz, run });
      }
    }
    const baselines = new Map<string, Promise<Compilation>>();
    const baselineOf = (start: FuzzStart) => {
      const key = `${start.deck!.path}#${start.deck!.frame}`;
      if (!baselines.has(key)) {
        baselines.set(key, compileDeck(inDeck(start), start.deck!.path));
      }
      return baselines.get(key)!;
    };
    const failing = (
      await pooled(cases.map((entry) => async () => {
        const baseline = await baselineOf(entry.fuzz.start);
        const compiled = await compileDeck(inDeck(entry.fuzz.start, entry.run.finalText), entry.fuzz.start.deck!.path);
        return { ...entry, baseline, errors: editorErrors(baseline, compiled) };
      }), JOBS)
    ).filter((entry) => entry.errors.length > 0);
    const reports = await pooled(failing.map((entry) => async () => {
      const keys = new Set(entry.errors.map(errorKey));
      const step = await firstFailingState(entry.fuzz, entry.run, entry.baseline, keys);
      return describeTexFailure(entry.index, entry.fuzz, entry.run, step, entry.errors);
    }), JOBS);
    expect(reports.join("\n\n")).toBe("");
    // Most cases must reach a judgeable end state, or the run proves little.
    expect(cases.length).toBeGreaterThan(CASES / 2);
  }, 3_600_000);
});

describe.skipIf(!ENABLED)("TeX facts the editing rules rely on", () => {
  it("knows which math symbols a script cannot take bare", async () => {
    const table = createCommandTable();
    const symbols = table.names("math").filter((name) => {
      const schema = table.command(name, "math");
      return schema?.category === "symbol" && !schema.args.some((arg) => arg.kind === "mandatory");
    });
    const header = "\\documentclass{beamer}\n\\begin{document}\n";
    const body = symbols.map((name) => `$x^\\${name}$ $x_\\${name}$\\par`).join("\n");
    const compiled = await compileDeck(`${header}${body}\n\\end{document}\n`, path.join(os.tmpdir(), "symbols.tex"));
    const failing = new Set(compiled.errors.flatMap((error) => (error.line == null ? [] : [symbols[error.line - 3]])).filter(Boolean));
    expect([...failing].sort()).toEqual(symbols.filter((name) => MULTI_TOKEN_SYMBOLS.has(name)).sort());
  }, 120_000);
});
