export interface FuzzProcessResult {
  status: "completed" | "failed" | "timeout" | "oom" | "output-limit" | "aborted" | "startup-error";
  exitCode: number | null; signal: string | null; error?: string; elapsedMs: number;
  timeoutMs: number; heapMb: number; memoryLimitKind: string; outputBytes: number; logTruncated: boolean;
}
export function runFuzzProcess(command: string, args: readonly string[], options: {
  timeoutMs: number; heapMb?: number; maxOutputBytes?: number; logPath: string; signal?: AbortSignal;
  cwd?: string; env?: NodeJS.ProcessEnv;
}): Promise<FuzzProcessResult>;
