import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBeamerFrameBody } from "../packages/core/src/beamer/content.js";
import { scanBeamerDocument } from "../packages/core/src/beamer/scan.js";
import { prepareBeamerDocument, renderBeamerFrame } from "../packages/core/src/beamer/render.js";
import { emitTcolorboxBackground, measureTcolorboxGeometry, parseTcolorboxOptions, projectTcolorboxFontDeclaration, resolveTcolorboxPlan, tcolorboxSurroundingSpacing } from "../packages/core/src/beamer/tcolorbox.js";
import { createIdentityMappedText } from "../packages/core/src/text/source-map.js";
import { texLength } from "../packages/core/src/text/tex/coordinates.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import type { BeamerBlockBodyNode } from "../packages/core/src/beamer/content-types.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const fixture = readFileSync(new URL("./fixtures/beamer/tcolorbox-fidelity/boxes.tex", import.meta.url), "utf8");
const oracle = JSON.parse(readFileSync(new URL("./fixtures/beamer/tcolorbox-fidelity/boxes.oracle.json", import.meta.url), "utf8")) as {
  sourceSha256: string; pages: Array<{ frameIndex: number; trace: OracleBeamerPageTrace }>;
};
const deck = (body: string, preamble = "") => String.raw`\documentclass{beamer}\usepackage{tcolorbox}${preamble}\begin{document}\begin{frame}{Test}${body}\end{frame}\end{document}`;
const bodyIr = (source: string) => {
  const document = scanBeamerDocument(source);
  return parseBeamerFrameBody({ source, frame: document.frames[0], document });
};
const box = (source: string): BeamerBlockBodyNode => {
  const result = bodyIr(source).children.find(node => node.kind === "block");
  if (!result || result.kind !== "block") throw new Error("Expected a supported package box");
  return result;
};
const dimensions = { linewidth: texLength(307.289871), textwidth: texLength(307.289871), columnwidth: texLength(307.289871), paperwidth: texLength(364.195358), em: texLength(10.95), ex: texLength(4.86) };
const planFor = (source: string, node = box(source)) => {
  const parsed = parseTcolorboxOptions(source, node.options, node.beginSpan);
  const result = resolveTcolorboxPlan({ source, options: parsed, dimensions, baselineSkipPt: 13.6 });
  expect(result.diagnostics).toEqual([]);
  if (!result.plan) throw new Error("Expected a supported box plan");
  return result.plan;
};

