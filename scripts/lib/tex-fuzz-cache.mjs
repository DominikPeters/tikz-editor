import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const TEX_FUZZ_CACHE_SCHEMA = "tex-fuzz-oracle-cache-v1";

/** @param {unknown} value @returns {unknown} */
function stable(value) {
  if (Array.isArray(value)) {
    const array = /** @type {unknown[]} */ (value);
    return array.map(stable);
  }
  if (value && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => /** @type {[string, unknown]} */ ([key, stable(item)])));
  }
  return value;
}

/** @param {{ source: string, preamble: string, layer: string, environment: unknown }} input */
export function texFuzzCacheKey(input) {
  return createHash("sha256").update(JSON.stringify(stable({ schema: TEX_FUZZ_CACHE_SCHEMA, ...input }))).digest("hex");
}

export class TexFuzzDiskCache {
  /** @param {string} directory */
  constructor(directory) {
    this.directory = directory;
  }

  /** @param {string} key */
  path(key) {
    return join(this.directory, key.slice(0, 2), `${key}.json`);
  }

  /** @param {string} key */
  get(key) {
    try {
      const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(this.path(key), "utf8")));
      if (!parsed || typeof parsed !== "object") return undefined;
      const record = /** @type {Record<string, unknown>} */ (parsed);
      return record.schema === TEX_FUZZ_CACHE_SCHEMA && record.key === key ? record.value : undefined;
    } catch {
      return undefined;
    }
  }

  /** @param {string} key @param {unknown} value */
  set(key, value) {
    const path = this.path(key);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ schema: TEX_FUZZ_CACHE_SCHEMA, key, value })}\n`, "utf8");
    renameSync(temporary, path);
  }
}
