import { describe, expect, it } from "vitest";
import {
  beamerBuildSpecPatch, beamerBuildStateAt, buildBeamerBuildModel,
  firstVisibleBeamerBuildStep, isExplicitBeamerBuildSpec, reconcileBeamerBuildRow,
  renderBeamerFramePages, scanBeamerDocument,
  beamerBuildTimingPatch, beamerBuildBoundaryPatch, beamerBuildRange,
} from "../packages/core/src/beamer/index.js";
import { buildSelectionRects } from "../packages/app/src/ui/builds-panel/build-selection.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";

const deck = (body: string) => String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Builds}
${body}
\end{frame}
\end{document}`;
function modelFor(source: string) {
  return buildBeamerBuildModel(source, scanBeamerDocument(source).frames[0].id)!;
}
function rowFor(model: ReturnType<typeof modelFor>, label: string) {
  const row = model.rows.find((entry) => entry.label === label);
  expect(row, label).toBeDefined();
  return row!;
}

describe("source-backed Beamer builds", () => {
  it("sets numeric timing without changing content, comments, or other rules", () => {
    const source = deck(String.raw`% Keep me.
\only<1,3-4>{Target} \uncover<2->{Other}`);
    const model = modelFor(source);
    const row = model.rows[0];
    for (const [action, value] of [["from", "3-"], ["only", "3"], ["through", "-3"]] as const) {
      const patch = beamerBuildTimingPatch(model, row.id, action, 3)!;
      expect(source.slice(0, patch.oldSpan.from) + patch.replacement + source.slice(patch.oldSpan.to)).toBe(source.replace("<1,3-4>", `<${value}>`));
    }
  });

  it("moves a single interval boundary without crossing or inventing an open end", () => {
    const model = modelFor(deck(String.raw`\only<2-4>{Closed}\only<2->{Open}\only<-4>{Until}\only<2>{Single}`));
    expect(beamerBuildBoundaryPatch(model, model.rows[0].id, "start", 9)?.replacement).toBe("4");
    expect(beamerBuildBoundaryPatch(model, model.rows[0].id, "end", 1)?.replacement).toBe("2");
    expect(beamerBuildBoundaryPatch(model, model.rows[1].id, "start", 3)?.replacement).toBe("3-");
    expect(beamerBuildBoundaryPatch(model, model.rows[1].id, "end", 4)).toBeNull();
    expect(beamerBuildBoundaryPatch(model, model.rows[2].id, "end", 5)?.replacement).toBe("-5");
    expect(beamerBuildBoundaryPatch(model, model.rows[2].id, "start", 2)?.replacement).toBe("2-4");
    expect(beamerBuildBoundaryPatch(model, model.rows[3].id, "end", 4)?.replacement).toBe("2-4");
    expect(beamerBuildBoundaryPatch(model, model.rows[0].id, "start", 2)).toBeNull();
    expect(beamerBuildBoundaryPatch(model, model.rows[0].id, "end", NaN)).toBeNull();
  });

  it("does not apply visibility shortcuts to relative, inherited, inverted or branching rules", () => {
    const model = modelFor(deck(String.raw`\only<+->{Relative}\invisible<2>{Inverse}\alt<2>{First}{Second}
\begin{itemize}[<2->]\item Inherited\end{itemize}`));
    for (const row of model.rows.filter((entry) => entry.kind !== "list")) {
      expect(beamerBuildTimingPatch(model, row.id, "from", 3)).toBeNull();
      expect(beamerBuildRange(row)).toBeNull();
    }
    const shared = model.rows.find((row) => row.kind === "list")!;
    expect(beamerBuildTimingPatch(model, shared.id, "from", 3)?.replacement).toBe("3-");
    const disjoint = modelFor(deck(String.raw`\only<1,3>{Disjoint}`));
    expect(beamerBuildRange(disjoint.rows[0])).toBeNull();
  });

  it("labels source content and keeps disappearing content in the inventory", () => {
    const model = modelFor(deck(String.raw`\begin{itemize}
\item<2-> Second point
\end{itemize}
\only<1>{\begin{block}{Early result}Proof.\end{block}}
\only<3>{\includegraphics[width=.4\textwidth]{figures/chart.pdf}}`));
    expect(model.rows.map((row) => row.label)).toEqual(["Bullet · Second point", "Block · Early result", "Image · chart.pdf"]);
    const block = rowFor(model, "Block · Early result");
    expect([1, 2, 3].map((step) => beamerBuildStateAt(model, block, step).label)).toEqual(["Visible", "Absent", "Absent"]);
    expect(beamerBuildStateAt(model, rowFor(model, "Bullet · Second point"), 1).label).toBe("Covered");
    expect(model.rows).toHaveLength(3);
  });

  it("shows nested effective rules and preserves their distinct owners", async () => {
    const source = deck(String.raw`\begin{uncoverenv}<3->
