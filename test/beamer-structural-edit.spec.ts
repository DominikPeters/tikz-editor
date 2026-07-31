import { describe, expect, it } from "vitest";
import {
  applyBeamerStructuralEdits,
  beamerStructuralBackspacePatch,
  beamerStructuralDeletePatch,
  beamerStructuralEnterPatch,
  beamerStructuralLineBreakPatch,
  beamerStructuralTabPatch,
  buildBeamerCaretStopDomain,
  prepareBeamerDocument,
  type BeamerCaretDomain,
  type BeamerStructuralKeyResult,
  type BeamerStructuralPatch,
} from "../packages/core/src/beamer/index.js";

function frameDocument(body: string): string {
  return `\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{T}\n${body}\n\\end{frame}\n\\end{document}`;
}

const LIST_BODY = [
  "Intro prose.",
  "\\begin{itemize}",
  "\\item First one",
  "\\item Second two",
  "\\item Third three",
  "\\end{itemize}",
  "Outro prose.",
].join("\n");

const NESTED_BODY = [
  "\\begin{itemize}",
  "\\item Outer top",
  "\\begin{itemize}",
  "\\item Alpha row",
  "\\item Beta row",
  "\\item Gamma row",
  "\\end{itemize}",
  "\\item Outer last",
  "\\end{itemize}",
].join("\n");

async function domainFor(source: string): Promise<BeamerCaretDomain> {
  const page = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1 });
  return buildBeamerCaretStopDomain({ paragraphs: page.layout.paragraphs, source });
}

function asPatch(result: BeamerStructuralKeyResult): BeamerStructuralPatch {
  expect(result).not.toBeNull();
  expect(result).not.toBe("swallow");
  return result as BeamerStructuralPatch;
}

/** Applies a patch and asserts the edited document still renders. */
async function applyAndRender(
  source: string,
  patch: BeamerStructuralPatch
): Promise<{ next: string; nextDomain: BeamerCaretDomain }> {
  const next = applyBeamerStructuralEdits(source, patch.edits);
  const nextDomain = await domainFor(next);
  expect(nextDomain.rows.length).toBeGreaterThan(0);
  return { next, nextDomain };
}

