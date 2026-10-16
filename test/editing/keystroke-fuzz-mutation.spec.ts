import { describe, expect, it, vi } from "vitest";
import { beamerCorpusScopes } from "./beamer-corpus.js";
import { corpusStarts, runCampaign } from "./fuzz/keystroke-fuzz.js";

/**
 * Is the keystroke fuzzer able to find anything? Each test breaks one
 * editing operation the way real bugs have (writing `$$`, dropping a
 * terminator, a deletion taking too much, a lost undo step) and requires
 * a small campaign to catch it with the expected invariant. A fuzzer that
 * stays green on these would make its green runs meaningless.
 */
const sabotage = vi.hoisted(() => ({ mutant: null as string | null }));

vi.mock("../../packages/core/src/editing/operations/insert.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/core/src/editing/operations/insert.js")>();
  return {
    ...original,
    typeCharacter: (...args: Parameters<typeof original.typeCharacter>) => {
      const outcome = original.typeCharacter(...args);
      if (outcome.kind !== "patch") {
        return outcome;
      }
      if (sabotage.mutant === "empty formula as $$" && outcome.patches.some((patch) => patch.insert === "${}$")) {
        const patches = outcome.patches.map((patch) => (patch.insert === "${}$" ? { ...patch, insert: "$$" } : patch));
        return { ...outcome, patches, caret: outcome.caret - 1, placeholder: undefined };
      }
      if (sabotage.mutant === "no terminator" && /^[A-Za-z]$/u.test(args[2])) {
        const patches = outcome.patches.map((patch) => ({ ...patch, insert: patch.insert.replace(/^(?: |\{\})(?=[A-Za-z]$)/u, "") }));
        const removed = outcome.patches.reduce((sum, patch, index) => sum + patch.insert.length - patches[index].insert.length, 0);
        return { ...outcome, patches, caret: outcome.caret - removed };
      }
      return outcome;
    },
  };
});

vi.mock("../../packages/core/src/editing/operations/delete.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/core/src/editing/operations/delete.js")>();
  return {
    ...original,
    deleteBackward: (...args: Parameters<typeof original.deleteBackward>) => {
      const outcome = original.deleteBackward(...args);
      if (sabotage.mutant === "⌫ takes two" && outcome.kind === "patch" && outcome.patches.length === 1) {
        const [patch] = outcome.patches;
        if (patch.insert === "" && patch.to - patch.from === 1 && patch.from > 0) {
          return { ...outcome, patches: [{ ...patch, from: patch.from - 1 }], caret: outcome.caret - 1 };
        }
      }
      return outcome;
    },
    deleteRange: (...args: Parameters<typeof original.deleteRange>) => {
      const [view, start, end, insert = ""] = args;
      if (sabotage.mutant === "range deletion ignores structure") {
        const from = view.offset(start);
        const to = view.offset(end);
        return to > from
          ? { kind: "patch" as const, patches: [{ from, to, insert }], caret: from + insert.length, run: null }
          : { kind: "none" as const };
      }
      return original.deleteRange(...args);
    },
  };
});

vi.mock("../../packages/core/src/editing/operations/lists.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/core/src/editing/operations/lists.js")>();
  return {
    ...original,
    mergeWithPreviousItemPatch: (...args: Parameters<typeof original.mergeWithPreviousItemPatch>) => {
      const patch = original.mergeWithPreviousItemPatch(...args);
      if (sabotage.mutant === "item merge eats a word" && patch) {
        const [edit] = patch.edits;
        return { ...patch, edits: [{ ...edit, span: { from: edit.span.from, to: Math.min(args[0].length, edit.span.to + 4) } }] };
      }
      return patch;
    },
  };
});

vi.mock("../../packages/core/src/editing/transaction/history.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/core/src/editing/transaction/history.js")>();
  let calls = 0;
  return {
    ...original,
    recordTransaction: (...args: Parameters<typeof original.recordTransaction>) => {
      calls += 1;
      // Drops every fifth step: undo can no longer get back to the start.
      return sabotage.mutant === "lost undo step" && calls % 5 === 0 ? args[0] : original.recordTransaction(...args);
    },
  };
});

const starts = corpusStarts(beamerCorpusScopes());

describe("keystroke fuzzing catches broken operations", () => {
  it.each([
    ["empty formula as $$", "balance"],
    ["no terminator", "content"],
    ["⌫ takes two", "content|balance"],
    ["range deletion ignores structure", "balance|content"],
    ["item merge eats a word", "content|balance"],
    ["lost undo step", "undo"],
  ])("%s → %s", (mutant, invariants) => {
    sabotage.mutant = mutant;
    try {
      // Keep the list-merge mutation exercised as the general fixture corpus grows.
      // Titles and non-list bodies cannot trigger this operation.
      const mutationStarts = mutant === "item merge eats a word"
        ? starts.filter(start => /\\item\b/u.test(start.text))
        : starts;
      const result = runCampaign({ starts: mutationStarts, seed: 7, cases: 400, length: 24, maxFailures: 1, shrink: false });
      expect(invariants.split("|")).toContain(result.invariants[0]);
    } finally {
      sabotage.mutant = null;
    }
  }, 300_000);

  it("finds nothing without sabotage", () => {
    expect(runCampaign({ starts, seed: 7, cases: 400, length: 24, maxFailures: 1, shrink: false }).failures).toEqual([]);
  }, 300_000);
});
