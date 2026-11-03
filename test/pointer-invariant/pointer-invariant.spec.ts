import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRAMES, QUICK_FRAME_LABELS, runPointerFuzz, type CaseOutcome, type CaseResult } from "./pointer-fuzz.js";

// `npm test` runs one frame per mechanism; POINTER_FUZZ_FULL=1 (CI, and
// `npm run test:pointer-fuzz`) runs every frame. POINTER_FUZZ_SEED picks other
// deltas. POINTER_FUZZ_UPDATE=1 rewrites the expected outcomes from a full run
// with the default seed, and refuses if any case got worse, disappeared, or
// arrived failing, unless POINTER_FUZZ_ACCEPT_REGRESSIONS=1.
// POINTER_FUZZ_VERBOSE=1 prints every failure.
const FULL = Boolean(process.env.POINTER_FUZZ_FULL);
const SEED = Number(process.env.POINTER_FUZZ_SEED ?? 1);
const EXPECTED_PATH = "test/pointer-invariant/expected-outcomes.json";

/**
 * The recorded outcome of every case, so a case that worked cannot quietly
 * become unsupported. Failures carry their class; refusals their reason.
 */
const expected = existsSync(EXPECTED_PATH) ? JSON.parse(readFileSync(EXPECTED_PATH, "utf8")) as Record<string, string> : {};

const POSITIONING_BODY = "positioning";

function classify(result: CaseResult): string {
  const [action, , body] = result.key.split("|");
  if (action === "moveCurveHandle") return "curve handle angle written in the wrong frame";
  if (action === "resizeElement" && (body === "circle" || body === "ellipse")) return "resized radius misses the pointer";
  if (action === "singular") return "singular frame accepted a coordinate write";
  if (action === "insertAfterTikzset") return "insertion ignored the state at the final gap";
  if (action === "pasteAcrossScopes") return "paste offset used the original rather than destination frame";
  if (body === POSITIONING_BODY && action === "duplicateElements") return "offset written as `at`, which `right=of` overrides";
  if (body === POSITIONING_BODY) return "positioning offsets ignore the node's own transform or its dependency on A";
  if (action === "duplicateElements" || action === "repeatElements") return "offset planned in a bare identity-frame picture";
  if (action === "insertPathPoint" || action === "convertNodePositionToAbsolute" || action === "setFigureBounds" || action === "rotateElement") {
    return "world cm written as source units without the frame";
  }
  if (action === "addElement" || action === "pathTool" || action === "freehand" || action === "appendToPath") {
    return "new coordinates ignore axis vectors and scopes: the app only inverts rootTransform";
  }
  if ((action === "reversePath" || action === "setPathPointKind") && body === "relative") return "relative coordinates lost when the path is rewritten";
  if (action === "positionNodeRelativeTo") return "direction and distance not measured in world space";
  return "unclassified";
}

const short = (text: string) => text.replace(/\s+/g, " ").slice(0, 100);

function encode(result: CaseResult): string {
  const outcome: CaseOutcome = result.outcome;
  switch (outcome.kind) {
    case "ok": return "ok";
    case "partial": return `partial: ${short(outcome.reason)}`;
    case "unsupported": return `unsupported: ${short(outcome.reason)}`;
    case "error": return `error: ${short(outcome.message)}`;
    case "fail": return `fail: ${classify(result)}`;
  }
}

/** Higher is better: refusing is better than writing the wrong geometry. */
function rank(encoded: string): number {
  if (encoded === "ok") return 3;
  if (encoded.startsWith("partial")) return 2;
  if (encoded.startsWith("unsupported")) return 1;
  return 0;
}

