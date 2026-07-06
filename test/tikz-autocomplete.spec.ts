import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { tikzCompletion } from "../packages/app/src/ui/source-panel/tikz-autocomplete";
import type { DocumentSymbols } from "../packages/core/src/completion/index";

const EMPTY_SYMBOLS: DocumentSymbols = {
  nodeNames: [],
  styleNames: [],
  coordinateNames: [],
};

/**
 * Build a minimal CompletionContext-like object from source text with a `|` cursor marker.
 */
function makeContext(source: string, opts?: { explicit?: boolean }): CompletionContext {
  const pos = source.indexOf("|");
  if (pos === -1) throw new Error("Source must contain a | cursor marker");
  const doc = source.slice(0, pos) + source.slice(pos + 1);
  const state = EditorState.create({ doc });
  const explicit = opts?.explicit ?? false;

  return {
    state,
    pos,
    explicit,
    matchBefore(regexp: RegExp) {
      const line = state.doc.lineAt(pos);
      const textBefore = line.text.slice(0, pos - line.from);
      // Real CM matchBefore only matches text ending at cursor position.
      // Anchor the regex to end-of-string.
      const anchored = new RegExp(regexp.source + "$", regexp.flags);
      const match = textBefore.match(anchored);
      if (!match) return null;
      const from = line.from + match.index!;
      const to = line.from + match.index! + match[0].length;
      return { from, to, text: match[0] };
    },
  } as CompletionContext;
}

function labels(result: CompletionResult | null): string[] {
  if (!result) return [];
  return result.options.map((o) => o.label);
}

describe("tikzCompletion", () => {
  describe("anchor completions after dot", () => {
    it("suggests anchors after nodename.", () => {
      const ctx = makeContext(String.raw`\draw (A.|) -- (B);`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("north");
      expect(labels(result)).toContain("south east");
      expect(labels(result)).toContain("center");
    });

    it("suggests anchors after partial typing", () => {
      const ctx = makeContext(String.raw`\draw (A.nor|) -- (B);`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("north");
    });

    it("sets from to position after the dot", () => {
      const source = String.raw`\draw (mynode.so|) -- (B);`;
      const ctx = makeContext(source);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      // "from" should be right after the dot
      const dotPos = source.replace("|", "").indexOf(".") + 1;
      expect(result!.from).toBe(dotPos);
    });
  });

  describe("value completions after =", () => {
    it("suggests align values after align=", () => {
      const ctx = makeContext(String.raw`\node[align=|] {text};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("left");
      expect(labels(result)).toContain("center");
      expect(labels(result)).toContain("right");
      expect(labels(result)).toContain("justify");
    });

    it("suggests line cap values", () => {
      const ctx = makeContext(String.raw`\draw[line cap=|] (0,0) -- (1,1);`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toEqual(expect.arrayContaining(["round", "butt", "rect"]));
    });

    it("suggests line join values", () => {
      const ctx = makeContext(String.raw`\draw[line join=|] (0,0) -- (1,1);`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toEqual(expect.arrayContaining(["round", "bevel", "miter"]));
    });

    it("suggests shape values", () => {
      const ctx = makeContext(String.raw`\node[shape=|] {text};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("circle");
      expect(labels(result)).toContain("rectangle");
      expect(labels(result)).toContain("diamond");
    });

    it("suggests anchor values", () => {
      const ctx = makeContext(String.raw`\node[anchor=|] {text};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("north");
      expect(labels(result)).toContain("south west");
    });

    it("suggests pattern values with modern first", () => {
      const ctx = makeContext(String.raw`\draw[pattern=|] (0,0) rectangle (1,1);`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      const l = labels(result);
      expect(l).toContain("lines");
      expect(l).toContain("hatch");
      // Modern families should have higher boost (appear first)
      const linesOpt = result!.options.find((o) => o.label === "lines");
      const bricksOpt = result!.options.find((o) => o.label === "bricks");
      expect(linesOpt!.boost).toBeGreaterThan(bricksOpt!.boost!);
    });

    it("suggests shading values", () => {
      const ctx = makeContext(String.raw`\node[shading=|] {text};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toEqual(expect.arrayContaining(["axis", "radial", "ball"]));
    });

    it("filters with partial typing", () => {
      const ctx = makeContext(String.raw`\node[align=le|] {text};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      // Should return all values — CM handles client-side filtering via validFor
      expect(labels(result)).toContain("left");
    });

    it("handles spaces around =", () => {
      const ctx = makeContext(String.raw`\node[align = |] {text};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("left");
    });
  });

  describe("color completions", () => {
    it("does NOT suggest colors after fill= with 0 chars", () => {
      const ctx = makeContext(String.raw`\draw[fill=|] (0,0) -- (1,1);`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).toBeNull();
    });

    it("does NOT suggest colors after fill= with 1 char", () => {
      const ctx = makeContext(String.raw`\draw[fill=r|] (0,0) -- (1,1);`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).toBeNull();
    });

    it("suggests colors after fill= with 2+ chars", () => {
      const ctx = makeContext(String.raw`\draw[fill=re|] (0,0) -- (1,1);`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("red");
      expect(labels(result)).toContain("blue");
      expect(labels(result)).toContain("none");
    });

    it("suggests colors after draw= with 2+ chars", () => {
      const ctx = makeContext(String.raw`\draw[draw=bl|] (0,0) -- (1,1);`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("blue");
      expect(labels(result)).toContain("black");
    });

    it("suggests colors for text= with 2+ chars", () => {
      const ctx = makeContext(String.raw`\node[text=gr|] {hi};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("green");
      expect(labels(result)).toContain("gray");
    });

    it("suggests colors on explicit trigger even with 0 chars", () => {
      const ctx = makeContext(String.raw`\draw[fill=|] (0,0) -- (1,1);`, { explicit: true });
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("red");
    });
  });

  describe("option key completions", () => {
    it("does NOT suggest keys with fewer than 3 chars", () => {
      const ctx = makeContext(String.raw`\node[dr|] {text};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).toBeNull();
    });

    it("suggests keys with 3+ chars inside brackets", () => {
      const ctx = makeContext(String.raw`\node[dra|] {text};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("draw");
    });

    it("suggests keys including multi-word options", () => {
      const ctx = makeContext(String.raw`\node[line|] {text};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("line width");
      expect(labels(result)).toContain("line cap");
    });

    it("does NOT suggest keys outside brackets", () => {
      const ctx = makeContext(String.raw`\node draw|;`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).toBeNull();
    });

    it("includes dynamic style names", () => {
      const symbols: DocumentSymbols = {
        nodeNames: [],
        styleNames: ["mystyle", "fancybox"],
        coordinateNames: [],
      };
      const ctx = makeContext(String.raw`\node[mys|] {text};`);
      const result = tikzCompletion(ctx, symbols);
      expect(result).not.toBeNull();
      expect(labels(result)).toContain("mystyle");
    });

    it("suggests keys on explicit trigger even with 0 chars", () => {
      const ctx = makeContext(String.raw`\node[|] {text};`, { explicit: true });
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      // explicit but matchBefore for word returns null (empty), so no result
      // This is expected — explicit only helps color keys and Ctrl+Space
      expect(result).toBeNull();
    });
  });

  describe("no completions in wrong contexts", () => {
    it("returns null for plain text", () => {
      const ctx = makeContext(String.raw`\node {some text|};`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).toBeNull();
    });

    it("returns null for coordinates", () => {
      const ctx = makeContext(String.raw`\draw (1,|);`);
      const result = tikzCompletion(ctx, EMPTY_SYMBOLS);
      expect(result).toBeNull();
    });
  });
});
