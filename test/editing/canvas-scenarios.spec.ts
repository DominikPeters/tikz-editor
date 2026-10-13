import { describe, expect, it } from "vitest";
import { runScenario } from "../../packages/core/src/editing/testing/index.js";
import { editingHint, resolveIntent, type InteractionState } from "../../packages/core/src/editing/input/index.js";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { createEditView, hoverSource, revealedCodes } from "../../packages/core/src/editing/position/index.js";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { applyPatches } from "../../packages/core/src/editing/transaction/index.js";
import { canvasSessionDriver } from "./canvas-session-driver.js";
import { KeystrokeSession } from "./fuzz/keystroke-session.js";
import { parseScenarioKeys } from "../../packages/core/src/editing/testing/index.js";
import { constructMenu, constructMenuEdit, copyRange } from "../../packages/core/src/editing/operations/index.js";

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
    ["a caption's words are copied without the caption", R`\caption{A ⟦long⟧ title} and ‸`, undefined, R`\caption{A long title} and long‸`],
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

/** Keys, then pointer picks (`@ghost`, `@complete:n`), from a caret marked `‸`. */
function pointerPicks(body: string, keys: readonly string[]): string {
  const caret = body.indexOf("‸");
  const session = new KeystrokeSession(body.replace("‸", ""), createCommandTable(), caret, caret);
  for (const token of keys) {
    const complete = /^@complete:(\d+)$/u.exec(token);
    if (token === "@ghost") {
      session.press({ kind: "ghost" });
    } else if (complete) {
      session.press({ kind: "complete", index: Number(complete[1]) });
    } else {
      for (const key of parseScenarioKeys(token)) {
        session.press(key);
      }
    }
  }
  const { focus } = session.selection;
  return `${session.text.slice(0, focus)}‸${session.text.slice(focus)}`;
}

describe("canvas editing: ghost slots (V3) and picked completions (V2)", () => {
  it.each([
    ["a root's index", R`$\sqrt{x‸}$`, ["@ghost", "3"], R`$\sqrt[3‸]{x}$`],
    ["the superscript a subscripted atom lacks", R`$a_{1‸} + b$`, ["@ghost", "2"], R`$a_{1}^2‸ + b$`],
    ["the subscript a superscripted atom lacks", R`$c^{2‸}$`, ["@ghost", "i"], R`$c^{2}_i‸$`],
    ["a description item's label", "\\begin{description}\n\\item ‸two\n\\end{description}", ["@ghost", "A"], "\\begin{description}\n\\item[A‸] two\n\\end{description}"],
    ["nothing where the construct has every slot", R`$\sqrt[3]{x‸}$`, ["@ghost"], R`$\sqrt[3]{x‸}$`],
    ["nothing for an itemize item", "\\begin{itemize}\n\\item ‸two\n\\end{itemize}", ["@ghost"], "\\begin{itemize}\n\\item ‸two\n\\end{itemize}"],
  ])("a ghost slot clicked writes %s", (_, body, keys, expected) => {
    expect(pointerPicks(body, keys)).toBe(expected);
  });

  it("a completion picked with the pointer commits as ⇥ does on it", () => {
    expect(pointerPicks(R`$A‸$`, [R`\setm`, "@complete:0", "␣B"])).toBe(R`$A\setminus B‸$`);
    const picked = pointerPicks(R`$a‸$`, [R`\al`, "@complete:1"]);
    expect(picked).toBe(pointerPicks(R`$a‸$`, [R`\al`, "↓", "⇥"]));
  });
});

/** The focus tag's menu (V4) for the construct whose source starts at `‸`'s construct, picked by entry id. */
function menuEdit(body: string, construct: string, id: string): string | null {
  const caret = body.indexOf("‸");
  const text = body.replace("‸", "");
  const commands = createCommandTable();
  const view = createEditView(buildEditTree(text, { commands }));
  const from = text.indexOf(construct);
  const node = view.tree.nodes.find((candidate) => candidate.parent != null && candidate.span.from === from && candidate.span.to === from + construct.length);
  const edit = node ? constructMenuEdit(view, node.id, id, commands, caret) : null;
  if (!edit || edit.kind !== "patch") {
    return null;
  }
  const after = applyPatches(text, edit.patches);
  return `${after.slice(0, edit.caret)}‸${after.slice(edit.caret)}`;
}

