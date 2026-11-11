import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditWrittenNumbers, DEFAULT_TOLERANCE_PT, renderReport, runDecimalNoiseAudit, summarize } from "./decimal-noise.js";
import { evaluate, FRAMES, QUICK_FRAME_LABELS } from "./pointer-fuzz.js";
import { createTexNodeTextEngine } from "../../packages/core/src/text/tex-node-text-engine.js";

// The audit itself is a report, not a gate: DECIMAL_NOISE_AUDIT=1 runs it
// (every frame with POINTER_FUZZ_FULL=1) and writes artifacts/decimal-noise/.
// `npm run audit:decimal-noise` does both.
const AUDIT = Boolean(process.env.DECIMAL_NOISE_AUDIT);
const FULL = Boolean(process.env.POINTER_FUZZ_FULL);

const picture = (body: string) => evaluate(String.raw`\begin{tikzpicture}
${body}
\end{tikzpicture}`);

describe("decimal-noise metric", () => {
  it("counts decimals a half-pixel pointer could not have meant", () => {
    const before = picture(String.raw`\draw (0,0) -- (1,1);`);
    const after = picture(String.raw`\draw (0,0) -- (2.300004,1.5);`);
    const { numbers } = auditWrittenNumbers(before, after, DEFAULT_TOLERANCE_PT);
    expect(numbers).toEqual([
      { text: "2.300004", unit: "", written: 6, needed: 1, shortest: "2.3" },
      { text: "1.5", unit: "", written: 1, needed: 1, shortest: "1.5" }
    ]);
  });

  it("keeps decimals that move the picture by more than the tolerance", () => {
    const before = picture(String.raw`\draw (0,0) -- (1,1);`);
    const after = picture(String.raw`\draw (0,0) -- (2.37cm,1);`);
    expect(auditWrittenNumbers(before, after, DEFAULT_TOLERANCE_PT).numbers).toEqual([{ text: "2.37", unit: "cm", written: 2, needed: 2, shortest: "2.37" }]);
  });

  it("ignores digits in names", () => {
    const before = picture(String.raw`\node (n1) at (0,0) {a};`);
    const after = picture(String.raw`\node (n12) at (0,0) {a};`);
    expect(auditWrittenNumbers(before, after, DEFAULT_TOLERANCE_PT).numbers).toEqual([]);
  });
});

describe.runIf(AUDIT)("decimal-noise audit", () => {
  it("writes the report", async () => {
    const frames = FULL ? FRAMES : FRAMES.filter(frame => QUICK_FRAME_LABELS.has(frame.label));
    const run = runDecimalNoiseAudit({ frames, textEngine: await createTexNodeTextEngine(), ...(process.env.DECIMAL_NOISE_TOLERANCE ? { tolerancePt: Number(process.env.DECIMAL_NOISE_TOLERANCE) } : {}) });
    mkdirSync("artifacts/decimal-noise", { recursive: true });
    writeFileSync("artifacts/decimal-noise/report.md", renderReport(run));
    writeFileSync("artifacts/decimal-noise/report.json", `${JSON.stringify({ summary: summarize(run), ...run }, null, 2)}\n`);
    console.log(renderReport(run, 0));
    expect(run.edits.length).toBeGreaterThan(0);
  }, 600_000);
});
