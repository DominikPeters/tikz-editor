export function texOracleEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;

export function escapeTexText(text: string, options?: { preserveCommands?: boolean }): string;

export function runTexOracleDocument(options: {
  engine: string;
  source: string;
  filename?: string;
  tempPrefix?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}): string;
