import { describe, expect, it } from "vitest";

import {
  evaluateSemantic,
  firstElementOfKind,
  elementsOfKind
} from "./helpers.js";

const nonNull = <T>(value: T | null): value is T => value != null;

describe("semantic evaluator / coordinates and path ops", () => {
    it("supports relative and polar coordinates", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- ++(1,0) -- +(90:1cm);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.length).toBeGreaterThanOrEqual(3);
      }
    });

    it("accepts dimension-valued polar angles like `++(-1.0cm:-2.0cm)`", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- ++(-1.0cm:-2.0cm);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-polar-coordinate:(-1.0cm:-2.0cm)")).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const line = path.commands.find((command) => command.kind === "L");
        expect(line?.kind).toBe("L");
        if (line?.kind === "L") {
          expect(line.to.x).toBeCloseTo(-50.0319, 2);
          expect(line.to.y).toBeCloseTo(27.1117, 2);
        }
      }
    });

    it("reports invalid polar coordinates and accepts a leading relative coordinate", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw +(1,0);
    \draw (bad:1cm) -- (45:bad);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "relative-coordinate-without-current-point")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-polar-coordinate:(bad:1cm)")).toBe(true);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-polar-coordinate:(45:bad)")).toBe(true);
    });

    it("keeps `+` relative bases while advancing the drawn path cursor", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) +(0:1) -- +(90:1) -- +(180:1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const moves = path.commands.filter((command) => command.kind === "M");
        const originMoves = moves.filter((command) => Math.hypot(command.to.x, command.to.y) <= 1e-6);
        expect(originMoves).toHaveLength(1);
      }
    });

    it("uses logical `+` coordinates as centers for subsequent circle keywords", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[radius=2pt] (0,0) circle +(1,0) circle +(0,1) circle;
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const circles = elementsOfKind(result.scene.elements, "Circle");
      expect(circles).toHaveLength(3);
      if (circles.every((element) => element.kind === "Circle")) {
        const centers = circles.map((element) => element.center);
        const uniqueCenters = new Set(centers.map((center) => `${center.x.toFixed(3)}:${center.y.toFixed(3)}`));
        expect(uniqueCenters.size).toBe(3);
      }
    });

    it("captures coordinate operations from logical `+` points", () => {
      const source = String.raw`\begin{tikzpicture}
    \path (0.5,0.5) coordinate (A) +(40:3.5) coordinate (B) +(10:3.5) coordinate (C);
    \draw (B) -- (A) -- (C);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:B")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:C")).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const points = path.commands
          .filter((command) => command.kind === "M" || command.kind === "L")
          .map((command) => (command.kind === "M" || command.kind === "L" ? command.to : null))
          .filter(nonNull);
        const uniquePoints = new Set(points.map((point) => `${point.x.toFixed(3)}:${point.y.toFixed(3)}`));
        expect(uniquePoints.size).toBeGreaterThanOrEqual(3);
      }
    });

    it("treats standalone `\\coordinate` commands like `\\path coordinate`", () => {
      const source = String.raw`\begin{tikzpicture}
    \coordinate (A) at (0,0);
    \coordinate (B) at (1,0);
    \draw (A) -- (B);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:A")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:B")).toBe(false);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands[0];
        const line = path.commands[1];
        expect(move?.kind).toBe("M");
        expect(line?.kind).toBe("L");
        if (move?.kind === "M") {
          expect(move.to.x).toBeCloseTo(0, 6);
          expect(move.to.y).toBeCloseTo(0, 6);
        }
        if (line?.kind === "L") {
          expect(line.to.x).toBeCloseTo(28.4528, 3);
          expect(line.to.y).toBeCloseTo(0, 6);
        }
      }
    });

    it("captures coordinate[pos=...] points along the previous segment", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- coordinate[pos=0.25] (A) coordinate[pos=0.75] (B) (4,0);
    \draw (A) -- (B);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
      const points = result.scene.elements
        .filter((element) => element.kind === "Path")
        .flatMap((element) =>
          element.kind === "Path"
            ? element.commands
                .filter((command) => command.kind === "M" || command.kind === "L")
                .map((command) => (command.kind === "M" || command.kind === "L" ? command.to : null))
            : []
        )
        .filter(nonNull);
  
      const hasQuarterPoint = points.some((point) => Math.abs(point.x - 28.4528) <= 1e-3 && Math.abs(point.y) <= 1e-3);
      const hasThreeQuarterPoint = points.some((point) => Math.abs(point.x - 85.3583) <= 1e-3 && Math.abs(point.y) <= 1e-3);
      expect(hasQuarterPoint).toBe(true);
      expect(hasThreeQuarterPoint).toBe(true);
    });

    it("renders labels attached to coordinate operations", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) coordinate[label=$A$] (a) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-coordinate-operation")).toBe(false);
      const label = result.scene.elements.find((element) => element.kind === "Text");
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.text).toContain("A");
      }
    });

    it("supports `[turn]` polar coordinates using the previous segment direction", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- +(1,0) -- ([turn]90:1) -- ([turn]90:1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-turn-coordinate"))).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const lines = path.commands.filter((command) => command.kind === "L");
        expect(lines).toHaveLength(3);
        const uniqueTargets = new Set(lines.map((command) => `${command.to.x.toFixed(3)}:${command.to.y.toFixed(3)}`));
        expect(uniqueTargets.size).toBe(3);
      }
    });

    it("places nodes with `pos=.5` at the center of rectangle paths", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0pt,0pt) rectangle ++(40pt,40pt) node[pos=.5] {3};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-coordinate-operation")).toBe(false);
      const text = result.scene.elements.find((element) => element.kind === "Text");
      expect(text?.kind).toBe("Text");
      if (text?.kind === "Text") {
        expect(text.position.x).toBeCloseTo(20, 1);
        expect(text.position.y).toBeCloseTo(20, 1);
      }
    });

    it("applies leading fill options before circle shapes", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (3.5,0) [fill=red] circle (.2cm);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const shape = result.scene.elements.find((element) => element.kind === "Circle" || element.kind === "Path");
      expect(shape).toBeDefined();
      if (shape && (shape.kind === "Circle" || shape.kind === "Path")) {
        expect(shape.style.fill).toBe("#ff0000");
      }
    });

    it("emits polyline geometry for `plot coordinates` and advances the current point", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw plot coordinates {(0,0) (1,1) (2,0)} -- (3,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-plot-coordinates")).toBe(false);
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBeGreaterThanOrEqual(2);
  
      const hasPlotPolyline = paths.some((element) => {
        if (element.kind !== "Path") {
          return false;
        }
        const commands = element.commands;
        return commands.length >= 3 && commands[0]?.kind === "M" && commands[1]?.kind === "L" && commands[2]?.kind === "L";
      });
      expect(hasPlotPolyline).toBe(true);
  
      const hasTrailingSegmentFromPlotEnd = paths.some((element) => {
        if (element.kind !== "Path") {
          return false;
        }
        if (element.commands.length < 2) {
          return false;
        }
        const move = element.commands[0];
        const line = element.commands[1];
        if (move?.kind !== "M" || line?.kind !== "L") {
          return false;
        }
        return (
          Math.abs(move.to.x - 56.9055) <= 1e-2 &&
          Math.abs(move.to.y) <= 1e-6 &&
          Math.abs(line.to.x - 85.3583) <= 1e-2 &&
          Math.abs(line.to.y) <= 1e-6
        );
      });
      expect(hasTrailingSegmentFromPlotEnd).toBe(true);
    });

    it("distinguishes `plot` vs `-- plot` connection behavior", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) plot coordinates {(1,0) (2,0)};
    \draw (0,0) -- plot coordinates {(1,0) (2,0)};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      const hasDisconnectedPlot = paths.some((element) => {
        if (element.kind !== "Path") {
          return false;
        }
        const move = element.commands[0];
        return move?.kind === "M" && Math.abs(move.to.x - 28.4528) <= 1e-2 && Math.abs(move.to.y) <= 1e-6;
      });
      const hasConnectedPlot = paths.some((element) => {
        if (element.kind !== "Path") {
          return false;
        }
        const move = element.commands[0];
        const firstLine = element.commands.find((command) => command.kind === "L");
        if (move?.kind !== "M" || firstLine?.kind !== "L") {
          return false;
        }
        return (
          Math.abs(move.to.x) <= 1e-6 &&
          Math.abs(move.to.y) <= 1e-6 &&
          Math.abs(firstLine.to.x - 28.4528) <= 1e-2 &&
          Math.abs(firstLine.to.y) <= 1e-6
        );
      });
      expect(hasDisconnectedPlot).toBe(true);
      expect(hasConnectedPlot).toBe(true);
    });

    it("samples expression plots using domain/samples", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[domain=0:2,samples=5] plot (\x,{2*\x});
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.length).toBe(5);
        const first = path.commands[0];
        const last = path.commands[path.commands.length - 1];
        expect(first?.kind).toBe("M");
        expect(last?.kind).toBe("L");
        if (first?.kind === "M") {
          expect(first.to.x).toBeCloseTo(0, 6);
        }
        if (last?.kind === "L") {
          expect(last.to.x).toBeCloseTo(56.9055, 2);
          expect(last.to.y).toBeCloseTo(113.811, 2);
        }
      }
    });

    it("samples expression plots using `samples at` and custom variables", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw plot[samples at={0,0.5,1,2},variable=\t] ({\t},{\t*\t});
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.length).toBe(4);
        const commands = path.commands.filter((command) => command.kind === "M" || command.kind === "L");
        expect(commands).toHaveLength(4);
        const third = commands[2];
        const fourth = commands[3];
        if (third?.kind === "L") {
          expect(third.to.x).toBeCloseTo(28.4528, 2);
          expect(third.to.y).toBeCloseTo(28.4528, 2);
        }
        if (fourth?.kind === "L") {
          expect(fourth.to.x).toBeCloseTo(56.9055, 2);
          expect(fourth.to.y).toBeCloseTo(113.811, 2);
        }
      }
    });

    it("supports `sin(\\x r)` and `exp(\\x)` inside plot expressions", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[domain=0:3.1415926535,samples=3] plot (\x,{sin(\x r)});
    \draw[domain=0:1,samples=3] plot (\x,{exp(\x)});
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-plot-expression")).toBe(false);
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBe(2);
  
      const sinPath = paths[0];
      const expPath = paths[1];
      if (sinPath?.kind === "Path") {
        const commands = sinPath.commands.filter((command) => command.kind === "M" || command.kind === "L");
        expect(commands).toHaveLength(3);
        const middle = commands[1];
        if (middle?.kind === "L") {
          expect(middle.to.y).toBeCloseTo(28.4528, 1);
        }
      }
      if (expPath?.kind === "Path") {
        const last = expPath.commands[expPath.commands.length - 1];
        expect(last?.kind).toBe("L");
        if (last?.kind === "L") {
          expect(last.to.y).toBeGreaterThan(70);
        }
      }
    });

    it("emits explicit diagnostics for unsupported plot modes (`function` and `file`)", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw plot function{sin(\x)};
    \draw plot file{data.dat};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-plot-mode:function")).toBe(true);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-plot-mode:file")).toBe(true);
    });

    it("does not emit unsupported-option-key diagnostics for plot control keys", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[domain=0:1,samples=5,samples at={0,0.25,0.5,0.75,1},variable=\t,mark=x] plot ({\t},{exp(\t)});
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:domain")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:samples")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:samples at")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:variable")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:mark")).toBe(false);
    });

    it("does not emit unsupported-option-key diagnostics for path shortening keys", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[->,shorten >=1.7pt,shorten <=0.5pt] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:shorten >")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:shorten <")).toBe(false);
    });

    it("resolves path shortening and cap/join aliases into path style", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[shorten >=2pt,shorten <=1pt,cap=round,join=bevel] (0,0) -- (1,0) -- (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const path = elementsOfKind(result.scene.elements, "Path")[0];

      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.shortenEnd).toBeCloseTo(2);
        expect(path.style.shortenStart).toBeCloseTo(1);
        expect(path.style.lineCap).toBe("round");
        expect(path.style.lineJoin).toBe("bevel");
      }
    });

    it("supports smooth and smooth-cycle plot handlers", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw plot[smooth,tension=1] coordinates {(0,0) (1,1) (2,0) (3,1)};
    \draw plot[smooth cycle,tension=0.5] coordinates {(0,0) (1,0) (1,1) (0,1)};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBe(2);
      const smoothPath = paths[0];
      const smoothCyclePath = paths[1];
      if (smoothPath?.kind === "Path") {
        expect(smoothPath.commands.some((command) => command.kind === "C")).toBe(true);
      }
      if (smoothCyclePath?.kind === "Path") {
        expect(smoothCyclePath.commands.some((command) => command.kind === "C")).toBe(true);
        expect(smoothCyclePath.commands.some((command) => command.kind === "Z")).toBe(true);
      }
    });

    it("supports const and jump plot handlers", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw plot[const plot] coordinates {(0,0) (1,1) (2,0)};
    \draw plot[jump mark mid] coordinates {(0,0) (1,1) (2,0)};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:const plot")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:jump mark mid")).toBe(false);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBe(2);
      const constPath = paths[0];
      const jumpPath = paths[1];
      if (constPath?.kind === "Path") {
        expect(constPath.commands.filter((command) => command.kind === "L").length).toBeGreaterThanOrEqual(4);
      }
      if (jumpPath?.kind === "Path") {
        const moveCommands = jumpPath.commands.filter((command) => command.kind === "M");
        expect(moveCommands.length).toBeGreaterThan(1);
      }
    });

    it("supports comb and bar plot handlers", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw plot[ycomb] coordinates {(0,1) (1,2) (2,1)};
    \draw plot[xcomb] coordinates {(1,0) (2,1) (1.5,2)};
    \draw[fill=blue!30,bar width=6pt,bar shift=2pt] plot[ybar] coordinates {(0,1) (1,2) (2,1)};
    \draw[fill=red!30,bar width=6pt,bar shift=-1pt] plot[xbar] coordinates {(1,0) (2,1) (1.5,2)};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:bar width")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:bar shift")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:ycomb")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:xbar")).toBe(false);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBe(4);
      const yBarPath = paths[2];
      const xBarPath = paths[3];
      if (yBarPath?.kind === "Path") {
        expect(yBarPath.commands.some((command) => command.kind === "Z")).toBe(true);
      }
      if (xBarPath?.kind === "Path") {
        expect(xBarPath.commands.some((command) => command.kind === "Z")).toBe(true);
      }
    });

    it("supports interval bar plot handlers", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[bar interval width=0.8,bar interval shift=0.5] plot[ybar interval] coordinates {(0,1) (1,2) (3,1) (4,0.5)};
    \draw[bar interval width=0.8,bar interval shift=0.5] plot[xbar interval] coordinates {(1,0) (2,1) (1.5,2) (1,3)};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:bar interval width")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:bar interval shift")).toBe(false);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBe(2);
      const yInterval = paths[0];
      const xInterval = paths[1];
      if (yInterval?.kind === "Path") {
        const closedSubpaths = yInterval.commands.filter((command) => command.kind === "Z");
        expect(closedSubpaths).toHaveLength(3);
      }
      if (xInterval?.kind === "Path") {
        const closedSubpaths = xInterval.commands.filter((command) => command.kind === "Z");
        expect(closedSubpaths).toHaveLength(3);
      }
    });

    it("supports `only marks` plot handler (no connecting polyline)", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw plot[only marks,mark=x] coordinates {(0,0) (1,1) (2,0)};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:only marks")).toBe(false);
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBe(1);
      const markerPath = paths[0];
      if (markerPath?.kind === "Path") {
        expect(markerPath.commands.some((command) => command.kind === "C")).toBe(false);
        expect(markerPath.commands.some((command) => command.kind === "Z")).toBe(false);
        expect(markerPath.commands.filter((command) => command.kind === "L").length).toBe(6);
      }
    });

    it("supports `mark=+` and `mark=*` plot markers", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw plot[mark=+] coordinates {(0,0) (1,1) (2,0)};
    \draw plot[mark=*] coordinates {(0,1) (1,2) (2,1)};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBeGreaterThanOrEqual(4);
  
      const plusMarkerPath = paths.find((element) => {
        if (element.kind !== "Path") {
          return false;
        }
        const hasArc = element.commands.some((command) => command.kind === "A");
        const hasCurve = element.commands.some((command) => command.kind === "C");
        const hasClose = element.commands.some((command) => command.kind === "Z");
        const lineCount = element.commands.filter((command) => command.kind === "L").length;
        return !hasArc && !hasCurve && !hasClose && lineCount >= 6;
      });
      const starMarkerPath = paths.find((element) => {
        if (element.kind !== "Path") {
          return false;
        }
        const arcCount = element.commands.filter((command) => command.kind === "A").length;
        const closeCount = element.commands.filter((command) => command.kind === "Z").length;
        return arcCount >= 6 && closeCount >= 3;
      });
  
      expect(plusMarkerPath?.kind).toBe("Path");
      expect(starMarkerPath?.kind).toBe("Path");
    });

    it("emits explicit diagnostics for currently unsupported path keywords", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) bend (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const unsupportedKeywordDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-path-keyword");
      expect(unsupportedKeywordDiagnostics.length).toBeGreaterThanOrEqual(1);
    });

    it("evaluates edge operations as separate paths that do not advance the main current point", () => {
      const source = String.raw`\begin{tikzpicture}
    \node (a) at (0,0) {A};
    \node (b) at (2,0) {B};
    \node (c) at (1,1.5) {C};
    \draw (a) edge (b) edge (c) -- (b);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-keyword")).toBe(false);
  
      const linePaths = result.scene.elements.filter((element) => {
        if (element.kind !== "Path") {
          return false;
        }
        return element.commands.length === 2 && element.commands[0]?.kind === "M" && element.commands[1]?.kind === "L";
      });
  
      expect(linePaths.length).toBe(3);
      const startKeys = linePaths.map((element) => {
        if (element.kind !== "Path") {
          return "";
        }
        const start = element.commands[0];
        if (start?.kind !== "M") {
          return "";
        }
        return `${start.to.x.toFixed(3)}:${start.to.y.toFixed(3)}`;
      });
      const startFrequencies = new Map<string, number>();
      for (const key of startKeys) {
        startFrequencies.set(key, (startFrequencies.get(key) ?? 0) + 1);
      }
      expect(Math.max(...startFrequencies.values())).toBeGreaterThanOrEqual(2);
    });

    it("draws edge paths from \\path and applies local edge styling", () => {
      const source = String.raw`\begin{tikzpicture}
    \path (0,0) edge [->, dotted] (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.stroke).toBe("black");
        expect(path.style.markerEnd).toBeTruthy();
        expect(path.style.dashArray).toEqual([0.4, 2]);
      }
    });

    it("supports sin/cos path keywords as cubic segments", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) sin (1,1) cos (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-keyword")).toBe(false);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const commandKinds = path.commands.map((command) => command.kind);
        expect(commandKinds).toEqual(["M", "C", "C"]);
        const end = path.commands[path.commands.length - 1];
        expect(end?.kind).toBe("C");
        if (end?.kind === "C") {
          expect(end.to.x).toBeCloseTo(56.9055, 3);
          expect(end.to.y).toBeCloseTo(0, 3);
        }
      }
    });

    it("evaluates explicit and calc coordinate forms when possible", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (canvas cs:x=1cm,y=2cm) -- ($(1,1) + (2,0)$);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-form:explicit")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-form:calc")).toBe(false);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.some((command) => command.kind === "L")).toBe(true);
      }
    });

    it("evaluates perpendicular coordinate syntax with |- and -|", () => {
      const source = String.raw`\begin{tikzpicture}
    \path coordinate (a) at (1,2) coordinate (b) at (3,4);
    \draw (a |- b) -- (a -| b);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      const drawPath = paths.find((element) => element.kind === "Path" && element.style.stroke != null);
      expect(drawPath?.kind).toBe("Path");
      if (drawPath?.kind !== "Path") {
        return;
      }
  
      const move = drawPath.commands[0];
      const line = drawPath.commands.find((command) => command.kind === "L");
      expect(move?.kind).toBe("M");
      expect(line?.kind).toBe("L");
      if (move?.kind === "M" && line?.kind === "L") {
        expect(move.to.x).toBeCloseTo(28.4528, 3);
        expect(move.to.y).toBeCloseTo(113.811, 3);
        expect(line.to.x).toBeCloseTo(85.3583, 3);
        expect(line.to.y).toBeCloseTo(56.9055, 3);
      }
    });

    it("evaluates perpendicular coordinates when calc operands are wrapped in braces", () => {
      const source = String.raw`\begin{tikzpicture}
    \node (A) at (0,1)    {A};
    \node (B) at (1,1.5)  {B};
    \node (C) at (2,0)    {C};
    \node (D) at (2.5,-2) {D};
    \node at ({$(A)!.5!(B)$} -| {$(C)!.5!(D)$}) {X};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-perpendicular-coordinate")).toBe(false);
  
      const xLabel = result.scene.elements.find((element) => element.kind === "Text" && element.text === "X");
      expect(xLabel?.kind).toBe("Text");
      if (xLabel?.kind === "Text") {
        expect(xLabel.position.x).toBeCloseTo(64.0187, 3);
        expect(xLabel.position.y).toBeCloseTo(35.5659, 3);
      }
    });

    it("evaluates intersection-of and intersection cs coordinates for line pairs", () => {
      const source = String.raw`\begin{tikzpicture}
    \path coordinate (p) at (intersection cs:first line={(0,0)--(2,2)}, second line={(0,2)--(2,0)});
    \draw (intersection of 0,0--2,2 and 0,2--2,0) -- (p);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-form:explicit")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-explicit-coordinate")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const drawPath = result.scene.elements.find((element) => element.kind === "Path" && element.style.stroke != null);
      expect(drawPath?.kind).toBe("Path");
      if (drawPath?.kind !== "Path") {
        return;
      }
  
      const move = drawPath.commands[0];
      const line = drawPath.commands.find((command) => command.kind === "L");
      expect(move?.kind).toBe("M");
      expect(line?.kind).toBe("L");
      if (move?.kind === "M" && line?.kind === "L") {
        expect(move.to.x).toBeCloseTo(28.4528, 3);
        expect(move.to.y).toBeCloseTo(28.4528, 3);
        expect(line.to.x).toBeCloseTo(28.4528, 3);
        expect(line.to.y).toBeCloseTo(28.4528, 3);
      }
    });

    it("reports invalid explicit intersection coordinates with malformed line endpoints", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (intersection cs:first line={(missing)--(2,2)}, second line={(0,2)--(2,0)});
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:missing")).toBe(true);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-explicit-coordinate:"))).toBe(true);
    });

    it("supports name path and name intersections with alias naming", () => {
      const source = String.raw`\begin{tikzpicture}
    \path [name path=upward line] (1,0) -- (1,1);
    \path [name path=sloped line] (0,0) -- (30:1.5cm);
    \draw [name intersections={of=upward line and sloped line, by=x}] (1,0) -- (x);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:name path")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:name intersections")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:x"))).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-path:"))).toBe(false);
  
      const drawPath = result.scene.elements.find((element) => element.kind === "Path" && element.style.stroke != null);
      expect(drawPath?.kind).toBe("Path");
      if (drawPath?.kind !== "Path") {
        return;
      }
  
      const move = drawPath.commands[0];
      const line = drawPath.commands.find((command) => command.kind === "L");
      expect(move?.kind).toBe("M");
      expect(line?.kind).toBe("L");
      if (move?.kind === "M" && line?.kind === "L") {
        expect(move.to.x).toBeCloseTo(28.4528, 3);
        expect(move.to.y).toBeCloseTo(0, 3);
        expect(line.to.x).toBeCloseTo(28.4528, 3);
        expect(line.to.y).toBeCloseTo(16.427, 2);
      }
    });

    it("registers default intersection-n coordinates from name intersections", () => {
      const source = String.raw`\begin{tikzpicture}
    \path [name path=a] (0,0) -- (2,2);
    \path [name path=b] (0,2) -- (2,0);
    \draw [name intersections={of=a and b}] (intersection-1) -- (2,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:intersection-1"))).toBe(false);
      const drawPath = result.scene.elements.find((element) => element.kind === "Path" && element.style.stroke != null);
      expect(drawPath?.kind).toBe("Path");
      if (drawPath?.kind === "Path") {
        const move = drawPath.commands[0];
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          expect(move.to.x).toBeCloseTo(28.4528, 3);
          expect(move.to.y).toBeCloseTo(28.4528, 3);
        }
      }
    });

    it("orders cubic name intersections so by={a,b} assigns the center crossing to b", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw [name path=curve 1] (-2,-1) .. controls (8,-1) and (-8,1) .. (2,1);
    \draw [name path=curve 2] (-1,-2) .. controls (-1,8) and (1,-8) .. (1,2);
    \draw [name intersections={of=curve 1 and curve 2, by={a,b}}] (a) -- (b);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-path:"))).toBe(false);
  
      const intersectionSegment = result.scene.elements.find(
        (element) =>
          element.kind === "Path" &&
          element.style.stroke != null &&
          element.commands.some((command) => command.kind === "L") &&
          !element.commands.some((command) => command.kind === "C")
      );
      expect(intersectionSegment?.kind).toBe("Path");
      if (intersectionSegment?.kind !== "Path") {
        return;
      }
  
      const move = intersectionSegment.commands[0];
      const line = intersectionSegment.commands.find((command) => command.kind === "L");
      expect(move?.kind).toBe("M");
      expect(line?.kind).toBe("L");
      if (move?.kind === "M" && line?.kind === "L") {
        expect(move.to.x).toBeCloseTo(-28.2, 1);
        expect(move.to.y).toBeCloseTo(-28.2, 1);
        expect(line.to.x).toBeCloseTo(0, 1);
        expect(line.to.y).toBeCloseTo(0, 1);
      }
    });

    it("samples closed paths and ellipse geometry for named intersections", () => {
      const source = String.raw`\begin{tikzpicture}
    \path [name path=box] (0,0) -- (2,0) -- (2,2) -- (0,2) -- cycle;
    \path [name path=cut] (1,-1) -- (1,3);
    \path [name path=ellipse] (4,1) ellipse (1cm and 0.5cm);
    \path [name path=line] (3,1) -- (5,1);
    \draw [name intersections={of=box and cut, by={lower,upper}}] (lower) -- (upper);
    \draw [name intersections={of=ellipse and line, by={left,right}}] (left) -- (right);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-path:"))).toBe(false);

      const drawn = result.scene.elements.filter((element) => element.kind === "Path" && element.style.stroke != null);
      expect(drawn.length).toBeGreaterThanOrEqual(2);
      const vertical = drawn.find((path) =>
        path.kind === "Path" &&
        path.commands.some((command) => command.kind === "M" && Math.abs(command.to.x - 28.4528) < 0.1)
      );
      const horizontal = drawn.find((path) =>
        path.kind === "Path" &&
        path.commands.some((command) => command.kind === "M" && command.to.x > 80)
      );
      expect(vertical?.kind).toBe("Path");
      expect(horizontal?.kind).toBe("Path");
    });

    it("reports unknown named paths from name intersections", () => {
      const source = String.raw`\begin{tikzpicture}
    \path [name path=known] (0,0) -- (1,1);
    \path [name intersections={of=known and missing, by=p}];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-path:missing")).toBe(true);
    });

    it("uses name-intersections total macros and sort-by ordering", () => {
      const source = String.raw`\begin{tikzpicture}
    \path [name path=box] (0,0) -- (2,0) -- (2,2) -- (0,2) -- cycle;
    \path [name path=cut] (1,-1) -- (1,3);
    \path [name intersections={of=box and cut, by={first,second}, sort by=cut, total=\n}];
    \draw (first) -- (second);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
      const drawn = result.scene.elements.filter((element) => element.kind === "Path" && element.style.stroke != null);
      expect(drawn.some((path) => path.kind === "Path" && path.commands.some((command) => command.kind === "L"))).toBe(true);
    });

    it("projects xyz coordinates onto 2d output and warns when z contributes", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0,1) -- (1,1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-form:xyz")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-z-component")).toBe(true);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.some((command) => command.kind === "L")).toBe(true);
      }
    });

    it("does not carry operators across cycle into the next subpath", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- (1,1) -- (1,0) -- cycle (2,0) -- (3,1) -- (3,0) -- cycle;
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBe(2);
      const second = paths[1];
      expect(second?.kind).toBe("Path");
      if (second?.kind === "Path") {
        const move = second.commands[0];
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          expect(move.to.x).toBeCloseTo(56.9055, 3);
          expect(move.to.y).toBeCloseTo(0, 3);
        }
      }
    });

    it("accepts braced shift vectors in scope options", () => {
      const source = String.raw`\begin{tikzpicture}
    \begin{scope}[shift={(0.2,0)}]
      \draw (0,0) -- (1,0);
    \end{scope}
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-shift:"))).toBe(false);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands.find((command) => command.kind === "M");
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          expect(move.to.x).toBeCloseTo(5.6906, 3);
          expect(move.to.y).toBeCloseTo(0, 3);
        }
      }
    });

    it("accepts named coordinates in shift scope options", () => {
      const source = String.raw`\begin{tikzpicture}
    \path (1,2) coordinate (tip);
    \begin{scope}[shift=(tip)]
      \draw (0,0) -- (1,0);
    \end{scope}
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-shift:"))).toBe(false);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands.find((command) => command.kind === "M");
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          expect(move.to.x).toBeCloseTo(28.4528, 3);
          expect(move.to.y).toBeCloseTo(56.9055, 3);
        }
      }
    });

    it("renders rotated scope grids with non-axis-aligned segments", () => {
      const source = String.raw`\begin{tikzpicture}
    \begin{scope}[shift={(1,1)},rotate=10]
      \draw[help lines] grid(1,1);
    \end{scope}
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
      const gridPaths = elementsOfKind(result.scene.elements, "Path");
      expect(gridPaths.length).toBeGreaterThanOrEqual(4);
  
      const hasDiagonalSegment = gridPaths.some((element) => {
        if (element.kind !== "Path") {
          return false;
        }
        const move = element.commands[0];
        const line = element.commands.find((command) => command.kind === "L");
        if (move?.kind !== "M" || line?.kind !== "L") {
          return false;
        }
        const dx = line.to.x - move.to.x;
        const dy = line.to.y - move.to.y;
        return Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6;
      });
  
      expect(hasDiagonalSegment).toBe(true);
    });

    it("renders rotated scope rectangles as transformed quadrilaterals", () => {
      const source = String.raw`\begin{tikzpicture}
    \begin{scope}[shift={(1,1)},rotate=10]
      \draw (0,0) rectangle (0.5,0.5);
    \end{scope}
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind !== "Path") {
        return;
      }
  
      const firstLine = path.commands.find((command) => command.kind === "L");
      expect(firstLine?.kind).toBe("L");
      if (firstLine?.kind === "L") {
        const move = path.commands[0];
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          const dx = firstLine.to.x - move.to.x;
          const dy = firstLine.to.y - move.to.y;
          expect(Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6).toBe(true);
        }
      }
    });

    it("supports slash multi-variable bindings with repeat-last fallback", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x/\y in {1/a,2}
      \node at (\x,0) {\y};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const labels = result.scene.elements
        .filter((element) => element.kind === "Text")
        .map((element) => (element.kind === "Text" ? element.text : ""));
      expect(labels).toEqual(["a", "2"]);
    });

    it("supports grouped slash bindings in list entries", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \center/\r in {{(0,0)/2mm}, {(1,1)/3mm}, {(2,0)/1mm}}
      \draw[yshift=2.5cm] \center circle (\r);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate"))).toBe(false);
  
      const circles = elementsOfKind(result.scene.elements, "Circle");
      expect(circles).toHaveLength(3);
      const maxRadius = circles.reduce((max, element) => {
        if (element.kind !== "Circle") {
          return max;
        }
        return Math.max(max, element.radius);
      }, 0);
      expect(maxRadius).toBeLessThan(10);
    });

    it("supports basic to/ellipse/arc/grid semantics without unsupported diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to (1,1);
    \draw (0,0) ellipse [x radius=1cm, y radius=.5cm];
    \draw (0,0) arc [start angle=0, end angle=90, radius=1cm];
    \draw (0,0) grid [step=1cm] (2,2);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-to-operation")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-keyword")).toBe(false);
      expect(result.scene.elements.some((element) => element.kind === "Ellipse")).toBe(true);
      expect(result.scene.elements.some((element) => element.kind === "Path")).toBe(true);
    });

    it("expands macros before evaluating ellipse radii", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\xdist{0.13}
    \def\ydist{0.05}
    \fill [fill=red!30!white] (30*\xdist, -5) rectangle (50*\xdist,-0);
      \fill [fill=blue!30!white] (50*\xdist, 0) ellipse ({50*\xdist} and {50*\ydist});
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
      const ellipse = result.scene.elements.find(
        (element) => element.kind === "Path" && element.shapeHint === "ellipse"
      );
      expect(ellipse?.kind).toBe("Path");
      if (ellipse?.kind === "Path") {
        expect(ellipse.shapeHint).toBe("ellipse");
      }
    });

    it("expands macros in circle radius path options", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\r{1cm}
    \draw (0,0) circle [radius=\r];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
      expect(elementsOfKind(result.scene.elements, "Circle")).toHaveLength(1);
    });

    it("expands macros in ellipse radii path options", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\r{1cm}
    \def\h{0.5cm}
    \draw (2,0) ellipse [x radius=\r, y radius=\h];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
      expect(result.scene.elements.some((element) => element.kind === "Ellipse")).toBe(true);
    });

    it("expands macros in arc path options", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\r{1cm}
    \def\h{0.5cm}
    \draw (4,0) arc [start angle=0, end angle=90, x radius=\r, y radius=\h];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.some((path) => path.commands.some((command) => command.kind === "A"))).toBe(true);
    });

    it("expands macros in grid and parabola path options", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\s{0.25cm}
    \def\h{0.5cm}
    \draw (0,2) grid [step=\s] (1,3);
    \draw (0,4) parabola [parabola height=\h] (1,4);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.some((path) => path.id.includes("scene-grid-"))).toBe(true);
      expect(paths.some((path) => path.commands.some((command) => command.kind === "C"))).toBe(true);
    });

    it("supports parabola bend variants and reports invalid parabola forms", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) parabola [bend at start] (1,0);
    \draw (0,1) parabola [bend at end] (1,1);
    \draw (0,2) parabola [bend pos=bad, bend=+(0.25,0.5)] (1,2);
    \draw (0,3) parabola [bend=(0.5,3.5)] (1,3);
    \draw (0,4) parabola bend (0.5,4.5) (1,4);
    \draw (0,5) -- (1,5) parabola cycle;
    \draw (0,6) parabola [bend pos=NaN, bend=] (1,6);
    \draw (0,7) parabola [bend=bad] (1,7);
    \draw (0,4) parabola bend;
    \draw parabola (1,5);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-parabola")).toBe(true);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parabola-without-start")).toBe(true);
      const parabolaPaths = elementsOfKind(result.scene.elements, "Path").filter((path) =>
        path.commands.some((command) => command.kind === "C")
      );
      expect(parabolaPaths.length).toBeGreaterThanOrEqual(3);
      expect(parabolaPaths.some((path) => path.commands.length >= 2)).toBe(true);
    });

    it("supports arc variants and grid step variants", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (1,0) arc (0:90:1cm);
    \draw (1,0) arc [start angle=0, delta angle=90, x radius=1cm, y radius=.5cm];
    \draw (0,0) grid [xstep=1cm, ystep=.5cm] (2,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-arc-parameters")).toBe(false);
  
      const arcPaths = elementsOfKind(result.scene.elements, "Path");
      expect(arcPaths.length).toBeGreaterThanOrEqual(3);
  
      const arcCommands = arcPaths.flatMap((path) => (path.kind === "Path" ? path.commands : [])).filter((command) => command.kind === "A");
      expect(arcCommands.length).toBeGreaterThanOrEqual(2);
      for (const command of arcCommands) {
        if (command.kind === "A") {
          expect(command.rx).toBeGreaterThan(0);
          expect(command.ry).toBeGreaterThan(0);
        }
      }
  
      const gridElements = arcPaths.filter((path) => path.id.includes("scene-grid-"));
      expect(gridElements.length).toBe(6);
    });

    it("lets explicit x/y arc radii override inherited radius", () => {
      const source = String.raw`\begin{tikzpicture}[radius=1cm]
    \draw (8,0) arc [start angle=0, end angle=270, x radius=1cm, y radius=5mm];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const arc = path.commands.find((command) => command.kind === "A");
        expect(arc?.kind).toBe("A");
        if (arc?.kind === "A") {
          expect(arc.rx).toBeCloseTo(28.4528, 3);
          expect(arc.ry).toBeCloseTo(14.2264, 3);
        }
      }
    });

    it("applies transform rotation to arc ellipse axes", () => {
      const source = String.raw`\begin{tikzpicture}[rotate=30]
    \draw (1,0) arc [start angle=0, end angle=90, x radius=1cm, y radius=.5cm];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const arc = path.commands.find((command) => command.kind === "A");
        expect(arc?.kind).toBe("A");
        if (arc?.kind === "A") {
          const normalizedRotation = ((arc.xAxisRotation % 180) + 180) % 180;
          expect(normalizedRotation).toBeCloseTo(30, 3);
          expect(arc.rx).toBeCloseTo(28.4528, 3);
          expect(arc.ry).toBeCloseTo(14.2264, 3);
        }
      }
    });

    it("applies rotate around with a coordinate pivot", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[rotate around={90:(1,0)}] (1,0) -- (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:rotate around")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code?.startsWith("invalid-rotate-around:"))).toBe(false);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const commands = path.commands.filter((command) => command.kind === "M" || command.kind === "L");
        expect(commands).toHaveLength(2);
        const [first, second] = commands;
        if (first?.kind === "M" && second?.kind === "L") {
          expect(first.to.x).toBeCloseTo(28.4528, 3);
          expect(first.to.y).toBeCloseTo(0, 3);
          expect(second.to.x).toBeCloseTo(28.4528, 3);
          expect(second.to.y).toBeCloseTo(28.4528, 3);
        }
      }
    });

    it("composes rotate around in option order with cm", () => {
      const source = String.raw`\begin{tikzpicture}[rotate around={90:(1,0)},cm={1,0,0,1,(1cm,0)}]
    \draw (0,0) -- (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code?.startsWith("invalid-rotate-around:"))).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code?.startsWith("invalid-cm:"))).toBe(false);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const commands = path.commands.filter((command) => command.kind === "M" || command.kind === "L");
        expect(commands).toHaveLength(2);
        const [first, second] = commands;
        if (first?.kind === "M" && second?.kind === "L") {
          expect(first.to.x).toBeCloseTo(28.4528, 3);
          expect(first.to.y).toBeCloseTo(0, 3);
          expect(second.to.x).toBeCloseTo(28.4528, 3);
          expect(second.to.y).toBeCloseTo(56.9055, 3);
        }
      }
    });

    it("supports /tikz/rotate around with braced PGF syntax", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[/tikz/rotate around={40:(1,1)}] (0,0) -- (1,1) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:/tikz/rotate around")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code?.startsWith("invalid-rotate-around:"))).toBe(false);
    });

    it("reports invalid rotate around payloads as invalid-rotate-around diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[rotate around={45}] (0,0) -- (1,0);
    \draw[rotate around={foo:(1,0)}] (0,0) -- (1,0);
    \draw[rotate around={45:not-a-coordinate}] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const invalidRotateAround = result.diagnostics.filter((diagnostic) =>
        diagnostic.code?.startsWith("invalid-rotate-around:")
      );
      expect(invalidRotateAround.length).toBeGreaterThanOrEqual(3);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:rotate around")).toBe(false);
    });

    it("applies cm shear matrices to path coordinates", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[cm={1,1,0,1,(0,0)}] (0,0) -- (1,1) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code?.startsWith("invalid-cm:"))).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const commands = path.commands.filter((command) => command.kind === "M" || command.kind === "L");
        expect(commands).toHaveLength(3);
        const [, second, third] = commands;
        if (second?.kind === "L" && third?.kind === "L") {
          expect(second.to.x).toBeCloseTo(28.4528, 3);
          expect(second.to.y).toBeCloseTo(56.9055, 3);
          expect(third.to.x).toBeCloseTo(28.4528, 3);
          expect(third.to.y).toBeCloseTo(28.4528, 3);
        }
      }
    });

    it("applies cm axis swaps with translation", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[cm={0,1,1,0,(1cm,1cm)}] (0,0) -- (1,1) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code?.startsWith("invalid-cm:"))).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const commands = path.commands.filter((command) => command.kind === "M" || command.kind === "L");
        expect(commands).toHaveLength(3);
        const [first, second, third] = commands;
        if (first?.kind === "M" && second?.kind === "L" && third?.kind === "L") {
          expect(first.to.x).toBeCloseTo(28.4528, 3);
          expect(first.to.y).toBeCloseTo(28.4528, 3);
          expect(second.to.x).toBeCloseTo(56.9055, 3);
          expect(second.to.y).toBeCloseTo(56.9055, 3);
          expect(third.to.x).toBeCloseTo(28.4528, 3);
          expect(third.to.y).toBeCloseTo(56.9055, 3);
        }
      }
    });

    it("composes cm in option order with other transforms", () => {
      const source = String.raw`\begin{tikzpicture}[rotate=90,cm={1,0,0,1,(1cm,0)}]
    \draw (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands.find((command) => command.kind === "M");
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          expect(move.to.x).toBeCloseTo(0, 3);
          expect(move.to.y).toBeCloseTo(28.4528, 3);
        }
      }
    });

    it("reports invalid cm payloads as invalid-cm diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[cm={1,1,0}] (0,0) -- (1,0);
    \draw[cm={foo,1,0,1,(0,0)}] (0,0) -- (1,0);
    \draw[cm={1,1,0,1,not-a-coordinate}] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const invalidCm = result.diagnostics.filter((diagnostic) => diagnostic.code?.startsWith("invalid-cm:"));
      expect(invalidCm.length).toBeGreaterThanOrEqual(3);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:cm")).toBe(false);
    });

    it("interprets unitless grid steps in axis units under transformed x vectors", () => {
      const source = String.raw`\begin{tikzpicture}[x=.5cm]
    \draw (0,0) grid [step=1] (3,2);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      const vertical = paths.filter((path) => path.id.includes("scene-grid-x:"));
      const horizontal = paths.filter((path) => path.id.includes("scene-grid-y:"));
      expect(vertical.length).toBe(4);
      expect(horizontal.length).toBe(3);
    });

    it("applies statement-level step options to grid spacing", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[step=0.5] (0,3) grid (3,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const paths = elementsOfKind(result.scene.elements, "Path");
      const vertical = paths.filter((path) => path.id.includes("scene-grid-x:"));
      const horizontal = paths.filter((path) => path.id.includes("scene-grid-y:"));
      expect(vertical.length).toBe(7);
      expect(horizontal.length).toBe(7);
    });

    it("applies picture-level step options to grid spacing", () => {
      const source = String.raw`\begin{tikzpicture}[step=0.5]
    \draw (0,3) grid (3,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const paths = elementsOfKind(result.scene.elements, "Path");
      const vertical = paths.filter((path) => path.id.includes("scene-grid-x:"));
      const horizontal = paths.filter((path) => path.id.includes("scene-grid-y:"));
      expect(vertical.length).toBe(7);
      expect(horizontal.length).toBe(7);
    });

    it("scales default grid spacing with transformed coordinate systems", () => {
      const source = String.raw`\begin{tikzpicture}[scale=0.2]
    \draw (0,0) grid (10,10);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      const vertical = paths.filter((path) => path.id.includes("scene-grid-x:"));
      const horizontal = paths.filter((path) => path.id.includes("scene-grid-y:"));
      expect(vertical.length).toBe(11);
      expect(horizontal.length).toBe(11);
    });

    it("applies rounded corners across cycle closure", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) [rounded corners=10pt] -- (1,1) -- (2,1)
                       [sharp corners] -- (2,0)
                 [rounded corners=5pt] -- cycle;
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const cubicCount = path.commands.filter((command) => command.kind === "C").length;
        expect(cubicCount).toBeGreaterThanOrEqual(3);
        expect(path.commands.some((command) => command.kind === "Z")).toBe(true);
        const move = path.commands[0];
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          expect(move.to.x).toBeGreaterThan(0);
        }
      }
    });

    it("keeps named coordinates transformed at registration scope", () => {
      const source = String.raw`\begin{tikzpicture}
    \begin{scope}[xshift=1cm,yshift=1cm]
      \path coordinate (p) at (1,2);
    \end{scope}
    \draw (p) -- ++(1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:p")).toBe(false);
  
      const path = result.scene.elements.find((element) => element.kind === "Path" && !element.id.includes("scene-grid-"));
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands.find((command) => command.kind === "M");
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          expect(move.to.x).toBeCloseTo(56.9055, 3);
          expect(move.to.y).toBeCloseTo(85.3582, 3);
        }
      }
    });

    it("supports dash phase and dash shorthand while recognizing bar markers", () => {
      const source = String.raw`\begin{tikzpicture}[|-|, dash pattern=on 20pt off 10pt]
    \draw[dash phase=0pt] (0,0) -- (2,0);
    \draw[dash=on 20pt off 10pt phase 10pt] (0,1) -- (2,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:dash phase")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:dash")).toBe(false);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBeGreaterThanOrEqual(2);
      const topPath = paths[0];
      const bottomPath = paths[1];
      expect(topPath?.kind).toBe("Path");
      expect(bottomPath?.kind).toBe("Path");
      if (topPath?.kind === "Path" && bottomPath?.kind === "Path") {
        expect(topPath.style.markerStart?.tips.map((tip) => tip.kind)).toEqual(["bar"]);
        expect(topPath.style.markerEnd?.tips.map((tip) => tip.kind)).toEqual(["bar"]);
        expect(topPath.style.dashArray).toEqual([20, 10]);
        expect(topPath.style.dashOffset).toBeCloseTo(0);
        expect(bottomPath.style.dashArray).toEqual([20, 10]);
        expect(bottomPath.style.dashOffset).toBeCloseTo(10);
      }
    });

    it("accepts braced dash patterns from generated TikZ output", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw [line width=2.25] [dash pattern={on 2.53pt off 3.02pt}] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-dash-pattern:{on 2.53pt off 3.02pt}")).toBe(false);

      const path = elementsOfKind(result.scene.elements, "Path")[0];
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.dashArray).toEqual([2.53, 3.02]);
      }
    });

    it("supports shade=false/none choices", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[shade,shade=false,fill=red] (0,0) rectangle (1,1);
    \draw[shade,shade=none,fill=blue] (2,0) rectangle (3,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBe(2);
      for (const path of paths) {
        if (path.kind === "Path") {
          expect(path.style.shadeEnabled).toBe(false);
        }
      }
    });

    it("preserves dot separators as afterLineEnd semantics for subsequent tips", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[-{Stealth[length=4pt] . Latex[length=5pt] . Stealth[length=3pt]}] (0,0) -- (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const path = firstElementOfKind(result.scene.elements, "Path");
  
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const tips = path.style.markerEnd?.tips ?? [];
        expect(tips.length).toBe(3);
        expect(tips[0]?.afterLineEnd).toBe(false);
        expect(tips[1]?.afterLineEnd).toBe(true);
        expect(tips[2]?.afterLineEnd).toBe(true);
      }
    });

    it("recomputes Stealth inset when geometric dimensions are overridden", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[line width=1.2pt,-{Stealth[length=2mm 4]}] (0,0) -- (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const path = firstElementOfKind(result.scene.elements, "Path");
  
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const tip = path.style.markerEnd?.tips[0];
        expect(tip?.kind).toBe("stealth");
        expect(tip?.length).toBeCloseTo(10.4906, 3);
        expect(tip?.width).toBeCloseTo(7.8679, 3);
        expect(tip?.inset).toBeCloseTo(3.4094, 3);
        expect(tip?.lineWidth).toBeCloseTo(1.2, 3);
      }
    });

    it("supports cubic Bezier curves with controls/and", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) .. controls (1,1) and (2,1) .. (3,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-operator")).toBe(false);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.some((command) => command.kind === "C")).toBe(true);
      }
    });

    it("supports to-operation bend left/right curve shorthands", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[bend right=45] (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-to-operation")).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const cubic = path.commands.find((command) => command.kind === "C");
        expect(cubic?.kind).toBe("C");
        if (cubic?.kind === "C") {
          expect(cubic.c1.y).toBeLessThan(0);
          expect(cubic.c2.y).toBeLessThan(0);
        }
      }
    });

    it("applies leading bend options to the following `to` operation", () => {
      const source = String.raw`\begin{tikzpicture}
    \node (RL) at (0,0) {$R_l$};
    \node (SL) at (3,0) {$S_l$};
    \draw[bend left] (RL) to (SL);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.some((command) => command.kind === "C")).toBe(true);
      }
    });

    it("curves edge operations when only `out` is set", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) edge[out=45] (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:out")).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind !== "Path") {
        return;
      }

      const cubic = path.commands.find((command) => command.kind === "C");
      expect(cubic?.kind).toBe("C");
      if (cubic?.kind === "C") {
        expect(cubic.c1.y).toBeGreaterThan(0);
        expect(cubic.c2.y).toBeGreaterThan(0);
      }
    });

    it("supports to-cycle closure and implicit move-to-target paths", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- (1,0) to cycle;
    \draw to (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const paths = elementsOfKind(result.scene.elements, "Path");
      const closedPath = paths.find((path) => path.commands.some((command) => command.kind === "Z"));
      const implicitTargetHandle = result.editHandles.find(
        (handle) => handle.kind === "path-point" && Math.abs(handle.world.x - 56.9055) <= 1e-3
      );
      expect(closedPath).toBeDefined();
      expect(implicitTargetHandle).toBeDefined();
      if (closedPath) {
        expect(closedPath.commands.some((command) => command.kind === "L")).toBe(true);
      }
    });

    it("reports invalid to-operation targets without dropping the previous path", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- (1,0) to (missing);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:missing")).toBe(true);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.some((command) => command.kind === "L")).toBe(true);
      }
    });

    it("accepts `to path` edge options without unsupported-style diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) edge[to path={-- (\tikztotarget) \tikztonodes}] (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:to path")).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
    });

    it("interprets `relative` to-angles against the start-to-target direction", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[out=0,in=180] (1,1);
    \draw (0,-2) to[out=0,in=180,relative] (1,-1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const curvePaths = elementsOfKind(result.scene.elements, "Path")
        .filter((element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> => element.kind === "Path")
        .filter((element) => element.commands.some((command) => command.kind === "C"));
      expect(curvePaths.length).toBeGreaterThanOrEqual(2);

      const first = curvePaths[0];
      const second = curvePaths[1];
      expect(first?.commands[0]?.kind).toBe("M");
      expect(second?.commands[0]?.kind).toBe("M");
      const firstCubic = first?.commands.find((command) => command.kind === "C");
      const secondCubic = second?.commands.find((command) => command.kind === "C");
      expect(firstCubic?.kind).toBe("C");
      expect(secondCubic?.kind).toBe("C");
      if (first?.commands[0]?.kind === "M" && second?.commands[0]?.kind === "M" && firstCubic?.kind === "C" && secondCubic?.kind === "C") {
        expect(firstCubic.c1.y).toBeCloseTo(first.commands[0].to.y, 4);
        expect(secondCubic.c1.y).toBeGreaterThan(second.commands[0].to.y + 0.1);
      }
    });

    it("applies `bend angle` when used with `bend left`", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[bend angle=45,bend left] (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind !== "Path") {
        return;
      }
      const move = path.commands[0];
      const cubic = path.commands.find((command) => command.kind === "C");
      expect(move?.kind).toBe("M");
      expect(cubic?.kind).toBe("C");
      if (move?.kind === "M" && cubic?.kind === "C") {
        const outDx = cubic.c1.x - move.to.x;
        const outDy = cubic.c1.y - move.to.y;
        expect(outDx).toBeGreaterThan(0);
        expect(outDy).toBeGreaterThan(0);
        expect(outDy / outDx).toBeCloseTo(1, 2);
      }
    });

    it("applies `distance` to both control-point radii for to-curves", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[out=45,in=135,distance=2cm] (4,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind !== "Path") {
        return;
      }
      const move = path.commands[0];
      const cubic = path.commands.find((command) => command.kind === "C");
      expect(move?.kind).toBe("M");
      expect(cubic?.kind).toBe("C");
      if (move?.kind === "M" && cubic?.kind === "C") {
        const outDistance = Math.hypot(cubic.c1.x - move.to.x, cubic.c1.y - move.to.y);
        const inDistance = Math.hypot(cubic.c2.x - cubic.to.x, cubic.c2.y - cubic.to.y);
        expect(outDistance).toBeCloseTo(56.9055, 2);
        expect(inDistance).toBeCloseTo(56.9055, 2);
      }
    });

    it("uses shared looseness and bend-right flag shorthands for to-curves", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[out=0,in=180,looseness=2] (2,0);
    \draw (0,-1) to[bend right] (2,-1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const cubics = elementsOfKind(result.scene.elements, "Path")
        .flatMap((path) => path.commands)
        .filter((command) => command.kind === "C");
      expect(cubics).toHaveLength(2);
      const [loose, bent] = cubics;
      if (loose?.kind === "C" && bent?.kind === "C") {
        const looseDistance = Math.hypot(loose.c1.x, loose.c1.y);
        // PGF fixed-point distance, also checked by the independent oracle.
        expect(looseDistance).toBeCloseTo(44.38284, 2);
        expect(bent.c1.y).toBeLessThan(-28.4528);
        expect(bent.c2.y).toBeLessThan(-28.4528);
      }
    });

    it("ignores invalid to-curve option values while preserving valid curve options", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[out=,in=abc,relative=maybe,distance=-1pt,out=0] (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind !== "Path") {
        return;
      }
      const move = path.commands[0];
      const cubic = path.commands.find((command) => command.kind === "C");
      expect(move?.kind).toBe("M");
      expect(cubic?.kind).toBe("C");
      if (move?.kind === "M" && cubic?.kind === "C") {
        expect(cubic.c1.y).toBeCloseTo(move.to.y, 4);
        expect(cubic.c2.y).toBeGreaterThan(move.to.y);
      }
    });

    it("treats empty relative values as true for to-angle edit metadata", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[out=0,in=180,relative=] (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const outHandle = result.editHandles.find(
        (handle) => handle.kind === "path-control" && handle.curveEdit?.kind === "to-angle" && handle.curveEdit.role === "out"
      );
      expect(outHandle?.curveEdit?.kind).toBe("to-angle");
      if (outHandle?.curveEdit?.kind === "to-angle") {
        expect(outHandle.curveEdit.relative).toBe(true);
        expect(outHandle.curveEdit.baseHeading).toBeCloseTo(45, 1);
      }
    });

    it("applies per-side looseness and distance clamps to to-curve controls", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[out=0,in=180,out looseness=8,in looseness=0.1,out max distance=20pt,in min distance=12pt] (4,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind !== "Path") {
        return;
      }
      const move = path.commands[0];
      const cubic = path.commands.find((command) => command.kind === "C");
      expect(move?.kind).toBe("M");
      expect(cubic?.kind).toBe("C");
      if (move?.kind === "M" && cubic?.kind === "C") {
        const outDistance = Math.hypot(cubic.c1.x - move.to.x, cubic.c1.y - move.to.y);
        const inDistance = Math.hypot(cubic.c2.x - cubic.to.x, cubic.c2.y - cubic.to.y);
        expect(outDistance).toBeCloseTo(20, 3);
        expect(inDistance).toBeCloseTo(12, 3);
      }
    });

    it("applies one-sided min/max and exact distances independently", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[out=45,in=135,min distance=8pt,max distance=30pt,in distance=14pt,out min distance=24pt] (1,0);
    \draw (0,-1) to[out=45,in=135,out distance=18pt,in max distance=10pt] (1,-1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const cubics = elementsOfKind(result.scene.elements, "Path")
        .flatMap((path) => path.commands)
        .filter((command) => command.kind === "C");
      expect(cubics).toHaveLength(2);
      const [first, second] = cubics;
      if (first?.kind === "C" && second?.kind === "C") {
        const firstOutDistance = Math.hypot(first.c1.x, first.c1.y);
        const firstInDistance = Math.hypot(first.c2.x - first.to.x, first.c2.y - first.to.y);
        const secondOutDistance = Math.hypot(second.c1.x, second.c1.y + 28.4528);
        const secondInDistance = Math.hypot(second.c2.x - second.to.x, second.c2.y - second.to.y);
        expect(firstOutDistance).toBeCloseTo(24, 3);
        expect(firstInDistance).toBeCloseTo(14, 3);
        expect(secondOutDistance).toBeCloseTo(18, 3);
        expect(secondInDistance).toBeCloseTo(10, 3);
      }
    });

    it("keeps absolute to-angles when `relative=false` is explicit", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[out=0,in=180,relative=false] (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind !== "Path") {
        return;
      }
      const move = path.commands[0];
      const cubic = path.commands.find((command) => command.kind === "C");
      expect(move?.kind).toBe("M");
      expect(cubic?.kind).toBe("C");
      if (move?.kind === "M" && cubic?.kind === "C") {
        expect(cubic.c1.y).toBeCloseTo(move.to.y, 4);
      }
    });

    it("emits to-curve edit handle metadata for angle and bend modes", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[out=20,in=160,relative=on] (2,0);
    \draw (0,-1) to[bend left=75] (2,-1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const angleHandles = result.editHandles.filter(
        (handle) => handle.kind === "path-control" && handle.curveEdit?.kind === "to-angle"
      );
      const bendHandles = result.editHandles.filter(
        (handle) => handle.kind === "path-bend" && handle.curveEdit?.kind === "to-bend"
      );
      expect(angleHandles).toHaveLength(2);
      expect(bendHandles).toHaveLength(1);
      expect(angleHandles.map((handle) => handle.curveEdit?.kind === "to-angle" ? handle.curveEdit.role : null).sort()).toEqual([
        "in",
        "out"
      ]);
      for (const handle of angleHandles) {
        if (handle.curveEdit?.kind === "to-angle") {
          expect(handle.curveEdit.relative).toBe(true);
          expect(handle.curveEdit.baseHeading).toBeCloseTo(0, 6);
        }
      }
      const bendHandle = bendHandles[0];
      if (bendHandle?.curveEdit?.kind === "to-bend") {
        expect(bendHandle.curveEdit.baseHeading).toBeCloseTo(0, 6);
        expect(bendHandle.world.y).toBeGreaterThan(bendHandle.curveEdit.startWorld.y);
      }
    });

    it("supports nodes between closing `..` and a curve target coordinate", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) .. controls (1,1) and (2,1) .. node[above]{mid} (3,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-operator")).toBe(false);
      const label = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
          element.kind === "Text" && element.text === "mid"
      );
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.position.x).toBeGreaterThan(0);
      }
    });

    it("falls back with diagnostics for unsupported curve pattern variants", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) .. (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-operator")).toBe(true);
    });

    it("keeps connector segments when circles are interleaved in a draw path", () => {
      const source = String.raw`\begin{tikzpicture}[radius=2pt]
    \draw (0,0) circle -- (1,1) circle -- ++(0,1) circle;
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      const circles = elementsOfKind(result.scene.elements, "Circle");
      expect(circles.length).toBe(3);
      expect(paths.length).toBe(2);
  
      const lineCounts = paths.map((path) => (path.kind === "Path" ? path.commands.filter((command) => command.kind === "L").length : 0));
      expect(lineCounts).toEqual([1, 1]);
      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    });

    it("parses edge quote syntax when quote options are provided without braces", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) edge["inside" pos=0.4] (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-option-key:"inside" pos')).toBe(false);
  
      const inside = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
          element.kind === "Text" && element.text === "inside"
      );
      expect(inside).toBeDefined();
    });

    it("keeps multi-cycle fill geometry in one compound path for hole punching", () => {
      const source = String.raw`\begin{tikzpicture}
    \fill[orange]
      (90:2) -- (210:2) -- (330:2) -- cycle
      (90:1) -- (330:1) -- (210:1) -- cycle;
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = result.scene.elements.filter((element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> => element.kind === "Path");
      expect(paths).toHaveLength(1);
      const closeCommands = paths[0]?.commands.filter((command) => command.kind === "Z") ?? [];
      expect(closeCommands).toHaveLength(2);
    });

    it("supports positioning shift expressions like 2pt+3pt and .2 and 3mm", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,name=a,node contents=A] at (0,0);
    \node[draw,above=2pt+3pt,name=b,node contents=B] at (0,0);
    \node[draw,above=.2 and 3mm,name=c,node contents=C] at (0,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-positioning-shift"))).toBe(false);
  
      const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      const cText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      expect(aText?.kind).toBe("Text");
      expect(bText?.kind).toBe("Text");
      expect(cText?.kind).toBe("Text");
      if (aText?.kind === "Text" && bText?.kind === "Text" && cText?.kind === "Text") {
        expect(bText.position.y).toBeGreaterThan(aText.position.y + 4.5);
        expect(cText.position.y).toBeGreaterThan(bText.position.y + 0.5);
      }
    });

    it("ignores standalone \\usetikzlibrary commands without emitting unsupported-statement diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \usetikzlibrary {shadows,shapes.symbols}
    \draw (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-statement")).toBe(false);
      expect(result.scene.elements.some((element) => element.kind === "Path")).toBe(true);
    });

    it("preserves optional/default behavior through callable let aliases", () => {
      const source = String.raw`\begin{tikzpicture}
    \newcommand{\pair}[2][left]{#1/#2}
    \let\alias=\pair
    \node at (0,0) {\alias{R}};
    \node at (1,0) {\alias[right]{R}};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const labels = result.scene.elements
        .filter((element) => element.kind === "Text")
        .map((element) => (element.kind === "Text" ? element.text : ""));
      expect(labels).toContain("left/R");
      expect(labels).toContain("right/R");
    });

    it("scales circle radii with the active transform so polar spokes still reach the boundary", () => {
      const source = String.raw`\begin{tikzpicture}[transform shape, scale=0.9]
      \draw [thick] (0,0) circle (5);
      \foreach \x in {45,135,225,-45}
        \draw [thick] (\x:0) -- (\x:5);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const circle = result.scene.elements.find((element) => element.kind === "Circle");
      expect(circle?.kind).toBe("Circle");
  
      const endpoints = result.scene.elements
        .filter((element) => element.kind === "Path")
        .flatMap((element) =>
          element.commands.flatMap((command) => (command.kind === "L" ? [command.to] : []))
        );
      expect(endpoints).toHaveLength(4);
  
      if (circle?.kind === "Circle") {
        for (const endpoint of endpoints) {
          const radialDistance = Math.hypot(endpoint.x - circle.center.x, endpoint.y - circle.center.y);
          expect(radialDistance).toBeCloseTo(circle.radius, 3);
        }
      }
    });

    it("applies transform rotation to ellipse geometry", () => {
      const source = String.raw`\begin{tikzpicture}[rotate=30]
    \draw (0,0) ellipse [x radius=2cm, y radius=1cm];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const ellipse = result.scene.elements.find((element) => element.kind === "Ellipse");
      expect(ellipse?.kind).toBe("Ellipse");
      if (ellipse?.kind === "Ellipse") {
        const normalized = ((ellipse.rotation ?? 0) % 180 + 180) % 180;
        expect(normalized).toBeCloseTo(30, 3);
        expect(ellipse.rx).toBeGreaterThan(ellipse.ry);
      }
    });

    it("maps circles to ellipses under non-uniform scaling transforms", () => {
      const source = String.raw`\begin{tikzpicture}[xscale=2, yscale=1]
    \draw (0,0) circle (1cm);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const ellipse = result.scene.elements.find((element) => element.kind === "Ellipse");
      expect(ellipse?.kind).toBe("Ellipse");
      if (ellipse?.kind === "Ellipse") {
        expect(ellipse.rx).toBeGreaterThan(ellipse.ry * 1.9);
        expect(ellipse.rotation ?? 0).toBeCloseTo(0, 3);
      }
    });

    it("applies dimensionless rounded corners values to rectangle path geometry", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[rounded corners=0.5] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-rounded-corners"))).toBe(false);
      const rectangle = firstElementOfKind(result.scene.elements, "Path");
      expect(rectangle?.kind).toBe("Path");
      if (rectangle?.kind === "Path") {
        expect(rectangle.commands.some((command) => command.kind === "C")).toBe(true);
      }
    });

    it("tags compounded filled shape paths with semantic shape hints", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[fill=yellow] (0,0) rectangle (1,1);
    \draw[fill=yellow] (2,0) circle (0.5cm);
    \draw[fill=yellow] (4,0) ellipse [x radius=0.75cm, y radius=0.4cm];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const rectangle = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.shapeHint === "rectangle"
      );
      const circle = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.shapeHint === "circle"
      );
      const ellipse = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.shapeHint === "ellipse"
      );

      expect(rectangle?.shapeHint).toBe("rectangle");
      expect(circle?.shapeHint).toBe("circle");
      expect(ellipse?.shapeHint).toBe("ellipse");
    });

    it("merges consecutive leading option lists before path geometry", () => {
      const source = String.raw`\begin{tikzpicture}
  \fill [decorate,decoration={zigzag}]
    [fill=blue!20,draw=blue,thick] (0,0) -- (2,1) arc (90:-90:.5) -- cycle;
\end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const filledPath = result.scene.elements.find((element) => element.kind === "Path" && element.style.fill != null);
  
      expect(filledPath?.kind).toBe("Path");
      if (filledPath?.kind === "Path") {
        expect(filledPath.style.fill).toBe("#ccccff");
        expect(filledPath.style.stroke).toBe("#0000ff");
      }
    });
});
