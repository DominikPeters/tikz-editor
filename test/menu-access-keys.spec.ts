import { describe, expect, it } from "vitest";
import { assignAccessKeys } from "../packages/app/src/ui/menu-access-keys";

function keys(labels: string[]): string[] {
  return assignAccessKeys(labels).map((index, position) => index == null ? "" : (labels[position] ?? "").charAt(index));
}

describe("menu access keys", () => {
  it("takes the first letter, then a later word's, then any free letter", () => {
    expect(keys(["File", "Edit", "Path", "Insert", "View", "Present", "Help"])).toEqual(["F", "E", "P", "I", "V", "r", "H"]);
    expect(keys(["Zoom In", "Zoom Out", "Zoom"])).toEqual(["Z", "O", "m"]);
  });

  it("keeps the Windows conventions even when an earlier item wants the letter", () => {
    expect(keys(["Undo", "Redo", "Copy", "Cut", "Paste", "Exit"])).toEqual(["U", "R", "C", "t", "P", "x"]);
    expect(keys(["Save", "Save As..."])).toEqual(["S", "A"]);
  });

  it("leaves a label without a free letter unmarked", () => {
    expect(keys(["A", "A", "—"])).toEqual(["A", "", ""]);
  });
});
