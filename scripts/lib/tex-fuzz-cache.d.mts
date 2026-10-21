export const TEX_FUZZ_CACHE_SCHEMA: string;
export function texFuzzCacheKey(input: {
  readonly source: string;
  readonly preamble: string;
  readonly layer: string;
  readonly environment: unknown;
}): string;
export class TexFuzzDiskCache {
  constructor(directory: string);
  readonly directory: string;
  path(key: string): string;
  get(key: string): unknown | undefined;
  set(key: string, value: unknown): void;
}
