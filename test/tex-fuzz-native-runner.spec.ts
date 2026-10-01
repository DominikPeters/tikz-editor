import { describe, expect, it } from "vitest";
import { caseFromTexFuzzAst, generateFullySupportedTexFuzzCases, generateFullySupportedTexFuzzCasesAsync, shrinkTexFuzzCase } from "@tikz-editor/tex-fuzz";
import { createTexFuzzNativeRunner, runTexFuzzNativeCases } from "../scripts/lib/tex-fuzz-native-runner.mjs";

const workerUrl = new URL(`data:text/javascript,${encodeURIComponent(`
  import { parentPort } from 'node:worker_threads';
  parentPort.on('message', ({caseData}) => {
    if (caseData.source === 'hang') while (true) {}
    if (caseData.source === 'crash') throw new Error('injected native crash');
    parentPort.postMessage({observations: [], elapsedMs: 1, support: {supported: true, reason: 'fully-supported'}});
  });
`)}`);
const source = (value: string) => caseFromTexFuzzAst([{ kind: "text", value }]);

describe("bounded native TeX fuzz execution", () => {
  it("terminates a hung case, preserves its witness, and continues in a fresh worker", async () => {
    const records = await runTexFuzzNativeCases([source("hang"), source("valid")], {
      workerUrl, timeoutMs: 1000, checks: () => ({ history: true, churnRequests: 4100 }),
    });
    expect(records[0].caseData.source).toBe("hang");
    expect(records[0].observations[0]).toMatchObject({
      fingerprint: { code: "native-time-budget" },
      detail: { timeoutMs: 1000, checks: { history: true, churnRequests: 4100 } },
    });
    expect(records[1].observations).toEqual([]);
  });

  it("records crashes and continues instead of losing the remaining case batch", async () => {
    const records = await runTexFuzzNativeCases([source("crash"), source("valid")], { workerUrl, timeoutMs: 1000 });
    expect(records[0].observations[0]).toMatchObject({
      fingerprint: { code: "native-worker-failure" }, detail: { error: "injected native crash" },
    });
    expect(records[1].observations).toEqual([]);
  });
  it("bounds support qualification and records the qualification mode for replay", async () => {
    const runner = createTexFuzzNativeRunner({ workerUrl, timeoutMs: 1000 });
    try {
      const hung = await runner.runCase(source("hang"), { support: true });
      expect(hung.observations[0]).toMatchObject({
        fingerprint: { code: "native-time-budget" }, detail: { checks: { support: true } },
      });
      const qualified = await runner.runCase(source("valid"), { support: true });
      expect(qualified.support).toMatchObject({ supported: true });
    } finally { await runner.close(); }
  });

  it("qualifies genuine seeded candidates in the production worker", async () => {
    const expected = generateFullySupportedTexFuzzCases(20_260_712, { count: 3 });
    const runner = createTexFuzzNativeRunner();
    try {
      const actual = await generateFullySupportedTexFuzzCasesAsync(20_260_712, { count: 3 }, async (candidate) => {
        const record = await runner.runCase(candidate, { support: true });
        expect(record.observations).toEqual([]);
        expect(record.support).toBeDefined();
        return record.support!.supported;
      });
      expect(actual).toEqual(expected);
    } finally { await runner.close(); }
  });

  it("cancels an in-flight worker and can resume with a fresh worker", async () => {
    const runner = createTexFuzzNativeRunner({ workerUrl, timeoutMs: 5000 });
    const controller = new AbortController();
    const reason = new Error("whole-batch deadline");
    const timer = setTimeout(() => controller.abort(reason), 100);
    try {
      await expect(runner.runCase(source("hang"), {}, controller.signal)).rejects.toBe(reason);
      const next = await runner.runCase(source("valid"));
      expect(next.observations).toEqual([]);
    } finally { clearTimeout(timer); await runner.close(); }
  });

  it("cancels worker work when a whole shrink batch reaches its deadline", async () => {
    const hangWorker = new URL(`data:text/javascript,${encodeURIComponent(`
      import {parentPort} from 'node:worker_threads';
      parentPort.on('message', () => { while (true) {} });
    `)}`);
    const original = source("Alpha Beta");
    const expected = { fingerprint: { version: 1 as const, resultClass: "hard-invariant" as const,
      code: "native-time-budget", featureTags: original.features, mode: "text" as const, structuralLocus: "native-worker" } };
    let work: Promise<unknown> | undefined;
    const result = await shrinkTexFuzzCase(original, expected, async (candidates, context) => {
      work = runTexFuzzNativeCases(candidates, { workerUrl: hangWorker, timeoutMs: 5000, signal: context.signal });
      await work;
      return candidates.map(() => null);
    }, { maxTimeMs: 100 });
    expect(result).toMatchObject({ minimizedCase: original, termination: "time-budget" });
    await expect(work).rejects.toThrow("shrink deadline");
  });

  it("does not start an already-cancelled batch", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled before start"));
    await expect(runTexFuzzNativeCases([source("valid")], {
      workerUrl, signal: controller.signal,
    })).rejects.toThrow("cancelled before start");
  });

});
