import { describe, expect, it } from "vitest";
import { PT_PER_CM } from "../../packages/core/src/coords/source.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { getInspectorDescriptor } from "../../packages/core/src/edit/inspector.js";
import { elementsOfKind, evaluateSemantic } from "./helpers.js";

function center(result: ReturnType<typeof evaluateSemantic>, name: string, anchor = "center") {
  const target = result.nodeAnchorTargets.find((entry) => entry.nodeName === name && entry.anchor === anchor);
  expect(target, `${name}.${anchor}`).toBeDefined();
  return target!.world;
}

function expectCenter(result: ReturnType<typeof evaluateSemantic>, name: string, x: number, y: number) {
  expect(center(result, name).x).toBeCloseTo(x * PT_PER_CM, 5);
  expect(center(result, name).y).toBeCloseTo(y * PT_PER_CM, 5);
}

describe("deferred path styles", () => {
  it("runs after command defaults and before explicit paint overrides", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[every path/.style={draw,red}]
\path (0,0) -- (1,0);
\fill (0,1) rectangle (1,2);
\path[draw=none] (0,3) -- (1,3);
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(elementsOfKind(result.scene.elements, "Path").map((path) => path.style.stroke))
      .toEqual(["#ff0000", "#ff0000", null]);
  });

  it("replaces and clears stored bodies without leaking their style or transform", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\tikzset{every path/.style={line width=2pt,scale=2}}
\draw (0,0) -- (1,0);
\tikzset{every path/.style={red}}
\draw (0,0) -- (1,0);
\tikzset{every path/.style={}}
\draw (0,0) -- (1,0);
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const paths = elementsOfKind(result.scene.elements, "Path");
    expect(paths.map((path) => path.style.lineWidth)).toEqual([2, .4, .4]);
    expect(paths.map((path) => path.style.stroke)).toEqual(["black", "#ff0000", "black"]);
    expect(paths.map((path) => path.commands.find((command) => command.kind === "L")?.to.x)).toEqual([2 * PT_PER_CM, PT_PER_CM, PT_PER_CM]);
  });

  it("orders prefix and append layers with provenance and restores enclosing scope bodies", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[every path/.style={red}]
\begin{scope}[every path/.append style={blue},every path/.prefix style={green,line width=2pt}]
\draw (0,0) -- (1,0);
\end{scope}
\draw (0,1) -- (1,1);
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const paths = elementsOfKind(result.scene.elements, "Path");
    expect(paths.map((path) => [path.style.stroke, path.style.lineWidth])).toEqual([["#0000ff", 2], ["#ff0000", .4]]);
    expect(paths[0].styleChain.filter((entry) => entry.sourceRef?.label?.startsWith("every path/")).map((entry) => entry.sourceRef?.label))
      .toEqual(["every path/.prefix style", "every path/.style", "every path/.append style"]);
    const appliedPrefix = paths[0].styleChain.find((entry) => entry.sourceRef?.label === "every path/.prefix style" && entry.after.lineWidth === 2);
    expect(appliedPrefix?.sourceRef?.sourceSpan).toBeDefined();
  });

  it("expands named bodies when invoked and supports legacy every-path definitions", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\tikzset{tone/.style={red},every path/.style={tone}}
\draw (0,0) -- (1,0);
\tikzset{tone/.style={blue}}
\draw (0,1) -- (1,1);
\tikzstyle{every path}=[green]
\draw (0,2) -- (1,2);
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(elementsOfKind(result.scene.elements, "Path").map((path) => path.style.stroke)).toEqual(["#ff0000", "#0000ff", "#00ff00"]);
  });

  it("retains scoped deferred bodies through incremental checkpoints", () => {
    const source = String.raw`\begin{tikzpicture}[every path/.style={draw,red}]
\path (0,0) -- (1,0);
\begin{scope}[every path/.style={draw,blue,scale=2}]
\path (0,1) -- (1,1);
\path (0,2) -- (1,2);
\end{scope}
\path (0,3) -- (1,3);
\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    const parsed = parseTikz(source);
    session.evaluate({ figure: parsed.figure, source, hints: { trigger: "other" } });
    const nextSource = source.replace("(1,2)", "(2,2)");
    const nextParsed = parseTikz(nextSource);
    const scope = nextParsed.figure.body[1];
    if (scope.kind !== "Scope") throw new Error("Expected scope");
    const next = session.evaluate({ figure: nextParsed.figure, source: nextSource, hints: { trigger: "drag-handle", changedSourceIds: [scope.body[1].id] } });
    expect(next.stats.strategy).toBe("incremental");
    expect(next.semantic).toEqual(evaluateTikzFigure(nextParsed.figure, nextSource));
    expect(elementsOfKind(next.semantic.scene.elements, "Path").map((path) => path.style.stroke)).toEqual(["#ff0000", "#0000ff", "#0000ff", "#ff0000"]);
  });
});

describe("effective node transform shape", () => {
  for (const [picture, local, expectedWidth] of [
    ["xscale=2", "transform shape", 40],
    ["xscale=2,every node/.style={transform shape}", "", 40],
    ["xscale=2,every rectangle node/.style={transform shape}", "", 40],
    ["xscale=2,huge/.style={transform shape}", "huge", 40],
    ["xscale=2,transform shape", "transform shape=false", 20],
    ["xscale=2,every node/.style={transform shape}", "transform shape=false", 20]
  ] as const) {
    it(`resolves ${picture}; ${local || "inherited style"}`, () => {
      const result = evaluateSemantic(String.raw`\begin{tikzpicture}[${picture}]
\node[draw,minimum width=20pt,minimum height=10pt,inner sep=0pt,outer sep=0pt,${local}] (A) at (1,0) {};
\end{tikzpicture}`);
      expect(result.diagnostics).toEqual([]);
      expectCenter(result, "A", 2, 0);
      expect(center(result, "A", "east").x - center(result, "A", "west").x).toBeCloseTo(expectedWidth, 5);
    });
  }

  it("applies node rotation to path-attached shape and text without changing sibling metadata", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[xscale=2]
\draw (0,0) -- (2,0) node[transform shape,rotate=90,draw,minimum width=20pt,minimum height=10pt,inner sep=0pt,outer sep=0pt] (A) {X};
\node[draw,minimum width=20pt,minimum height=10pt,inner sep=0pt,outer sep=0pt] (B) at (1,1) {};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(center(result, "A", "east").y - center(result, "A", "west").y).toBeCloseTo(20, 5);
    expect(center(result, "B", "east").x - center(result, "B", "west").x).toBeCloseTo(20, 5);
    const text = elementsOfKind(result.scene.elements, "Text").find((entry) => entry.text === "X");
    expect(text?.transform).toMatchObject({ a: expect.closeTo(0, 6), b: expect.closeTo(1, 6), c: expect.closeTo(-2, 6), d: expect.closeTo(0, 6) });
  });
});

describe("tree coordinate transform ordering", () => {
  for (const definition of ["child", "level"] as const) {
    it(`applies ${definition}-scoped every-path paint at generated node and edge boundaries`, () => {
      const pathOptions = definition === "level" ? "[level 1/.style={every path/.style={blue,line width=2pt}}]" : "";
      const childOptions = definition === "child" ? "[every path/.style={blue,line width=2pt}]" : "";
      const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\path${pathOptions} (0,0) node[draw](r){} child${childOptions}{node[draw](c){}};
\end{tikzpicture}`);
      expect(result.diagnostics).toEqual([]);
      expect(elementsOfKind(result.scene.elements, "Path").map((path) => [path.style.stroke, path.style.lineWidth]))
        .toEqual([["black", .4], ["#0000ff", 2], ["#0000ff", 2]]);
    });
  }

  it("resolves explicit node and edge paint after their deferred path styles", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\path (0,0) node[draw](r){} child[every path/.style={blue,line width=2pt}]{node[draw,red,line width=1pt](c){} edge from parent[draw,green,line width=3pt]};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(elementsOfKind(result.scene.elements, "Path").map((path) => [path.style.stroke, path.style.lineWidth]))
      .toEqual([["black", .4], ["#ff0000", 1], ["#00ff00", 3]]);
  });

  it("retains generated root names from path-local metadata without leaking it to siblings", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\path (0,0) node(r){}
child[every path/.style={name prefix=S-,xshift=10pt}]{node(c){} child{node(d){}}}
child{node(e){}};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(center(result, "S-c").x).toBeCloseTo(10 - .75 * PT_PER_CM, 5);
    expect(center(result, "S-d").x).toBeCloseTo(20 - .75 * PT_PER_CM, 5);
    expect(center(result, "e").x).toBeCloseTo(.75 * PT_PER_CM, 5);
  });

  it("isolates nested replacements and restores deferred paint for siblings and parent edges", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\path (0,0) node[draw](r){}
child[every path/.style={blue,line width=2pt}]{node[draw](c){} child[every path/.style={red,line width=1pt}]{node[draw](d){}}}
child{node[draw](e){}};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(elementsOfKind(result.scene.elements, "Path").map((path) => [path.style.stroke, path.style.lineWidth]))
      .toEqual([["black", .4], ["#0000ff", 2], ["#ff0000", 1], ["#ff0000", 1], ["#0000ff", 2], ["black", .4], ["black", .4]]);
  });

  it("applies every-path shifts once at each generated descendant node origin", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\path[level distance=1cm] (0,0) node[draw](r){} child[every path/.style={xshift=10pt,yshift=5pt}]{node[draw](c){} child{node[draw](d){}}};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(center(result, "c").x).toBeCloseTo(10, 5);
    expect(center(result, "c").y).toBeCloseTo(-PT_PER_CM + 5, 5);
    expect(center(result, "d").x).toBeCloseTo(20, 5);
    expect(center(result, "d").y).toBeCloseTo(-2 * PT_PER_CM + 10, 5);
  });

  it("starts remaining child-body geometry at its own transformed path origin", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\path[level distance=1cm] (0,0) node[draw](r){} child[every path/.style={draw,blue,xshift=10pt,yshift=5pt}]{node[draw](c){} (0,0)--(1,0)};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const line = elementsOfKind(result.scene.elements, "Path").find((path) => path.commands.length === 2 && path.commands[0]?.kind === "M" && Math.abs(path.commands[0].to.x - 10) < .0001);
    expect(line?.commands).toMatchObject([{ kind: "M", to: { x: expect.closeTo(10, 5), y: expect.closeTo(-PT_PER_CM + 5, 5) } }, { kind: "L", to: { x: expect.closeTo(PT_PER_CM + 10, 5), y: expect.closeTo(-PT_PER_CM + 5, 5) } }]);
    expect(line?.style.stroke).toBe("#0000ff");
    expectCenter(result, "r", 0, 0);
  });

  for (const [options, x, y] of [["rotate=90", 1, 0], ["scale=2", 0, -2], ["", 0, -1]] as const) {
    it(`transforms inherited growth: ${options || "identity"}`, () => {
      const result = evaluateSemantic(String.raw`\begin{tikzpicture}[${options}]
\path[level distance=1cm] (0,0) node(r){} child{node(c){}};
\end{tikzpicture}`);
      expect(result.diagnostics).toEqual([]);
      expectCenter(result, "c", x, y);
    });
  }

  it("applies child shifts before growth and carries the generated origin into descendants", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\path[level distance=1cm] (2,3) node(r){} child[shift={(0.5cm,0.25cm)},rotate=90]{node(c){} child{node(d){}}};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expectCenter(result, "r", 2, 3);
    expectCenter(result, "c", 3.5, 3.25);
    expectCenter(result, "d", 4.5, 3.25);
  });

  it("anchors after level shifts and resolves every-child transforms after level transforms", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[xscale=2]
\path[level distance=1cm,level 1/.style={shift={(0.5cm,0.25cm)},rotate=90},every child/.style={shift={(0.25cm,0cm)}}]
(1,0) node(r){} child{node(c){}};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expectCenter(result, "r", 2, 0);
    expectCenter(result, "c", 4, .25);
  });

  it("keeps a world parent anchor while applying child shifts under inherited rotation", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[rotate=90,shift={(2cm,3cm)}]
\path[level distance=1cm] (1,0) node(r){} child[shift={(0.5cm,0.25cm)}]{node(c){}};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expectCenter(result, "r", -3, 3);
    expectCenter(result, "c", -2.25, 3.5);
  });

  it("transforms sibling offsets and resolves reversed growth independently", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[xscale=2,yscale=3]
\path[level distance=1cm,sibling distance=1cm] (1,1) node(r){} child{node(c1){}} child[grow'=down]{node(c2){}};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expectCenter(result, "c1", 1, 0);
    expectCenter(result, "c2", 2, 0);
  });

  it("keeps noncenter growth anchors in world coordinates", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[scale=2]
\path[level distance=1cm,growth parent anchor=east] (1,0)
node[minimum width=20pt,minimum height=10pt,inner sep=0pt,outer sep=0pt] (r){} child{node(c){}};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(center(result, "c").x).toBeCloseTo(center(result, "r", "east").x, 5);
    expect(center(result, "c").y).toBeCloseTo(-2 * PT_PER_CM, 5);
  });

  it("applies child-local growth parent anchors to descendants after the current parent anchoring", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[scale=2]
\path[level distance=1cm] (0,0)
node[minimum width=20pt,minimum height=10pt,inner sep=0pt,outer sep=0pt](r){}
child[growth parent anchor=east]{node[minimum width=20pt,minimum height=10pt,inner sep=0pt,outer sep=0pt](c){} child{node(d){}}};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expectCenter(result, "c", 0, -2);
    expect(center(result, "d").x).toBeCloseTo(10, 5);
    expect(center(result, "d").y).toBeCloseTo(-4 * PT_PER_CM, 5);
  });
});

