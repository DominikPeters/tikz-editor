import { expect, it } from "vitest";
import { suggestedSaveName } from "../../packages/app/src/ui/useDocumentFileOperations";

it("offers an unsaved document under its title", () => {
  expect(suggestedSaveName({ fileRef: null, title: "Untitled 1" })).toBe("Untitled 1.tex");
  expect(suggestedSaveName({ fileRef: null, title: "figure.tikz" })).toBe("figure.tikz");
  expect(suggestedSaveName({ fileRef: null, title: "a/b: c" })).toBe("a b c.tex");
  expect(suggestedSaveName({ fileRef: null, title: "  " })).toBe("Untitled.tex");
});

it("keeps the name of a document that already has a file", () => {
  expect(suggestedSaveName({ fileRef: { kind: "file", name: "plot.tex", path: "/plot.tex" }, title: "Other" })).toBe("plot.tex");
});
