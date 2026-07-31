import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  beamerCaretAtomBeside,
  beamerCaretRowEdgeOffset,
  buildBeamerCaretStopDomain,
  nextBeamerCaretOffset,
  prepareBeamerDocument,
  verticalBeamerCaretOffset,
  type BeamerCaretDomain,
} from "../packages/core/src/beamer/index.js";

const corpusSource = readFileSync(
  new URL("./fixtures/beamer/editing_corpus_beamer.tex", import.meta.url),
  "utf8"
);

const DISPLAY_MATH_SOURCE = String.raw`\documentclass{beamer}
\newcommand{\generatedword}{Generated}
\begin{document}
\begin{frame}{Titel typo \generatedword}
Body typo.
\[
  x + y
\]
\end{frame}
\end{document}`;

async function domainFor(
  source: string,
  frameIndex: number,
  step = 1
): Promise<BeamerCaretDomain> {
  const page = await prepareBeamerDocument(source).renderFrame({ frameIndex, step });
  return buildBeamerCaretStopDomain({ paragraphs: page.layout.paragraphs, source });
}

function rowText(source: string, domain: BeamerCaretDomain, rowIndex: number): string {
  const stops = domain.rows[rowIndex].stops;
  const offsets = stops.map((stop) => stop.offset);
  return source.slice(Math.min(...offsets), Math.max(...offsets));
}

