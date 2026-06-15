import { describe, expect, it } from "vitest";
import {
  normalizeTexMathAtomClasses,
  parseTexMath,
  spaceTexMathList,
  type TexMathAtom,
  type TexMathSpacedItem,
} from "../packages/core/src/text/tex/index.js";

function spacedItems(source: string, style: "text" | "script" = "text"): readonly TexMathSpacedItem[] {
  const parsed = parseTexMath(source);
  expect(parsed.diagnostics).toEqual([]);
  return spaceTexMathList(parsed.list, { style }).items;
}

function atoms(source: string): readonly TexMathAtom[] {
  const parsed = parseTexMath(source);
  expect(parsed.diagnostics).toEqual([]);
  return normalizeTexMathAtomClasses(parsed.list).items.filter((item): item is TexMathAtom => item.kind === "atom");
}

describe("TeX math atom classes and spacing", () => {
  it("keeps binary operators between ordinary atoms and inserts medium mu glue", () => {
    const items = spacedItems("a+b");

    expect(items.map((item) => item.kind)).toEqual([
      "atom",
      "resolved-glue",
      "atom",
      "resolved-glue",
      "atom",
    ]);
    expect(items[1]).toMatchObject({
      source: "inter-atom",
      mu: 4,
      stretchMu: 2,
      shrinkMu: 4,
      leftClass: "ord",
      rightClass: "bin",
    });
    expect(items[3]).toMatchObject({
      source: "inter-atom",
      mu: 4,
      leftClass: "bin",
      rightClass: "ord",
    });
  });

  it("reclassifies binary operators at unary positions to ordinary atoms", () => {
    expect(atoms("-a").map((atom) => atom.atomClass)).toEqual(["ord", "ord"]);
    expect(spacedItems("-a").map((item) => item.kind)).toEqual(["atom", "atom"]);

    expect(atoms("a+").map((atom) => atom.atomClass)).toEqual(["ord", "ord"]);
    expect(spacedItems("a+").map((item) => item.kind)).toEqual(["atom", "atom"]);

    expect(atoms("a=-b").map((atom) => atom.atomClass)).toEqual(["ord", "rel", "ord", "ord"]);
    expect(spacedItems("a=-b").filter((item) => item.kind === "resolved-glue")).toEqual([
      expect.objectContaining({ mu: 5, leftClass: "ord", rightClass: "rel" }),
      expect.objectContaining({ mu: 5, leftClass: "rel", rightClass: "ord" }),
    ]);
  });

  it("applies TeX spacing table around relations, punctuation, and explicit inner atoms", () => {
    expect(spacedItems("a=b").filter((item) => item.kind === "resolved-glue")).toEqual([
      expect.objectContaining({ mu: 5, leftClass: "ord", rightClass: "rel" }),
      expect.objectContaining({ mu: 5, leftClass: "rel", rightClass: "ord" }),
    ]);
    expect(spacedItems("a,b").filter((item) => item.kind === "resolved-glue")).toEqual([
      expect.objectContaining({ mu: 3, leftClass: "punct", rightClass: "ord" }),
    ]);
    expect(spacedItems("a{b}").filter((item) => item.kind === "resolved-glue")).toEqual([]);
    expect(spacedItems(String.raw`a\mathinner{b}`).filter((item) => item.kind === "resolved-glue")).toEqual([
      expect.objectContaining({ mu: 3, leftClass: "ord", rightClass: "inner" }),
    ]);
  });

  it("suppresses style-dependent inter-atom glue in script styles", () => {
    expect(spacedItems("a+b", "script").map((item) => item.kind)).toEqual([
      "atom",
      "atom",
      "atom",
    ]);
    expect(spacedItems("a=b", "script").map((item) => item.kind)).toEqual([
      "atom",
      "atom",
      "atom",
    ]);
    expect(spacedItems(String.raw`a\mathop{o}b`, "script").filter((item) => item.kind === "resolved-glue")).toEqual([
      expect.objectContaining({ mu: 3, leftClass: "ord", rightClass: "op" }),
      expect.objectContaining({ mu: 3, leftClass: "op", rightClass: "ord" }),
    ]);
  });

  it("preserves explicit math spacing commands as resolved glue", () => {
    const items = spacedItems(String.raw`x\,y\:z\;w\!q\nobreakspace r\ s\negmedspace t\negthickspace u\quad v\qquad w`);
    const glues = items.filter((item) => item.kind === "resolved-glue");

    expect(glues).toEqual([
      expect.objectContaining({ source: "explicit", command: ",", mu: 3 }),
      expect.objectContaining({ source: "explicit", command: ":", mu: 4, stretchMu: 2, shrinkMu: 4 }),
      expect.objectContaining({ source: "explicit", command: ";", mu: 5, stretchMu: 5 }),
      expect.objectContaining({ source: "explicit", command: "!", mu: -3 }),
      expect.objectContaining({ source: "explicit", command: "nobreakspace", mu: 18 }),
      expect.objectContaining({ source: "explicit", command: "nobreakspace", mu: 18 }),
      expect.objectContaining({ source: "explicit", command: "negmedspace", mu: -4, stretchMu: -2, shrinkMu: -4 }),
      expect.objectContaining({ source: "explicit", command: "negthickspace", mu: -5, stretchMu: -5 }),
      expect.objectContaining({ source: "explicit", command: "quad", mu: 18 }),
      expect.objectContaining({ source: "explicit", command: "qquad", mu: 36 }),
    ]);
  });

  it("parses explicit atom class commands before spacing", () => {
    expect(atoms(String.raw`a\mathrel{=}b`).map((atom) => atom.atomClass)).toEqual([
      "ord",
      "rel",
      "ord",
    ]);
    expect(spacedItems(String.raw`a\mathrel{=}b`).filter((item) => item.kind === "resolved-glue")).toEqual([
      expect.objectContaining({ mu: 5, leftClass: "ord", rightClass: "rel" }),
      expect.objectContaining({ mu: 5, leftClass: "rel", rightClass: "ord" }),
    ]);

    expect(atoms(String.raw`\mathbin{+}a`).map((atom) => atom.atomClass)).toEqual([
      "ord",
      "ord",
    ]);
  });

  it("normalizes nested lists independently", () => {
    const [group] = atoms("{-a}");
    expect(group?.nucleus.kind).toBe("list");
    if (group?.nucleus.kind !== "list") {
      return;
    }
    const nestedAtoms = group.nucleus.list.items.filter((item): item is TexMathAtom => item.kind === "atom");
    expect(nestedAtoms.map((atom) => atom.atomClass)).toEqual(["ord", "ord"]);
  });
});