describe("independent pic code bodies", () => {
  it("executes normal, foreground and background bodies while stacking them separately", () => {
    const source = String.raw`\begin{tikzpicture}
\tikzset{pics/triple/.style={background code={\draw[blue] (F) -- (3,0);},code={\coordinate (N) at (1,0);\draw[red] (0,0) -- (N);},foreground code={\coordinate (F) at (2,0);\draw[green] (N) -- (F);}}}
\draw (0,0) -- (3,0) pic[behind path] {triple};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    expect(result.diagnostics).toEqual([]);
    const paths = elementsOfKind(result.scene.elements, "Path");
    expect(paths.map((path) => path.style.stroke)).toEqual(["#ff0000", "#0000ff", "black", "#00ff00"]);
    expect(new Set(paths.map((path) => path.id)).size).toBe(paths.length);
    const generated = paths.filter((path) => path.origin?.picStack?.length);
    expect(new Set(generated.map((path) => path.origin?.picStack?.at(-1)?.codeSpan?.from)).size).toBe(3);
    for (const path of generated) {
      const span = path.identityRef?.sourceSpan;
      expect(span).toBeDefined();
      expect(span && source.slice(span.from, span.to)).toContain("\\draw");
    }
  });

  it("uses final assignments independently and lets the type body override earlier pic options", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\tikzset{pics/tick/.style={code={\draw[red] (0,0) -- (1,0);},code={\draw[blue] (0,0) -- (1,0);}}}
\pic[pics/code={\draw[green] (0,0) -- (1,0);},pics/background code={\draw[red] (0,1) -- (1,1);},pics/background code={\draw[green] (0,1) -- (1,1);}] {tick};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(elementsOfKind(result.scene.elements, "Path").map((path) => path.style.stroke)).toEqual(["#00ff00", "#0000ff"]);
  });

  it("isolates replacement definitions and inline bodies between scopes and invocations", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\tikzset{pics/mark/.style={code={\draw[red] (0,0)--(1,0);},background code={\draw[blue] (0,1)--(1,1);}}}
\begin{scope}
\tikzset{pics/mark/.style={code={\draw[green] (0,0)--(1,0);}}}
\pic {mark};
\end{scope}
\pic[pics/foreground code={\draw[yellow] (0,2)--(1,2);}] {mark};
\pic {mark};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(elementsOfKind(result.scene.elements, "Path").map((path) => path.style.stroke).sort())
      .toEqual(["#0000ff", "#0000ff", "#00ff00", "#ff0000", "#ff0000", "#ffff00"]);
  });

  it("applies each pic body's own scope style after invocation options", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[
every pic/.style={line width=2pt},every front pic/.style={line width=3pt},every behind pic/.style={line width=4pt}]
\pic[line width=1pt,pics/code={\draw[red] (0,0)--(1,0);},pics/foreground code={\draw[green] (0,1)--(1,1);},pics/background code={\draw[blue] (0,2)--(1,2);}] {};
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const paths = elementsOfKind(result.scene.elements, "Path");
    expect(paths.map((entry) => [entry.style.stroke, entry.style.lineWidth])).toEqual([["#0000ff", 4], ["#ff0000", 2], ["#00ff00", 3]]);
  });

  it("edits each shared pic body through its own template target", () => {
    const source = String.raw`\begin{tikzpicture}
\tikzset{pics/mark/.style={code={\draw[red] (0,0)--(1,0);},foreground code={\draw[green] (0,1)--(1,1);},background code={\draw[blue] (0,2)--(1,2);}}}
\pic {mark}; \pic at (0,3) {mark};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    expect(result.diagnostics).toEqual([]);
    const paths = elementsOfKind(result.scene.elements, "Path");
    const targets = new Set<string>();
    for (const stroke of ["#ff0000", "#00ff00", "#0000ff"]) {
      const path = paths.find((entry) => entry.style.stroke === stroke)!;
      const descriptor = getInspectorDescriptor(path, { source, editHandles: result.editHandles });
      const property = descriptor.sections.flatMap((section) => section.properties).find((entry) => entry.kind === "lineWidth");
      if (!property || property.kind !== "lineWidth") throw new Error("Expected line-width template control");
      expect(property.write.writable).toBe(true);
      targets.add(property.write.elementId);
      const edited = applyEditAction(source, [], { kind: "setProperty", elementId: property.write.elementId, level: property.write.level, key: property.write.key, value: "2pt" });
      if (edited.kind !== "success") throw new Error(`Pic body edit failed: ${edited.kind}`);
      const updated = evaluateSemantic(edited.newSource);
      expect(updated.diagnostics).toEqual([]);
      const updatedPaths = elementsOfKind(updated.scene.elements, "Path");
      expect(updatedPaths).toHaveLength(6);
      expect(updatedPaths.filter((entry) => entry.style.stroke === stroke)).toHaveLength(2);
      for (const entry of updatedPaths) expect(entry.style.lineWidth).toBe(entry.style.stroke === stroke ? 2 : .4);
    }
    expect(targets.size).toBe(3);
  });
});