describe("beamer caret-stop domain", () => {
  it("collapses macro calls to atomic steps and splits rows at explicit line breaks", async () => {
    const domain = await domainFor(corpusSource, 0);

    expect(domain.rows.map((row) => rowText(corpusSource, domain, domain.rows.indexOf(row)))).toEqual([
      "Command-form title",
      "First line",
      "second line",
      expect.stringContaining("Signed with"),
    ]);

    const inner = {
      from: corpusSource.indexOf(String.raw`\inner{x}{y}`),
      to: corpusSource.indexOf(String.raw`\inner{x}{y}`) + String.raw`\inner{x}{y}`.length,
    };
    const highlight = {
      from: corpusSource.indexOf(String.raw`\highlight{a wrapped phrase}`),
      to:
        corpusSource.indexOf(String.raw`\highlight{a wrapped phrase}`) +
        String.raw`\highlight{a wrapped phrase}`.length,
    };
    expect(domain.atomSpans).toEqual([inner, highlight]);

    // Atom interiors are not caret stops; traversal over a macro call is a
    // single step from one endpoint to the other.
    for (const atom of [inner, highlight]) {
      expect(domain.offsets.some((offset) => atom.from < offset && offset < atom.to)).toBe(false);
      expect(domain.offsets).toContain(atom.from);
      expect(domain.offsets).toContain(atom.to);
      expect(nextBeamerCaretOffset(domain, atom.from, 1)).toBe(atom.to);
      expect(nextBeamerCaretOffset(domain, atom.to, -1)).toBe(atom.from);
    }

    // Explicit `\\` splits rendered rows; Home on the second row lands at
    // the row's own start, not the paragraph start.
    const secondLine = corpusSource.indexOf("second line");
    expect(beamerCaretRowEdgeOffset(domain, secondLine + 3, "start")).toBe(secondLine);
    expect(beamerCaretRowEdgeOffset(domain, secondLine + 3, "end")).toBe(
      secondLine + "second line".length
    );

    // The `\\` between the rows is not a stop: stepping right from the end
    // of "First line" skips the line-break command atomically.
    const firstLineEnd = corpusSource.indexOf("First line") + "First line".length;
    const next = nextBeamerCaretOffset(domain, firstLineEnd, 1);
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThanOrEqual(secondLine);
  });

  it("orders nested-list rows vertically and moves between rows by nearest x", async () => {
    const domain = await domainFor(corpusSource, 1);
    const texts = domain.rows.map((_, index) => rowText(corpusSource, domain, index));
    expect(texts).toEqual([
      "Nested lists",
      "Outer first",
      "Nested numbered",
      "Outer after empty",
      "Points uphill",
      "Curves the bowl",
    ]);

    const outerFirst = corpusSource.indexOf("Outer first");
    const nested = {
      from: corpusSource.indexOf("Nested numbered"),
      to: corpusSource.indexOf("Nested numbered") + "Nested numbered".length,
    };
    const down = verticalBeamerCaretOffset(domain, outerFirst, 1);
    expect(down).not.toBeNull();
    expect(down!.offset).toBeGreaterThanOrEqual(nested.from);
    expect(down!.offset).toBeLessThanOrEqual(nested.to);

    const pointsUphill = corpusSource.indexOf("Points uphill");
    const up = verticalBeamerCaretOffset(domain, pointsUphill, -1);
    const outerAfter = {
      from: corpusSource.indexOf("Outer after empty"),
      to: corpusSource.indexOf("Outer after empty") + "Outer after empty".length,
    };
    expect(up).not.toBeNull();
    expect(up!.offset).toBeGreaterThanOrEqual(outerAfter.from);
    expect(up!.offset).toBeLessThanOrEqual(outerAfter.to);

    // Vertical motion at the domain edges clamps to the row's start/end.
    const titleStart = corpusSource.indexOf("Nested lists");
    expect(verticalBeamerCaretOffset(domain, titleStart + 4, -1)?.offset).toBe(titleStart);
    const lastRowEnd = corpusSource.indexOf("Curves the bowl") + "Curves the bowl".length;
    expect(verticalBeamerCaretOffset(domain, lastRowEnd - 4, 1)?.offset).toBe(lastRowEnd);
  });

  it("keeps the sticky goal column across a short row", async () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{T}
A rather long opening line segment \\ hi \\ Another rather long closing line
\end{frame}
\end{document}`;
    const domain = await domainFor(source, 0);

    // Start deep into the long first row, well past the short row's extent.
    const start = source.indexOf("segment") + "segment".length;
    const first = verticalBeamerCaretOffset(domain, start, 1);
    expect(first).not.toBeNull();
    const shortRow = { from: source.indexOf("hi"), to: source.indexOf("hi") + 2 };
    expect(first!.offset).toBeGreaterThanOrEqual(shortRow.from);
    expect(first!.offset).toBeLessThanOrEqual(shortRow.to);
    // The goal remembers the original x, not the clamped landing.
    expect(first!.goalX).toBeGreaterThan(
      verticalBeamerCaretOffset(domain, first!.offset, 1)!.goalX
    );

    // Continuing down with the goal returns to the original column; without
    // it, the position decays to the short row's x.
    const withGoal = verticalBeamerCaretOffset(domain, first!.offset, 1, first!.goalX);
    const withoutGoal = verticalBeamerCaretOffset(domain, first!.offset, 1);
    expect(withGoal).not.toBeNull();
    expect(withoutGoal).not.toBeNull();
    expect(withGoal!.offset).toBeGreaterThan(withoutGoal!.offset);
    const closing = source.indexOf("Another rather long closing line");
    expect(withGoal!.offset).toBeGreaterThan(closing + "Another rather".length);
  });

  it("excludes overlay-hidden content from the step's domain", async () => {
    const revealed = corpusSource.indexOf("Revealed second");
    const temporalBefore = corpusSource.indexOf("Temporal before");

    const stepOne = await domainFor(corpusSource, 2, 1);
    expect(
      stepOne.offsets.some((offset) => offset > revealed && offset < revealed + 8)
    ).toBe(false);

    const stepThree = await domainFor(corpusSource, 2, 3);
    expect(
      stepThree.offsets.some((offset) => offset > revealed && offset < revealed + 8)
    ).toBe(true);
    // The unrendered \temporal branch never enters any step's domain.
    for (const domain of [stepOne, stepThree]) {
      expect(
        domain.offsets.some(
          (offset) => offset > temporalBefore && offset < temporalBefore + 8
        )
      ).toBe(false);
    }
  });

  it("walks display math per offset and identifies atoms for select-then-delete", async () => {
    const domain = await domainFor(DISPLAY_MATH_SOURCE, 0);

    // Display math contributes a rendered row with per-offset stops.
    const mathContent = DISPLAY_MATH_SOURCE.indexOf("x + y");
    expect(domain.offsets).toContain(mathContent);
    expect(nextBeamerCaretOffset(domain, mathContent, 1)).toBe(mathContent + 1);

    const invocation = {
      from: DISPLAY_MATH_SOURCE.indexOf(
        String.raw`\generatedword`,
        DISPLAY_MATH_SOURCE.indexOf(String.raw`\begin{frame}`)
      ),
      to: 0,
    };
    invocation.to = invocation.from + String.raw`\generatedword`.length;
    expect(beamerCaretAtomBeside(domain, invocation.to, "before")).toEqual(invocation);
    expect(beamerCaretAtomBeside(domain, invocation.from, "after")).toEqual(invocation);
    expect(beamerCaretAtomBeside(domain, invocation.from - 1, "before")).toBeNull();
  });
});
