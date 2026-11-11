import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditWrittenNumbers, DEFAULT_TOLERANCE_PT, renderReport, runDecimalNoiseAudit, summarize } from "./decimal-noise.js";
import { evaluate, FRAMES, QUICK_FRAME_LABELS } from "./pointer-fuzz.js";
import { createTexNodeTextEngine } from "../../packages/core/src/text/tex-node-text-engine.js";

// `npm test` gates the audit on one frame per mechanism against
// decimal-noise-baseline.json: no action may write more gross noise or excess
// digits, and dragging back may not drift or respell more often.
// DECIMAL_NOISE_UPDATE=1 records the current counts (refusing regressions
// unless DECIMAL_NOISE_ACCEPT_REGRESSIONS=1). DECIMAL_NOISE_AUDIT=1 writes
// the full report to artifacts/decimal-noise/ (every frame with
// POINTER_FUZZ_FULL=1); `npm run audit:decimal-noise` does both.
const AUDIT = Boolean(process.env.DECIMAL_NOISE_AUDIT);
const FULL = Boolean(process.env.POINTER_FUZZ_FULL);
const BASELINE_PATH = "test/pointer-invariant/decimal-noise-baseline.json";

type Baseline = { actions: Record<string, { gross: number; excessDigits: number }>; dragBack: { drifted: number; respelled: number } };

function countsOf(run: ReturnType<typeof runDecimalNoiseAudit>): Baseline {
  const actions = Object.fromEntries(summarize(run)
    .map((entry): [string, { gross: number; excessDigits: number }] => [entry.action, { gross: entry.gross, excessDigits: entry.excessDigits }])
    .sort(([a], [b]) => a.localeCompare(b)));
  const count = (outcome: string) => run.dragBacks.filter(entry => entry.outcome === outcome).length;
  return { actions, dragBack: { drifted: count("drifted"), respelled: count("respelled") } };
}

/** Every way `now` is worse than `before`. */
function regressions(before: Baseline, now: Baseline): string[] {
  const worse: string[] = [];
  for (const [action, counts] of Object.entries(now.actions)) {
    const was = before.actions[action] ?? { gross: 0, excessDigits: 0 };
    if (counts.gross > was.gross) worse.push(`${action}: gross ${was.gross} → ${counts.gross}`);
    if (counts.excessDigits > was.excessDigits) worse.push(`${action}: excess digits ${was.excessDigits} → ${counts.excessDigits}`);
  }
  for (const key of ["drifted", "respelled"] as const) {
    if (now.dragBack[key] > before.dragBack[key]) worse.push(`drag back ${key}: ${before.dragBack[key]} → ${now.dragBack[key]}`);
  }
  return worse;
}

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

describe("decimal-noise gate", () => {
  it("writes no noisier numbers than recorded, in one frame per mechanism", async () => {
    const run = runDecimalNoiseAudit({ frames: FRAMES.filter(frame => QUICK_FRAME_LABELS.has(frame.label)), textEngine: await createTexNodeTextEngine() });
    const now = countsOf(run);
    const before = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline : null;
    const worse = before ? regressions(before, now) : [];
    if (process.env.DECIMAL_NOISE_UPDATE) {
      if (worse.length > 0 && !process.env.DECIMAL_NOISE_ACCEPT_REGRESSIONS) {
        throw new Error(`Refusing to record regressions (set DECIMAL_NOISE_ACCEPT_REGRESSIONS=1 to accept):\n${worse.join("\n")}`);
      }
      writeFileSync(BASELINE_PATH, `${JSON.stringify(now, null, 2)}\n`);
      return;
    }
    expect(before, `no ${BASELINE_PATH}; record one with DECIMAL_NOISE_UPDATE=1`).not.toBeNull();
    expect(worse, `noisier than ${BASELINE_PATH}; run npm run audit:decimal-noise for examples`).toEqual([]);
  }, 120_000);
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
