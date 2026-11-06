import { spawn, spawnSync } from "node:child_process";
import { openSync, closeSync, writeSync } from "node:fs";

/** A watchdog outside the target's event loop, including synchronous hangs.
 * heapMb caps V8 old-space per Node isolate, not total RSS or native tools. */
export async function runFuzzProcess(command, args, options) {
  const { timeoutMs, heapMb = 1536, maxOutputBytes = 8 * 1024 * 1024, logPath, signal } = options;
  for (const [name, value] of Object.entries({ timeoutMs, heapMb, maxOutputBytes })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`Invalid ${name}`);
  }
  signal?.throwIfAborted();
  const started = performance.now(), fd = openSync(logPath, "w");
  let bytes = 0, tail = "", status = null, timer;
  const child = spawn(command, args, { cwd: options.cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.env, NODE_OPTIONS: `${options.env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? ""} --max-old-space-size=${heapMb}`.trim() } });
  const killTree = () => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 5000 });
      else process.kill(-child.pid, "SIGKILL");
    } catch (error) { if (error.code !== "ESRCH") child.kill("SIGKILL"); }
  };
  const stop = reason => { if (status === null) status = reason; killTree(); };
  const onAbort = () => stop("aborted");
  const capture = data => {
    tail = (tail + data.toString("utf8")).slice(-64 * 1024);
    const keep = Math.max(0, Math.min(data.length, maxOutputBytes - bytes));
    if (keep) writeSync(fd, data.subarray(0, keep));
    bytes += data.length;
    if (bytes > maxOutputBytes) stop("output-limit");
  };
  child.stdout?.on("data", capture); child.stderr?.on("data", capture);
  timer = setTimeout(() => stop("timeout"), timeoutMs);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  let error;
  try {
    const result = await new Promise(resolve => {
      child.once("error", value => { error = value.message; });
      child.once("close", (code, exitSignal) => resolve({ code, signal: exitSignal }));
    });
    // Reap descendants that a target accidentally leaves running.
    killTree();
    if (status === null) status = error ? "startup-error" : result.code === 0 ? "completed"
      : /FATAL ERROR:[^\n]*(?:heap|memory)|ERR_WORKER_OUT_OF_MEMORY/iu.test(tail) ? "oom" : "failed";
    return { status, exitCode: result.code, signal: result.signal, error, elapsedMs: performance.now() - started,
      timeoutMs, heapMb, memoryLimitKind: "V8 old-space per Node isolate", outputBytes: bytes, logTruncated: bytes > maxOutputBytes };
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", onAbort); closeSync(fd);
  }
}