\begin{onlyenv}<2>
Explanation
\end{onlyenv}
\end{uncoverenv}`);
    const model = modelFor(source);
    expect(model.rows).toHaveLength(2);
    const inner = model.rows[1];
    expect(inner.parentId).toBe(model.rows[0].id);
    expect(inner.spec?.source.value).toBe("2");
    expect([1, 2, 3].map((step) => beamerBuildStateAt(model, inner, step).label)).toEqual(["Absent", "Covered", "Absent"]);
    expect(firstVisibleBeamerBuildStep(model, inner)).toBeNull();
    const rendered = await renderBeamerFramePages(source);
    expect(rendered.stepCount).toBe(3);
    expect(rendered.pages.every((page) => buildNativeBeamerPageTrace(page, computerModernTexMetricProvider)
      .lines.every((line) => !line.text.includes("Explanation")))).toBe(true);
  });

  it("groups inherited list rules without pretending each child owns the default", () => {
    const model = modelFor(deck(String.raw`\begin{itemize}[<+->]
\item Alpha
\item Beta
\item<5-> Explicit
\end{itemize}`));
    const group = model.rows[0];
    expect(group.kind).toBe("list");
    const alpha = rowFor(model, "Bullet · Alpha");
    const beta = rowFor(model, "Bullet · Beta");
    expect(alpha).toMatchObject({ parentId: group.id, provenance: "list-default", editable: false });
    expect(beta.spec?.resolved).toBe("2-");
    expect(beta.ruleSpan).toEqual(group.ruleSpan);
    expect(beamerBuildSpecPatch(model, beta.id, "4-")).toBeNull();
    expect(rowFor(model, "Bullet · Explicit").editable).toBe(true);
  });

  it("edits a numeric list default once while keeping item source untouched", () => {
    const source = deck(String.raw`\begin{itemize}[<2->]
\item Alpha
\item Beta
\end{itemize}`);
    const model = modelFor(source);
    const patch = beamerBuildSpecPatch(model, model.rows[0].id, "3-")!;
    const next = source.slice(0, patch.oldSpan.from) + patch.replacement + source.slice(patch.oldSpan.to);
    expect(next).toBe(source.replace("[<2->]", "[<3->]"));
  });

  it("inventories unused list defaults without advancing the overlay counter or adding steps", () => {
    const model = modelFor(deck(String.raw`\begin{itemize}[<+->]\item<1-> Explicit\end{itemize}
\begin{itemize}[<99->]\item<1-> Another\end{itemize}
\only<+->{Later}`));
    const defaults = model.rows.filter(row => row.kind === "list");
    expect(defaults.map(row => row.spec?.source.value)).toEqual(["+-", "99-"]);
    expect(defaults.map(row => row.editable)).toEqual([false, true]);
    expect(rowFor(model, "Text · Later").spec?.resolved).toBe("1-");
    expect(model.stepCount).toBe(1);
  });

  it("models alternatives and temporal branches with their actual active content", () => {
    const model = modelFor(deck(String.raw`\alt<2>{During}{Otherwise}
\temporal<2>{Before}{At}{After}`));
    const alt = model.rows[0];
    expect([1, 2, 3].map((step) => beamerBuildStateAt(model, alt, step).label)).toEqual(["Otherwise", "During", "Otherwise"]);
    const temporal = model.rows.find((row) => row.command?.kind === "temporal")!;
    expect([1, 2, 3].map((step) => beamerBuildStateAt(model, temporal, step).label)).toEqual(["Before", "At", "After"]);
    const branch = model.rows.find((row) => row.kind === "branch" && row.parentId === alt.id)!;
    expect(branch.editable).toBe(false);
    expect(beamerBuildStateAt(model, branch, 1).label).toBe("Absent");
  });

  it("preserves disjoint steps, mode selectors and unsupported relative instructions", () => {
    const model = modelFor(deck(String.raw`\only<1,3-4>{Explicit}
