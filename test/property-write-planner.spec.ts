import { describe, expect, it } from "vitest";
import {
  applyPlannedSetPropertyAction,
  cleanupIdiomaticPropertyWrites,
  planPropertyWrite,
  PROPERTY_WRITE_CLEANUP_NOOP_REASON
} from "../packages/core/src/edit/property-write-planner.js";
import {
  buildArrowTipSetPropertyMutation,
  buildPathMorphingDecorationSetPropertyMutations
} from "../packages/core/src/edit/property-write-builders.js";

function expectSuccessSource(
  result: ReturnType<typeof applyPlannedSetPropertyAction>,
  expectedSource: string
): void {
  expect(result.kind).toBe("success");
  if (result.kind !== "success") {
    return;
  }
  expect(result.newSource).toBe(expectedSource);
}

describe("property write planner", () => {
  it("keeps unsupported conservative writes as the selected result", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const plan = planPropertyWrite({
      source,
      action: {
        elementId: "missing",
        key: "draw",
        value: "red"
      }
    });

    expect(plan.conservative).toEqual(plan.selected);
    expect(plan.selected).toMatchObject({ kind: "unsupported" });
    expect(plan.certificates).toEqual([]);
  });

  it("uses conservative writes for preview, drag-frame, and comment interactions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue] (0,0) -- (1,0);
\end{tikzpicture}`;

    const preview = planPropertyWrite({
      source,
      mode: "preview",
      action: {
        elementId: "path:0",
        key: "draw",
        value: "none"
      }
    });
    expect(preview.selected).toEqual(preview.conservative);
    expect(preview.certificates).toEqual([]);

    const dragFrame = planPropertyWrite({
      source,
      parseOptions: { propertyWriteMode: "drag-frame" },
      action: {
        elementId: "path:0",
        key: "draw",
        value: "none"
      }
    });
    expect(dragFrame.selected).toEqual(dragFrame.conservative);

    const comment = planPropertyWrite({
      source,
      action: {
        elementId: "path:0",
        key: "draw",
        value: "blue",
        commentMode: "disable",
        commentSourceText: "blue"
      }
    });
    expect(comment.selected).toEqual(comment.conservative);
  });

  it("returns the conservative result when no cleanup candidate applies", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const plan = planPropertyWrite({
      source,
      action: {
        elementId: "path:0",
        key: "line width",
        value: "2pt"
      }
    });

    expect(plan.selected).toEqual(plan.conservative);
    expect(plan.certificates).toEqual([]);
  });

  it("cleans no-options paint commands and reports explicit changed ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyPlannedSetPropertyAction(source, {
      elementId: "path:0",
      key: "draw",
      value: "none"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\path (0,0) -- (1,0);");
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("omits explicit no-arrow defaults when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red, thick, ->] (0,0) -- (1,0);
\end{tikzpicture}`;
    const mutation = buildArrowTipSetPropertyMutation(
      { startRaw: "", endRaw: ">", clearKeys: ["arrows", "-", "->", "<-", "<->"] },
      "end",
      "none"
    );

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        ...mutation
      }),
      String.raw`\begin{tikzpicture}
  \draw[red, thick] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("keeps explicit no-arrow overrides when inherited arrows would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[->]
  \draw[->] (0,0) -- (1,0);
\end{tikzpicture}`;
    const mutation = buildArrowTipSetPropertyMutation(
      { startRaw: "", endRaw: ">", clearKeys: ["arrows", "-", "->", "<-", "<->"] },
      "end",
      "none"
    );

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        ...mutation
      }),
      String.raw`\begin{tikzpicture}[->]
  \draw[-] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("does not omit arrow options when only one side returns to default", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[<->] (0,0) -- (1,0);
\end{tikzpicture}`;
    const mutation = buildArrowTipSetPropertyMutation(
      { startRaw: "<", endRaw: ">", clearKeys: ["arrows", "-", "->", "<-", "<->"] },
      "start",
      "none"
    );

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        ...mutation
      }),
      String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("omits explicit disabled decorations when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red, thick, decorate, decoration=snake] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [mutation] = buildPathMorphingDecorationSetPropertyMutations("none");

    expect(mutation).toBeDefined();
    if (!mutation) {
      return;
    }

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        ...mutation
      }),
      String.raw`\begin{tikzpicture}
  \draw[red, thick] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("keeps explicit disabled decorations when inherited decorations would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[decorate, decoration=snake]
  \draw[decorate, decoration=coil] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [mutation] = buildPathMorphingDecorationSetPropertyMutations("none");

    expect(mutation).toBeDefined();
    if (!mutation) {
      return;
    }

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        ...mutation
      }),
      String.raw`\begin{tikzpicture}[decorate, decoration=snake]
  \draw[decorate=false] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("exercises disabled draw/fill cleanup rewrites for each paint command target", () => {
    const invisibleDraw = cleanupIdiomaticPropertyWrites(String.raw`\begin{tikzpicture}
  \draw[draw=false, fill=false] (0,0) rectangle (1,1);
\end{tikzpicture}`);
    expect(invisibleDraw).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });

    const fillOnly = cleanupIdiomaticPropertyWrites(String.raw`\begin{tikzpicture}
  \draw[draw=false, fill=red] (0,0) rectangle (1,1);
\end{tikzpicture}`);
    expect(fillOnly).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });

    const drawOnly = cleanupIdiomaticPropertyWrites(String.raw`\begin{tikzpicture}
  \filldraw[draw=blue, fill=false] (0,0) rectangle (1,1);
\end{tikzpicture}`);
    expect(drawOnly).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
  });

  it("does not try paint-command cleanup for non-paint path commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \clip[draw=none] (0,0) rectangle (1,1);
\end{tikzpicture}`;

    const plan = planPropertyWrite({
      source,
      action: {
        elementId: "path:0",
        key: "draw",
        value: "red"
      }
    });

    expect(plan.selected).toEqual(plan.conservative);
  });

  it("handles bare draw and fill flags while considering paint cleanup", () => {
    for (const source of [
      String.raw`\begin{tikzpicture}
  \path[draw] (0,0) -- (1,0);
\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}
  \path[fill] (0,0) rectangle (1,1);
\end{tikzpicture}`
    ]) {
      expect(cleanupIdiomaticPropertyWrites(source)).toEqual({
        kind: "unsupported",
        reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
      });
    }
  });

  it("treats whitespace-only targeted cleanup as a no-op", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(cleanupIdiomaticPropertyWrites(source, {}, [" ", "\t"])).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
  });
});