describe("canvas editing: the focus tag's menu (V4)", () => {
  it("offers a construct's variants and what can be done to it whole", () => {
    const commands = createCommandTable();
    const text = R`a \textbf{bold} $\frac{1}{2}$ $\sqrt{x}$`;
    const view = createEditView(buildEditTree(text, { commands }));
    const ids = (construct: string) => {
      const from = text.indexOf(construct);
      const node = view.tree.nodes.find((candidate) => candidate.span.from === from && candidate.span.to === from + construct.length)!;
      return constructMenu(view, node.id, commands).map((entry) => entry.id);
    };
    expect(ids(R`\textbf{bold}`)).toEqual(expect.arrayContaining(["variant:textit", "variant:emph", "unwrap", "select", "lens"]));
    expect(ids(R`\textbf{bold}`)).not.toContain("variant:textbf");
    expect(ids(R`\frac{1}{2}`)).toEqual(["variant:dfrac", "variant:tfrac", "select", "lens"]);
    expect(ids(R`$\sqrt{x}$`)).toEqual(["variant:display", "select", "lens"]);
  });

  it.each([
    ["a style for another, the caret kept", R`a \textbf{bo‸ld} b`, R`\textbf{bold}`, "variant:emph", R`a \emph{bo‸ld} b`],
    ["a fraction for a display one", R`$\frac{1‸}{2}$`, R`\frac{1}{2}`, "variant:dfrac", R`$\dfrac{1‸}{2}$`],
    ["an inline formula for a display", R`Let $x+‸y$ be`, R`$x+y$`, "variant:display", R`Let \[x+‸y\] be`],
    ["a display for an inline formula", R`\[x‸\]`, R`\[x\]`, "variant:inline", R`$x‸$`],
    ["Unwrap keeps the content and the caret in it", R`a \textbf{bo‸ld} b`, R`\textbf{bold}`, "unwrap", R`a bo‸ld b`],
    ["Unwrap after a control word keeps it a word", R`$\alpha\sqrt{x‸}$`, R`\sqrt{x}`, "unwrap", R`$\alpha x‸$`],
    ["Unwrap of a control word before a letter keeps it a word", R`see \textbf{\LaTeX‸}x`, R`\textbf{\LaTeX}`, "unwrap", R`see \LaTeX‸{}x`],
  ])("%s", (_, body, construct, id, expected) => {
    expect(menuEdit(body, construct, id)).toBe(expected);
  });

  it("offers a display only where TeX takes one: in a paragraph, not a table cell", () => {
    const commands = createCommandTable();
    const text = "\\begin{tabular}{l}\n$x$ \\\\\n\\end{tabular}";
    const view = createEditView(buildEditTree(text, { commands }));
    const node = view.tree.nodes.find((candidate) => candidate.kind === "formula")!;
    expect(constructMenu(view, node.id, commands).map((entry) => entry.id)).not.toContain("variant:display");
  });

  it("does not unwrap a construct with nothing to keep", () => {
    expect(menuEdit(R`$\sqrt{‸}$`, R`\sqrt{}`, "unwrap")).toBeNull();
  });
});

