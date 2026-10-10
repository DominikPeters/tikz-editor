import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { beamerScenarioDocument } from "../packages/core/src/editing/testing/index.js";

/**
 * Temporarily invalid states (T1, T5): an edit that leaves source
 * unbalanced changes the rendering of the construct it is in, never the
 * list or paragraphs around it, and the recovery is reported.
 */
const BASE = String.raw`Intro with \textbf{bold} and \emph{em} text.
\begin{itemize}
\item First $v_i(A_i) \ge v_i(O)$ here.
\item Second item.
\end{itemize}
Outro.`;

/** The frame's rendered text, its literal (source-shown) runs, and its diagnostics. */
async function render(body: string) {
  const { source, bodyFrom } = beamerScenarioDocument(body);
  const page = await prepareBeamerDocument(source).renderFrame({ step: 1 });
  const segments = page.layout.paragraphs.flatMap((paragraph) => paragraph.report.lines.flatMap((line) => line.segments ?? []));
  return {
    words: segments.filter((segment) => segment.kind === "text" && !segment.literal).map((segment) => segment.text ?? "").join(""),
    literals: segments.filter((segment) => segment.literal).map((segment) => ({
      text: segment.text ?? "",
      from: Number(segment.sourceStartRaw) - bodyFrom,
    })),
    codes: page.diagnostics.map((diagnostic) => diagnostic.code),
    recovery: page.layout.recovery,
    bodyFrom,
  };
}

describe("rendering unbalanced source while it is edited", () => {
  it("renders the balanced baseline with no recovery", async () => {
    const baseline = await render(BASE);
    expect(baseline.literals).toEqual([]);
    expect(baseline.recovery).toBeUndefined();
  });

  it.each([
    ["an unclosed \\textbf{ in prose", "\\textbf{bold}", "\\textbf{bo", "tex-missing-closer"],
    ["a lone { in prose", "Intro with", "Intro { with", "tex-missing-closer"],
    ["a deleted } of \\textbf", "\\textbf{bold}", "\\textbf{bold", "tex-missing-closer"],
    ["an unclosed $ in an item", "Second item.", "Second $x item.", "tex-missing-closer"],
    ["a stray $ in a formula", "v_i(O)$", "v_i($O)$", "tex-missing-closer"],
    ["an unclosed \\textbf{ in an item", "Second item.", "Second \\textbf{it em.", "tex-missing-closer"],
    ["a stray }", "Intro with", "Intro } with", "tex-unmatched-delimiter"],
  ])("%s keeps the list and the text around it", async (_name, find, replace, code) => {
    const baseline = await render(BASE);
    const edited = await render(BASE.replace(find, replace));
    const editFrom = BASE.indexOf(find);
    const editTo = editFrom + replace.length;
    // Source shows only inside the edit, never as `\begin{itemize}` or `\item` elsewhere.
    for (const literal of edited.literals) {
      expect(literal.from).toBeGreaterThanOrEqual(editFrom);
      expect(literal.from).toBeLessThan(editTo);
    }
    // Every word outside the edited one renders as before.
    const kept = (words: string) => words.replace(/bold|bo|with|Second|item\.|it|em\.|First|here\.|O\)/gu, "");
    expect(kept(edited.words)).toBe(kept(baseline.words));
    expect(edited.codes).toContain(code);
    expect(edited.recovery).toBeDefined();
  });

  it("reports where a missing closer goes, in document coordinates", async () => {
    const body = BASE.replace("Second item.", "Second \\textbf{it em.");
    const edited = await render(body);
    const opener = body.indexOf("\\textbf{it") + "\\textbf".length;
    expect(edited.recovery?.closers).toEqual([{
      opener: { from: edited.bodyFrom + opener, to: edited.bodyFrom + opener + 1 },
      kind: "group",
      at: edited.bodyFrom + body.indexOf("em.") + 3,
      closer: "}",
    }]);
  });
});
