import { describe, expect, it } from "vitest";

import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import {
  rewriteOptionListMutations,
  rewriteSourceBackedOptionListMutations,
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

  it("does not mistake an escaped comma for an option delimiter", () => {
    const source = String.raw`[foo=\,
]`;
    const mutations = new Map([["bar", { kind: "set", value: "true" } as const]]);

    expect(rewriteSourceBackedOptionListMutations(
      source,
      { from: 0, to: source.length },
      parseOptionListRaw(source),
      mutations
    )).toBe(String.raw`[foo=\,,
bar
]`);
  });

  it("keeps authored comments when removing the last entry", () => {
    const source = "[red % important\n]";
    const mutations = new Map([["red", { kind: "remove" } as const]]);

    expect(rewriteSourceBackedOptionListMutations(
      source,
      { from: 0, to: source.length },
      parseOptionListRaw(source),
      mutations
    )).toBe("[ % important\n]");
  });

  it("removes the dangling comma when deleting the last multiline entry", () => {
    const source = "[red,\n  thick\n]";
    const mutations = new Map([["thick", { kind: "remove" } as const]]);

    expect(rewriteSourceBackedOptionListMutations(
      source,
      { from: 0, to: source.length },
      parseOptionListRaw(source),
      mutations
    )).toBe("[red\n]");
  });

  it("does not double the separator when inserting after a trailing comma", () => {
    const source = "[red,]";
    const mutations = new Map([["thick", { kind: "set", value: "true" } as const]]);

    expect(rewriteSourceBackedOptionListMutations(
      source,
      { from: 0, to: source.length },
      parseOptionListRaw(source),
      mutations
    )).toBe("[red, thick]");
  });

  it("inserts new entries before the requested key", () => {
    const source = "[draw=red, anchor=west, thick]";
    const mutations = new Map([["below", { kind: "set", value: "of a" } as const]]);

    expect(rewriteSourceBackedOptionListMutations(
      source,
      { from: 0, to: source.length },
      parseOptionListRaw(source),
      mutations,
      "bracketed",
      { beforeKey: "anchor" }
    )).toBe("[draw=red, below=of a, anchor=west, thick]");
  });

  it("falls back to appending when the requested insertion key is absent", () => {
    const source = "[draw=red]";
    const mutations = new Map([["below", { kind: "set", value: "of a" } as const]]);

    expect(rewriteSourceBackedOptionListMutations(
      source,
      { from: 0, to: source.length },
      parseOptionListRaw(source),
      mutations,
      "bracketed",
      { beforeKey: "anchor" }
    )).toBe("[draw=red, below=of a]");
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
