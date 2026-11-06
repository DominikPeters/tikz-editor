import { execFileSync, spawnSync } from "node:child_process";
function limits(options) {
  const timeout = options.timeout ?? Number(process.env.TIKZ_ORACLE_TOOL_TIMEOUT_MS ?? 120000);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new RangeError("Invalid oracle tool timeout");
  return { maxBuffer: 30 * 1024 * 1024, ...options, timeout, killSignal: "SIGKILL" };
}
/** Independent native calls cannot rely on a JavaScript event-loop timer. */
export function execOracleTool(command, args, options = {}) {
  return execFileSync(command, args, limits(options));
}
export function spawnOracleTool(command, args, options = {}) {
  return spawnSync(command, args, limits(options));
}
