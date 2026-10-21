import { describe, expect, it } from "vitest";

import {
  formatDocumentRootId,
  parseDocumentRootId,
  tikzFigureIndexFromRootId,
  type DocumentRootRef,
} from "../packages/core/src/document/root-id.js";

describe("document root id codec", () => {
  it("round-trips every root kind", () => {
    const refs: DocumentRootRef[] = [
      { kind: "tikz-figure", index: 0 },
      { kind: "tikz-figure", index: 12 },
      { kind: "beamer-frame", index: 3 },
      { kind: "beamer-frame-tikz", frameIndex: 3, index: 1 },
    ];
    for (const ref of refs) {
      expect(parseDocumentRootId(formatDocumentRootId(ref))).toEqual(ref);
    }
  });

  it("formats the established wire shapes", () => {
    expect(formatDocumentRootId({ kind: "tikz-figure", index: 2 })).toBe(
      "figure:2"
    );
    expect(formatDocumentRootId({ kind: "beamer-frame", index: 0 })).toBe(
      "frame:0"
    );
    expect(
      formatDocumentRootId({ kind: "beamer-frame-tikz", frameIndex: 4, index: 1 })
    ).toBe("frame:4:tikzpicture:1");
  });

  it("resolves descendant-qualified ids to their owning root", () => {
    expect(parseDocumentRootId("figure:2:node:5")).toEqual({
      kind: "tikz-figure",
      index: 2,
    });
    expect(parseDocumentRootId("frame:1:frame-title:text")).toEqual({
      kind: "beamer-frame",
      index: 1,
    });
    expect(parseDocumentRootId("frame:1:tikzpicture:0:node:3")).toEqual({
      kind: "beamer-frame-tikz",
      frameIndex: 1,
      index: 0,
    });
  });

  it("tolerates surrounding whitespace like the legacy parser", () => {
    expect(parseDocumentRootId(" figure:7 ")).toEqual({
      kind: "tikz-figure",
      index: 7,
    });
  });

  it("rejects ids outside the root namespace", () => {
    for (const id of ["", "figure", "figure:", "figure:x", "node:3", "frame:-1"]) {
      expect(parseDocumentRootId(id)).toBeNull();
    }
  });

  it("extracts tikz figure indices only from tikz figure ids", () => {
    expect(tikzFigureIndexFromRootId("figure:5")).toBe(5);
    expect(tikzFigureIndexFromRootId("figure:5:path:2")).toBe(5);
    expect(tikzFigureIndexFromRootId("frame:5")).toBeNull();
    expect(tikzFigureIndexFromRootId("banana")).toBeNull();
  });
});
