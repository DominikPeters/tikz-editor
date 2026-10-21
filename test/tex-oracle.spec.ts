import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { texOracleEnv } from "../scripts/lib/tex-oracle.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("TeX oracle environment", () => {
  it("uses the system temporary directory for caches when paths are unset", () => {
    vi.stubEnv("TMPDIR", "/tmp");
    vi.stubEnv("TEXMFVAR", undefined);
    vi.stubEnv("TEXMFCACHE", undefined);

    expect(texOracleEnv()).toMatchObject({ TEXMFVAR: tmpdir(), TEXMFCACHE: tmpdir() });
  });

  it("preserves configured cache paths and other inherited variables", () => {
    vi.stubEnv("TEXMFVAR", "/configured/var");
    vi.stubEnv("TEXMFCACHE", "/configured/cache");
    vi.stubEnv("TEXINPUTS", "/configured/inputs:");

    expect(texOracleEnv()).toMatchObject({
      TEXMFVAR: "/configured/var",
      TEXMFCACHE: "/configured/cache",
      TEXINPUTS: "/configured/inputs:",
    });
  });

  it("lets per-invocation cache paths override the inherited environment", () => {
    vi.stubEnv("TEXMFVAR", "/configured/var");
    vi.stubEnv("TEXMFCACHE", "/configured/cache");

    expect(texOracleEnv({ TEXMFVAR: "/invocation/var", TEXMFCACHE: "/invocation/cache" }))
      .toMatchObject({ TEXMFVAR: "/invocation/var", TEXMFCACHE: "/invocation/cache" });
  });
});