describe("canvas editing: the hint line (V7)", () => {
  const hintAt = (body: string, interaction: InteractionState = {}, promoted = false) => {
    const caret = body.indexOf("‸");
    const view = createEditView(buildEditTree(body.replace("‸", "")));
    return editingHint(view, view.index.resolve(caret, "after")!, interaction, promoted)?.text ?? null;
  };
  it.each([
    ["in a superscript", R`$x^{2‸}$`, {}, false, "superscript · → to leave"],
    ["in a numerator", R`$\frac{1‸}{2}$`, {}, false, "numerator · ⇥ to the denominator"],
    ["in an alignment cell", "\\begin{align*}\na &= b‸\n\\end{align*}", {}, false, "cell · ⇥ next cell · ⏎ new row"],
    ["while the chip is open", R`a‸`, { chip: { name: "fr", at: 1, selected: 0, held: null } }, false, "command · ⇥ to accept · ␣ as typed · esc to cancel"],
    ["for a promoted selection", R`a‸ b`, {}, true, "selection extended to the whole construct"],
    ["nowhere in plain prose", R`a‸ b`, {}, false, null],
  ] as const)("%s", (_, body, interaction, promoted, expected) => {
    expect(hintAt(body, interaction as InteractionState, promoted)).toBe(expected);
  });
});

describe("canvas editing: hover reveals source (V5)", () => {
  it.each([
    ["a symbol", R`$A\setminus B$`, R`\setminus`, R`\setminus`],
    ["a symbol macro", R`$x\in\R$`, R`\R`, R`\R`],
    ["a style run, its content elided", R`a \textbf{bold} b`, "ol", R`\textbf{…}`],
    ["a fraction", R`$\frac{1}{2}$`, "1", R`\frac{…}{…}`],
  ])("%s", (_, text, under, expected) => {
    const view = createEditView(buildEditTree(text));
    expect(hoverSource(view, text.indexOf(under))?.text).toBe(expected);
  });

  it("nothing for plain text", () => {
    const view = createEditView(buildEditTree("plain words"));
    expect(hoverSource(view, 3)).toBeNull();
  });
});

describe("canvas editing: reveal codes (R14, B4)", () => {
  const press = (body: string, intent: Parameters<typeof resolveIntent>[1], revealCodes: boolean) => {
    const caret = body.indexOf("‸");
    const text = body.replace("‸", "");
    const resolution = resolveIntent({
      surface: "canvas", editMode: "default", isScopeSession: true, revision: 0, text, bufferFrom: 0,
      anchor: caret, focus: caret, composition: null, domain: null, verticalGoal: null,
      structure: (source, visibility) => createEditView(buildEditTree(source), visibility),
      positions: null, interaction: {}, commands: createCommandTable(), revealCodes,
    }, intent);
    if (resolution.kind !== "transaction") {
      return null;
    }
    const { patches, selection } = resolution.transaction;
    const after = applyPatches(text, patches);
    if (selection.kind !== "absolute") {
      return after;
    }
    const [from, to] = [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)];
    return from === to ? `${after.slice(0, from)}‸${after.slice(from)}` : `${after.slice(0, from)}⟦${after.slice(from, to)}⟧${after.slice(to)}`;
  };
  const backspace = { type: "deleteBackward", unit: "item", origin: "keyboard", repeat: false } as const;
  const left = { type: "move", dir: "left", unit: "item", extend: false, origin: "keyboard", repeat: false } as const;

  it("⌫ after a revealed \\pause selects it; without reveal codes it is passed over", () => {
    expect(press(R`First.\pause‸ Second.`, backspace, true)).toBe(R`First.⟦\pause ⟧Second.`);
    expect(press(R`First.\pause‸ Second.`, backspace, false)).toBe(R`First‸\pause Second.`);
  });

  it("← stops on both sides of a revealed comment", () => {
    expect(press("a % note\n‸b", left, true)).toBe("a ‸% note\nb");
  });

  it("labels the codes it reveals", () => {
    const text = "First.\\pause Second. % TODO cite\nThird $x=0\\label{eq:a}$.\n\\vspace{1em}\nLast \\small x \\LaTeX{} y";
    expect(revealedCodes(createEditView(buildEditTree(text))).map((code) => code.label))
      .toEqual(["⏸ pause", "% TODO cite", "label eq:a", "vspace 1em"]);
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
