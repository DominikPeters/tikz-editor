import { afterEach, describe, expect, it, vi } from "vitest";

import { lookupTikzDocEntry, resetTikzDocCacheForTests } from "../packages/app/src/ui/source-panel/tikz-docs";

describe("tikz docs lookup", () => {
  afterEach(() => {
    resetTikzDocCacheForTests();
    vi.restoreAllMocks();
  });

  it("loads index + chunk lazily and resolves first matching candidate", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/docs/keys/index.json")) {
        return {
          ok: true,
          async json() {
            return {
              "line width": "tikz-actions"
            };
          }
        };
      }
      if (url.endsWith("/docs/keys/tikz-actions.json")) {
        return {
          ok: true,
          async json() {
            return {
              "line width": {
                type: "key",
                signatureHtml: "<kbd>/tikz/line width</kbd>=<i>dimension</i>",
                defaultHtml: "(no default)",
                snippetHtml: "<p>Sets the line width.</p>",
                page: "tikz-actions",
                anchor: "pgf.line:width",
                href: "https://tikz.dev/tikz-actions#pgf.line%3Awidth"
              }
            };
          }
        };
      }
      return { ok: false, async json() { return {}; } };
    });
    vi.stubGlobal("fetch", fetchMock);

    const entry = await lookupTikzDocEntry(["line width", "/tikz/line width"]);
    expect(entry).not.toBeNull();
    expect(entry?.page).toBe("tikz-actions");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const cached = await lookupTikzDocEntry(["line width"]);
    expect(cached?.href).toContain("tikz-actions");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when index entry is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        async json() {
          return {};
        }
      }))
    );

    const entry = await lookupTikzDocEntry(["not-a-key"]);
    expect(entry).toBeNull();
  });
});
