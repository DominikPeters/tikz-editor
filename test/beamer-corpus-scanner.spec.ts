import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Beamer corpus scanner", () => {
  it("counts file-defined macro uses inside inline and display math", () => {
    const root = process.cwd();
    const output = execFileSync(
      process.execPath,
      [
        join(root, "scripts/scan-beamer-corpus.mjs"),
        join(root, "test/fixtures/beamer/kkt_theorem_beamer.tex"),
        "--top",
        "30"
      ],
      {
        cwd: root,
        encoding: "utf8"
      }
    );

    expect(output).toContain("Frames: 20");
    expect(output).toContain("frames using file-defined macros: 7 (35.0%)");
    expect(output).toMatch(/\| R \| 4 \| 1\/1 \| 15\.0% \|/);
    expect(output).toMatch(/\| act \| 4 \| 1\/1 \| 15\.0% \|/);
    expect(output).toMatch(/\| Lagr \| 3 \| 1\/1 \| 15\.0% \|/);
  });
});
