import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { detectDocumentKind } from "../packages/core/src/document/kind.js";

const KKT_FIXTURE_PATH = new URL(
  "./fixtures/beamer/kkt_theorem_beamer.tex",
  import.meta.url
);

describe("document kind detection", () => {
  it("detects beamer decks from the documentclass", () => {
    expect(detectDocumentKind(readFileSync(KKT_FIXTURE_PATH, "utf8"))).toBe(
      "beamer"
    );
    expect(
      detectDocumentKind("\\documentclass[aspectratio=169]{beamer}\n")
    ).toBe("beamer");
    expect(
      detectDocumentKind(
        "% a comment first\n\\documentclass{beamer}\\begin{document}\\end{document}"
      )
    ).toBe("beamer");
  });

  it("treats everything else as a tikz document", () => {
    expect(detectDocumentKind("\\begin{tikzpicture}\\end{tikzpicture}")).toBe(
      "tikz"
    );
    expect(detectDocumentKind("\\documentclass{article}\n")).toBe("tikz");
    expect(detectDocumentKind("\\documentclass{standalone}\n")).toBe("tikz");
    expect(detectDocumentKind("")).toBe("tikz");
  });

  it("ignores commented-out documentclass declarations", () => {
    expect(detectDocumentKind("% \\documentclass{beamer}\n\\draw;")).toBe(
      "tikz"
    );
  });
});
