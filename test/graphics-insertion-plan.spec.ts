import { describe, expect, it } from "vitest";
import { planGraphicsFileName, planGraphicsFolder, type GraphicsFolderListing } from "../packages/core/src/graphics/index.js";

const deck = (preamble: string, ...frames: string[]) => `\\documentclass{beamer}\n${preamble}\n\\begin{document}\n${frames.map((body) => `\\begin{frame}\n${body}\n\\end{frame}`).join("\n")}\n\\end{document}`;
const listing = (...files: string[]): GraphicsFolderListing => ({ files: files.map((path) => ({ path })) });
const at = (source: string, marker: string) => source.indexOf(marker);

describe("choosing the folder for a new image", () => {
  it("follows the nearest image before the insertion point, then after it", () => {
    const source = deck("", "\\includegraphics{figs/week1/a}", "MARK1", "\\includegraphics{figs/week3/b.png} MARK2");
    const files = listing("figs/week1/a.pdf", "figs/week3/b.png");
    expect(planGraphicsFolder(source, at(source, "MARK1"), files)).toEqual({ folder: "figs/week1", reason: "nearest" });
    expect(planGraphicsFolder(source, at(source, "MARK2"), files)).toEqual({ folder: "figs/week3", reason: "nearest" });
    expect(planGraphicsFolder(source, 0, files)).toEqual({ folder: "figs/week1", reason: "nearest" });
  });

  it("keeps images beside the .tex when the document does", () => {
    const source = deck("", "\\includegraphics{plot.pdf}", "MARK");
    expect(planGraphicsFolder(source, at(source, "MARK"), listing("plot.pdf", "old/x.png", "old/y.png"))).toEqual({ folder: "", reason: "nearest" });
  });

  it("prefers the project's own folders over a shared one outside it", () => {
    const source = deck("", "\\includegraphics{img/chart}", "\\includegraphics{../shared/logo.png} MARK");
    expect(planGraphicsFolder(source, at(source, "MARK"), listing("img/chart.png"))).toEqual({ folder: "img", reason: "nearest" });
    const onlyShared = deck("", "\\includegraphics{../shared/logo.png} MARK");
    expect(planGraphicsFolder(onlyShared, at(onlyShared, "MARK"), listing())).toEqual({ folder: "../shared", reason: "nearest" });
  });

  it("stays among \\graphicspath folders, even when a nearer image sits elsewhere", () => {
    const source = deck("\\graphicspath{{pics/}{art/}}", "\\includegraphics{photo}", "\\includegraphics{logo.png} MARK");
    expect(planGraphicsFolder(source, at(source, "MARK"), listing("art/photo.jpg", "logo.png"))).toEqual({ folder: "art", reason: "graphicspath" });
    const empty = deck("\\graphicspath{{./pics/}}", "MARK");
    expect(planGraphicsFolder(empty, at(empty, "MARK"), listing())).toEqual({ folder: "pics", reason: "graphicspath" });
  });

  it("uses the folder holding the most images when the document has none, whatever its name", () => {
    const source = deck("", "MARK");
    expect(planGraphicsFolder(source, 0, listing("Abbildungen/a.png", "Abbildungen/b.pdf", "cover.jpg"))).toEqual({ folder: "Abbildungen", reason: "existing" });
    expect(planGraphicsFolder(source, 0, listing("a.png", "b.png", "x/c.png"))).toEqual({ folder: "", reason: "loose" });
    expect(planGraphicsFolder(source, 0, listing("notes.txt"))).toEqual({ folder: "figures", reason: "default" });
    expect(planGraphicsFolder(source, 0, null)).toEqual({ folder: "figures", reason: "default" });
  });

  it("ignores commented-out images", () => {
    const source = deck("", "% \\includegraphics{old/a.png}\nMARK");
    expect(planGraphicsFolder(source, at(source, "MARK"), listing("new/a.png"))).toEqual({ folder: "new", reason: "existing" });
  });
});

describe("naming the new image", () => {
  it("writes the extension and dot-slash the way the document does", () => {
    const source = deck("", "\\includegraphics{./figs/a}\\includegraphics{./figs/b}");
    const files = listing("figs/a.pdf", "figs/b.png");
    const plan = planGraphicsFileName(source, { folder: "figs", reason: "nearest" }, "Results.png", ".png", files);
    expect(plan).toMatchObject({ path: "figs/results.png", texPath: "./figs/results", reuse: false });
  });

  it("keeps the extension when an extensionless name would find another file first", () => {
    const source = deck("", "\\includegraphics{figs/a}");
    const plan = planGraphicsFileName(source, { folder: "figs", reason: "nearest" }, "chart.png", ".png", listing("figs/a.pdf", "figs/Chart.pdf"));
    expect(plan.path).toBe("figs/chart-2.png");
    const clash = planGraphicsFileName(source, { folder: "figs", reason: "nearest" }, "chart.png", ".png", listing("figs/a.pdf", "chart.pdf"));
    expect(clash.texPath).toBe("figs/chart");
  });

  it("writes names relative to the \\graphicspath folder", () => {
    const source = deck("\\graphicspath{{figures/}}", "\\includegraphics{a.png}");
    expect(planGraphicsFileName(source, { folder: "figures", reason: "graphicspath" }, "b.jpg", ".jpg", listing("figures/a.png")).texPath).toBe("b.jpg");
    // The name as written is tried first, relative to the .tex.
    expect(planGraphicsFileName(source, { folder: "figures", reason: "graphicspath" }, "b.jpg", ".jpg", listing("figures/a.png", "b.jpg")).texPath).toBe("figures/b.jpg");
  });

  it("names files in the folder's style", () => {
    const source = deck("", "");
    const snake = listing("figs/loss_curve.pdf", "figs/model_overview.png");
    expect(planGraphicsFileName(source, { folder: "figs", reason: "existing" }, "Screenshot 2026-11-08 at 10.42.13.png", ".png", snake).path).toBe("figs/screenshot_2026_11_08_at_10_42_13.png");
    expect(planGraphicsFileName(source, { folder: "x", reason: "default" }, "My Photo (1).heic", ".jpg", null).path).toBe("x/My-Photo-1.jpg");
  });

  it("reuses an identical file instead of copying it again", () => {
    const source = deck("", "\\includegraphics{figs/logo.png}");
    const plan = planGraphicsFileName(source, { folder: "figs", reason: "nearest" }, "logo.png", ".png", listing("figs/logo.png"), new Set(["figs/logo.png"]));
    expect(plan).toMatchObject({ path: "figs/logo.png", texPath: "figs/logo.png", reuse: true });
  });
});
