import { describe, expect, it } from "vitest";

import { PersistentMap } from "../../packages/core/src/semantic/persistent-map.js";

describe("PersistentMap", () => {
  it("materializes long checkpoint histories with linear retained storage", () => {
    const map = new PersistentMap<number, number | undefined>();
    const snapshots = [];
    for (let index = 0; index < 500; index += 1) {
      map.set(index, index === 10 ? undefined : index);
      snapshots.push(map.snapshot());
    }
    expect([...map.keys()]).toEqual(Array.from({ length: 500 }, (_, index) => index));
    expect(snapshots.reduce((total, snapshot) => total + (snapshot.materialized?.size ?? 0), 0)).toBeLessThanOrEqual(500);
    expect(map.has(10)).toBe(true);
    expect(map.get(10)).toBeUndefined();
    map.restore(snapshots[249]);
    expect(map.has(499)).toBe(false);
    expect(map.get(0)).toBe(0);
    map.delete(10);
    map.set(500, 500);
    expect(map.size).toBe(250);
    const old = new PersistentMap(snapshots[249]);
    expect(old.has(10)).toBe(true);
    expect(old.has(500)).toBe(false);
    expect(new PersistentMap(snapshots[499]).size).toBe(500);
  });

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
