import { describe, expect, it } from "vitest";

import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { computeSvgPathBounds, computeSvgStrokedPathBounds } from "../packages/core/src/svg/geometry.js";
import { worldTransform } from "../packages/core/src/coords/transforms.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { renderPathWithArrows } from "../packages/core/src/svg/arrows/render.js";
import { emitSvg } from "../packages/core/src/svg/emit.js";

function renderSvg(source: string): string {
  const parsed = parseTikz(source);
  const semantic = evaluateTikzFigure(parsed.figure, source);
  return emitSvg(semantic.scene).svg;
}

function extractShaftLineEndpoints(svg: string, sourceId: string): { startX: number; endX: number } | null {
  const escapedSourceId = sourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = svg.match(new RegExp(`data-source-id="${escapedSourceId}" d="M ([0-9.\\-]+) [0-9.\\-]+ L ([0-9.\\-]+) [0-9.\\-]+"`));
  if (!match) {
    return null;
  }
  return {
    startX: Number(match[1]),
    endX: Number(match[2])
  };
}

function extractArrowPathPoints(svg: string, sourceId: string, tipKind: string): { x: number; y: number }[] {
  const escapedSourceId = sourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedTipKind = tipKind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = svg.match(
    new RegExp(`data-source-id="${escapedSourceId}" data-arrow-tip-kind="${escapedTipKind}"[^>]* d="([^"]+)"`)
  );
  const d = match?.[1] ?? "";
  const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((numberMatch) => Number(numberMatch[0]));
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

describe("svg arrow geometry", () => {
  it("treats angle 90 as a single end tip instead of splitting it", () => {
    const source = String.raw`\begin{tikzpicture}[->,>=angle 90]
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const path = semantic.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.markerEnd?.tips).toHaveLength(1);
    }
    const svg = emitSvg(semantic.scene).svg;
    const tipMatches = svg.match(/data-arrow-tip-kind="cm-rightarrow"/g) ?? [];
    expect(tipMatches.length).toBe(1);
  });

  it("emits explicit tip path metadata and does not emit SVG markers", () => {
    const source = String.raw`\begin{tikzpicture}[>=Stealth]
  \draw[arrows={-Latex[open,length=10pt,color=blue]}] (0,0) -- (2,0);
  \draw[>->] (0,1) -- (2,1);
\end{tikzpicture}`;
    const svg = renderSvg(source);

    expect(svg).toContain('data-arrow-tip-kind="latex"');
    expect(svg).toContain('data-arrow-tip-kind="stealth"');
    expect(svg).toContain('data-arrow-side="start"');
    expect(svg).toContain('data-arrow-side="end"');
    expect(svg).toContain('data-arrow-index="0"');
    expect(svg).toContain('data-arrow-bend="false"');
    expect(svg).not.toContain("<marker");
    expect(svg).not.toContain("marker-start=");
    expect(svg).not.toContain("marker-end=");
  });

  it("shortens end shafts further when dot separators force after-line-end accumulation", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[-{Stealth[length=4pt] Stealth[length=4pt]}] (0,0) -- (2,0);
  \draw[-{Stealth[length=4pt] . Stealth[length=4pt]}] (0,1) -- (2,1);
\end{tikzpicture}`;
    const svg = renderSvg(source);

    const plain = extractShaftLineEndpoints(svg, "path:0");
    const dotted = extractShaftLineEndpoints(svg, "path:1");
    expect(plain).not.toBeNull();
    expect(dotted).not.toBeNull();
    if (!plain || !dotted) {
      return;
    }

    expect(dotted.endX).toBeLessThan(plain.endX - 0.3);

    const dottedTips = svg.match(/data-source-id="path:1" data-arrow-tip-kind="stealth"/g) ?? [];
    expect(dottedTips.length).toBe(2);
  });

  it("uses curved geometry for Latex tips and keeps open tips unfilled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[-{Latex[open,length=8pt,width=6pt]}] (0,0) -- (2,0);
\end{tikzpicture}`;
    const svg = renderSvg(source);

    const tagMatch = svg.match(/<path data-source-id="path:0" data-arrow-tip-kind="latex"[^>]+>/);
    expect(tagMatch).not.toBeNull();
    const tag = tagMatch?.[0] ?? "";
    expect(tag).toContain('fill="none"');
    expect(tag.includes('stroke="black"') || tag.includes('stroke="#000000"')).toBe(true);
    expect(tag).toContain(' d="M ');
    expect(tag).toContain(" C ");
  });

  it("emits bend metadata and distinct bend/non-bend tip paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[-{Stealth[bend]}] (0,0) .. controls (1,1) and (2,1) .. (3,0);
  \draw[-{Stealth}] (0,-1) .. controls (1,0) and (2,0) .. (3,-1);
\end{tikzpicture}`;
    const svg = renderSvg(source);

    expect(svg).toContain('data-source-id="path:0" data-arrow-tip-kind="stealth" data-arrow-side="end" data-arrow-index="0" data-arrow-bend="true"');
    expect(svg).toContain('data-source-id="path:1" data-arrow-tip-kind="stealth" data-arrow-side="end" data-arrow-index="0" data-arrow-bend="false"');
  });

  it("orients rigid tips from the original transformed arc endpoint tangent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[cm={30,0,0,30,(0pt,0pt)}, -{Stealth[inset=0pt,length=7pt,width=7pt]}] (0.03,0) arc[start angle=0, end angle=90, radius=1pt];
\end{tikzpicture}`;
    const svg = renderSvg(source);
    const points = extractArrowPathPoints(svg, "path:0", "stealth");

    expect(points).toHaveLength(4);
    expect(points[1]?.x).toBeCloseTo(points[3]?.x ?? Number.NaN, 3);
    expect(points[0]?.y).toBeCloseTo(points[2]?.y ?? Number.NaN, 3);
  });

  it("emits geometry metadata for additional arrows.meta tip families", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[-{Kite[] Square[] Circle[] Rays[n=6]}] (0,0) -- (2,0);
  \draw[-{Bracket[] Parenthesis[]}] (0,1) -- (2,1);
\end{tikzpicture}`;
    const svg = renderSvg(source);

    expect(svg).toContain('data-arrow-tip-kind="kite"');
    expect(svg).toContain('data-arrow-tip-kind="square"');
    expect(svg).toContain('data-arrow-tip-kind="circle"');
    expect(svg).toContain('data-arrow-tip-kind="rays"');
    expect(svg).toContain('data-arrow-tip-kind="tee-barb"');
    expect(svg).toContain('data-arrow-tip-kind="arc-barb"');
  });

  function renderPaths(body: string) {
    const source = String.raw`\begin{tikzpicture}` + body + String.raw`\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    expect([...parsed.diagnostics, ...semantic.diagnostics]).toEqual([]);
    return semantic.scene.elements.flatMap(element => element.kind === "Path" ? [renderPathWithArrows(element)] : []);
  }

  it.each(["Latex", "Stealth", "Straight Barb"])("honors independent %s outline widths", kind => {
    for (const width of [0, 0.2, 2]) {
      const [rendered] = renderPaths(String.raw`\draw[line width=4pt,-{${kind}[length=15pt,line width=${width}pt,fill=white]}] (0,0)--(20pt,0);`);
      expect(rendered.tipPaths[0]?.strokeWidth).toBe(width);
      expect(rendered.tipPaths[0]?.fill).toBe(kind === "Straight Barb" ? "none" : "#ffffff");
      if (width === 0 && kind !== "Straight Barb") expect(rendered.tipPaths[0]?.stroke).toBe("none");
    }
  });

  it("preserves PGF endpoint shortening and tip placement on short lines and curves", () => {
    for (const segment of [String.raw`--(1pt,0)`, String.raw`..controls(.3pt,0)and(.7pt,0)..(1pt,0)`]) {
      const [rendered] = renderPaths(String.raw`\draw[-{Latex[length=6pt]}] (0,0)${segment};`);
      expect(rendered.tipPaths).toHaveLength(1);
      const end = rendered.shaftCommands[rendered.shaftCommands.length - 1];
      expect(end.kind === "L" || end.kind === "C").toBe(true);
      if (end.kind === "L" || end.kind === "C") expect(end.to.x).toBeCloseTo(-4.8, 4);
    }
    const [both] = renderPaths(String.raw`\draw[{Latex[length=6pt]}-{Latex[length=6pt]}] (0,0)--(1pt,0);`);
    expect(both.tipPaths).toHaveLength(2);
    expect(both.shaftCommands[0]).toMatchObject({ kind: "M", to: { x: -5.8, y: 0 } });
  });

  it.each(["true", "on draw", "proper", "on proper draw"])("applies tips=%s to coincident coordinates", mode => {
    for (const geometry of ["(0,0)", "(0,0)--(0,0)"]) {
      const [rendered] = renderPaths(String.raw`\draw[tips=${mode},{Latex[length=6pt]}-{Latex[length=6pt]}] ${geometry};`);
      expect(rendered?.tipPaths ?? []).toHaveLength(mode.includes("proper") ? 0 : 2);
      if (!mode.includes("proper")) {
        for (const tipPath of rendered.tipPaths) {
          const first = tipPath.commands[0];
          expect(first.kind).toBe("M");
          if (first.kind === "M") expect(first.to.x).toBeCloseTo(0, 6);
        }
      }
    }
  });

  it.each([String.raw`--(5pt,0)--(5pt,5pt)--cycle`, String.raw`circle(3pt)`, String.raw`ellipse(3pt and 2pt)`, String.raw`rectangle(3pt,2pt)`])("suppresses all tips after authored closure %s", closed => {
    const rendered = renderPaths(String.raw`\draw[-{Latex[length=6pt]}] (0,0)${closed} (10pt,0)--(30pt,0);`);
    expect(rendered.flatMap(path => path.tipPaths)).toHaveLength(0);
  });


  it.each(["true", "on draw", "proper", "on proper draw"])("emits actual move-only SVG for tips=%s", mode => {
    const rendered = renderTikzToSvg(String.raw`\begin{tikzpicture}\draw[tips=${mode},-{Latex[length=30pt]}] (0,0);\end{tikzpicture}`, { svg: { padding: 0 } });
    expect(rendered.svg.diagnostics).toEqual([]);
    expect(rendered.svg.svg.match(/data-arrow-tip-kind=/g) ?? []).toHaveLength(mode.includes("proper") ? 0 : 1);
    if (!mode.includes("proper")) expect(rendered.svg.viewBox.height).toBeGreaterThan(20);
  });

  it.each([
    String.raw`\node[draw] at(3,4){X};`,
    String.raw`\coordinate (a) at(3,4);`,
    String.raw`\draw (0,0)--(1,2,bad);`,
    String.raw`\draw (0,0)--(missing);`,
    String.raw`\draw (0,0)..controls(1,0)and(2,0)..(missing);`
  ])("does not draw phantom placeholder tips for %s", body => {
    const rendered = renderTikzToSvg(String.raw`\begin{tikzpicture}[->]` + body + String.raw`\end{tikzpicture}`);
    expect(rendered.svg.svg).not.toContain("data-arrow-tip-kind=");
    expect(rendered.svg.diagnostics).toEqual([]);
  });

  it.each([
    ["literal edges", String.raw`\draw[->](0,0)edge(20pt,0)(30pt,0)edge(50pt,0);`, 3, [0, 30]],
    ["shape edge", String.raw`\node(A)at(0,0){A};\node(B)at(20pt,0){B};\draw[->](A)edge(B);`, 1, []],
    ["shape move", String.raw`\node(A)at(0,0){A};\draw[->](A);`, 0, []],
    ["coordinate move", String.raw`\coordinate(A)at(0,0);\draw[->](A);`, 1, [0]],
    ["mixed edges", String.raw`\node(A)at(0,0){A};\node(B)at(20pt,0){B};\draw[->](10pt,0)edge(B)(A)edge(B);`, 3, [10]],
    ["explicit center", String.raw`\node(A)at(0,0){A};\draw[->](A.center);`, 1, [0]],
    ["explicit east", String.raw`\node(A)at(0,0){A};\draw[->](A.east);`, 1, null],
    ["last shape", String.raw`\node(A)at(0,0){A};\draw[->](10pt,0)(A);`, 1, [10]],
    ["first shape", String.raw`\node(A)at(0,0){A};\draw[->](A)(10pt,0);`, 1, [10]],
    ["coordinate edge", String.raw`\coordinate(A)at(0,0);\coordinate(B)at(20pt,0);\draw[->](A)edge(B);`, 2, [0]]
  ] as const)("matches PGF move-only retention for %s", (_name, body, tipCount, moves) => {
    const rendered = renderTikzToSvg(String.raw`\begin{tikzpicture}` + body + String.raw`\end{tikzpicture}`);
    expect(rendered.svg.diagnostics).toEqual([]);
    expect(rendered.svg.svg.match(/data-arrow-tip-kind=/g) ?? []).toHaveLength(tipCount);
    if (!moves) return;
    const outer = rendered.semantic.scene.elements.find(element => element.kind === "Path" &&
      element.commands.length > 0 && element.commands.every(command => command.kind === "M"));
    if (moves.length === 0) {
      expect(outer).toBeUndefined();
    } else {
      if (outer?.kind !== "Path") throw new Error("Missing committed outer moves");
      expect(outer.commands.map(command => command.kind === "M" ? command.to.x : null)).toEqual(moves);
      const points = extractArrowPathPoints(rendered.svg.svg, outer.sourceRef.sourceId, "cm-rightarrow");
      expect(points.length).toBeGreaterThan(0);
      const centerX = (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2;
      expect(centerX).toBeCloseTo(moves[moves.length - 1], 3);
    }
  });

  it("preserves signed cap shortening for both ends and explicit distances", () => {
    const cap = "Butt Cap[length=8pt,width=5pt,line width=.4pt,reversed]";
    for (const [arrows, expectedStart, expectedEnd] of [
      [`-${cap}`, 0, 22], [`${cap}-`, -2, 20], [`${cap}-${cap}`, -2, 22]
    ] as const) {
      const [rendered] = renderPaths(String.raw`\draw[line width=4pt,arrows={${arrows}}] (0,0)--(20pt,0);`);
      expect(rendered.shaftCommands[0]).toMatchObject({ kind: "M", to: { x: expectedStart, y: 0 } });
      expect(rendered.shaftCommands[1]).toMatchObject({ kind: "L", to: { x: expectedEnd, y: 0 } });
    }
    const [explicit] = renderPaths(String.raw`\draw[line width=4pt,shorten >=1pt,-{${cap}}] (0,0)--(20pt,0);`);
    expect(explicit.shaftCommands[1]).toMatchObject({ kind: "L", to: { x: 21, y: 0 } });
    const [compound] = renderPaths(String.raw`\draw[line width=4pt,-{${cap} ${cap}}] (0,0)--(20pt,0);`);
    expect(compound.tipPaths).toHaveLength(2);
    expect(compound.shaftCommands[1]).toMatchObject({ kind: "L", to: { x: 22, y: 0 } });
  });

  it("bounds rendered tips and extended shafts while respecting an explicit viewBox", () => {
    const sources = [
      String.raw`\begin{tikzpicture}\draw[-{Latex[length=30pt]}] (0,0);\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}\draw[line width=4pt,-{Butt Cap[length=8pt,reversed]}] (0,0)--(20pt,0);\end{tikzpicture}`
    ];
    for (const source of sources) {
      const rendered = renderTikzToSvg(source, { svg: { padding: 0 } });
      for (const path of rendered.semantic.scene.elements) {
        if (path.kind !== "Path") continue;
        const geometry = renderPathWithArrows(path);
        for (const commands of [geometry.shaftCommands, ...geometry.tipPaths.map(tip => tip.commands)]) {
          const bounds = computeSvgPathBounds(commands, rendered.svg.viewBox);
          if (!bounds) continue;
          expect(bounds.minX).toBeGreaterThanOrEqual(rendered.svg.viewBox.x - 1e-6);
          expect(bounds.maxX).toBeLessThanOrEqual(rendered.svg.viewBox.x + rendered.svg.viewBox.width + 1e-6);
          expect(bounds.minY).toBeGreaterThanOrEqual(rendered.svg.viewBox.y - 1e-6);
          expect(bounds.maxY).toBeLessThanOrEqual(rendered.svg.viewBox.y + rendered.svg.viewBox.height + 1e-6);
        }
      }
      const viewBox = { x: 1, y: 2, width: 3, height: 4 };
      expect(renderTikzToSvg(source, { svg: { viewBox } }).svg.viewBox).toEqual(viewBox);
    }
  });

  it.each([
    ["Latex", 2.491238483962, 2.380399380410],
    ["Stealth", 2.513878772024, 2.267822987163],
    ["Kite", 2.5, 2.457460947032]
  ] as const)("contains actual %s join ink with padding zero", (kind, sharpBoundary, roundBoundary) => {
    for (const [options, boundary] of [["", sharpBoundary], [",round", roundBoundary], [",line width=0pt", 2.5]] as const) {
      const source = String.raw`\begin{tikzpicture}\draw[-{${kind}[length=8pt,width=5pt,line width=.4pt${options}]}](0,0)--(20pt,0);\end{tikzpicture}`;
      const rendered = renderTikzToSvg(source, { svg: { padding: 0 } });
      expect(rendered.svg.svg).toContain('stroke-miterlimit="10"');
      expect(rendered.svg.viewBox.y).toBeCloseTo(-boundary, 9);
      expect(rendered.svg.viewBox.y + rendered.svg.viewBox.height).toBeCloseTo(boundary, 9);
    }
  });

  it("keeps PGF's long Latex front miter while retaining the SVG shaft default", () => {
    const source = String.raw`\begin{tikzpicture}\draw[-{Latex[length=100pt,width=40pt,line width=.4pt]}](0,0)--(20pt,0);\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source, { svg: { padding: 0 } });
    const path = rendered.semantic.scene.elements.find(element => element.kind === "Path");
    if (path?.kind !== "Path") throw new Error("Missing long Latex");
    const tip = renderPathWithArrows(path).tipPaths[0];
    expect(tip.miterLimit).toBe(10);
    const pgf = computeSvgStrokedPathBounds(tip.commands, { y: 0, height: 0 }, tip)!;
    const svgDefault = computeSvgStrokedPathBounds(tip.commands, { y: 0, height: 0 }, { ...tip, miterLimit: 4 })!;
    expect(pgf.maxX).toBeGreaterThan(svgDefault.maxX + 1);
    expect(rendered.svg.svg.match(/stroke-miterlimit="10"/g)).toHaveLength(1);
    expect(pgf.maxX).toBeLessThanOrEqual(rendered.svg.viewBox.x + rendered.svg.viewBox.width);
    const narrow = renderTikzToSvg(source.replace("width=40pt", "width=20pt"), { svg: { padding: 0 } });
    const narrowPath = narrow.semantic.scene.elements.find(element => element.kind === "Path");
    if (narrowPath?.kind !== "Path") throw new Error("Missing narrow Latex");
    const narrowTip = renderPathWithArrows(narrowPath).tipPaths[0];
    const bevel = computeSvgStrokedPathBounds(narrowTip.commands, { y: 0, height: 0 }, narrowTip)!;
    expect(bevel.maxX).toBeCloseTo(17.193340724325, 9);
    const shaft = renderTikzToSvg(String.raw`\begin{tikzpicture}\draw[line width=.4pt,shorten >=.1pt](-8pt,-2pt)--(0,0)--(-8pt,2pt);\end{tikzpicture}`, { svg: { padding: 0 } });
    expect(shaft.svg.svg).not.toContain("stroke-miterlimit=");
    expect(shaft.svg.viewBox.x + shaft.svg.viewBox.width).toBeCloseTo(.2, 9);
  });

  it.each(["shorten >=-2pt", "-{Butt Cap[length=8pt,reversed]}"])("contains diagonal square cap corners after %s", arrows => {
    const source = String.raw`\begin{tikzpicture}\draw[line width=4pt,line cap=rect,${arrows}](0,0)--(20pt,20pt);\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source, { svg: { padding: 0 } });
    expect(rendered.svg.svg).toContain('stroke-linecap="square"');
    expect(rendered.svg.viewBox.x).toBeCloseTo(-2 * Math.SQRT2, 9);
    expect(rendered.svg.viewBox.y).toBeCloseTo(-2 * Math.SQRT2, 9);
    expect(rendered.svg.viewBox.x + rendered.svg.viewBox.width).toBeCloseTo(20 + 3 * Math.SQRT2, 9);
    expect(rendered.svg.viewBox.y + rendered.svg.viewBox.height).toBeCloseTo(20 + 3 * Math.SQRT2, 9);
  });

  it("transforms sharp join ink consistently during exact model reuse", () => {
    const source = String.raw`\begin{tikzpicture}\draw[-{Latex[length=8pt,width=5pt,line width=.4pt]}](0,0)--(20pt,0);\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const path = rendered.semantic.scene.elements.find(element => element.kind === "Path");
    if (path?.kind !== "Path") throw new Error("Missing transformed arrow");
    path.transform = worldTransform(2, 0, 0, 3, 5, 10);
    const first = emitSvg(rendered.semantic.scene, { padding: 0 });
    const reused = emitSvg(rendered.semantic.scene, { padding: 0, reuse: { previousModel: first.model, affectedSourceIds: ["unrelated-source"] } });
    expect(reused.svg).toBe(first.svg);
    expect(first.viewBox.y + first.viewBox.height).toBeCloseTo(10 + 3 * 2.491238483962, 9);
    expect(first.svg).toContain('stroke-miterlimit="10"');
  });

  it("preserves transformed tip-only geometry in exact model reuse", () => {
    const source = String.raw`\begin{tikzpicture}\draw[shade,-{Latex[length=30pt]}] (0,0);\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const path = semantic.scene.elements.find(element => element.kind === "Path");
    if (path?.kind !== "Path") throw new Error("Missing arrow-only path");
    path.transform = worldTransform(2, 0, 0, 2, 5, 10);
    const first = emitSvg(semantic.scene, { padding: 0 });
    const reused = emitSvg(semantic.scene, { padding: 0, reuse: { previousModel: first.model, affectedSourceIds: ["unrelated-source"] } });
    expect(reused.svg).toBe(first.svg);
    expect(first.svg).toContain("data-arrow-tip-kind=");
    expect(first.viewBox.height).toBeGreaterThan(40);
  });


  it.each(["", ",reversed"])("uses PGF rounded Kite compound spacing%s", reversed => {
    const kite = `Kite[length=8pt,width=5pt,line width=.4pt,round${reversed}]`;
    const [rendered] = renderPaths(String.raw`\draw[-{${kite} ${kite}}] (0,0)--(20pt,0);`);
    expect(rendered.tipPaths).toHaveLength(2);
    const first = rendered.tipPaths[0].commands[0];
    const second = rendered.tipPaths[1].commands[0];
    if (first.kind !== "M" || second.kind !== "M") throw new Error("Missing Kite vertices");
    expect(second.to.x - first.to.x).toBeCloseTo(7.72002, 3);
  });


  it("keeps an authored manual bounding box authoritative for later arrows", () => {
    const rendered = renderTikzToSvg(String.raw`\begin{tikzpicture}
      \path[use as bounding box] (0,0)rectangle(1,1);
      \draw[->] (10,0)--(11,0);
    \end{tikzpicture}`, { svg: { padding: 0 } });
    expect(rendered.svg.svg).toContain("data-arrow-tip-kind=");
    expect(rendered.svg.viewBox.width).toBeCloseTo(28.4527559055, 5);
    expect(rendered.svg.viewBox.height).toBeCloseTo(28.4527559055, 5);
    const arrow = rendered.semantic.scene.elements.find(element => element.kind === "Path" && element.style.markerEnd);
    expect(arrow?.kind === "Path" && arrow.pictureSizeRelevant).toBe(false);
  });

  it.each([
    String.raw`\draw[->] (10,0)--(11,0);`,
    String.raw`\draw[->] (-1,.5)--(2,.5);`,
    String.raw`\draw[-{Latex[length=30pt]}] (.5,.5);`,
    String.raw`\draw[-{Latex[length=30pt]}] (10,.5);`
  ])("keeps clipped arrow bounds within the established picture: %s", body => {
    const rendered = renderTikzToSvg(String.raw`\begin{tikzpicture}\clip (0,0)rectangle(1,1);` + body + String.raw`\end{tikzpicture}`, { svg: { padding: 0 } });
    expect(rendered.svg.svg).toContain("data-arrow-tip-kind=");
    expect(rendered.svg.svg).toContain("clip-path=");
    expect(rendered.svg.viewBox.width).toBeCloseTo(28.4527559055, 5);
    expect(rendered.svg.viewBox.height).toBeCloseTo(28.4527559055, 5);
  });

  it("restores rendered-arrow bound participation after a scoped clip", () => {
    const rendered = renderTikzToSvg(String.raw`\begin{tikzpicture}
      \begin{scope}\clip (0,0)rectangle(1,1);\draw[->] (10,0)--(11,0);\end{scope}
      \draw[-{Latex[length=30pt]}] (2,0);
    \end{tikzpicture}`, { svg: { padding: 0 } });
    const arrows = rendered.semantic.scene.elements.filter(element => element.kind === "Path" && element.style.markerEnd);
    expect(arrows).toHaveLength(2);
    expect(arrows.map(element => element.kind === "Path" && element.pictureSizeRelevant)).toEqual([false, true]);
    expect(rendered.svg.viewBox.width).toBeLessThan(100);
    expect(rendered.svg.viewBox.width).toBeGreaterThan(56);
    expect(rendered.svg.viewBox.height).toBeGreaterThan(50);
  });

});
