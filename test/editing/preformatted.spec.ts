import { describe, expect, it } from "vitest";
import { createCommandTable } from "../../packages/core/src/editing/commands/table.js";
import { parseMarkedSource, parseScenarioKeys } from "../../packages/core/src/editing/testing/index.js";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { checkEditTree } from "../../packages/core/src/editing/tree/invariants.js";
import { KeystrokeSession } from "./fuzz/keystroke-session.js";

const commands = createCommandTable();

describe("preformatted editing", () => {
  it.each(["lstlisting", "alltt"])("types special characters literally in %s", environment => {
    for (const char of "%$&_~^") {
      const { source: text, selection: { anchor, focus } } = parseMarkedSource(String.raw`\begin{${environment}}A‸B\end{${environment}}`);
      const session = new KeystrokeSession(text, commands, anchor, focus);
      for (const key of parseScenarioKeys(char)) session.press(key);
      expect(session.text).toBe(text.slice(0, anchor) + char + text.slice(anchor));
      expect(checkEditTree(session.view().tree)).toEqual([]);
    }
  });
  it("keeps alltt's braces active and special characters literal within a style", () => {
    const source = String.raw`\begin{alltt}\textbf{a% $ _}\end{alltt}`;
    const tree = buildEditTree(source);
    expect(tree.diagnostics).toEqual([]);
    expect(checkEditTree(tree)).toEqual([]);
    const style = tree.nodes.find(node => node.command === "textbf")!;
    expect(tree.slots[style.slots[0]].mode).toBe("verbatim");
    const { source: text, selection: { anchor, focus } } = parseMarkedSource(String.raw`\begin{alltt}A‸B\end{alltt}`);
    const session = new KeystrokeSession(text, commands, anchor, focus);
    for (const key of parseScenarioKeys("{")) session.press(key);
    expect(session.text).toBe(text.slice(0, anchor) + "{}" + text.slice(anchor));
  });
});