describe("ordinary tcolorbox package boxes", () => {
  it("keeps title punctuation and nested TeX groups source-backed while preserving body ownership", () => {
    const source = deck(String.raw`Before.\begin{tcolorbox}[title={A title, with \emph{emphasis}},colback=blue!5!white]Body.\end{tcolorbox}After.`);
    const ir = bodyIr(source);
    expect(ir.diagnostics).toEqual([]);
    expect(ir.children.map(node => node.kind)).toEqual(["paragraph", "block", "paragraph"]);
    const node = box(source);
    expect(node.packageBox).toBe("tcolorbox");
    expect(node.title.value).toBe(String.raw`A title, with \emph{emphasis}`);
    expect(source.slice(node.title.contentSpan.from, node.title.contentSpan.to)).toBe(node.title.value);
    expect(source.slice(node.bodySpan.from, node.bodySpan.to)).toBe("Body.");
    expect(source.slice(node.children[0].span.from, node.children[0].span.to)).toBe("Body.");
  });

  it("uses the last title/notitle and option declaration in authored order", () => {
    const source = deck(String.raw`\begin{tcolorbox}[title=Old,notitle,title={New},left=3pt,leftupper=7pt,right=9pt,boxrule=1pt,leftrule=2pt]Body.\end{tcolorbox}`);
    const plan = planFor(source);
    expect(plan.title.value).toBe("New");
    expect(plan).toMatchObject({ leftPt: 7, leftTitlePt: 3, rightPt: 9, rightTitlePt: 9, leftRulePt: 2, rightRulePt: 1, titleRulePt: 1 });
  });

  it("matches the stock TeX savebox dimensions independently of Beamer block templates", () => {
    const document = scanBeamerDocument(fixture);
    const ir = parseBeamerFrameBody({ source: fixture, frame: document.frames[0], document });
    const node = ir.children[0] as BeamerBlockBodyNode;
    const plan = planFor(fixture, node);
    expect(plan.bodyXPt).toBeCloseTo(15.648971, 5);
    expect(plan.titleWidthPt).toBeCloseTo(275.991928, 5);
    expect(plan).toMatchObject({ frameColor: "#0000bf", backgroundColor: "#f2f2ff", titleColor: "#ffffff", textColor: "#000000", suppressInitialListTopsep: true });
    const geometry = measureTcolorboxGeometry(plan, 7.851151, 24.440216);
    expect(geometry.titleTopPt).toBeCloseTo(4.267883, 5);
    expect(geometry.bodyTopPt).toBeCloseTo(24.922714, 5);
    expect(geometry.heightPt).toBeCloseTo(59.32135, 5);
  });

  it("resolves width and padding against the containing column/font", () => {
    const source = deck(String.raw`\begin{tcolorbox}[width=.8\linewidth,left=1em,right=.5em,boxsep=1pt,boxrule=.5pt]Body.\end{tcolorbox}`);
    const plan = planFor(source);
    expect(plan.widthPt).toBeCloseTo(245.831894, 5);
    expect(plan.bodyXPt).toBeCloseTo(12.449997, 5);
    expect(plan.bodyWidthPt).toBeCloseTo(plan.widthPt - 19.425, 4);
  });

  it("omits all title padding and title rule for an untitled box", () => {
    const source = deck(String.raw`\begin{tcolorbox}[boxrule=1pt,boxsep=2pt,top=3pt,bottom=4pt]Body.\end{tcolorbox}`);
    const plan = planFor(source);
    expect(measureTcolorboxGeometry(plan, 999, 8)).toMatchObject({ heightPt: 21, bodyTopPt: 6, interiorTopPt: 1 });
  });

  it("preserves distinct title/body font-option and prose source mappings", () => {
    const source = deck(String.raw`\begin{tcolorbox}[title=Heading,fonttitle=\bfseries,fontupper={\small\itshape}]Body.\end{tcolorbox}`);
    const plan = planFor(source);
    const node = box(source);
    const body = projectTcolorboxFontDeclaration(createIdentityMappedText("Body.", node.bodySpan.from), plan.fontUpper);
    expect(body.text).toBe(String.raw`\small\itshape Body.`);
    expect(body.sourceMap.charOrigins[body.text.indexOf("Body")]).toMatchObject({ kind: "direct", from: source.indexOf("Body.") });
    expect(body.sourceMap.charOrigins[0]).toMatchObject({ kind: "direct", from: source.indexOf(String.raw`\small`) });
    expect(plan.fontTitle?.value).toBe(String.raw`\bfseries`);
  });

  it("uses balanced before/after skips and restores the following baseline depth", () => {
    const source = deck(String.raw`\begin{tcolorbox}Body.\end{tcolorbox}`);
    const plan = planFor(source);
    expect(tcolorboxSurroundingSpacing(plan, { baselineSkipPt: 13.6, previousDepthPt: 2 })).toMatchObject({ afterPt: 6.8, endingDepthPt: 4.08 });
    expect(tcolorboxSurroundingSpacing(plan, { baselineSkipPt: 13.6, previousDepthPt: 2 }).beforePt).toBeCloseTo(8.88, 6);
    expect(tcolorboxSurroundingSpacing(plan, { baselineSkipPt: 13.6, previousDepthPt: null, atStart: true }).beforePt).toBe(0);
    expect(tcolorboxSurroundingSpacing(plan, { baselineSkipPt: 13.6, previousDepthPt: 2, insideMinipage: true, parskipPt: 1 }).beforePt).toBe(-1);
    plan.noBeforeAfter = true;
    expect(tcolorboxSurroundingSpacing(plan, { baselineSkipPt: 13.6, previousDepthPt: 2 })).toEqual({ beforePt: 0, afterPt: 0, endingDepthPt: 0 });
  });

  it("fills a rounded frame and bottom-rounded body, and optionally a separately colored title", () => {
    const source = deck(String.raw`\begin{tcolorbox}[title=Heading,colbacktitle=green!30!black]Body.\end{tcolorbox}`);
    const plan = planFor(source);
    const geometry = measureTcolorboxGeometry(plan, 8, 9);
    const svg = emitTcolorboxBackground(plan, geometry);
    expect(svg).toContain('data-tcolorbox-layer="frame"');
    expect(svg).toContain('data-tcolorbox-layer="body"');
    expect(svg).toContain('data-tcolorbox-layer="title"');
    expect(svg.match(/C/gu)).toHaveLength(8);
    plan.sharpCorners = true;
    expect(emitTcolorboxBackground(plan, geometry)).not.toContain("C");
  });

  it.each(["enhanced", "breakable", "sidebyside", "height=50pt", "overlay={code}", "left=\\dimexpr2pt+3pt\\relax", "fonttitle=\\myfont"])('diagnoses and preserves the bounded box for unsupported option "%s"', option => {
    const source = deck(String.raw`Before.\begin{tcolorbox}[${option}]Body.\end{tcolorbox}After.`);
    const ir = bodyIr(source);
    expect(ir.children.map(node => node.kind)).toEqual(["paragraph", "unsupported", "paragraph"]);
    expect(ir.diagnostics[0].code).toBe("beamer-tcolorbox-unsupported-option");
    expect(source.slice(ir.children[1].span.from, ir.children[1].span.to)).toBe(String.raw`\begin{tcolorbox}[${option}]Body.\end{tcolorbox}`);
  });

  it.each([String.raw`Upper.\tcblower Lower.`, String.raw`\begin{tcolorbox}Nested.\end{tcolorbox}`, String.raw`\begin{block}{Nested}Body.\end{block}`])("diagnoses unsupported lower/nested content without swallowing sibling prose", content => {
    const source = deck(String.raw`Before.\begin{tcolorbox}${content}\end{tcolorbox}After.`);
    const ir = bodyIr(source);
    expect(ir.children.map(node => node.kind)).toEqual(["paragraph", "unsupported", "paragraph"]);
    expect(ir.diagnostics[0].code).toBe("beamer-tcolorbox-unsupported-content");
  });

  it("diagnoses global style setup while comments containing setup commands stay inert", () => {
    const body = String.raw`\begin{tcolorbox}Body.\end{tcolorbox}`;
    expect(bodyIr(deck(body, String.raw`\tcbset{left=1pt}`)).diagnostics[0].code).toBe("beamer-tcolorbox-unsupported-setup");
    expect(bodyIr(deck(body, "% \\tcbset{left=1pt}\n")).diagnostics).toEqual([]);
  });

  it("recognizes package boxes in command-form columns and keeps unsupported options local", () => {
    const source = deck(String.raw`\begin{columns}\column{.5\textwidth}\begin{tcolorbox}[title=Left]One.\end{tcolorbox}\column{.5\textwidth}\begin{tcolorbox}[enhanced]Two.\end{tcolorbox}After.\end{columns}`);
    const columns = bodyIr(source).children[0];
    expect(columns.kind).toBe("columns");
    if (columns.kind !== "columns") throw new Error("Expected columns");
    expect(columns.columns[0].children[0]).toMatchObject({ kind: "block", packageBox: "tcolorbox" });
    expect(columns.columns[1].children.map(node => node.kind)).toEqual(["unsupported", "paragraph"]);
  });

  it("pins the source used for the LuaLaTeX fidelity snapshots", () => {
    expect(createHash("sha256").update(fixture).digest("hex")).toBe(oracle.sourceSha256);
  });

  for (const page of oracle.pages) it(`matches LuaLaTeX glyphs and stock box packing for source frame ${page.frameIndex + 1}`, async () => {
    const result = await prepareBeamerDocument(fixture).renderFrame({ frameIndex: page.frameIndex });
    expect(result.diagnostics).toEqual([]);
    expect(result.svg.svg).not.toContain("data-tex-literal=");
    expect(result.svg.svg).toContain('data-tcolorbox-layer="frame"');
    const { summary } = compareBeamerPageTraces(buildNativeBeamerPageTrace(result, computerModernTexMetricProvider), page.trace);
    expect(summary).toMatchObject({ unmatchedNativeRectangles: 0, unmatchedOracleRules: 0, unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0, excludedOracleTextLines: 0, glyphCodeMatch: true, fontMatch: true, transformMatch: true });
    expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.02);
    expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.01);
  });
  it("keeps a package box inside a Beamer block in a bounded source card", async () => {
    const nested = String.raw`\begin{tcolorbox}[enhanced]Unknown skin.\end{tcolorbox}`;
    const source = deck(String.raw`\begin{block}{Outer}Before.${nested}After.\end{block}`);
    const result = await renderBeamerFrame(source);
    const cards = result.layout.items.filter(item => item.kind === "unsupported");
    expect(cards).toHaveLength(1);
    expect(source.slice(cards[0].sourceSpan.from, cards[0].sourceSpan.to)).toBe(nested);
    expect(cards[0].bounds.height).toBeGreaterThan(0);
    expect(cards[0].bounds.height).toBeLessThanOrEqual(54);
    expect(result.layout.paragraphs.filter(paragraph => paragraph.role === "block-body").map(paragraph => source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to)).join(" ")).toContain("After.");
  });

});
