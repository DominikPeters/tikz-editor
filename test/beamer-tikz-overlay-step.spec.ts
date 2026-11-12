import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { computeSnapshot } from "../packages/app/src/compute.js";
import { executeDocumentEdit } from "../packages/app/src/edit-execution.js";
import { pictureOverlayVisibility } from "../packages/app/src/picture-overlay-step.js";
import { buildSelectionRects } from "../packages/app/src/ui/builds-panel/build-selection.js";
import { beamerStatementOverlayTarget, prepareBeamerDocument, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { buildBeamerBuildModel } from "../packages/core/src/beamer/builds.js";
import { BEAMER_TIKZ_LAYER_DEFINITION } from "../packages/core/src/beamer/overlay-pictures.js";
import { projectBeamerTikzSource, resolveBeamerOverlaySpanVisibility, scanBeamerFrameOverlays } from "../packages/core/src/beamer/overlay.js";
import { beamerTikzStep } from "../packages/core/src/beamer/tikz-overlay-step.js";
import { pt, worldPoint } from "../packages/core/src/coords/index.js";
import { maskTikzPictureSource } from "../packages/core/src/document/masking.js";
import { createIncrementalParseSession, parseTikz } from "../packages/core/src/parser/index.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

const FIXTURES = join(__dirname, "fixtures/beamer");

function texFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? texFiles(path) : name.endsWith(".tex") ? [path] : [];
  });
}

/** A scene element without its ids, which the old path numbered per step. */
function shape(element: object): string {
  return JSON.stringify(element, (key, value: unknown) => /(?:^id|Id|Ids|^sourceRef|^overlayCovered|^styleChain|^dependsOn.*|^provenance)$/u.test(key) ? undefined : value);
}

function drawn(source: string, options: Parameters<typeof renderTikzToSvg>[1], covered: (element: ReturnType<typeof renderTikzToSvg>["semantic"]["scene"]["elements"][number]) => boolean) {
  const rendered = renderTikzToSvg(source, options);
  const elements = rendered.semantic.scene.elements;
  return {
    painted: elements.filter((element) => !covered(element)).map((element) => `${element.sourceRef.sourceSpan.from}-${element.sourceRef.sourceSpan.to} ${shape(element)}`),
    covered: elements.filter(covered).map((element) => `${element.sourceRef.sourceSpan.from}-${element.sourceRef.sourceSpan.to} ${shape(element)}`),
    bounds: rendered.semantic.scene.bounds,
    ids: elements.map((element) => `${element.sourceRef.sourceSpan.from}:${element.id}`),
  };
}

const decks = texFiles(FIXTURES)
  .map((path) => ({ path, source: readFileSync(path, "utf8") }))
  .filter(({ source }) => /\\begin\{tikz(?:picture|layer)\}/u.test(source) && /\\(?:only|uncover|visible|invisible|alt|temporal|onslide|pause)(?![A-Za-z])|\\(?:node|draw|path|fill|filldraw|shade|clip|coordinate|matrix|pic)\s*</u.test(source));

