import { describe, it, expect } from "vitest";
import { expandTexConditionals } from "@tikz-editor/core/conditionals/expand.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

describe("expandTexConditionals", () => {
  describe("\\ifnum", () => {
    it("true branch with <", () => {
      expect(expandTexConditionals("\\ifnum 3<5 yes\\else no\\fi")).toBe("yes");
    });

    it("false branch with <", () => {
      expect(expandTexConditionals("\\ifnum 5<3 yes\\else no\\fi")).toBe(" no");
    });

    it("true branch with >", () => {
      expect(expandTexConditionals("\\ifnum 5>3 yes\\fi")).toBe("yes");
    });

    it("false branch with > and no \\else", () => {
      expect(expandTexConditionals("\\ifnum 1>3 yes\\fi")).toBe("");
    });

    it("equality", () => {
      expect(expandTexConditionals("\\ifnum 3=3 yes\\else no\\fi")).toBe("yes");
      expect(expandTexConditionals("\\ifnum 3=4 yes\\else no\\fi")).toBe(" no");
    });

    it("negative numbers", () => {
      expect(expandTexConditionals("\\ifnum -1<0 yes\\fi")).toBe("yes");
    });

    it("with \\relax", () => {
      expect(expandTexConditionals("\\ifnum 3>2\\relax yes\\else no\\fi")).toBe(" yes");
    });
  });

  describe("\\ifodd", () => {
    it("odd number", () => {
      expect(expandTexConditionals("\\ifodd 3 yes\\else no\\fi")).toBe("yes");
    });

    it("even number", () => {
      expect(expandTexConditionals("\\ifodd 4 yes\\else no\\fi")).toBe(" no");
    });

    it("with \\relax", () => {
      expect(expandTexConditionals("\\ifodd 5\\relax odd\\fi")).toBe(" odd");
    });
  });

  describe("\\ifx", () => {
    it("equal tokens", () => {
      expect(expandTexConditionals("\\ifx\\abc\\abc yes\\else no\\fi")).toBe("yes");
    });

    it("different tokens", () => {
      expect(expandTexConditionals("\\ifx\\abc\\def yes\\else no\\fi")).toBe(" no");
    });

    it("single character tokens", () => {
      expect(expandTexConditionals("\\ifx ab yes\\else no\\fi")).toBe(" no");
      expect(expandTexConditionals("\\ifx aa yes\\else no\\fi")).toBe("yes");
    });
  });

  describe("\\ifthenelse", () => {
    it("numeric comparison true", () => {
      expect(expandTexConditionals("\\ifthenelse{3>2}{yes}{no}")).toBe("yes");
    });

    it("numeric comparison false", () => {
      expect(expandTexConditionals("\\ifthenelse{1>2}{yes}{no}")).toBe("no");
    });

    it("\\isodd", () => {
      expect(expandTexConditionals("\\ifthenelse{\\isodd{3}}{odd}{even}")).toBe("odd");
      expect(expandTexConditionals("\\ifthenelse{\\isodd{4}}{odd}{even}")).toBe("even");
    });

    it("\\equal", () => {
      expect(expandTexConditionals("\\ifthenelse{\\equal{hello}{hello}}{yes}{no}")).toBe("yes");
      expect(expandTexConditionals("\\ifthenelse{\\equal{hello}{world}}{yes}{no}")).toBe("no");
    });

    it("\\NOT", () => {
      expect(expandTexConditionals("\\ifthenelse{\\NOT 1>2}{yes}{no}")).toBe("yes");
    });

    it("\\AND", () => {
      expect(expandTexConditionals("\\ifthenelse{1<2 \\AND 3<4}{yes}{no}")).toBe("yes");
      expect(expandTexConditionals("\\ifthenelse{1<2 \\AND 3>4}{yes}{no}")).toBe("no");
    });

    it("\\OR", () => {
      expect(expandTexConditionals("\\ifthenelse{1>2 \\OR 3<4}{yes}{no}")).toBe("yes");
    });
  });

  describe("nesting", () => {
    it("nested \\ifnum", () => {
      const input = "\\ifnum 1>0 \\ifnum 2>1 inner\\fi outer\\fi";
      expect(expandTexConditionals(input)).toBe("inner outer");
    });

    it("nested with else", () => {
      const input = "\\ifnum 1>0 \\ifnum 0>1 inner-true\\else inner-false\\fi outer\\fi";
      expect(expandTexConditionals(input)).toBe(" inner-false outer");
    });

    it("false outer skips inner", () => {
      const input = "\\ifnum 0>1 \\ifnum 2>1 inner\\fi\\else outer-false\\fi";
      expect(expandTexConditionals(input)).toBe(" outer-false");
    });
  });

  describe("surrounding text preserved", () => {
    it("text before and after", () => {
      expect(expandTexConditionals("before \\ifnum 1=1 yes\\fi after")).toBe("before yes after");
    });

    it("no conditionals", () => {
      expect(expandTexConditionals("no conditionals here")).toBe("no conditionals here");
    });

    it("empty input", () => {
      expect(expandTexConditionals("")).toBe("");
    });

    it("stops after max passes when conditionals keep changing", () => {
      expect(expandTexConditionals("\\ifnum 1=1 \\ifnum 1=1 x\\fi\\fi", 1)).toBe("\\ifnum 1=1 x\\fi");
    });
  });

  describe("malformed and defensive inputs", () => {
    it("leaves malformed primitive conditionals unchanged", () => {
      expect(expandTexConditionals("\\ifnum x<1 yes\\fi")).toBe("\\ifnum x<1 yes\\fi");
      expect(expandTexConditionals("\\ifnum 1?2 yes\\fi")).toBe("\\ifnum 1?2 yes\\fi");
      expect(expandTexConditionals("\\ifnum 1<z yes\\fi")).toBe("\\ifnum 1<z yes\\fi");
      expect(expandTexConditionals("\\ifodd x yes\\fi")).toBe("\\ifodd x yes\\fi");
      expect(expandTexConditionals("\\ifx\\foo")).toBe("\\ifx\\foo");
    });

    it("leaves malformed ifthenelse groups unchanged", () => {
      expect(expandTexConditionals("\\ifthenelse x {yes}{no}")).toBe("\\ifthenelse x {yes}{no}");
      expect(expandTexConditionals("\\ifthenelse{1=1} yes {no}")).toBe("\\ifthenelse{1=1} yes {no}");
      expect(expandTexConditionals("\\ifthenelse{1=1}{yes} no")).toBe("\\ifthenelse{1=1}{yes} no");
      expect(expandTexConditionals("\\ifthenelse{1=1}{yes}{no")).toBe("\\ifthenelse{1=1}{yes}{no");
    });

    it("handles plus-signed integers, nested top-level operators, and non-relax suffixes", () => {
      expect(expandTexConditionals("\\ifnum +3=3 yes\\else no\\fi")).toBe("yes");
      expect(expandTexConditionals("\\ifodd +4 yes\\else no\\fi")).toBe(" no");
      expect(expandTexConditionals("\\ifnum 1=1\\relaxation yes\\else no\\fi")).toBe("\\relaxation yes");
      expect(expandTexConditionals("\\ifthenelse{\\equal{a \\AND b}{a \\AND b} \\AND \\isodd{bad}}{yes}{no}")).toBe("no");
      expect(expandTexConditionals("\\ifthenelse{\\equal{a}{b} \\OR fallback}{yes}{no}")).toBe("yes");
    });

    it("preserves unterminated blocks and non-conditional control sequences while scanning", () => {
      expect(expandTexConditionals("\\ifnum 1=1 true \\foo\\bar")).toBe("\\ifnum 1=1 true \\foo\\bar");
      expect(expandTexConditionals("\\ifnum 1=1 outer \\ifnum 2=2 inner\\fi")).toBe("\\ifnum 1=1 outer \\ifnum 2=2 inner\\fi");
      expect(expandTexConditionals("\\ifnum 1=1 \\ifnum 2=2 inner\\else other\\fi\\else no\\fi")).toBe("inner");
    });
  });

  describe("foreach-like usage", () => {
    it("conditional node color", () => {
      const body = "\\ifnum 3=3 \\node[red] at (3,0) {3};\\else \\node at (3,0) {3};\\fi";
      const result = expandTexConditionals(body);
      expect(result).toBe("\\node[red] at (3,0) {3};");
    });

    it("\\ifx for string matching in foreach", () => {
      const body = "\\ifx\\label\\target [green]\\fi";
      expect(expandTexConditionals(body)).toBe("");
    });
  });

  describe("end-to-end rendering", () => {
    function renderSvg(source: string) {
      const result = renderTikzToSvg(source);
      return { svg: result.svg.svg, scene: result.semantic.scene };
    }

    it("foreach with \\ifnum: only the 3rd node is red", () => {
      const source = String.raw`\begin{tikzpicture}
        \foreach \x in {1,...,5} {
          \ifnum\x=3\relax
            \node[red] at (\x,0) {\x};
          \else
            \node at (\x,0) {\x};
          \fi
        }
      \end{tikzpicture}`;

      const { svg, scene } = renderSvg(source);

      // 5 nodes total
      expect(scene.elements.filter(e => e.kind === "Text")).toHaveLength(5);

      // exactly one red fill
      const redCount = (svg.match(/fill="#ff0000"/g) ?? []).length;
      expect(redCount).toBe(1);

      // all 5 labels present
      for (let i = 1; i <= 5; i++) {
        expect(svg).toContain(`>${i}<`);
      }
    });

    it("false branch text does not appear in SVG", () => {
      const source = String.raw`\begin{tikzpicture}
        \foreach \x in {1,2,3} {
          \ifnum\x=2\relax
            \node at (\x,0) {VISIBLE};
          \else
            \node at (\x,0) {HIDDEN};
          \fi
        }
      \end{tikzpicture}`;

      const { svg } = renderSvg(source);

      // "VISIBLE" appears exactly once (only for \x=2)
      expect((svg.match(/VISIBLE/g) ?? []).length).toBe(1);
      // "HIDDEN" appears exactly twice (for \x=1 and \x=3)
      expect((svg.match(/HIDDEN/g) ?? []).length).toBe(2);
    });

    it("\\ifodd inside foreach colors odd nodes", () => {
      const source = String.raw`\begin{tikzpicture}
        \foreach \x in {1,...,4} {
          \ifodd\x\relax
            \node[blue] at (\x,0) {\x};
          \else
            \node at (\x,0) {\x};
          \fi
        }
      \end{tikzpicture}`;

      const { svg } = renderSvg(source);

      // 2 blue fills (for x=1 and x=3)
      const blueCount = (svg.match(/fill="#0000ff"/g) ?? []).length;
      expect(blueCount).toBe(2);
    });

    it("\\ifthenelse inside foreach", () => {
      const source = String.raw`\begin{tikzpicture}
        \foreach \x in {1,...,4} {
          \ifthenelse{\x>2}
            {\node[green] at (\x,0) {\x};}
            {\node at (\x,0) {\x};}
        }
      \end{tikzpicture}`;

      const { svg, scene } = renderSvg(source);

      expect(scene.elements.filter(e => e.kind === "Text")).toHaveLength(4);
      // green for x=3 and x=4
      const greenCount = (svg.match(/fill="#00ff00"/g) ?? []).length;
      expect(greenCount).toBe(2);
    });

    it("conditional that eliminates all content produces no elements", () => {
      const source = String.raw`\begin{tikzpicture}
        \foreach \x in {1,2,3} {
          \ifnum\x>10\relax
            \node at (\x,0) {never};
          \fi
        }
      \end{tikzpicture}`;

      const { scene } = renderSvg(source);
      expect(scene.elements.filter(e => e.kind === "Text")).toHaveLength(0);
    });

    it("nested \\ifnum in foreach", () => {
      const source = String.raw`\begin{tikzpicture}
        \foreach \x in {1,...,6} {
          \ifnum\x>2\relax
            \ifnum\x<5\relax
              \node[red] at (\x,0) {\x};
            \else
              \node at (\x,0) {\x};
            \fi
          \else
            \node at (\x,0) {\x};
          \fi
        }
      \end{tikzpicture}`;

      const { svg, scene } = renderSvg(source);

      expect(scene.elements.filter(e => e.kind === "Text")).toHaveLength(6);
      // red for x=3 and x=4 only
      const redCount = (svg.match(/fill="#ff0000"/g) ?? []).length;
      expect(redCount).toBe(2);
    });
  });
});
