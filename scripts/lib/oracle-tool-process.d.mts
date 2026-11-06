import type { ExecFileSyncOptionsWithStringEncoding, SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
export function execOracleTool(command: string, args: readonly string[], options: ExecFileSyncOptionsWithStringEncoding): string;
export function spawnOracleTool(command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>;
