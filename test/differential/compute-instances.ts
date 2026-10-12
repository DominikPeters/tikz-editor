import { vi } from "vitest";

import * as glyphOutlines from "../../packages/core/src/text/tex/fonts/glyph-outlines.js";

export type ComputeModule = typeof import("../../packages/app/src/compute.js");

const GLYPH_OUTLINES = "../../packages/core/src/text/tex/fonts/glyph-outlines.js";

/** A module replaced in one instance, as vi.doMock takes it (paths relative to this file). */
export type ModuleMock = { path: string; factory: (importOriginal: () => Promise<unknown>) => unknown };

/**
 * A compute module with its own copy of every module-level cache (parse and
 * semantic sessions, the deck session and page cache, syntax indexes, scans).
 * Glyph outlines are immutable font data, so the instances share the copy the
 * test setup loaded rather than loading and installing it again. `mocks`
 * replace modules in this instance only.
 */
export async function freshComputeModule(mocks: readonly ModuleMock[] = []): Promise<ComputeModule> {
  vi.resetModules();
  vi.doMock(GLYPH_OUTLINES, () => glyphOutlines);
  for (const mock of mocks) vi.doMock(mock.path, mock.factory as never);
  try {
    return await import("../../packages/app/src/compute.js");
  } finally {
    vi.resetModules();
    vi.doUnmock(GLYPH_OUTLINES);
    for (const mock of mocks) vi.doUnmock(mock.path);
  }
}