describe("a slide picture on an overlay step", () => {
  it("has fixture decks to check", () => { expect(decks.length).toBeGreaterThan(10); });

  it("draws what blanking the source before parsing drew, on every step of every fixture", () => {
    let pictures = 0, steps = 0;
    for (const { path, source } of decks) {
      const document = scanBeamerDocument(source);
      for (const frame of document.frames) {
        const tikz = frame.children.filter((child) => child.kind === "tikzpicture");
        if (tikz.length === 0) continue;
        const overlays = scanBeamerFrameOverlays(source, frame);
        for (const picture of tikz) {
          const structural = overlays.commands.some((command) => command.commandSpan.from >= picture.span.from && command.commandSpan.from < picture.span.to) ||
            overlays.pauses.some((pause) => pause.span.from >= picture.span.from && pause.span.from < picture.span.to);
          if (!structural) continue;
          pictures += 1;
          const idsByStep: string[][] = [];
          for (let step = 1; step <= overlays.stepCount; step += 1) {
            steps += 1;
            const where = `${path.slice(FIXTURES.length + 1)} @${picture.span.from} step ${step}`;
            const before = drawn(maskTikzPictureSource(projectBeamerTikzSource(source, picture.span, overlays, step), picture.span),
              { parse: { includeContextDefinitions: true } },
              (element) => resolveBeamerOverlaySpanVisibility(overlays, element.sourceRef.sourceSpan, step) === "hidden");
            const pictureStep = beamerTikzStep(source, picture.span, overlays, step);
            const after = drawn(pictureStep.source, { parse: { includeContextDefinitions: true },
              evaluate: pictureStep.overlayVisibility ? { overlayVisibility: pictureStep.overlayVisibility } : {} }, (element) => element.overlayCovered === true);
            expect(after.painted, where).toEqual(before.painted);
            expect(after.covered, where).toEqual(before.covered);
            expect(after.bounds, where).toEqual(before.bounds);
            idsByStep.push(after.ids);
          }
          // An element has one id on every step it is on.
          const idBySpan = new Map<string, string>();
          for (const ids of idsByStep) for (const entry of ids) {
            const [span, id] = [entry.slice(0, entry.indexOf(":")), entry.slice(entry.indexOf(":") + 1)];
            void span;
            expect(idBySpan.get(id) ?? entry, path).toBe(entry);
            idBySpan.set(id, entry);
          }
        }
      }
    }
    expect(pictures).toBeGreaterThan(5);
    expect(steps).toBeGreaterThan(pictures);
  });
});

describe("overlay syntax in a picture", () => {
  const picture = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;

  it("parses specifications on path commands where PGF reads them", () => {
    for (const [body, raw] of [
      [String.raw`\node<2-> at (0,0) {A};`, "2-"], [String.raw`\draw<3>[red] (0,0) -- (1,1);`, "3"], [String.raw`\path[draw]<2-4> (0,0) -- (1,1);`, "2-4"],
      [String.raw`\coordinate<+-> (a) at (0,0);`, "+-"], [String.raw`\pic<2> at (0,0) {x};`, "2"], [String.raw`\useasboundingbox<2> (0,0) rectangle (1,1);`, "2"],
    ] as const) {
      const parsed = parseTikz(picture(body));
      expect(parsed.diagnostics, body).toEqual([]);
      const statement = parsed.figure.body[0];
      expect(statement.kind === "Path" && statement.overlay?.raw, body).toBe(raw);
    }
  });

  it("reads an overlay command's bodies as siblings that name it", () => {
    const source = picture(String.raw`\draw (0,0) -- (1,0);
\alt<2>{\draw (0,0) -- (1,1); \node {x};}{\fill (2,2) circle (1);}
\onslide<3->{\draw (5,5) -- (6,6);}
\draw (9,9) -- (8,8);`);
    const parsed = parseTikz(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.figure.body.map((statement) => [statement.id, statement.overlayGroups?.map((group) => `${group.groupId}/${group.branch}`).join(",") ?? ""])).toEqual([
      ["path:0", ""], ["overlay-group:1", ""], ["path:2", "overlay-group:1/0"], ["path:3", "overlay-group:1/0"], ["path:4", "overlay-group:1/1"],
      ["overlay-group:5", ""], ["path:6", "overlay-group:5/0"], ["path:7", ""],
    ]);
    const head = parsed.figure.body[1];
    expect(head.kind === "OverlayGroup" && [head.command, head.spec.raw, source.slice(head.span.from, head.span.to), head.branches.length]).toEqual(["alt", "2", String.raw`\alt<2>`, 2]);
    const onslide = parsed.figure.body[5];
    expect(onslide.kind === "OverlayGroup" && onslide.command).toBe("onslide");
  });

  it("nests overlay commands, outermost first", () => {
    const parsed = parseTikz(picture(String.raw`\only<2>{\uncover<3>{\draw (0,0) -- (1,1);}}`));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.figure.body.map((statement) => statement.overlayGroups?.map((group) => group.groupId))).toEqual([undefined, ["overlay-group:0"], ["overlay-group:0", "overlay-group:1"]]);
  });

  it("reads declarations, and leaves the statement after them alone", () => {
    const parsed = parseTikz(picture(String.raw`\pause
\draw (0,0) -- (1,1);
\pause[4]\draw (1,1) -- (2,2);
\onslide<2->
\draw (2,2) -- (3,3);
\onslide*<3>
\onslide
\draw (3,3) -- (4,4);`));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.figure.body.map((statement) => statement.kind === "OverlayDeclaration"
      ? `${statement.command}${statement.modifier ?? ""}${statement.spec ? `<${statement.spec.raw}>` : ""}${statement.countRaw ? `[${statement.countRaw}]` : ""}` : statement.kind)).toEqual(
      ["pause", "Path", "pause[4]", "Path", "onslide<2->", "Path", "onslide*<3>", "onslide", "Path"]);
  });

  it("matches whole command names, and leaves node text and options alone", () => {
    const parsed = parseTikz(picture(String.raw`\node[alt=<2>{red}{blue}] at (0,0) {\only<2>{x} $a<b>c$ \pause y};
\altitude;`));
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Path", "UnknownStatement"]);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("skips a removed statement whole and covers a hidden one", () => {
    const source = picture(String.raw`\node (a) at (0,0) {A};
\node<2-> (b) at (4,0) {B};
\uncover<2->{\draw (a) -- (2,2);}
\draw (a) -- (b);`);
    const visibility = (step: number) => (span: { from: number; to: number }) => {
      const text = source.slice(span.from, span.to);
      return step >= 2 ? "visible" : text.includes("(b) at") ? "removed" : text.includes("(2,2)") ? "hidden" : "visible";
    };
    const first = renderTikzToSvg(source, { evaluate: { overlayVisibility: visibility(1) } });
    const second = renderTikzToSvg(source, { evaluate: { overlayVisibility: visibility(2) } });
    expect(second.semantic.scene.elements.filter((element) => element.overlayCovered)).toEqual([]);
    expect(first.semantic.scene.elements.filter((element) => element.overlayCovered).map((element) => element.id)).toEqual(
      second.semantic.scene.elements.filter((element) => element.sourceRef.sourceSpan.from === source.indexOf(String.raw`\draw (a) -- (2,2)`)).map((element) => element.id));
    // The removed node's name is not defined on step 1.
    expect(first.semantic.diagnostics.some((diagnostic) => /\bb\b/u.test(diagnostic.message))).toBe(true);
    expect(second.semantic.diagnostics).toEqual([]);
    // Elements keep their ids across steps.
    const ids = (result: typeof first) => new Set(result.semantic.scene.elements.map((element) => element.id));
    for (const id of ids(first)) expect(ids(second).has(id)).toBe(true);
    // A covered element counts towards the picture's size; a removed one does not.
    expect(first.semantic.scene.bounds!.maxY).toBeCloseTo(second.semantic.scene.bounds!.maxY, 6);
    expect(first.semantic.scene.bounds!.maxX).toBeLessThan(second.semantic.scene.bounds!.maxX);
  });
});

