import { describe, expect, it } from "vitest";

import { PersistentMap } from "../../packages/core/src/semantic/persistent-map.js";

describe("PersistentMap", () => {
  it("restores older snapshots after subsequent writes", () => {
    const map = new PersistentMap<string, number>();
    map.set("a", 1);
    map.set("b", 2);
    const before = map.snapshot();

    map.set("c", 3);
    map.set("a", 10);
    expect(map.get("a")).toBe(10);
    expect(map.get("c")).toBe(3);

    map.restore(before);
    expect(map.get("a")).toBe(1);
    expect(map.get("b")).toBe(2);
    expect(map.get("c")).toBeUndefined();
  });

  it("keeps iteration and size consistent across delete/restore", () => {
    const map = new PersistentMap<string, string>();
    map.set("x", "one");
    map.set("y", "two");
    const beforeDelete = map.snapshot();

    expect(map.delete("x")).toBe(true);
    expect(map.has("x")).toBe(false);
    expect(map.size).toBe(1);
    expect([...map.entries()]).toEqual([["y", "two"]]);

    map.restore(beforeDelete);
    expect(map.size).toBe(2);
    expect([...map.entries()]).toEqual([
      ["x", "one"],
      ["y", "two"]
    ]);
  });

  it("isolates forked overlays in both directions", () => {
    const parent = new PersistentMap<string, number>();
    parent.set("shared", 1);

    const child = parent.fork();
    child.set("shared", 2);
    child.set("child-only", 3);
    parent.set("parent-only", 4);

    expect([...parent.entries()]).toEqual([
      ["shared", 1],
      ["parent-only", 4]
    ]);
    expect([...child.entries()]).toEqual([
      ["shared", 2],
      ["child-only", 3]
    ]);
  });
});