describe("beamer structural edits", () => {
  it("Enter splits an item at the caret with whitespace repair", async () => {
    const source = frameDocument(LIST_BODY);
    const domain = await domainFor(source);
    const offset = source.indexOf(" two");
    const patch = asPatch(beamerStructuralEnterPatch(domain, offset));
    const { next } = await applyAndRender(source, patch);
    expect(next).toContain("\\item Second\n\\item two\n");
    expect(next.slice(patch.caretOffset, patch.caretOffset + 3)).toBe("two");
  });

  it("Enter at an item's content start inserts an empty item above", async () => {
    const source = frameDocument(LIST_BODY);
    const domain = await domainFor(source);
    const offset = source.indexOf("First one");
    const patch = asPatch(beamerStructuralEnterPatch(domain, offset));
    const { next } = await applyAndRender(source, patch);
    expect(next).toContain("\\item \n\\item First one\n");
    expect(next.slice(patch.caretOffset, patch.caretOffset + 5)).toBe("First");
  });

  it("Enter on an empty last item deletes it and exits the list", async () => {
    const source = frameDocument(
      ["\\begin{itemize}", "\\item Kept row", "\\item", "\\end{itemize}"].join("\n")
    );
    const domain = await domainFor(source);
    const emptyOffset = source.indexOf("\\end{itemize}");
    // The whitespace tail of `\item` (where a fresh split parks the caret)
    // resolves to the same empty item as the content-start offset.
    const tailOffset = source.indexOf("\\item\n\\end") + "\\item".length;
    expect(beamerStructuralEnterPatch(domain, tailOffset)).toEqual(
      beamerStructuralEnterPatch(domain, emptyOffset)
    );
    const patch = asPatch(beamerStructuralEnterPatch(domain, emptyOffset));
    const { next } = await applyAndRender(source, patch);
    expect(next).toContain("\\item Kept row\n\\end{itemize}\n\n");
    expect(next).not.toContain("\\item\n");
    // The caret sits on the fresh line following the environment.
    expect(next.slice(patch.caretOffset - 2, patch.caretOffset)).toBe("}\n");
  });

  it("Enter on the only (empty) item removes the whole environment", async () => {
    const source = frameDocument(
      ["Before text.", "\\begin{itemize}", "\\item", "\\end{itemize}", "After text."].join("\n")
    );
    const domain = await domainFor(source);
    const emptyOffset = source.indexOf("\\end{itemize}");
    const patch = asPatch(beamerStructuralEnterPatch(domain, emptyOffset));
    const next = applyBeamerStructuralEdits(source, patch.edits);
    expect(next).not.toContain("itemize");
    expect(next).not.toContain("\\item");
    expect(next).toContain("Before text.");
    expect(next).toContain("After text.");
  });

  it("Enter in body prose breaks the paragraph with a blank line", async () => {
    const source = frameDocument(LIST_BODY);
    const domain = await domainFor(source);
    const offset = source.indexOf(" prose.");
    const patch = asPatch(beamerStructuralEnterPatch(domain, offset));
    const { next } = await applyAndRender(source, patch);
    expect(next).toContain("Intro\n\nprose.");
    expect(next.slice(patch.caretOffset, patch.caretOffset + 6)).toBe("prose.");
  });

  it("Enter is swallowed in math and in template areas", async () => {
    const source = frameDocument("Body text with $a+b$ inline.\n\\[\n  x + y\n\\]");
    const domain = await domainFor(source);
    const inlineOffset = source.indexOf("+b");
    expect(beamerStructuralEnterPatch(domain, inlineOffset)).toBe("swallow");
    const displayOffset = source.indexOf("x + y") + 2;
    expect(beamerStructuralEnterPatch(domain, displayOffset)).toBe("swallow");
    const titleOffset = source.indexOf("{T}") + 1;
    expect(beamerStructuralEnterPatch(domain, titleOffset)).toBe("swallow");
  });

  it("Shift+Enter inserts an explicit line break", async () => {
    const source = frameDocument(LIST_BODY);
    const domain = await domainFor(source);
    const offset = source.indexOf(" three");
    const patch = asPatch(beamerStructuralLineBreakPatch(domain, offset));
    const { next } = await applyAndRender(source, patch);
    expect(next).toContain("Third \\\\ three");
    expect(next.slice(patch.caretOffset, patch.caretOffset + 5)).toBe("three");
  });

  it("Backspace at an item's content start merges with the previous item", async () => {
    const source = frameDocument(LIST_BODY);
    const domain = await domainFor(source);
    const offset = source.indexOf("Second two");
    const patch = asPatch(beamerStructuralBackspacePatch(domain, offset));
    const { next } = await applyAndRender(source, patch);
    expect(next).toContain("\\item First one Second two\n");
    expect(next.slice(patch.caretOffset - 4, patch.caretOffset + 6)).toBe("one Second");
    // First item: no previous sibling to merge into — swallowed, not native.
    expect(
      beamerStructuralBackspacePatch(domain, source.indexOf("First one"))
    ).toBe("swallow");
    // Mid-content Backspace stays native.
    expect(beamerStructuralBackspacePatch(domain, source.indexOf(" two"))).toBeNull();
  });

  it("Delete at an item's rendered end merges the next item into it", async () => {
    const source = frameDocument(LIST_BODY);
    const domain = await domainFor(source);
    const offset = source.indexOf("First one") + "First one".length;
    const patch = asPatch(beamerStructuralDeletePatch(domain, offset));
    const { next } = await applyAndRender(source, patch);
    expect(next).toContain("\\item First one Second two\n");
    expect(patch.caretOffset).toBe(offset);
    // Last item swallows; mid-content stays native.
    const lastEnd = source.indexOf("Third three") + "Third three".length;
    expect(beamerStructuralDeletePatch(domain, lastEnd)).toBe("swallow");
    expect(beamerStructuralDeletePatch(domain, source.indexOf("irst"))).toBeNull();
  });

  it("Tab wraps an item in a nested same-kind environment; the first item cannot nest", async () => {
    const source = frameDocument(LIST_BODY);
    const domain = await domainFor(source);
    const offset = source.indexOf("econd two");
    const patch = asPatch(beamerStructuralTabPatch(domain, offset, "nest"));
    const { next } = await applyAndRender(source, patch);
    expect(next).toContain(
      "\\begin{itemize}\n\\item Second two\n\\end{itemize}\n\\item Third three"
    );
    expect(next.slice(patch.caretOffset, patch.caretOffset + 9)).toBe("econd two");
    expect(beamerStructuralTabPatch(domain, source.indexOf("First one"), "nest")).toBe(
      "swallow"
    );
  });

  it("consecutive Tabs extend the nested environment instead of chaining siblings", async () => {
    const source = frameDocument(LIST_BODY);
    const domain = await domainFor(source);
    const first = asPatch(
      beamerStructuralTabPatch(domain, source.indexOf("econd two"), "nest")
    );
    const { next, nextDomain } = await applyAndRender(source, first);
    const second = asPatch(
      beamerStructuralTabPatch(nextDomain, next.indexOf("hird three"), "nest")
    );
    const { next: final } = await applyAndRender(next, second);
    expect(final).toContain(
      "\\begin{itemize}\n\\item Second two\n\\item Third three\n\\end{itemize}"
    );
    expect(final.match(/\\begin\{itemize\}/gu)).toHaveLength(2);
    expect(final.slice(second.caretOffset, second.caretOffset + 10)).toBe("hird three");
  });

  it("Shift+Tab unnests first, middle, last, and single items", async () => {
    const source = frameDocument(NESTED_BODY);
    const domain = await domainFor(source);

    const middle = asPatch(
      beamerStructuralTabPatch(domain, source.indexOf("eta row"), "unnest")
    );
    const { next: middleNext } = await applyAndRender(source, middle);
    expect(middleNext).toContain(
      "\\item Alpha row\n\\end{itemize}\n\\item Beta row\n\\begin{itemize}\n\\item Gamma row"
    );
    expect(middleNext.slice(middle.caretOffset, middle.caretOffset + 7)).toBe("eta row");

    const firstItem = asPatch(
      beamerStructuralTabPatch(domain, source.indexOf("Alpha row"), "unnest")
    );
    const { next: firstNext } = await applyAndRender(source, firstItem);
    expect(firstNext).toContain(
      "\\item Outer top\n\\item Alpha row\n\\begin{itemize}\n\\item Beta row"
    );

    const lastItem = asPatch(
      beamerStructuralTabPatch(domain, source.indexOf("Gamma row"), "unnest")
    );
    const { next: lastNext } = await applyAndRender(source, lastItem);
    expect(lastNext).toContain(
      "\\item Beta row\n\\end{itemize}\n\\item Gamma row\n\\item Outer last"
    );

    const singleSource = frameDocument(
      [
        "\\begin{itemize}",
        "\\item Outer top",
        "\\begin{itemize}",
        "\\item Lone nested",
        "\\end{itemize}",
        "\\item Outer last",
        "\\end{itemize}",
      ].join("\n")
    );
    const singleDomain = await domainFor(singleSource);
    const single = asPatch(
      beamerStructuralTabPatch(singleDomain, singleSource.indexOf("Lone nested"), "unnest")
    );
    const { next: singleNext } = await applyAndRender(singleSource, single);
    expect(singleNext).toContain(
      "\\item Outer top\n\\item Lone nested\n\\item Outer last"
    );

    // Top-level items cannot unnest.
    expect(
      beamerStructuralTabPatch(domain, source.indexOf("Outer top"), "unnest")
    ).toBe("swallow");
  });
});