describe("pictures on a slide, by step", () => {
  const DECK = String.raw`\documentclass{beamer}
\usepackage{tikz}
${BEAMER_TIKZ_LAYER_DEFINITION}
\begin{document}
\begin{frame}{T}
Text.

\begin{tikzpicture}
\node (a) at (0,0) {A};
\node<2-> (b) at (2,0) {B};
\only<3>{\draw (a) -- (b);}
\uncover<2->{\node (c) at (4,0) {C};}
\end{tikzpicture}
\begin{tikzlayer}
\node<3> at (3,3) {L};
\pattern<2->[pattern=dots] (0,0) rectangle (1,1);
\end{tikzlayer}
\end{frame}
\end{document}`;
  let requests = 0;
  const steps = async (activeRootId: string) => {
    const result = [];
    for (const deckStep of [1, 2, 3]) {
      const response = await computeSnapshot({ id: `overlay-step-${++requests}`, documentId: "overlay-step", source: DECK, activeRootId, deckStep, sourceRevision: 1 });
      expect(response.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), `step ${deckStep}`).toEqual([]);
      result.push(response.snapshot);
    }
    return result;
  };
  const texts = (elements: readonly { kind: string }[]) =>
    elements.flatMap((element) => element.kind === "Text" && "text" in element && typeof element.text === "string" ? [element.text] : []);

  it("counts a layer's specifications in the frame's steps", () => {
    const document = scanBeamerDocument(DECK);
    expect(scanBeamerFrameOverlays(DECK, document.frames[0]).stepCount).toBe(3);
  });

  it("gives the picture's edit snapshot the statements the slide shows, with one id each", async () => {
    const byStep = await steps("frame:0:tikzpicture:0");
    const elements = byStep.map((step) => step.scene!.elements);
    expect(elements.map((scene) => texts(scene))).toEqual([["A", "C"], ["A", "B", "C"], ["A", "B", "C"]]);
    expect(elements.map((scene) => scene.filter((element) => element.overlayCovered).length)).toEqual([1, 0, 0]);
    expect(elements.map((scene) => scene.filter((element) => element.kind === "Path").length)).toEqual([0, 0, 1]);
    const ids = elements.map((scene) => new Set(scene.map((element) => element.id)));
    for (const id of ids[0]) expect(ids[2].has(id)).toBe(true);
    for (const id of ids[1]) expect(ids[2].has(id)).toBe(true);
  });

  it("evaluates an edit on the picture as its snapshot's step shows it", async () => {
    const [first, , third] = await steps("frame:0:tikzpicture:0");
    const picture = scanBeamerDocument(DECK).frames[0]!.children.find((child) => child.kind === "tikzpicture")!;
    expect(third!.pictureOverlayStep ?? null).toBeNull();
    expect(first!.pictureOverlayStep).toEqual({ frameIndex: 0, step: 1 });
    const { overlayVisibility } = pictureOverlayVisibility(DECK, picture.span, first!.pictureOverlayStep);
    const at = (text: string) => ({ from: DECK.indexOf(text), to: DECK.indexOf(";", DECK.indexOf(text)) + 1 });
    expect([String.raw`\node (a)`, String.raw`\node<2-> (b)`, String.raw`\draw (a) -- (b)`, String.raw`\node (c)`].map((text) => overlayVisibility!(at(text), [])))
      .toEqual(["visible", "removed", "removed", "hidden"]);
    expect(pictureOverlayVisibility(DECK, picture.span, null)).toEqual({});

    // Moving the node that is there edits its coordinate, on the step that hides others.
    const moved = executeDocumentEdit({ documentId: "overlay-step", source: DECK, sourceRevision: 1, activeRootId: "frame:0:tikzpicture:0", snapshot: first! },
      { kind: "moveElements", elementIds: first!.scene!.elements.filter((element) => element.kind === "Text" && element.text === "A").map((element) => element.sourceRef.sourceId),
        delta: worldPoint(pt(28.4527559055), pt(0)) });
    expect(moved.kind === "unsupported" ? moved.reason : moved.kind).toBe("success");
    expect(moved.kind === "success" && moved.newSource).toBe(DECK.replace(String.raw`\node (a) at (0,0)`, String.raw`\node (a) at (1,0)`));
  });

  it("gives the drawing layer's edit snapshot the statements of its step", async () => {
    const byStep = await steps("frame:0:overlay:0");
    expect(byStep.map((step) => texts(step.scene!.elements))).toEqual([[], [], ["L"]]);
    expect(byStep.map((step) => step.scene!.elements.filter((element) => element.kind === "Path").length)).toEqual([0, 1, 1]);
  });
});

