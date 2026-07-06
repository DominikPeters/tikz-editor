import { describe, expect, it } from "vitest";

import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import {
  rewriteOptionListMutations,
  serializeOptionEntry
} from "../packages/core/src/edit/option-mutations.js";

describe("option mutation serialization", () => {
  it("preserves non-bracketed option sites when all entries are removed", () => {
    const mutations = new Map([["draw", { kind: "remove" } as const]]);

    expect(rewriteOptionListMutations(parseOptionListRaw("[draw]"), mutations, undefined, "braced")).toBe("{}");
    expect(rewriteOptionListMutations(parseOptionListRaw("[draw]"), mutations, undefined, "bare")).toBe("");
  });

  it("can remove the no-arrow shorthand flag", () => {
    const mutations = new Map([["-", { kind: "remove" } as const]]);

    expect(rewriteOptionListMutations(parseOptionListRaw("[red, -]"), mutations)).toBe("[red]");
  });

  it("serializes bare draw colors only for color-like values", () => {
    const drawContext = { bareColorKey: "draw" as const };

    expect(serializeOptionEntry("draw", "{rgb,255:red,1;green,2;blue,3}", drawContext)).toBe(
      "{rgb,255:red,1;green,2;blue,3}"
    );
    expect(serializeOptionEntry("draw", "red!30!blue", drawContext)).toBe("red!30!blue");
    expect(serializeOptionEntry("draw", "not a color expression", drawContext)).toBe(
      "draw=not a color expression"
    );
  });
});
