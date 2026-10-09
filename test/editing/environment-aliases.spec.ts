import { describe, expect, it } from "vitest";
import { parseBeamerFrameBody, prepareBeamerDocument } from "../../packages/core/src/beamer/index.js";
import { environmentAliasTarget } from "../../packages/core/src/beamer/environment-aliases.js";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { printEditTree } from "../../packages/core/src/editing/tree/print.js";
import { KeystrokeSession } from "./fuzz/keystroke-session.js";
import { parseScenarioKeys } from "../../packages/core/src/editing/testing/index.js";

const R = String.raw;

describe("user environments that are lists", () => {
  it.each([
    ["the primitive form with a length setting", R`\itemize\addtolength{\itemsep}{10pt}`, R`\enditemize`, "itemize"],
    ["the environment form with settings and comments", "%\n\\begin{enumerate}\n\\setlength{\\itemsep}{0pt}\n\\renewcommand{\\labelenumi}{(\\theenumi)}\n", R`\end{enumerate}`, "enumerate"],
    ["a description list", R`\begin{description}`, R`\end{description}`, "description"],
    ["not with a visible change around it", R`\small\begin{itemize}`, R`\end{itemize}`, null],
    ["not with text before it", R`Note: \begin{itemize}`, R`\end{itemize}`, null],
    ["not LaTeX's generic list", R`\begin{list}{--}{}`, R`\end{list}`, null],
    ["not when the end closes something else", R`\begin{itemize}`, R`\end{enumerate}`, null],
  ])("%s", (_, begin, end, target) => {
    expect(environmentAliasTarget(begin, end)).toBe(target);
  });

  const deck = String.raw`\documentclass{beamer}
\newenvironment{spacedlist}{\itemize\addtolength{\itemsep}{6pt}}{\enditemize}
\newenvironment{boxed}[1]{\begin{itemize}}{\end{itemize}}
\begin{document}
\begin{frame}{Lists}
\begin{spacedlist}
  \item Alpha.
  \item Beta.
\end{spacedlist}
\end{frame}
\end{document}
`;

  it("renders as the list it stands for, and binds as one", () => {
    const prepared = prepareBeamerDocument(deck);
    // (A definition with parameters is not an alias.)
    expect(prepared.document.preamble.environmentAliases.map((alias) => [alias.name, alias.target])).toEqual([["spacedlist", "itemize"]]);
    const frame = prepared.document.frames[0];
    const body = parseBeamerFrameBody({ source: deck, frame, document: prepared.document });
    expect(body.children.map((child) => child.kind)).not.toContain("unsupported");
    const commands = createCommandTable(prepared.frameEditingEnvironment(0));
    const tree = buildEditTree(deck.slice(frame.bodySpan.from, frame.bodySpan.to), { commands });
    expect(tree.diagnostics).toEqual([]);
    expect(printEditTree(tree)).toBe(`(scope (list:spacedlist (item label:∅ flow:[(paragraph "Alpha.")]) (item label:∅ flow:[(paragraph "Beta.")])))`);
  });

  it("lays out as that list, its boundaries at the user's source", async () => {
    const source = deck.replace("  \\item Beta.\n", "  \\item Beta.\n  \\begin{spacedlist}\n    \\item Gamma.\n  \\end{spacedlist}\n");
    const prepared = prepareBeamerDocument(source);
    const page = await prepared.renderFrame({ frameIndex: 0, step: 1 });
    const lists = page.layout.paragraphs.flatMap((paragraph) => paragraph.listStructure ?? []);
    expect(lists.map((list) => [list.environment, list.depth, list.items.length, source.slice(list.beginSpan.from, list.beginSpan.to)])).toEqual([
      ["itemize", 1, 2, "\\begin{spacedlist}"],
      ["itemize", 2, 1, "\\begin{spacedlist}"],
    ]);
  });

  it("splits its items with ⏎, keeping its name", () => {
    const prepared = prepareBeamerDocument(deck);
    const frame = prepared.document.frames[0];
    const text = deck.slice(frame.bodySpan.from, frame.bodySpan.to);
    const caret = text.indexOf("Alpha.") + "Alpha".length;
    const session = new KeystrokeSession(text, createCommandTable(prepared.frameEditingEnvironment(0)), caret);
    for (const key of [...parseScenarioKeys("⏎"), ...parseScenarioKeys("x")]) {
      session.press(key);
    }
    expect(session.text).toContain("\\item Alpha\n  \\item x.\n  \\item Beta.\n\\end{spacedlist}");
  });
});