describe("incremental parsing with overlay syntax", () => {
  const before = `\\begin{tikzpicture}
\\draw (0,0) -- (1,0);
\\only<2->{\\draw (0,0) -- (1,1); \\node at (2,2) {x};}
\\node<3> at (4,4) {y};
\\pause
\\draw (5,5) -- (6,6);
\\end{tikzpicture}`;

  it.each([["(1,1)", "(1.5,1)"], ["(2,2)", "(2,3)"], ["(4,4)", "(4,5)"], ["(6,6)", "(7,6)"]])("re-parses a statement whose %s becomes %s as a full parse does", (from, to) => {
    const session = createIncrementalParseSession();
    session.evaluate({ source: before, sourceRevision: 1 });
    const after = before.replace(from, to);
    const result = session.evaluate({ source: after, sourceRevision: 2, inferChanges: true });
    expect(result.stats.strategy).toBe("incremental");
    expect(result.parse.figure.body).toEqual(parseTikz(after).figure.body);
    expect(result.parse.diagnostics).toEqual([]);
  });

  it("parses the whole picture again when an overlay command's own text changes", () => {
    const session = createIncrementalParseSession();
    session.evaluate({ source: before, sourceRevision: 1 });
    const after = before.replace("\\only<2->", "\\only<3->");
    const result = session.evaluate({ source: after, sourceRevision: 2, inferChanges: true });
    expect(result.parse.figure.body).toEqual(parseTikz(after).figure.body);
  });
});

