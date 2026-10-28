import { describe, expect, it } from "vitest";
import { maskTexRecovery, scanTexRecovery } from "../packages/core/src/text/tex/recovery.js";
import { beamerCorpusScopes } from "./editing/beamer-corpus.js";

/** The recovery of `text`, with each virtual closer written in as `⟨…⟩` and each stray marked `⟪…⟫`. */
function recovered(text: string): string {
  const { closers, strays } = scanTexRecovery(text);
  const marks = [
    ...closers.map((closer) => ({ at: closer.at, text: `⟨${closer.closer}⟩` })),
    ...strays.flatMap((stray) => [{ at: stray.from, text: "⟪" }, { at: stray.to, text: "⟫" }]),
  ].sort((left, right) => right.at - left.at);
  let result = text;
  for (const mark of marks) {
    result = result.slice(0, mark.at) + mark.text + result.slice(mark.at);
  }
  return result;
}

describe("TeX recovery", () => {
  it("keeps recent recoveries reusable without retaining many large document revisions", () => {
    const firstText = `first {${"x".repeat(300000)}`;
    const first = scanTexRecovery(firstText);
    const hotText = "recent {text";
    const hot = scanTexRecovery(hotText);
    for (let index = 0; index < 5; index++) {
      scanTexRecovery(`${index} {${"x".repeat(300000)}`);
      expect(scanTexRecovery(hotText)).toBe(hot);
    }
    expect(scanTexRecovery(firstText)).not.toBe(first);
    expect(scanTexRecovery(firstText)).toEqual(first);
  });

  it("reuses one recovery larger than the memory budget", () => {
    const text = `large {${"x".repeat(1100000)}`;
    expect(scanTexRecovery(text)).toBe(scanTexRecovery(text));
  });

  it.each([
    String.raw`Intro \textbf{bold} and $x^{2}$ \(y\) \[z\] $$w$$.`,
    "{\\small one\n\ntwo}",
    "\\begin{itemize}\n\\item {\\color{red} a \\item b}\n\\end{itemize}",
    String.raw`\{ \} \$ 50\% $\{x\}$`,
    "a % { $ \\[ in a comment\nb",
    String.raw`\verb|{$| and \begin{verbatim}{ $ \end{verbatim}`,
    String.raw`$\left\{ \begin{array}{cc} a & b \end{array} \right.$`,
    String.raw`\begin{tabular}{>{$}c<{$}l} x & y \end{tabular}`,
    String.raw`$\left( a \middle| b \right) + \left. c \right|_0$ and \left( in prose`,
  ])("needs none for valid source: %s", (text) => {
    expect(scanTexRecovery(text)).toEqual({ closers: [], strays: [] });
  });

  it.each([
    // A group closes at the end of its paragraph or item, before the spaces there.
    ["Intro \\textbf{bo and \\emph{em} text.\n\nNext.", "Intro \\textbf{bo and \\emph{em} text.⟨}⟩\n\nNext."],
    ["\\begin{itemize}\n\\item One \\textbf{x two.\n\\item Three.\n\\end{itemize}", "\\begin{itemize}\n\\item One \\textbf{x two.⟨}⟩\n\\item Three.\n\\end{itemize}"],
    ["A \\textbf{bo", "A \\textbf{bo⟨}⟩"],
    ["A \\textbf{bo text.\n\\begin{itemize}\n\\item x\n\\end{itemize}", "A \\textbf{bo text.⟨}⟩\n\\begin{itemize}\n\\item x\n\\end{itemize}"],
    // Math cannot outlast its paragraph or item, as TeX inserts the `$`.
    ["\\item One $x two.\n\\item Three $y$ four.", "\\item One $x two.⟨$⟩\n\\item Three $y$ four."],
    ["Display \\[ x^2 \\frac{a}{b}\n\nOutro.", "Display \\[ x^2 \\frac{a}{b}⟨\\]⟩\n\nOutro."],
    // Groups opened in math end with it; math ends with the group it is in.
    ["$\\frac{a}{x$ b", "$\\frac{a}{x⟨}⟩$ b"],
    ["\\textbf{a $b} c", "\\textbf{a $b⟨$⟩} c"],
    // An environment's end closes what is open in it.
    ["\\begin{block}{T} a {b\n\\end{block} c", "\\begin{block}{T} a {b⟨}⟩\n\\end{block} c"],
    // A `\\left` with no `\\right` is closed where its formula or group ends, as TeX does;
    // even one just typed, with nothing in it yet.
    ["$a \\left( b + c$ d", "$a \\left( b + c⟨\\right)⟩$ d"],
    ["$a\\left($", "$a\\left(⟨\\right)⟩$"],
    ["${\\left[ a} b$", "${\\left[ a⟨\\right]⟩} b$"],
    ["$\\left\\langle x\\right\\rangle + \\left\\langle y$", "$\\left\\langle x\\right\\rangle + \\left\\langle y⟨\\right\\rangle⟩$"],
    ["$a \\right) b$", "$a ⟪\\right)⟫ b$"],
    // Strays.
    ["Intro } with", "Intro ⟪}⟫ with"],
    ["a \\) b \\] c", "a ⟪\\)⟫ b ⟪\\]⟫ c"],
  ])("closes %j", (text, expected) => {
    expect(recovered(text)).toBe(expected);
  });

  it("keeps an opener with nothing to close as source", () => {
    expect(recovered("a $\n\nc \\textbf{")).toBe("a ⟪$⟫\n\nc \\textbf⟪{⟫");
    expect(recovered("$\\frac{a}{$")).toBe("$\\frac{a}⟪{⟫$");
  });

  it("leaves a half-typed environment name alone", () => {
    expect(recovered("a \\begin{it b")).toBe("a \\begin{it b");
  });

  it("leaves \\left and \\right to the math parser, unmasked", () => {
    const text = "$\\left( a \\right) \\right] b$";
    expect(maskTexRecovery(text, scanTexRecovery(text))).toBe(text);
  });

  it("masks openers and strays for the parser, keeping offsets", () => {
    const text = "a } \\textbf{b $c";
    const masked = maskTexRecovery(text, scanTexRecovery(text));
    expect(masked).toBe("a * \\textbf*b *c");
    expect(masked).toHaveLength(text.length);
  });

  it("never closes inside a comment: the spaces a comment ends with are its own", () => {
    const text = "Normal {`%}theorem \n";
    const [closer] = scanTexRecovery(text).closers;
    expect(closer).toMatchObject({ kind: "group", closer: "}" });
    expect(closer.at).toBe(text.indexOf("\n"));
  });

  it("needs none for any scope of the corpus decks", () => {
    const needing = beamerCorpusScopes()
      .filter((scope) => {
        const recovery = scanTexRecovery(scope.text);
        return recovery.closers.length > 0 || recovery.strays.length > 0;
      })
      .map((scope) => `${scope.file}#${scope.frameIndex}: ${recovered(scope.text).slice(0, 200)}`);
    expect(needing).toEqual([]);
  });
});
