import { Worker } from "node:worker_threads";

/** Reuse one isolated engine; terminate and replace it after a resource failure. */
export function createTexFuzzNativeRunner(options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("Invalid native-case timeout.");
  const workerUrl = options.workerUrl ?? new URL("./tex-fuzz-native-worker.mjs", import.meta.url);
  let worker;
  let busy = false;
  let closed = false;
  return {
    async runCase(caseData, checks = {}, signal = options.signal) {
      if (closed || busy) throw new Error(closed ? "Native runner is closed." : "Native runner requires sequential requests.");
      signal?.throwIfAborted();
      busy = true;
      const started = performance.now();
      try {
        worker ??= new Worker(workerUrl, { resourceLimits: { maxOldGenerationSizeMb: 256 } });
        const current = worker;
        const response = await new Promise((resolve) => {
          let completed = false;
          const finish = (value) => {
            if (completed) return;
            completed = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            current.removeListener("message", onMessage);
            current.removeListener("error", onError);
            current.removeListener("exit", onExit);
            resolve(value);
          };
          const onMessage = (value) => finish(value);
          const onError = (error) => finish({ error: error.message });
          const onExit = (code) => finish({ error: `Native worker exited with code ${code}.` });
          const onAbort = () => finish({ aborted: true });
          const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
          current.once("message", onMessage);
          current.once("error", onError);
          current.once("exit", onExit);
          signal?.addEventListener("abort", onAbort, { once: true });
          try { current.postMessage({ caseData, checks }); }
          catch (error) { finish({ error: String(error) }); }
        });
        if (response.aborted || response.timedOut || response.error) {
          worker = undefined;
          await current.terminate();
          signal?.throwIfAborted();
          return { caseData, checks, elapsedMs: performance.now() - started, observations: [{
            fingerprint: { version: 1, resultClass: "hard-invariant",
              code: response.timedOut ? "native-time-budget" : "native-worker-failure",
              featureTags: caseData.features, mode: "text", structuralLocus: "native-worker" },
            detail: { timeoutMs, checks, error: response.error },
          }] };
        }
        signal?.throwIfAborted();
        return { caseData, checks, ...response };
      } finally { busy = false; }
    },
    async close() {
      if (busy) throw new Error("Wait for the native request before closing its runner.");
      closed = true;
      const current = worker;
      worker = undefined;
      if (current) await current.terminate();
    },
  };
}

/** Isolate synchronous native work so a pathological case cannot hang the whole gate. */
export async function runTexFuzzNativeCases(cases, options = {}) {
  const runner = createTexFuzzNativeRunner(options);
  const records = [];
  try {
    for (const [index, caseData] of cases.entries()) {
      records.push(await runner.runCase(caseData, options.checks?.(caseData, index) ?? {}));
    }
  } finally { await runner.close(); }
  return records;
}
