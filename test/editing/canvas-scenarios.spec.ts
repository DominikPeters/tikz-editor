import { describe, expect, it } from "vitest";
import { runScenario } from "../../packages/core/src/editing/testing/index.js";
import { resolveIntent } from "../../packages/core/src/editing/input/index.js";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { createEditView } from "../../packages/core/src/editing/position/index.js";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { applyPatches } from "../../packages/core/src/editing/transaction/index.js";
import { canvasSessionDriver } from "./canvas-session-driver.js";
import { KeystrokeSession } from "./fuzz/keystroke-session.js";
import { parseScenarioKeys } from "../../packages/core/src/editing/testing/index.js";
import { copyRange } from "../../packages/core/src/editing/operations/index.js";

const R = String.raw;
import {
  burstScenarios,
  characterisationScenarios,
  chipScenarios,
  contractScenarios,
  inputRuleScenarios,
  structuralKeyScenarios,
  texValidityScenarios,
  treeEditingScenarios,
  undoScenarios,
} from "./scenarios.js";

const eager = canvasSessionDriver("eager");
const burst = canvasSessionDriver("burst");

describe("canvas editing: today's behaviour", () => {
  for (const scenario of characterisationScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: the edit tree", () => {
  for (const scenario of treeEditingScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: input rules", () => {
  for (const scenario of inputRuleScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: structural keys", () => {
  for (const scenario of structuralKeyScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: the command chip", () => {
  for (const scenario of chipScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: source TeX accepts", () => {
  for (const scenario of texValidityScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }

  // (The scenario documents give the frame a title; here the body follows `\begin{frame}` directly.)
  it.each([
    ["typed", "\nText", 1, ["["], "\n\\relax[Text"],
    ["left by a deletion", "\nx[draft] Text", 2, ["⌫"], "\n\\relax[draft] Text"],
    ["typed as <", "\nText", 1, ["<"], "\n\\relax<Text"],
  ])("X11: a [ or < %s at a frame body's start is not read by the frame's header", (_, body, caret, keys, expected) => {
    const session = new KeystrokeSession(body, createCommandTable(), caret, caret, false, true);
    for (const key of keys.flatMap((token) => parseScenarioKeys(token))) {
      session.press(key);
    }
    expect(session.text).toBe(expected);
  });
});

/**
 * A paste: `‸` is where it goes; `⟦…⟧` (when present) is copied on the
 * canvas first, otherwise `plain` is pasted from outside.
 */
function paste(body: string, plain?: string, options: { title?: boolean } = {}): string {
  let text = "";
  const marks = new Map<string, number>();
  for (const char of body) {
    if ("⟦⟧‸".includes(char)) {
      marks.set(char, text.length);
    } else {
      text += char;
    }
  }
  const caret = marks.get("‸")!;
  const copy = marks.has("⟦") ? { from: marks.get("⟦")!, to: marks.get("⟧")! } : null;
  const session = new KeystrokeSession(text, createCommandTable(), caret, caret, options.title ?? false);
  if (copy) {
    session.press({ kind: "select", anchor: copy.from, focus: copy.to });
    session.press({ kind: "copy" });
    session.press({ kind: "select", anchor: caret, focus: caret });
  }
  session.press({ kind: "paste", plain });
  const { anchor, focus } = session.selection;
  return anchor === focus ? `${session.text.slice(0, focus)}‸${session.text.slice(focus)}` : session.text;
}

describe("canvas editing: paste (O6)", () => {
  it.each([
    ["outside text in prose is literal (C1)", "a ‸ b", "Costs rose 50% at R&D", R`a Costs rose 50\% at R\&D‸ b`],
    ["every TeX special is escaped in prose (C2)", "a ‸", "$x^2$ {y} ~_#", R`a \$x\^{}2\$ \{y\} \~{}\_\#‸`],
    ["a backslash in prose is shown", "‸", "C:\\dir", R`C:\textbackslash{}dir‸`],
    ["newlines in prose become spaces, blank lines paragraphs", "‸", "one\ntwo\n\nthree", "one two\n\nthree‸"],
    ["blank lines in a style's argument become spaces", R`\textbf{‸}`, "one\n\ntwo", R`\textbf{one two‸}`],
    ["blank lines in a title become spaces", "T‸", "one\n\ntwo", "Tone two‸", { title: true }],
    ["math characters keep their meaning in math", R`$‸$`, "x^2 + y_i", R`$x^2 + y_i‸$`],
    ["a script without a base is shown, not made", R`$‸$`, "^2 and _", R`$\text{\textasciicircum}2 and \_‸$`],
    ["a second superscript on one base is shown", R`$‸$`, "x^2^3", R`$x^2\text{\textasciicircum}3‸$`],
    ["a number as a script is braced", R`$‸$`, "x^10", R`$x^{10}‸$`],
    ["breaking characters are escaped in math", R`$‸$`, "{a} % b & c $", R`$\{a\} \% b \& c \$‸$`],
    ["a ] in an item label is braced", R`\begin{itemize}\item[‸] x\end{itemize}`, "a]", R`\begin{itemize}\item[a{]}‸] x\end{itemize}`],
    ["a [ after \\item is not its label", R`\begin{itemize}\item ‸x\end{itemize}`, "[draft]", R`\begin{itemize}\item {}[draft]‸x\end{itemize}`],
    ["a letter after a control word keeps it a word", R`\LaTeX‸`, "is", R`\LaTeX{}is‸`],
    ["a formula fragment pasted into prose is a formula (Z3)", R`$⟦\lambda_i⟧$ and ‸`, undefined, R`$\lambda_i$ and $\lambda_i$‸`],
    ["a whole formula pasted into math loses its delimiters", R`⟦$x$⟧ and $y+‸$`, undefined, R`$x$ and $y+x‸$`],
    ["prose pasted into math is \\text", R`⟦word⟧ $x‸$`, undefined, R`word $x\text{word}‸$`],
    ["a copy through a style keeps it whole", R`\textbf{a⟦b} c⟧ ‸`, undefined, R`\textbf{ab} c \textbf{b} c‸`],
    ["items pasted outside a list fall back to their text", "\\begin{itemize}\n⟦\\item One\n\\item Two⟧\n\\end{itemize}\nx‸", undefined, "\\begin{itemize}\n\\item One\n\\item Two\n\\end{itemize}\nxOne Two‸"],
    ["items pasted into a list stay items", "\\begin{itemize}\n⟦\\item One\n⟧\\item Two‸\n\\end{itemize}", undefined, "\\begin{itemize}\n\\item One\n\\item Two\\item One\n‸\n\\end{itemize}"],
  ] as const)("%s", (_, body, plain, expected, options?: { readonly title?: boolean }) => {
    expect(paste(body, plain, options)).toBe(expected);
  });
});

describe("canvas editing: plain-text copy", () => {
  it.each([
    [R`Stra\ss e \copyright{}`, "Straße ©"],
    [R`Fran\c cais caf\'{e} \v{s}`, "Français café š"],
    [R`\ae{} \OE{} \o{} \AA{} \textbullet{} \S{} \P{}`, "æ Œ ø Å • § ¶"],
    [R`\textbar{} \textasciitilde{} \textasciicircum{} \textquoteleft{} \textquoteright{}`, "| ~ ^ ‘ ’"],
  ])("preserves the visible symbols of %s", (source, expected) => {
    const commands = createCommandTable();
    const payload = copyRange(createEditView(buildEditTree(source, { commands })), 0, source.length, commands);
    expect(payload?.plain).toBe(expected);
    expect(payload?.clip?.source).toBe(source);
  });
});

describe("canvas editing: undo groups", () => {
  for (const scenario of undoScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: typing ahead of layout", () => {
  for (const scenario of burstScenarios) {
    it(`${scenario.id}: ${scenario.title} (rendering after every key)`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
  for (const scenario of [...burstScenarios, ...characterisationScenarios, ...treeEditingScenarios, ...inputRuleScenarios, ...structuralKeyScenarios, ...chipScenarios, ...texValidityScenarios, ...undoScenarios]) {
    it(`${scenario.id}: ${scenario.title} (no rendering between keys)`, async () => {
      const { actual, expected } = await runScenario(burst, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: contracts from the scenarios doc", () => {
  for (const scenario of contractScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }

  it("O4: a [ committed by composition does not open \\\\'s optional argument", () => {
    const text = String.raw`a\\ b`;
    const caret = text.indexOf("b");
    const resolution = resolveIntent({
      surface: "canvas",
      editMode: "default",
      isScopeSession: true,
      revision: 0,
      text,
      bufferFrom: 0,
      anchor: caret,
      focus: caret,
      composition: null,
      domain: null,
      verticalGoal: null,
      structure: (source) => createEditView(buildEditTree(source)),
      positions: null,
      interaction: {},
      commands: createCommandTable(),
    }, { type: "compose", text: "[", commit: true, origin: "composition", repeat: false });
    expect(resolution.kind).toBe("transaction");
    const { transaction } = resolution as Extract<typeof resolution, { kind: "transaction" }>;
    expect(applyPatches(text, transaction.patches)).toBe(String.raw`a\\ {}[b`);
  });
  it.todo("O8: cancelling the \\textcolor picker restores the selection and writes nothing");
});