describe("pointer invariant", () => {
  it(`keeps edited geometry under the pointer in ${FULL ? "every frame" : "one frame per mechanism"}`, () => {
    const frames = FULL ? FRAMES : FRAMES.filter(frame => QUICK_FRAME_LABELS.has(frame.label));
    const results = runPointerFuzz(SEED, frames);
    if (process.env.POINTER_FUZZ_VERBOSE) {
      for (const result of results) if (result.outcome.kind === "fail" || result.outcome.kind === "error") console.log(result.key, result.outcome);
    }
    const actual = new Map(results.map(result => [result.key, encode(result)]));
    for (const frame of frames) {
      for (const key of [
        `singular|${frame.label}|moveHandle`, `singular|${frame.label}|addElement`,
        `insertAfterTikzset|${frame.label}`, `pasteAcrossScopes|${frame.label}`,
        `resizeElement|${frame.label}|circle|top`, `resizeElement|${frame.label}|ellipse|right`,
        `insertPathPoint|${frame.label}|midpath-options`, `reversePath|${frame.label}|relative-start`
      ]) expect(actual.has(key), `missing promised coverage: ${key}`).toBe(true);
      expect(results.some(result => result.key.startsWith(`moveCurveHandle|${frame.label}|`)), "missing transformed curve handles").toBe(true);
      expect(results.some(result => result.key.startsWith(`moveHandle|${frame.label}|transform-shape-node|`)), "missing transform shape node").toBe(true);
    }

    if (process.env.POINTER_FUZZ_UPDATE) {
      if (!FULL || SEED !== 1) throw new Error("Record expected outcomes from a full run with the default seed.");
      const changes: string[] = [];
      const regressions: string[] = [];
      for (const [key, now] of actual) {
        const before = expected[key];
        if (before === now) continue;
        const line = `${key}: ${before ?? "(new case)"} → ${now}`;
        changes.push(line);
        // A new case may arrive refused, but a new failure is a decision to record.
        if (before === undefined ? rank(now) === 0 : rank(now) < rank(before)) regressions.push(line);
      }
      for (const key of Object.keys(expected)) {
        if (actual.has(key)) continue;
        const line = `${key}: ${expected[key]} → (case removed)`;
        changes.push(line);
        regressions.push(line);
      }
      console.log(changes.length === 0 ? "No outcome changes." : `Outcome changes:\n${changes.join("\n")}`);
      if (regressions.length > 0 && !process.env.POINTER_FUZZ_ACCEPT_REGRESSIONS) {
        throw new Error(`Refusing to record regressions (set POINTER_FUZZ_ACCEPT_REGRESSIONS=1 to accept):\n${regressions.join("\n")}`);
      }
      const sorted = Object.fromEntries([...actual].sort(([a], [b]) => a.localeCompare(b)));
      writeFileSync(EXPECTED_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
      return;
    }

    if (SEED === 1) {
      const mismatches = [...actual].filter(([key, now]) => expected[key] !== now).map(([key, now]) => {
        const detail = results.find(result => result.key === key)?.outcome;
        const why = detail?.kind === "fail" ? ` (${detail.detail})` : "";
        return `${key}: expected ${expected[key] ?? "(new case)"}, got ${now}${why}`;
      });
      expect(mismatches, `outcomes differ from ${EXPECTED_PATH}; rerun with POINTER_FUZZ_FULL=1 POINTER_FUZZ_UPDATE=1 to record improvements`).toEqual([]);
      if (FULL) {
        // A full run must still generate every recorded case, or coverage silently shrinks.
        const missing = Object.keys(expected).filter(key => !actual.has(key));
        expect(missing, "recorded cases no longer generated").toEqual([]);
      }
    } else {
      // Other deltas may change which edits are refused, but must not write wrong geometry where seed 1 did not.
      const worse = [...actual].filter(([key, now]) => rank(now) === 0 && rank(expected[key] ?? "ok") > 0)
        .map(([key, now]) => `${key}: expected ${expected[key] ?? "(new case)"}, got ${now}`);
      expect(worse, "new failures under another seed").toEqual([]);
    }
  }, 120_000); // Seconds alone; a loaded machine running the whole suite needs room.
});