describe("declarations in a picture, against LuaLaTeX", () => {
  // Each frame's visible words per step are what `pdftotext` reads from the
  // pages LuaLaTeX sets (TeX Live 2025), with Beamer's default invisible cover.
  const frame = (body: string) => String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}
${body}
\end{frame}
\end{document}`;
  const shown = (source: string): string[] => {
    const document = scanBeamerDocument(source);
    const overlays = scanBeamerFrameOverlays(source, document.frames[0]);
    const words = [...source.matchAll(/\{([A-Z][0-9])\};|^([A-Z]{2,})$/gmu)].map((match) => ({ word: match[1] ?? match[2], at: match.index }));
    const statement = (at: number) => {
      const from = source.lastIndexOf(String.raw`\node`, at);
      return source.slice(from, at).includes("\n") || from < 0 ? { from: at, to: at + 2 } : { from, to: source.indexOf(";", at) + 1 };
    };
    return Array.from({ length: overlays.stepCount }, (_, index) =>
      words.filter(({ at }) => resolveBeamerOverlaySpanVisibility(overlays, statement(at), index + 1) === "visible").map(({ word }) => word).join(" "));
  };

  it("ends a pause with its scope, and resumes the pause before it", () => {
    expect(shown(frame(String.raw`FRAMEA
\begin{tikzpicture}
\node at (0,0) {A1};
\pause
\node at (1,0) {A2};
\begin{scope}
\pause
\node at (2,0) {A3};
\end{scope}
\node at (3,0) {A4};
\end{tikzpicture}
AFTERA`))).toEqual(["FRAMEA A1 AFTERA", "FRAMEA A1 A2 A4 AFTERA", "FRAMEA A1 A2 A3 A4 AFTERA"]);
  });

  it("lets an onslide in an inner scope override the one outside, which resumes after it", () => {
    expect(shown(frame(String.raw`FRAMEB
\begin{tikzpicture}
\node at (0,0) {B1};
\onslide<3->
\node at (1,0) {B2};
\begin{scope}
\onslide<2->
\node at (2,0) {B3};
\end{scope}
\node at (3,0) {B4};
\end{tikzpicture}
AFTERB`))).toEqual(["FRAMEB B1 AFTERB", "FRAMEB B1 B3 AFTERB", "FRAMEB B1 B2 B3 B4 AFTERB"]);
  });

  it("lets the latest declaration win between pauses and onslide", () => {
    expect(shown(frame(String.raw`FRAMEC
\begin{tikzpicture}
\onslide<3->
\node at (1,0) {C1};
\begin{scope}
\pause
\node at (2,0) {C2};
\end{scope}
\node at (3,0) {C3};
\end{tikzpicture}`))).toEqual(["FRAMEC", "FRAMEC C2", "FRAMEC C1 C2 C3"]);
    expect(shown(frame(String.raw`FRAMED
\begin{tikzpicture}
\pause
\pause
\node at (1,0) {D1};
\begin{scope}
\onslide<1->
\node at (2,0) {D2};
\onslide<2->
\node at (2,1) {D3};
\end{scope}
\node at (3,0) {D4};
\end{tikzpicture}`))).toEqual(["FRAMED D2", "FRAMED D2 D3", "FRAMED D1 D2 D3 D4"]);
  });

  it("keeps a pause before the picture in force after a pause in one of its scopes", () => {
    // TeX also shows the text after the last pause on step 2, a Beamer quirk not followed here.
    expect(shown(frame(String.raw`FRAMEE
\pause
TEXTE
\begin{tikzpicture}
\node at (0,0) {E1};
\begin{scope}
\pause
\node at (2,0) {E2};
\end{scope}
\node at (3,0) {E3};
\end{tikzpicture}
MOREE`))).toEqual(["FRAMEE", "FRAMEE TEXTE E1 E3 MOREE", "FRAMEE TEXTE E1 E2 E3 MOREE"]);
  });
});

describe("overlay operations a loop performs, against LuaLaTeX", () => {
  const deck = (body: string) => String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}
\begin{tikzpicture}
${body}
\end{tikzpicture}
\end{frame}
\end{document}`;
  /** The node texts the picture shows on each step, sorted. */
  const shownBySteps = (source: string): string[] => {
    const document = scanBeamerDocument(source);
    const frame = document.frames[0];
    const overlays = scanBeamerFrameOverlays(source, frame);
    const picture = frame.children.find((child) => child.kind === "tikzpicture")!;
    return Array.from({ length: overlays.stepCount }, (_, index) => {
      const step = beamerTikzStep(source, picture.span, overlays, index + 1);
      const rendered = renderTikzToSvg(step.source, { evaluate: step.overlayVisibility ? { overlayVisibility: step.overlayVisibility } : {} });
      expect(rendered.parse.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      return rendered.semantic.scene.elements.flatMap((element) => element.kind === "Text" && !element.overlayCovered ? [element.text] : []).sort().join(" ");
    });
  };

  it("resolves a specification once per iteration, from the loop's values", () => {
    expect(shownBySteps(deck(String.raw`\foreach \x in {1,2,3} { \node<\x-> at (\x,0) {R\x}; }`))).toEqual(["R1", "R1 R2", "R1 R2 R3"]);
  });

  it("counts a pause in a loop once per iteration, each covering what runs after it", () => {
    expect(shownBySteps(deck(String.raw`\foreach \x in {1,2,3} { \node<\x-> at (\x,0) {R\x}; }
\foreach \x in {1,2} { \pause \node at (\x,1) {S\x}; }`))).toEqual(["R1", "R1 R2 S1", "R1 R2 R3 S1 S2"]);
  });

  it("covers what follows a pausing loop until its scope ends", () => {
    expect(shownBySteps(deck(String.raw`\node at (0,0) {A};
\begin{scope}
\foreach \x in {1,2} { \node at (\x,1) {B\x}; \pause }
\node at (5,5) {C};
\end{scope}
\node at (6,6) {D};`))).toEqual(["A B1 D", "A B1 B2 D", "A B1 B2 C D"]);
  });

  it("resolves nested loops by their own variables", () => {
    expect(shownBySteps(deck(String.raw`\foreach \x in {1,2} { \foreach \y in {1,2} { \node<\y> at (\x,\y) {N\x\y}; } }`))).toEqual(["N11 N21", "N12 N22"]);
  });

  it("gives one Overlays row to a loop's specification, not editable as a number", () => {
    const source = deck(String.raw`\foreach \x in {1,2,3} { \node<\x-> at (\x,0) {R\x}; }`);
    const model = buildBeamerBuildModel(source, "frame:0")!;
    expect(model.stepCount).toBe(3);
    expect(model.rows.map((row) => [row.id, row.editable])).toEqual([[`command:${source.indexOf(String.raw`\node<\x->`)}`, false]]);
  });
});

