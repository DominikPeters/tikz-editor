/** Fixture discovery and oracle file construction. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CaseResult } from "./run.js";
import { PGFPLOTS_ORACLE_HARNESS_VERSION, PGFPLOTS_ORACLE_SCHEMA, type PgfplotsOracle } from "./schema.js";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const FIXTURE_DIR = join(REPO_ROOT, "test", "fixtures", "pgfplots");
export const ARTIFACT_DIR = join(REPO_ROOT, "artifacts", "pgfplots-oracle");

export interface Fixture { name: string; path: string; body: string; sha256: string }

export function listFixtures(dir = FIXTURE_DIR, only?: readonly string[]): Fixture[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".tex"))
    .map((file) => file.slice(0, -4))
    .filter((name) => !only || only.length === 0 || only.includes(name))
    .sort()
    .map((name) => {
      const path = join(dir, `${name}.tex`);
      const body = readFileSync(path, "utf8");
      return { name, path, body, sha256: createHash("sha256").update(body).digest("hex") };
    });
}

export function oracleFromResult(fixture: Fixture, result: CaseResult): PgfplotsOracle {
  return {
    schema: PGFPLOTS_ORACLE_SCHEMA,
    harnessVersion: PGFPLOTS_ORACLE_HARNESS_VERSION,
    case: { name: fixture.name, sourceSha256: fixture.sha256 },
    toolchain: result.toolchain,
    tier1: result.tier1,
    tier2: result.tier2,
  };
}

/** Round floats so fixture diffs stay readable (1e-5 pt is far below every tolerance). */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, (_key, item: unknown) => (typeof item === "number" && !Number.isInteger(item) ? Number(item.toFixed(5)) : item), 1)}\n`;
}