\only<+->{Relative}
\only<handout:1|2>{Advanced}
\alert<2>{Highlight}`));
    const explicit = rowFor(model, "Text · Explicit");
    expect([1, 2, 3, 4].map((step) => beamerBuildStateAt(model, explicit, step).label)).toEqual(["Visible", "Absent", "Visible", "Visible"]);
    expect(rowFor(model, "Text · Relative").editable).toBe(false);
    expect([1, 2].map(step => beamerBuildStateAt(model, rowFor(model, "Text · Advanced"), step).label)).toEqual(["Absent", "Visible"]);
    expect(model.rows.at(-1)).toMatchObject({ kind: "unsupported", editable: false });
  });

  it("treats pauses as boundaries, not editable objects", () => {
    const model = modelFor(deck(String.raw`Before.\pause After.`));
    expect(model.rows[0]).toMatchObject({ kind: "pause", editable: false });
    expect(beamerBuildStateAt(model, model.rows[0], 1).label).toBe("Covered");
    expect(beamerBuildStateAt(model, model.rows[0], 2).label).toBe("Visible");
  });

  it("models a supported declaration's covered state until its numeric range begins", () => {
    const model = modelFor(deck(String.raw`\onslide<3-> \only<2->{Content}`));
    expect(beamerBuildStateAt(model, model.rows[1], 2).label).toBe("Covered");
    expect(beamerBuildStateAt(model, model.rows[1], 3).label).toBe("Visible");
  });

  it("does not claim visibility after an unsupported stateful command", () => {
    const model = modelFor(deck(String.raw`\mode<article> \only<2>{Content}`));
    expect(beamerBuildStateAt(model, model.rows[1], 2).label).toBe("Unknown preceding rule");
  });

  it("patches only spec contents and keeps selection through source edits", () => {
    const source = deck(String.raw`% Keep this comment.
\only<2->{First}
\only<1,3>{Second}`);
    const model = modelFor(source);
    const second = rowFor(model, "Text · Second");
    const patch = beamerBuildSpecPatch(model, model.rows[0].id, " 3-5 ")!;
    const nextSource = source.slice(0, patch.oldSpan.from) + patch.replacement + source.slice(patch.oldSpan.to);
    expect(nextSource).toBe(source.replace("<2->", "<3-5>"));
    const next = modelFor(nextSource);
    expect(reconcileBeamerBuildRow(model, second.id, next)?.label).toBe("Text · Second");
    const renamed = modelFor(nextSource.replace("Second", "Renamed"));
    expect(reconcileBeamerBuildRow(next, next.rows[1].id, renamed)?.label).toBe("Text · Renamed");
    const deleted = modelFor(source.replace(String.raw`\only<2->{First}`, ""));
    expect(reconcileBeamerBuildRow(model, model.rows[0].id, deleted)).toBeNull();
  });

  it("does not use duplicate labels as identities", () => {
    const model = modelFor(deck(String.raw`\only<1>{Same}\only<2>{Same}`));
    expect(model.rows[0].label).toBe(model.rows[1].label);
    expect(model.rows[0].id).not.toBe(model.rows[1].id);
  });

  it("handles huge steps without enumerating them", () => {
    const model = modelFor(deck(String.raw`\only<1000000->{Late}`));
    expect(firstVisibleBeamerBuildStep(model, model.rows[0])).toBe(1000000);
  });

  it.each(["", "0", "-", "3-2", "2--4", "2,", "2 3", "+-", "1|2", "2}oops", "9007199254740992"])("rejects invalid numeric edit %s", (value) => {
    expect(isExplicitBeamerBuildSpec(value)).toBe(false);
  });
  it.each(["1", "2-", "-3", "2-4", "1,3-5", " 1, 3 - 5 "])("accepts numeric edit %s", (value) => {
    expect(isExplicitBeamerBuildSpec(value)).toBe(true);
  });

  it("highlights only visible source-backed content", async () => {
    const source = deck(String.raw`Before \only<2>{target phrase} after.`);
    const model = modelFor(source);
    const rendered = await renderBeamerFramePages(source);
    const hidden = beamerBuildStateAt(model, model.rows[0], 1);
    const visible = beamerBuildStateAt(model, model.rows[0], 2);
    expect(buildSelectionRects(rendered.pages[0].layout, source, hidden.contentSpans)).toEqual([]);
    const rects = buildSelectionRects(rendered.pages[1].layout, source, visible.contentSpans);
    expect(rects.length).toBeGreaterThan(0);
    expect(rects.every((rect) => rect.width > 0 && rect.height > 0)).toBe(true);
  });
});
