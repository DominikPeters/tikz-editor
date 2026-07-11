import { describe, expect, it } from "vitest";

import { parseStyleValueAsOptionList } from "../../packages/core/src/semantic/style/option-utils.js";
import {
  applyCustomStyleDefinition,
  cloneCustomStyleRegistry,
  createDefaultCustomStyleRegistry
} from "../../packages/core/src/semantic/style/custom-styles.js";
import {
  clonePicDefinitionRegistry,
  createDefaultPicDefinitionRegistry,
  type PicDefinition
} from "../../packages/core/src/semantic/pics/registry.js";
import { PersistentMap } from "../../packages/core/src/semantic/persistent-map.js";

function optionList(raw: string) {
  const parsed = parseStyleValueAsOptionList(raw);
  expect(parsed).not.toBeNull();
  return parsed!;
}

function picDefinition(name: string, codeRaw: string): PicDefinition {
  return {
    name,
    codeRaw,
    sourceRef: {
      sourceId: `test-pic:${name}:${codeRaw}`,
      sourceKind: "pic-definition",
      label: name
    },
    parameterized: false,
    codeLayer: "normal"
  };
}

describe("layered semantic registries", () => {
  it("forks evaluator-owned registries without enumerating their inherited entries", () => {
    const styles = createDefaultCustomStyleRegistry();
    applyCustomStyleDefinition(styles, "local", "style", optionList("draw=red"));
    const pics = createDefaultPicDefinitionRegistry();
    pics.set("local", picDefinition("local", "local-code"));

    const rejectEnumeration = () => {
      throw new Error("registry fork enumerated its parent");
    };
    Object.defineProperty(styles, Symbol.iterator, { value: rejectEnumeration });
    Object.defineProperty(pics, Symbol.iterator, { value: rejectEnumeration });

    const styleFork = cloneCustomStyleRegistry(styles);
    const picFork = clonePicDefinitionRegistry(pics);
    expect(styleFork.has("local")).toBe(true);
    expect(picFork.get("local")?.codeRaw).toBe("local-code");
  });

  it("forks custom styles with inherited iteration order and isolated replacement-on-write", () => {
    const parent = createDefaultCustomStyleRegistry();
    applyCustomStyleDefinition(parent, "first local", "style", optionList("draw=black"));
    applyCustomStyleDefinition(parent, "shared local", "style", optionList("draw=red"));
    const inheritedLayers = parent.get("shared local");
    const inheritedKeys = [...parent.keys()];

    const child = cloneCustomStyleRegistry(parent);
    const sibling = cloneCustomStyleRegistry(parent);

    expect(child).toBeInstanceOf(PersistentMap);
    expect(Object.prototype.toString.call(child)).toBe("[object Map]");
    expect(child.get("shared local")).toBe(inheritedLayers);
    expect([...child.keys()]).toEqual(inheritedKeys);

    applyCustomStyleDefinition(child, "shared local", "append", optionList("dashed"));
    applyCustomStyleDefinition(child, "child only", "style", optionList("fill=blue"));
    applyCustomStyleDefinition(sibling, "shared local", "style", optionList("draw=green"));
    applyCustomStyleDefinition(parent, "parent only", "style", optionList("fill=yellow"));

    expect(parent.get("shared local")).toHaveLength(1);
    expect(child.get("shared local")).toHaveLength(2);
    expect(sibling.get("shared local")).toHaveLength(1);
    expect(parent.has("child only")).toBe(false);
    expect(parent.has("parent only")).toBe(true);
    expect(child.has("parent only")).toBe(false);
    expect(sibling.has("child only")).toBe(false);
    expect([...child.keys()].indexOf("shared local")).toBe(inheritedKeys.indexOf("shared local"));

    applyCustomStyleDefinition(child, "shared local", "style", optionList("draw=blue"));
    expect(child.get("shared local")).toHaveLength(1);
    expect([...child.keys()].indexOf("shared local")).toBe(inheritedKeys.indexOf("shared local"));

    const callerOwnedMap = new Map(parent);
    const imported = cloneCustomStyleRegistry(callerOwnedMap);
    callerOwnedMap.delete("shared local");
    expect(imported).toBeInstanceOf(PersistentMap);
    expect(imported.has("shared local")).toBe(true);
  });

  it("forks pic definitions with Map-compatible iteration and isolated replacement", () => {
    const parent = createDefaultPicDefinitionRegistry();
    const first = picDefinition("first", "first-code");
    const inherited = picDefinition("shared", "parent-code");
    parent.set("first", first);
    parent.set("shared", inherited);

    const child = clonePicDefinitionRegistry(parent);
    const sibling = clonePicDefinitionRegistry(parent);
    expect(child).toBeInstanceOf(PersistentMap);
    expect(Object.prototype.toString.call(child)).toBe("[object Map]");
    expect(child.get("shared")).toBe(inherited);
    expect([...child.entries()]).toEqual([...parent.entries()]);

    child.set("shared", picDefinition("shared", "child-code"));
    child.set("child-only", picDefinition("child-only", "child-only-code"));
    sibling.set("shared", picDefinition("shared", "sibling-code"));
    parent.set("parent-only", picDefinition("parent-only", "parent-only-code"));

    expect(parent.get("shared")?.codeRaw).toBe("parent-code");
    expect(child.get("shared")?.codeRaw).toBe("child-code");
    expect(sibling.get("shared")?.codeRaw).toBe("sibling-code");
    expect(child.has("parent-only")).toBe(false);
    expect(parent.has("child-only")).toBe(false);
    expect([...child.keys()]).toEqual(["first", "shared", "child-only"]);

    const iterated: string[] = [];
    child.forEach((_definition, name, registry) => {
      expect(registry).toBe(child);
      iterated.push(name);
    });
    expect(iterated).toEqual(["first", "shared", "child-only"]);

    const callerOwnedMap = new Map(parent);
    const imported = clonePicDefinitionRegistry(callerOwnedMap);
    callerOwnedMap.delete("shared");
    expect(imported).toBeInstanceOf(PersistentMap);
    expect(imported.get("shared")?.codeRaw).toBe("parent-code");
  });
});
