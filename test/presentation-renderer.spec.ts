import { describe, expect, it } from "vitest";
import { BeamerPresentationRenderer, remapPresentationCursor } from "../packages/app/src/presentation/renderer.js";
import { setActiveEditorPlatform } from "../packages/app/src/platform/current.js";

const frame = (text: string) => `\\begin{frame}${text}\\end{frame}`;
const deck = (...frames: string[]) => `\\documentclass{beamer}\\begin{document}${frames.join("\n")}\\end{document}`;
setActiveEditorPlatform({ id: "presentation-test", persistence: { load: () => null, save() {} } });

describe("presentation rendering", () => {
  it("reuses prepared pages and produces a separate formatted speaker-note SVG", async () => {
    const renderer = await BeamerPresentationRenderer.create(deck(frame(String.raw`Public\pause More\note{\textbf{Private} $x^2$}`)), null);
    const signal = new AbortController().signal;
    const cursor = { frame: 0, step: 1, continuation: 1 };
    const page = await renderer.page(cursor, signal);
    expect(await renderer.page(cursor, signal)).toBe(page);
    expect(await renderer.pageCount(0, signal)).toBe(2);
    expect(page.svg).not.toContain("Private");
    expect(page.notesSvg).toContain("presenter-notes");
    expect(page.notesSvg).toContain("<path");
  });

  it("retains the frame across reorder, and uses the nearest survivor when it is deleted", async () => {
    const a = frame("A"), b = frame("B"), c = frame("C");
    const previous = await BeamerPresentationRenderer.create(deck(a, b, c), null);
    const reordered = await BeamerPresentationRenderer.create(deck(c, a, b), null);
    const cursor = { frame: 1, step: 1, continuation: 1 };
    expect(remapPresentationCursor(previous, reordered, cursor).frame).toBe(2);
    const removed = await BeamerPresentationRenderer.create(deck(a, c), null);
    expect(remapPresentationCursor(previous, removed, cursor).frame).toBe(1);
    const edited = await BeamerPresentationRenderer.create(deck(a, frame("B edited"), c), null);
    expect(remapPresentationCursor(previous, edited, cursor).frame).toBe(1);
  });
});
