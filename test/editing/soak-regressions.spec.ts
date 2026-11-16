import { describe, expect, it } from "vitest";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { runCase } from "./fuzz/keystroke-fuzz.js";
import { commitCommand } from "../../packages/core/src/editing/operations/command.js";
import { NO_INTERACTION } from "../../packages/core/src/editing/input/interaction.js";
import { enter } from "../../packages/core/src/editing/operations/structure.js";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { createEditView } from "../../packages/core/src/editing/position/index.js";
import { applyPatches } from "../../packages/core/src/editing/transaction/index.js";

const commands = createCommandTable();

function replay(marked: string, tokens: readonly string[], table = commands) {
  const anchor = marked.indexOf("‸");
  return runCase({ start: { label: "hourly soak regression", text: marked.replace("‸", ""), commands: table }, anchor, focus: anchor, tokens });
}

describe("keystroke soak regressions", () => {

  it("keeps pause from absorbing an existing bracket and later columns", () => {
    const result = replay("\n\\fuzzpair{MacroStageB}{Timing: 12\\fuzzunit, retained: 9\\fuzzoriginalunit.}\\par\n{\\renewcommand{\\fuzzunit}{local}\\fuzzpair{FrameLocal}{Timing: 5\\fuzzunit.}\\par}\n\\fuzzpair{FrameRestored}{Timing: 8\\fuzzunit; estimate $\\fuzzscale{x}$.}\u2038\\par\n\\begin{columns}[T]\\begin{column}{.46\\textwidth}The final diagram records the order in which information crosses the partition.\\end{column}\\begin{column}{.46\\textwidth}\\begin{itemize}\\item Input state\\item Updated state\\end{itemize}\\end{column}\\end{columns}\n", ["[", "←", String.raw`\pause`, "⏎"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(String.raw`\pause{}[`);
  });

  it.each(["pause", "tableofcontents"])("guards existing brackets when committing %s", name => {
    for (const suffix of ["[Keep]", " \n[Keep]", "% comment\n[Keep]"]) {
      for (const key of ["space", "structure", "typed"] as const) {
        const source = `Text ${suffix}`;
        const view = createEditView(buildEditTree(source, { commands }));
        const result = commitCommand(view, commands, view.positionAt(5), 5, name, key, NO_INTERACTION, null).outcome;
        expect(result.kind).toBe("patch");
        if (result.kind !== "patch") throw new Error("Expected the command commit");
        const after = applyPatches(source, result.patches);
        expect(after).toContain(`\\${name}{}`);
        expect(after.endsWith(suffix)).toBe(true);
      }
    }
  });

  it("still opens an optional argument when the bracket is the commit key", () => {
    const view = createEditView(buildEditTree("Text ", { commands }));
    const result = commitCommand(view, commands, view.positionAt(5), 5, "pause", "bracket", NO_INTERACTION, null).outcome;
    expect(result.kind).toBe("patch");
    if (result.kind !== "patch") throw new Error("Expected the optional argument");
    expect(applyPatches("Text ", result.patches)).toBe(String.raw`Text \pause[]`);
  });

  it("keeps alltt command terminators when deleting a selected character", () => {
    const result = replay("\\begin{alltt}\n  e‸cho hello\n  echo world\n\\end{alltt}", [String.raw`\te`, String.raw`\sum`, "Esc", "b", "⇧←", "⌦"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(String.raw`\te{}cho`);
  });

  it.each(["⌫", "⌦"])("keeps a nested alltt command terminated after selection deletion with %s", key => {
    const result = replay(String.raw`\begin{alltt}\textbf{e‸cho hello}\end{alltt}`, [String.raw`\te`, String.raw`\sum`, "Esc", "b", "⇧←", key]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(String.raw`\te{}cho`);
  });

  it.each(["smallskip", "medskip", "bigskip"])("terminates %s after removing its newly dead line break", command => {
    const result = replay(String.raw`Right\\Second‸\\Third\\Fourth`, [`\\${command}`, "⏎", "x"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(`\\${command}{}xThird`);
  });

  it("keeps populated table cells in their mode when changing a specification", () => {
    const result = replay("\n\\begin{tabular}{>{$}c<{$}l}\nx\u2038^2 & Alpha\\\\\n  & Beta\\\\\n\\frac{1}{2} & Gamma\n\\end{tabular}\n", ["@72:38", "#", String.raw`\left|`, "@setvalue:-549825329"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(">{$}c<{$}l");
  });

  it("keeps malformed lens comments inside their recovered tree spans", () => {
    const result = replay("\u2038\\relax \\begin{enumerate}\\item<1-> \\uncover<1>{{\\scriptsize\\color{blue}\\centering\\begin{columns}[onlytextwidth,b]\\begin{column}{.46\\textwidth}Left\\end{column}\\begin{column}{.5\\textwidth}Right\\\\Second\\end{column}\\end{columns}\\par}}\\item After.\\end{enumerate}\\only<2>{}", ["⌦", "⌘E", "@lens:1119488613", "⌘B", "⏎"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
  });

  it.each(["⏎", "{"])("protects a ghost radical index inside an item label after %s", key => {
    const result = replay(String.raw`\begin{description}\item[Sta‸ge] Body.\end{description}`, [String.raw`\sqrt`, key, "@ghost"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(String.raw`{\sqrt[]`);
  });

  it("uses the new row's mode after deleting a mixed-mode table selection", () => {
    const result = replay("\n\\begin{tabular}{>{$}c<{$}l}\nx^2‸ & Alpha\\\\\n  & Beta\\\\\n\\frac{1}{2} & Gamma\n\\end{tabular}\n", ["⏎", String.raw`\frac`, "@83:69", "$"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).not.toContain("${}$");
  });

  it.each([">{$}c<{$}l", "l>{$}c<{$}"])("uses the first column's %s mode in a removed row", spec => {
    const marked = `\\begin{tabular}{${spec}}x & y\\\\\na & b‸\\end{tabular}`;
    const source = marked.replace("‸", "");
    const from = source.indexOf("a & b");
    const to = from + "a & b".length;
    const result = replay(marked, [`@${from}:${to}`, "$"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText.includes("${}$")).toBe(spec.startsWith("l"));
  });

  it("refuses math delimiter commands in alltt", () => {
    const result = replay("\\begin{alltt}\n2‸ Done\n\\end{alltt}", [String.raw`\left(`, "→", "⌫", "⌫"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).not.toContain(String.raw`\left`);
  });

  it("keeps a revealed comment balanced when wrapping it", () => {
    const result = replay("First.\\pause Second.\n\n‸\\onslide<1->%\n\\begin{tikzlayer}[blue]\n  \\node at (2,3) {Added};\n\\end{tikzlayer}\n", ["@reveal", "⌦", String.raw`\emph`, String.raw`\text`]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain("\\emph{%\n}");
  });

  it.each(["%", "% comment", String.raw`\\% comment`])("ends a selected trailing comment before wrapping %s", selected => {
    const source = `${selected}\nTail`;
    const view = createEditView(buildEditTree(source, { commands }));
    const result = commitCommand(view, commands, view.positionAt(0), 0, "emph", "structure", NO_INTERACTION, { from: 0, to: selected.length }).outcome;
    expect(result.kind).toBe("patch");
    if (result.kind !== "patch") throw new Error("Expected a wrapper");
    expect(applyPatches(source, result.patches)).toBe(`\\emph{${selected}\n}\nTail`);
  });

  it("keeps an escaped percent inside a wrapper without adding a line end", () => {
    const result = replay(String.raw`‸\%` + "\nTail", ["@0:2", String.raw`\emph`, String.raw`\text`]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(String.raw`\emph{\%}`);
  });
  it.each(["enumerate", "itemize"])("keeps fallback motion at editable stops inside %s", environment => {
    for (const motion of ["⌘←", "⌥←"]) {
      const source = `\\begin{${environment}}\n\\item \\[w_i‸ x_i\\]\n\\end{${environment}}`;
      const result = replay(source, [String.raw`\url`, String.raw`\left(`, "→", motion, String.raw`\texttt`, "⏎"]);
      expect(result.failure, JSON.stringify(result.states)).toBeNull();
      expect(result.finalText.indexOf(String.raw`\texttt`)).toBeGreaterThan(result.finalText.indexOf(String.raw`\item`));
    }
  });

  it("keeps item-label text when a command opens an optional argument", () => {
    const result = replay(String.raw`\begin{description}\item[Stag‸e] Last parent.\end{description}`, [String.raw`\pause`, "["]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(String.raw`\begin{description}\item[Stag{\pause[]}e] Last parent.\end{description}`);
  });

  it.each(["⌘B", "⌘I", "⌘U"])("keeps a closing bracket inside an item label when removing %s", (key) => {
    const result = replay(String.raw`\begin{description}\item[‸Stage 2] Last parent.\end{description}`, [key, "]", "⇧←", key]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(String.raw`\begin{description}\item[{]Stage 2}] Last parent.\end{description}`);
  });

  it("keeps a delimiter pair together after a fraction's unbraced argument", () => {
    const result = replay("Fo‸llowing line.", ["$", String.raw`\frac`, "[", String.raw`\left[`]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
  });

  it.each(["_", "^"])("enters an existing %s across a math space before another scripted atom", (marker) => {
    const marked = `$w${marker}i ‸x${marker}i$`;
    const result = replay(marked, [marker, "z"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(`$w${marker}{iz} x${marker}i$`);
  });

  it.each([
    [String.raw`$\quad\left(‸\right)x$`, "⌦", String.raw`$\quad x$`],
    [String.raw`$\quad\left(‸\right)x$`, "⌫", String.raw`$\quad x$`],
    [String.raw`$\quad\left.\middle.‸\right.x$`, "⌦", String.raw`$\quad x$`],
    [String.raw`$\alpha\left(‸x\right)$`, "⌫", String.raw`$\alpha x$`],
  ])("keeps command terminators when unwrapping %s with %s", (marked, key, expected) => {
    const result = replay(marked, [key]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(expected);
  });

  it("keeps named delimiters apart from text when extending a pair", () => {
    const result = replay("Fourt‸h", [String.raw`\left\langle␣`, String.raw`\right)`, "s", String.raw`\right]`]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(String.raw`Fourt$\left\langle s\right]$h`);
    const extended = replay(String.raw`$\left(\alpha\right)x‸$`, [String.raw`\right]`]);
    expect(extended.failure, JSON.stringify(extended.states)).toBeNull();
    expect(extended.finalText).toBe(String.raw`$\left(\alpha x\right]$`);
  });

  it("does not insert a spurious math closer after a completed macro definition", () => {
    const source = String.raw`\renewcommand{\foo}{local} ‸` + "${}$2";
    const result = replay(source, ["@fix"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(source.replace("‸", ""));
  });

  it("keeps a visible label when Enter splits an otherwise empty last item", () => {
    const source = String.raw`\begin{description}\item[Keep] \end{description}`;
    const view = createEditView(buildEditTree(source, { commands }));
    const item = view.tree.nodes.find(node => node.kind === "item")!;
    const content = view.tree.slots.find(slot => slot.node === item.id && slot.role === "flow")!;
    const caret = { slot: content.id, index: 0 };
    const result = enter(view, caret, view.offset(caret), "enter");
    expect(result.kind).toBe("patch");
    if (result.kind !== "patch") throw new Error("Expected an item split");
    const after = applyPatches(source, result.patches);
    expect(after).toContain(String.raw`\item[Keep]`);
    expect(after.match(/\\item/gu)).toHaveLength(2);
  });

  it.each(["l", ">{$}c<{$}"])("uses the editable cell mode at a %s column boundary", (spec) => {
    const source = `\\begin{tabular}{${spec}}\nx\n‸\\end{tabular}`;
    const result = replay(source, [String.raw`\left\langle␣`]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    const pair = String.raw`\left\langle\right\rangle`;
    expect(result.finalText).toBe(source.replace("‸", spec === "l" ? `$${pair}$` : pair));
  });

  it.each(["pmatrix", "aligned"])("refuses unsupported table rules in %s without hiding later content", (environment) => {
    const marked = `\\[\\begin{${environment}}a&b\\\\c&d‸\\end{${environment}}\\begin{pmatrix}x\\\\y\\end{pmatrix}\\]`;
    const result = replay(marked, [String.raw`\hline`, "["]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(marked.replace("‸", ""));
  });

  it("ends a row before a newly inserted array rule", () => {
    const result = replay(String.raw`\[\begin{array}{c}a‸\end{array}\]`, [String.raw`\hline`, "␣"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(String.raw`a\\ \hline`);
  });

  it("binds rules and comments in the first math column's mode", () => {
    const result = replay(String.raw`\begin{tabular}{>{$}c<{$}l}x^2 & Al‸pha\\ & Beta\end{tabular}`, [String.raw`\hline`, String.raw`\mathbb`, "␣"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    const tree = buildEditTree("\\begin{tabular}{>{$}c<{$}l}% comment\n\\hline x&y\\end{tabular}", { commands });
    for (const node of tree.nodes.filter(node => node.kind === "invisible" && node.parent != null)) {
      expect(node.mode).toBe(tree.slots[node.parent!].mode);
    }
  });

  it.each([
    ["l>{$}c<{$}>{$}r<{$}", String.raw`a & b & c‸\left|\right|`, String.raw`& & \left|\right|`],
    [">{$}c<{$}l", String.raw`a & b‸text`, "& text"],
    ["ll", "a & b‸text", "text"],
  ])("preserves cell modes when splitting a %s table", (spec, body, tail) => {
    const result = replay(`\\begin{tabular}{${spec}}${body}\\end{tabular}`, ["⏎"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(`\n${tail}\\end{tabular}`);
  });

  it.each(["}", "x"])("keeps %s out of an end command after unnesting a whitespace-only item", (key) => {
    const marked = String.raw`\begin{itemize}\item \begin{enumerate}\item First nested text.\item \begin{enumerate}\item First child text.\item Second child text.‸\end{enumerate}\end{enumerate}\end{itemize}`;
    const result = replay(marked, ["@91:132", "⌫", "⇧⇥", key]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).not.toContain(String.raw`\begin{enumerate}\item First child`);
    if (key === "x") expect(result.finalText).toContain(String.raw`\item{}x\end{enumerate}`);
  });

  it.each([
    [String.raw`\on‸ly`, "⌦", String.raw`\ony`],
    [String.raw`\onl‸y`, "⌫", String.raw`\ony`],
    [String.raw`\item‸x[`, "⌦", String.raw`\item[`],
    [String.raw`\\‸x[`, "⌦", String.raw`\\[`],
  ])("deletes literally in listings: %s", (body, key, expected) => {
    const result = replay("\\begin{lstlisting}\n" + body + "\n\\end{lstlisting}", [key]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe("\\begin{lstlisting}\n" + expected + "\n\\end{lstlisting}");
  });

  it.each(["centering", "bf"])("terminates %s when reopening a declaration group after an item split", (declaration) => {
    const marked = `\\begin{itemize}\\item {\\${declaration}\\emph{Before} Insi‸de.}\\end{itemize}`;
    const result = replay(marked, ["⏎"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(`{\\${declaration} de.}`);
  });

  it("does not put delimiter formulas inside line-break spacing", () => {
    const result = replay("Text‸ tail.", [String.raw`\\`, "[", String.raw`\left[`]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(String.raw`Text\\[] tail.`);
  });

  it.each([
    [String.raw`$\sum‸_{i=1}^{n}x_i$`, "${\\sum x^2}_{i=1}^{n}x_i$"],
    [String.raw`$y‸_i^n$`, "${yx^2}_i^n$"],
    [String.raw`$‸y_i^n$`, "${x^2y}_i^n$"],
  ])("keeps pasted scripts inside the base of %s", (marked, expected) => {
    const result = replay(marked, ["@paste-text:20"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(expected);
  });

  it("keeps Enter in the item after deleting its leading text before a block", () => {
    const marked = String.raw`{\small\begin{enumerate}\item ‸Before. \begin{alertblock}{Panel}Inside.\end{alertblock}\item After.\end{enumerate}}`;
    const result = replay(marked, [...Array.from({ length: 7 }, () => "⇧→"), "⏎"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText.match(/\\item/gu)).toHaveLength(3);
    expect(result.finalText).toContain(String.raw`\begin{alertblock}{Panel}Inside.\end{alertblock}`);
  });

  it("terminates a table rule when joining an empty first row", () => {
    const result = replay(String.raw`\begin{tabular}{l}\toprule \\ ‸a\end{tabular}`, ["⌫"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(String.raw`\toprule{}a`);
  });

  it.each(["<+->", "[label]"])("keeps %s visible when an item splits immediately before it", (text) => {
    const label = text.startsWith("[") ? "[Old]" : "";
    const result = replay(`\\begin{enumerate}\\item<1->${label} ‸${text}\\end{enumerate}`, ["⏎"]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(`\\item {}${text}`);
  });

  it.each([String.raw`\left[`, String.raw`\frac␣`, String.raw`\(`])("does not commit %s inside pause options", (command) => {
    const result = replay("Text‸tail.", [String.raw`\pause`, "[", command]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(String.raw`Text\pause[]tail.`);
  });

  it.each(["$x$", String.raw`\(x\)`])("does not wrap opaque macro arguments already containing %s in math", (math) => {
    const table = createCommandTable({ macros: new Map([["\\pair", {
      kind: "callable" as const, parameterCount: 2, body: "#1: #2", provenance: []
    }]]) });
    const result = replay(`Before ‸\\pair{A}{Estimate ${math}.} After.`, ["⌦", "$", "@fix"], table);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe("Before ${}$ After.");
  });

  it("still wraps an opaque macro with an escaped dollar in math", () => {
    const table = createCommandTable({ macros: new Map([["\\pair", {
      kind: "callable" as const, parameterCount: 2, body: "#1: #2", provenance: []
    }]]) });
    const result = replay(String.raw`Before ‸\pair{A}{Estimate \$5.} After.`, ["⌦", "$", "@fix"], table);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(String.raw`Before $\pair{A}{Estimate \$5.}$ After.`);
  });

  it.each(["⌫", "⌦"])("moves into the radicand when %s removes an empty root index", (key) => {
    const result = replay(String.raw`$\sqrt[‸]{s}$`, [key, String.raw`\left(`]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toBe(String.raw`$\sqrt{\left(\right)s}$`);
  });

  it("starts a new inline formula after leaving a display", () => {
    const result = replay("Text\n" + String.raw`\[x^2‸\]` + "\n\nTail", ["⏎", String.raw`\left|`]);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
    expect(result.finalText).toContain(String.raw`$\left|\right|$`);
  });

  it.each([["⇧←", "⌘B"], ["⌘B"]])("preserves a text-only footnote when toggling its wrapper with %s", (...tokens) => {
    const result = replay(String.raw`$x\textbf{\footnote{50\% more}‸}$`, tokens);
    expect(result.failure, JSON.stringify(result.states)).toBeNull();
  });
});