describe("the overlay rule of a shape", () => {
  const deck = (body: string) => String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}
\begin{tikzpicture}
${body}
\end{tikzpicture}
\end{frame}
\end{document}`;
  const statement = (source: string, text: string) => ({ from: source.indexOf(text), to: source.indexOf(";", source.indexOf(text)) + 1 });
  const apply = (source: string, patches: readonly { oldSpan: { from: number; to: number }; replacement: string }[]) =>
    [...patches].sort((a, b) => b.oldSpan.from - a.oldSpan.from).reduce((text, patch) => text.slice(0, patch.oldSpan.from) + patch.replacement + text.slice(patch.oldSpan.to), source);

  it("names shape rows by what they draw", () => {
    const source = deck(String.raw`\node<2->[draw] (a) at (0,0) {Alpha $x$};
\draw<3>[red] (0,0) -- (1,1);
\coordinate<2> (c) at (1,1);`);
    expect(buildBeamerBuildModel(source, "frame:0")!.rows.map((row) => row.label)).toEqual(
      ["Node · Alpha $x$", "Path · (0,0) -- (1,1)", "Coordinate · (c) at (1,1)"]);
  });

  it("writes a new specification straight after the command's name", () => {
    const source = deck(String.raw`\node[draw] (a) at (0,0) {A};
\draw (0,0) -- (1,1);`);
    const model = buildBeamerBuildModel(source, "frame:0")!;
    const node = beamerStatementOverlayTarget(model, statement(source, String.raw`\node[draw]`));
    expect([node.canSet, node.row, node.removePatches]).toEqual([true, null, []]);
    expect(apply(source, [node.setSpec("2-")!])).toBe(source.replace(String.raw`\node[draw]`, String.raw`\node<2->[draw]`));
    const path = beamerStatementOverlayTarget(model, statement(source, String.raw`\draw (0,0)`));
    expect(apply(source, [path.setSpec("3")!])).toBe(source.replace(String.raw`\draw (0,0)`, String.raw`\draw<3> (0,0)`));
    expect(node.setSpec("+-")).toBeNull();
  });

  it("changes and removes a shape's own specification in place", () => {
    const source = deck(String.raw`\node<2-> (a) at (0,0) {A};`);
    const model = buildBeamerBuildModel(source, "frame:0")!;
    const target = beamerStatementOverlayTarget(model, statement(source, String.raw`\node<2->`));
    expect(target.row?.id).toBe(`command:${source.indexOf(String.raw`\node<2->`)}`);
    expect(apply(source, [target.setSpec("3-4")!])).toBe(source.replace("<2->", "<3-4>"));
    expect(apply(source, target.removePatches)).toBe(source.replace("<2->", ""));
  });

  it("offers the owner of a shared rule and does not retime the shape", () => {
    const source = deck(String.raw`\only<2->{\node (a) at (0,0) {A}; \node (b) at (1,0) {B};}
\pause
\draw (0,0) -- (1,1);
\foreach \x in {1,2} { \node<\x-> at (\x,0) {L}; }`);
    const model = buildBeamerBuildModel(source, "frame:0")!;
    const grouped = beamerStatementOverlayTarget(model, statement(source, String.raw`\node (a)`));
    expect([grouped.canSet, grouped.row?.id, grouped.setSpec("3")]).toEqual([false, `command:${source.indexOf(String.raw`\only<2->`)}`, null]);
    const paused = beamerStatementOverlayTarget(model, statement(source, String.raw`\draw (0,0)`));
    expect([paused.canSet, paused.row?.kind]).toEqual([false, "pause"]);
    const looped = beamerStatementOverlayTarget(model, statement(source, String.raw`\node<\x->`));
    expect([looped.canSet, looped.removePatches]).toEqual([false, []]);
  });
});

describe("a selected Overlays row for a shape", () => {
  it("points at what the shape draws on the slide, on the steps it is there", async () => {
    const source = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}
\begin{tikzpicture}
\draw (0,0) rectangle (4,2);
\node<2-> at (1,1) {B};
\end{tikzpicture}
\end{frame}
\end{document}`;
    const span = { from: source.indexOf(String.raw`\node<2->`), to: source.indexOf(";", source.indexOf(String.raw`\node<2->`)) + 1 };
    const prepared = prepareBeamerDocument(source);
    const rects = async (step: number) => buildSelectionRects((await prepared.renderFrame({ frameIndex: 0, step })).layout, source, [span]);
    expect(await rects(1)).toEqual([]);
    const [rect, ...others] = await rects(2);
    expect(others).toEqual([]);
    const picture = (await prepared.renderFrame({ frameIndex: 0, step: 2 })).layout.embeddedTikz[0]!.bounds;
    // The node sits left of centre in the 4cm × 2cm rectangle, inside the picture.
    expect(rect!.x).toBeGreaterThan(picture.x);
    expect(rect!.x + rect!.width).toBeLessThan(picture.x + picture.width / 2);
    expect(rect!.y).toBeGreaterThan(picture.y);
    expect(rect!.y + rect!.height).toBeLessThan(picture.y + picture.height);
    expect(Math.abs(rect!.y + rect!.height / 2 - (picture.y + picture.height / 2))).toBeLessThan(2);
  });
});
