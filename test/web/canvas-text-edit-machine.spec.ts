import { describe, expect, it } from "vitest";
import { viewportBounds, px } from "../../packages/core/src/coords/index";

import {
  INITIAL_CANVAS_TEXT_EDIT_STATE,
  reduceCanvasTextEdit,
  type CanvasTextEditAction,
  type CanvasTextEditEffect,
  type CanvasTextEditState
} from "../../packages/app/src/ui/canvas-panel/canvas-text-edit-machine";
import type { EditableTextTarget } from "../../packages/app/src/ui/canvas-panel/types";

const BASE_SOURCE = String.raw`\begin{tikzpicture}
  \node at (0,0) {$x$};
\end{tikzpicture}`;

function buildTarget(source: string, text: string): EditableTextTarget {
  const spanFrom = source.indexOf(text);
  if (spanFrom < 0) {
    throw new Error("target text not found in source");
  }
  return {
    sourceId: "node:0",
    sceneTextId: "scene-text:0",
    sourceSpan: { from: spanFrom, to: spanFrom + text.length },
    text,
    renderSourceText: text,
    usesTex: false,
    paragraphId: null,
    layoutKind: "single-line",
    style: {
      align: "left",
      opacity: 1,
      rotate: 0,
      baselineShift: 0,
      textColor: "black",
      font: null,
      widthPt: null,
      anchor: "center",
      isMatrixCell: false,
      matrixCellAnchor: null
    },
    totalWidth: text.length,
    region: {
      key: "region-0",
      shape: "rect",
      sourceId: "node:0",
      targetId: "node:0",
      interactionMode: "text",
      sceneTextId: "scene-text:0",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      cx: 5,
      cy: 5,
      rotation: 0,
      contentWidth: 10,
      contentHeight: 10,
      transform: null
    }
  } as unknown as EditableTextTarget;
}

function reduceMany(state: CanvasTextEditState, actions: CanvasTextEditAction[]): { state: CanvasTextEditState; effectsCount: number } {
  let current = state;
  let effectsCount = 0;
  for (const action of actions) {
    const reduced = reduceCanvasTextEdit(current, action);
    current = reduced.state;
    effectsCount += reduced.effects.length;
  }
  return { state: current, effectsCount };
}

function reduceInputIntent(
  state: CanvasTextEditState,
  inputType: string,
  selectionStart: number,
  selectionEnd: number,
  data: string | null = null
) {
  return reduceCanvasTextEdit(state, {
    type: "textarea_input_intent",
    inputType,
    data,
    selectionStart,
    selectionEnd
  });
}

function buildTargetAtOccurrence(source: string, text: string, occurrence: number): EditableTextTarget {
  let searchFrom = 0;
  let found = -1;
  for (let i = 0; i <= occurrence; i += 1) {
    const index = source.indexOf(text, searchFrom);
    if (index < 0) {
      throw new Error(`target text occurrence ${occurrence} not found`);
    }
    found = index;
    searchFrom = index + 1;
  }
  return {
    ...buildTarget(source, text),
    sourceSpan: { from: found, to: found + text.length }
  };
}

function assertStateInvariants(state: CanvasTextEditState): void {
  if (!state.session) {
    expect(state.selectionOverlay).toBeNull();
    expect(state.compositionRange).toBeNull();
    return;
  }
  expect(state.session.selectionStart).toBeGreaterThanOrEqual(0);
  expect(state.session.selectionEnd).toBeGreaterThanOrEqual(state.session.selectionStart);
  expect(state.session.selectionEnd).toBeLessThanOrEqual(state.session.text.length);
  if (state.compositionRange) {
    expect(state.compositionRange.start).toBeGreaterThanOrEqual(0);
    expect(state.compositionRange.end).toBeGreaterThanOrEqual(state.compositionRange.start);
    expect(state.compositionRange.end).toBeLessThanOrEqual(state.session.text.length);
  }
}

function seedRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function randomInt(rng: () => number, min: number, maxInclusive: number): number {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

describe("canvas text edit machine", () => {
  it("keeps inline typo sessions single-line", () => {
    const target = {
      ...buildTarget(BASE_SOURCE, "$x$"),
      editMode: "inline-typo" as const
    };
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 1,
      selectionEnd: 1,
      historyMergeKey: "merge"
    }).state;

    const pasted = reduceInputIntent(
      started,
      "insertFromPaste",
      1,
      1,
      "two\nlines"
    );
    expect(pasted.state.session?.text).toBe("$x$");
    expect(pasted.effects).toEqual([]);

    const entered = reduceInputIntent(
      started,
      "insertParagraph",
      1,
      1,
      null
    );
    expect(entered.state.session).toBeNull();
    expect(entered.effects).toEqual([]);
  });

  it("closes an inline typo session when its authored span disappears", () => {
    const target = {
      ...buildTarget(BASE_SOURCE, "$x$"),
      editMode: "inline-typo" as const
    };
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 1,
      selectionEnd: 1,
      historyMergeKey: "merge"
    }).state;

    const reconciled = reduceCanvasTextEdit(started, {
      type: "source_reconciled",
      source: BASE_SOURCE,
      sourceRevision: 1,
      target: null
    });

    expect(reconciled.state.session).toBeNull();
    expect(reconciled.state.selectionOverlay).toBeNull();
  });

  it("covers lifecycle start/select/type/delete/close", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 0,
      selectionEnd: 3,
      historyMergeKey: "merge"
    }).state;
    expect(started.session?.text).toBe("$x$");

    const selected = reduceCanvasTextEdit(started, {
      type: "textarea_selection",
      selectionStart: 2,
      selectionEnd: 2
    }).state;
    expect(selected.session?.selectionStart).toBe(2);

    const typed = reduceInputIntent(selected, "insertText", 2, 2, "}");
    expect(typed.state.session?.text).toBe("$x}$");
    expect(typed.effects).toHaveLength(1);

    const deleted = reduceInputIntent(typed.state, "deleteContentBackward", 3, 3);
    expect(deleted.state.session?.text).toBe("$x$");

    const closed = reduceCanvasTextEdit(deleted.state, { type: "session_close" }).state;
    expect(closed.session).toBeNull();
  });

  it("drops stale async pointer/drag resolutions after input revision changes", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const down = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "pointer_down_provisional",
      source: BASE_SOURCE,
      target,
      pointerId: 1,
      selectionStart: 2,
      selectionEnd: 2,
      anchorOffset: 2,
      mode: "char",
      anchorLineRange: null,
      historyMergeKey: "merge"
    }).state;

    const afterInput = reduceInputIntent(down, "insertText", 2, 2, "}").state;

    const stalePointer = reduceCanvasTextEdit(afterInput, {
      type: "pointer_resolved",
      requestRevision: down.asyncRequestRevision,
      baseInputRevision: down.inputRevision,
      sourceId: target.sourceId,
      sceneTextId: target.sceneTextId,
      pointerId: 1,
      selectionStart: 2,
      selectionEnd: 2,
      anchorOffset: 2,
      anchorLineRange: null
    }).state;

    expect(stalePointer.session?.selectionStart).toBe(3);
    expect(stalePointer.session?.selectionEnd).toBe(3);
  });

  it("does not let late pointer resolution overwrite an expanded drag selection", () => {
    const multilineSource = String.raw`\begin{tikzpicture}
  \node[align=center] at (0,0) {First\\Second\\Third};
\end{tikzpicture}`;
    const target = buildTarget(multilineSource, String.raw`First\\Second\\Third`);
    const down = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "pointer_down_provisional",
      source: multilineSource,
      target,
      pointerId: 7,
      selectionStart: 0,
      selectionEnd: 5,
      anchorOffset: 2,
      mode: "line",
      anchorLineRange: { start: 0, end: 5 },
      historyMergeKey: "merge"
    }).state;

    const dragged = reduceCanvasTextEdit(down, {
      type: "drag_resolved",
      requestRevision: down.asyncRequestRevision,
      baseInputRevision: down.inputRevision,
      sourceId: target.sourceId,
      sceneTextId: target.sceneTextId,
      selectionStart: 0,
      selectionEnd: 13
    }).state;
    expect(dragged.session?.selectionEnd).toBe(13);

    const latePointer = reduceCanvasTextEdit(dragged, {
      type: "pointer_resolved",
      requestRevision: down.asyncRequestRevision,
      baseInputRevision: down.inputRevision,
      sourceId: target.sourceId,
      sceneTextId: target.sceneTextId,
      pointerId: 7,
      selectionStart: 0,
      selectionEnd: 5,
      anchorOffset: 2,
      anchorLineRange: { start: 0, end: 5 }
    }).state;

    expect(latePointer.session?.selectionStart).toBe(0);
    expect(latePointer.session?.selectionEnd).toBe(13);
  });

  it("keeps session text and selection stable through invalid source reconciles", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const initial = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    const typed = reduceInputIntent(initial, "insertText", 2, 2, "}").state;

    const invalidRecon = reduceCanvasTextEdit(typed, {
      type: "source_reconciled",
      source: String.raw`\begin{tikzpicture}
  \node at (0,0) {$x}$};
\end{tikzpicture}`,
      sourceRevision: 12,
      target: null
    }).state;

    expect(invalidRecon.session?.text).toBe("$x}$");
    expect(invalidRecon.session?.selectionStart).toBe(3);
  });

  it("reproduces exact regression sequence and returns to original source", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const { state } = reduceMany(INITIAL_CANVAS_TEXT_EDIT_STATE, [
      {
        type: "start_session",
        source: BASE_SOURCE,
        target,
        selectionStart: 2,
        selectionEnd: 2,
        historyMergeKey: "merge"
      },
      {
        type: "textarea_input_intent",
        inputType: "insertText",
        data: "}",
        selectionStart: 2,
        selectionEnd: 2
      },
      {
        type: "source_reconciled",
        source: String.raw`\begin{tikzpicture}
  \node at (0,0) {$x}$};
\end{tikzpicture}`,
        sourceRevision: 1,
        target: null
      },
      {
        type: "source_reconciled",
        source: String.raw`\begin{tikzpicture}
  \node at (0,0) {$x}$};
\end{tikzpicture}`,
        sourceRevision: 2,
        target: null
      },
      {
        type: "textarea_input_intent",
        inputType: "deleteContentBackward",
        data: null,
        selectionStart: 3,
        selectionEnd: 3
      }
    ]);

    expect(state.session?.text).toBe("$x$");
    expect(state.session?.workingSource).toBe(BASE_SOURCE);
    expect(state.session?.selectionStart).toBe(2);
    expect(state.session?.selectionEnd).toBe(2);
  });

  it("does not loop or oscillate on repeated source_reconciled", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    let current = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    for (let i = 0; i < 200; i += 1) {
      current = reduceCanvasTextEdit(current, {
        type: "source_reconciled",
        source: BASE_SOURCE,
        sourceRevision: i + 1,
        target
      }).state;
    }

    expect(current.session?.text).toBe("$x$");
    expect(current.session?.selectionStart).toBe(2);
    expect(current.sourceRevision).toBe(200);
  });

  it("enforces core invariants for selection bounds and session close cleanup", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    let state = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "pointer_down_provisional",
      source: BASE_SOURCE,
      target,
      pointerId: 1,
      selectionStart: -100,
      selectionEnd: 999,
      anchorOffset: 2,
      mode: "char",
      anchorLineRange: null,
      historyMergeKey: "merge"
    }).state;
    assertStateInvariants(state);

    state = reduceCanvasTextEdit(state, {
      type: "textarea_selection",
      selectionStart: -500,
      selectionEnd: 500
    }).state;
    assertStateInvariants(state);

    state = reduceCanvasTextEdit(state, {
      type: "overlay_resolved",
      requestRevision: state.asyncRequestRevision,
      sourceId: target.sourceId,
      selectionStart: 0,
      selectionEnd: 0,
      overlay: {
        sourceId: target.sourceId,
        selectionStart: 0,
        selectionEnd: 0,
        caret: { bounds: viewportBounds(px(0), px(0), px(0), px(1)) },
        rects: []
      }
    }).state;
    expect(state.selectionOverlay).not.toBeNull();
    state = reduceCanvasTextEdit(state, { type: "session_close" }).state;
    expect(state.session).toBeNull();
    expect(state.selectionOverlay).toBeNull();
    expect(state.dragSelection).toBeNull();
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
  });

  it("keeps text and selection unchanged for stale async responses", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "pointer_down_provisional",
      source: BASE_SOURCE,
      target,
      pointerId: 1,
      selectionStart: 2,
      selectionEnd: 2,
      anchorOffset: 2,
      mode: "char",
      anchorLineRange: null,
      historyMergeKey: "merge"
    }).state;
    const typed = reduceInputIntent(started, "insertText", 2, 2, "}").state;
    const baselineText = typed.session?.text;
    const baselineSelection = {
      start: typed.session?.selectionStart,
      end: typed.session?.selectionEnd
    };

    const stalePointer = reduceCanvasTextEdit(typed, {
      type: "pointer_resolved",
      requestRevision: started.asyncRequestRevision,
      baseInputRevision: started.inputRevision,
      sourceId: target.sourceId,
      sceneTextId: target.sceneTextId,
      pointerId: 1,
      selectionStart: 0,
      selectionEnd: 0,
      anchorOffset: 0,
      anchorLineRange: null
    }).state;
    expect(stalePointer.session?.text).toBe(baselineText);
    expect(stalePointer.session?.selectionStart).toBe(baselineSelection.start);
    expect(stalePointer.session?.selectionEnd).toBe(baselineSelection.end);

    const staleDrag = reduceCanvasTextEdit(typed, {
      type: "drag_resolved",
      requestRevision: started.asyncRequestRevision,
      baseInputRevision: started.inputRevision,
      sourceId: target.sourceId,
      sceneTextId: target.sceneTextId,
      selectionStart: 0,
      selectionEnd: 0
    }).state;
    expect(staleDrag.session?.text).toBe(baselineText);
    expect(staleDrag.session?.selectionStart).toBe(baselineSelection.start);
    expect(staleDrag.session?.selectionEnd).toBe(baselineSelection.end);

    const staleOverlay = reduceCanvasTextEdit(typed, {
      type: "overlay_resolved",
      requestRevision: started.asyncRequestRevision,
      sourceId: target.sourceId,
      selectionStart: 0,
      selectionEnd: 0,
      overlay: {
        sourceId: target.sourceId,
        selectionStart: 0,
        selectionEnd: 0,
        caret: { bounds: viewportBounds(px(0), px(0), px(0), px(1)) },
        rects: []
      }
    }).state;
    expect(staleOverlay.session?.text).toBe(baselineText);
    expect(staleOverlay.session?.selectionStart).toBe(baselineSelection.start);
    expect(staleOverlay.session?.selectionEnd).toBe(baselineSelection.end);
  });

  it("passes deterministic stateful fuzz without invariant violations", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const rng = seedRng(seed);
      let state = INITIAL_CANVAS_TEXT_EDIT_STATE;
      let sourceRevision = 0;
      const target = buildTarget(BASE_SOURCE, "$x$");

      for (let step = 0; step < 120; step += 1) {
        const roll = rng();
        const previous = state;
        let reduced: { state: CanvasTextEditState; effects: CanvasTextEditEffect[] };

        if (!state.session || roll < 0.08) {
          reduced = reduceCanvasTextEdit(state, {
            type: "start_session",
            source: state.session?.workingSource ?? BASE_SOURCE,
            target,
            selectionStart: randomInt(rng, -5, 8),
            selectionEnd: randomInt(rng, -5, 8),
            historyMergeKey: `merge-${seed}-${step}`
          });
        } else if (roll < 0.18) {
          const text = state.session.text;
          const insertAt = randomInt(rng, 0, text.length);
          const token = ["}", "$", "x", " "][randomInt(rng, 0, 3)];
          reduced = reduceInputIntent(state, "insertText", insertAt, insertAt, token);
        } else if (roll < 0.24) {
          const text = state.session.text;
          const a = randomInt(rng, 0, text.length);
          const b = randomInt(rng, 0, text.length);
          const inputType = ([
            "insertReplacementText",
            "insertFromDrop",
            "insertParagraph",
            "insertLineBreak"
          ] as const)[randomInt(rng, 0, 3)];
          const data = inputType === "insertParagraph" || inputType === "insertLineBreak"
            ? null
            : ["R", "DROP", "z"][randomInt(rng, 0, 2)];
          reduced = reduceInputIntent(state, inputType, a, b, data);
        } else if (roll < 0.36) {
          const text = state.session.text;
          const a = randomInt(rng, 0, text.length);
          const b = randomInt(rng, 0, text.length);
          const inputType = ([
            "deleteContentBackward",
            "deleteContentForward",
            "deleteWordBackward",
            "deleteWordForward",
            "deleteSoftLineBackward",
            "deleteSoftLineForward"
          ] as const)[randomInt(rng, 0, 5)];
          reduced = reduceInputIntent(state, inputType, a, b);
        } else if (roll < 0.48) {
          reduced = reduceCanvasTextEdit(state, {
            type: "textarea_selection",
            selectionStart: randomInt(rng, -10, 20),
            selectionEnd: randomInt(rng, -10, 20)
          });
        } else if (roll < 0.62) {
          reduced = reduceCanvasTextEdit(state, {
            type: "pointer_resolved",
            requestRevision: rng() < 0.75 ? state.asyncRequestRevision : Math.max(0, state.asyncRequestRevision - 1),
            baseInputRevision: rng() < 0.75 ? state.inputRevision : Math.max(0, state.inputRevision - 1),
            sourceId: state.session.sourceId,
            sceneTextId: state.session.sceneTextId,
            pointerId: 1,
            selectionStart: randomInt(rng, -5, 25),
            selectionEnd: randomInt(rng, -5, 25),
            anchorOffset: randomInt(rng, -5, 25),
            anchorLineRange: null
          });
        } else if (roll < 0.74) {
          reduced = reduceCanvasTextEdit(state, {
            type: "drag_resolved",
            requestRevision: rng() < 0.75 ? state.asyncRequestRevision : Math.max(0, state.asyncRequestRevision - 1),
            baseInputRevision: rng() < 0.75 ? state.inputRevision : Math.max(0, state.inputRevision - 1),
            sourceId: state.session.sourceId,
            sceneTextId: state.session.sceneTextId,
            selectionStart: randomInt(rng, -5, 25),
            selectionEnd: randomInt(rng, -5, 25)
          });
        } else if (roll < 0.86) {
          reduced = reduceCanvasTextEdit(state, {
            type: "overlay_resolved",
            requestRevision: rng() < 0.75 ? state.asyncRequestRevision : Math.max(0, state.asyncRequestRevision - 1),
            sourceId: state.session.sourceId,
            selectionStart: randomInt(rng, -5, 25),
            selectionEnd: randomInt(rng, -5, 25),
            overlay: {
              sourceId: state.session.sourceId,
              selectionStart: 0,
              selectionEnd: 0,
              caret: { bounds: viewportBounds(px(0), px(0), px(0), px(1)) },
              rects: []
            }
          });
        } else if (roll < 0.95) {
          sourceRevision += 1;
          reduced = reduceCanvasTextEdit(state, {
            type: "source_reconciled",
            source: state.session.workingSource,
            sourceRevision,
            target: rng() < 0.7 ? target : null
          });
        } else {
          reduced = reduceCanvasTextEdit(state, { type: "session_close" });
        }

        state = reduced.state;
        assertStateInvariants(state);

        if (
          previous.session &&
          reduced.effects.length === 0 &&
          (roll >= 0.48 && roll < 0.86)
        ) {
          expect(state.session?.text).toBe(previous.session.text);
        }
      }
    }
  });

  it("stays consistent across source reconcile and async selection reorderings", () => {
    const multilineSource = String.raw`\begin{tikzpicture}
  \node[align=center] at (0,0) {First\\Second\\Third};
\end{tikzpicture}`;
    const target = buildTarget(multilineSource, String.raw`First\\Second\\Third`);

    const sequences: CanvasTextEditAction[][] = [
      [
        {
          type: "pointer_down_provisional",
          source: multilineSource,
          target,
          pointerId: 9,
          selectionStart: 0,
          selectionEnd: 5,
          anchorOffset: 2,
          mode: "line",
          anchorLineRange: { start: 0, end: 5 },
          historyMergeKey: "merge"
        },
        {
          type: "drag_resolved",
          requestRevision: 1,
          baseInputRevision: 0,
          sourceId: target.sourceId,
          sceneTextId: target.sceneTextId,
          selectionStart: 0,
          selectionEnd: 13
        },
        {
          type: "source_reconciled",
          source: multilineSource,
          sourceRevision: 1,
          target
        },
        {
          type: "pointer_resolved",
          requestRevision: 1,
          baseInputRevision: 0,
          sourceId: target.sourceId,
          sceneTextId: target.sceneTextId,
          pointerId: 9,
          selectionStart: 0,
          selectionEnd: 5,
          anchorOffset: 2,
          anchorLineRange: { start: 0, end: 5 }
        }
      ],
      [
        {
          type: "pointer_down_provisional",
          source: multilineSource,
          target,
          pointerId: 9,
          selectionStart: 0,
          selectionEnd: 5,
          anchorOffset: 2,
          mode: "line",
          anchorLineRange: { start: 0, end: 5 },
          historyMergeKey: "merge"
        },
        {
          type: "source_reconciled",
          source: multilineSource,
          sourceRevision: 1,
          target
        },
        {
          type: "drag_resolved",
          requestRevision: 1,
          baseInputRevision: 0,
          sourceId: target.sourceId,
          sceneTextId: target.sceneTextId,
          selectionStart: 0,
          selectionEnd: 13
        },
        {
          type: "overlay_resolved",
          requestRevision: 1,
          sourceId: target.sourceId,
          selectionStart: 0,
          selectionEnd: 13,
          overlay: {
            sourceId: target.sourceId,
            selectionStart: 0,
            selectionEnd: 13,
            caret: null,
            rects: []
          }
        }
      ]
    ];

    for (const actions of sequences) {
      const reduced = reduceMany(INITIAL_CANVAS_TEXT_EDIT_STATE, actions);
      expect(reduced.state.session?.selectionStart).toBe(0);
      expect(reduced.state.session?.selectionEnd).toBe(13);
      expect(reduced.state.session?.text).toBe(String.raw`First\\Second\\Third`);
    }
  });

  it("patches the nearest matching repeated span deterministically", () => {
    const repeatedSource = String.raw`\begin{tikzpicture}
  \node at (0,0) {$x$};
  \node at (1,0) {$x$};
\end{tikzpicture}`;
    const secondTarget = buildTargetAtOccurrence(repeatedSource, "$x$", 1);
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: repeatedSource,
      target: secondTarget,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;
    const driftedSource = repeatedSource.replace("\\node at (0,0)", "  \\node at (0,0)");
    const reconciled = reduceCanvasTextEdit(started, {
      type: "source_reconciled",
      source: driftedSource,
      sourceRevision: 1,
      target: null
    }).state;
    const reduced = reduceInputIntent(reconciled, "insertText", 2, 2, "}");
    expect(reduced.effects).toHaveLength(1);
    const [effect] = reduced.effects;
    expect(effect?.type).toBe("apply_source_patch");
    if (effect?.type === "apply_source_patch") {
      const firstOccurrence = driftedSource.indexOf("$x$");
      const secondOccurrence = driftedSource.indexOf("$x$", firstOccurrence + 1);
      expect(effect.previousSpan.from).toBe(secondOccurrence);
      expect(effect.previousSpan.from).not.toBe(firstOccurrence);
    }
  });

  it("round-trips through invalid partially typed math states without corruption", () => {
    const cases = [
      {
        name: "simple inline math with unmatched brace",
        initialText: "$x$",
        insertChars: ["}", "{", "$"]
      },
      {
        name: "fraction with partially typed braces",
        initialText: "$\\frac{a}{b}$",
        insertChars: ["}", "{", "c"]
      },
      {
        name: "sqrt with dangling root body",
        initialText: "$\\sqrt{x}$",
        insertChars: ["}", "{", "y"]
      }
    ] as const;

    for (const testCase of cases) {
      const baseSource = `\\begin{tikzpicture}\n  \\node at (0,0) {${testCase.initialText}};\n\\end{tikzpicture}`;
      const target = buildTarget(baseSource, testCase.initialText);
      let state = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
        type: "start_session",
        source: baseSource,
        target,
        selectionStart: Math.max(0, testCase.initialText.length - 1),
        selectionEnd: Math.max(0, testCase.initialText.length - 1),
        historyMergeKey: `merge-${testCase.name}`
      }).state;

      let sourceRevision = 0;
      for (const ch of testCase.insertChars) {
        const current = state.session?.text ?? testCase.initialText;
        const caret = state.session?.selectionStart ?? Math.max(0, current.length - 1);
        const nextText = `${current.slice(0, caret)}${ch}${current.slice(caret)}`;
        state = reduceInputIntent(state, "insertText", caret, caret, ch).state;
        sourceRevision += 1;
        state = reduceCanvasTextEdit(state, {
          type: "source_reconciled",
          source: `\\begin{tikzpicture}\n  \\node at (0,0) {${nextText}};\n\\end{tikzpicture}`,
          sourceRevision,
          target: null
        }).state;
      }

      for (let i = 0; i < testCase.insertChars.length; i += 1) {
        const caret = state.session?.selectionStart ?? 0;
        state = reduceInputIntent(state, "deleteContentBackward", caret, caret).state;
        sourceRevision += 1;
        state = reduceCanvasTextEdit(state, {
          type: "source_reconciled",
          source: state.session?.workingSource ?? baseSource,
          sourceRevision,
          target: null
        }).state;
      }

      expect(state.session?.text, testCase.name).toBe(testCase.initialText);
      expect(state.session?.workingSource, testCase.name).toBe(baseSource);
      expect(state.session?.selectionStart, testCase.name).toBe(Math.max(0, testCase.initialText.length - 1));
      expect(state.session?.selectionEnd, testCase.name).toBe(Math.max(0, testCase.initialText.length - 1));
    }
  });

  it("supports composition intents and insertFromComposition", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    const composition = reduceInputIntent(started, "insertCompositionText", 2, 2, "y").state;
    expect(composition.session?.text).toBe("$xy$");
    expect(composition.session?.selectionStart).toBe(3);
    expect(composition.compositionRange).toEqual({ start: 2, end: 3 });

    const committed = reduceInputIntent(composition, "insertFromComposition", 2, 3, "z").state;
    expect(committed.session?.text).toBe("$xz$");
    expect(committed.session?.selectionStart).toBe(3);
    expect(committed.compositionRange).toBeNull();
  });

  it("replaces the active composition span across repeated composition updates", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    const firstComposition = reduceInputIntent(started, "insertCompositionText", 2, 2, "k").state;
    expect(firstComposition.session?.text).toBe("$xk$");
    expect(firstComposition.compositionRange).toEqual({ start: 2, end: 3 });
    expect(firstComposition.undoStack).toHaveLength(1);

    const updatedComposition = reduceInputIntent(firstComposition, "insertCompositionText", 3, 3, "ka").state;
    expect(updatedComposition.session?.text).toBe("$xka$");
    expect(updatedComposition.compositionRange).toEqual({ start: 2, end: 4 });
    expect(updatedComposition.undoStack).toHaveLength(1);

    const committed = reduceInputIntent(updatedComposition, "insertFromComposition", 4, 4, "か").state;
    expect(committed.session?.text).toBe("$xか$");
    expect(committed.session?.selectionStart).toBe(3);
    expect(committed.session?.selectionEnd).toBe(3);
    expect(committed.compositionRange).toBeNull();
    expect(committed.undoStack).toHaveLength(1);
  });

  it("preserves composition range across selection sync before commit", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    const firstComposition = reduceInputIntent(started, "insertCompositionText", 2, 2, "k").state;
    const secondComposition = reduceInputIntent(firstComposition, "insertCompositionText", 2, 3, "ka").state;
    expect(secondComposition.session?.text).toBe("$xka$");
    expect(secondComposition.compositionRange).toEqual({ start: 2, end: 4 });

    const syncedSelection = reduceCanvasTextEdit(secondComposition, {
      type: "textarea_selection",
      selectionStart: 2,
      selectionEnd: 4
    }).state;
    expect(syncedSelection.compositionRange).toEqual({ start: 2, end: 4 });

    const committed = reduceInputIntent(syncedSelection, "insertFromComposition", 2, 4, "か").state;
    expect(committed.session?.text).toBe("$xか$");
    expect(committed.compositionRange).toBeNull();
  });

  it("supports replacement, drop, word delete, and line delete intents", () => {
    const replaceTarget = buildTarget(BASE_SOURCE, "$x$");
    const replaceStarted = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target: replaceTarget,
      selectionStart: 1,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    const replaced = reduceInputIntent(replaceStarted, "insertReplacementText", 1, 2, "yz").state;
    expect(replaced.session?.text).toBe("$yz$");

    const dropped = reduceInputIntent(replaced, "insertFromDrop", 1, 3, "dropped").state;
    expect(dropped.session?.text).toBe("$dropped$");

    const wordSource = String.raw`\begin{tikzpicture}
  \node at (0,0) {alpha beta gamma};
\end{tikzpicture}`;
    const wordTarget = buildTarget(wordSource, "alpha beta gamma");
    const wordStarted = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: wordSource,
      target: wordTarget,
      selectionStart: 11,
      selectionEnd: 11,
      historyMergeKey: "merge"
    }).state;

    const deleteWordBackward = reduceInputIntent(wordStarted, "deleteWordBackward", 11, 11).state;
    expect(deleteWordBackward.session?.text).toBe("alpha gamma");

    const deleteWordForward = reduceInputIntent(deleteWordBackward, "deleteWordForward", 6, 6).state;
    expect(deleteWordForward.session?.text).toBe("alpha ");

    const lineText = "alpha\nbeta\ngamma";
    const lineSource = `\\begin{tikzpicture}\n  \\node[align=center] at (0,0) {${lineText}};\n\\end{tikzpicture}`;
    const lineTarget = buildTarget(lineSource, lineText);
    const lineStarted = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: lineSource,
      target: lineTarget,
      selectionStart: 8,
      selectionEnd: 8,
      historyMergeKey: "merge"
    }).state;

    const deleteLineBackward = reduceInputIntent(lineStarted, "deleteSoftLineBackward", 8, 8).state;
    expect(deleteLineBackward.session?.text).toBe("alpha\nta\ngamma");

    const deleteLineForward = reduceInputIntent(lineStarted, "deleteSoftLineForward", 8, 8).state;
    expect(deleteLineForward.session?.text).toBe("alpha\nbe\ngamma");
  });

  it("supports paragraph insertion and hard-line deletion intents", () => {
    const paragraphSource = String.raw`\begin{tikzpicture}
  \node at (0,0) {alpha};
\end{tikzpicture}`;
    const paragraphTarget = buildTarget(paragraphSource, "alpha");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: paragraphSource,
      target: paragraphTarget,
      selectionStart: 5,
      selectionEnd: 5,
      historyMergeKey: "merge"
    }).state;

    const withParagraph = reduceInputIntent(started, "insertParagraph", 5, 5).state;
    expect(withParagraph.session?.text).toBe("alpha\n");

    const withTail = reduceInputIntent(withParagraph, "insertText", 6, 6, "beta").state;
    expect(withTail.session?.text).toBe("alpha\nbeta");

    const deletedBackward = reduceInputIntent(withTail, "deleteHardLineBackward", 8, 8).state;
    expect(deletedBackward.session?.text).toBe("alpha\nta");

    const deletedForward = reduceInputIntent(withTail, "deleteHardLineForward", 7, 7).state;
    expect(deletedForward.session?.text).toBe("alpha\nb");
  });

  it("writes a trailing single backslash through immediately", () => {
    const baseSource = String.raw`\begin{tikzpicture}
  \node at (0,0) {A};
  \node at (1,0) {B};
\end{tikzpicture}`;
    const target = buildTarget(baseSource, "A");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: baseSource,
      target,
      selectionStart: 1,
      selectionEnd: 1,
      historyMergeKey: "merge"
    }).state;

    const insertedBackslash = reduceInputIntent(started, "insertText", 1, 1, "\\");
    expect(insertedBackslash.state.session?.text).toBe("A\\");
    expect(insertedBackslash.effects).toHaveLength(1);
    expect(insertedBackslash.state.session?.workingSource).toContain("{A\\};");

    const insertedNextChar = reduceInputIntent(insertedBackslash.state, "insertText", 2, 2, "a");
    expect(insertedNextChar.state.session?.text).toBe("A\\a");
    expect(insertedNextChar.effects).toHaveLength(1);
    expect(insertedNextChar.state.session?.workingSource).toContain("{A\\a};");
    expect(insertedNextChar.state.session?.workingSource).toContain("{B};");
  });

  it("keeps source in sync through backslashes and backspaces", () => {
    const baseSource = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {Q};
  \node[draw] (B) at (1.5, -0.5) {B};
\end{tikzpicture}`;
    const target = buildTarget(baseSource, "Q");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: baseSource,
      target,
      selectionStart: 1,
      selectionEnd: 1,
      historyMergeKey: "merge"
    }).state;

    const firstSlash = reduceInputIntent(started, "insertText", 1, 1, "\\").state;
    expect(firstSlash.session?.text).toBe("Q\\");
    expect(firstSlash.session?.workingSource).toContain("{Q\\};");

    const secondSlash = reduceInputIntent(firstSlash, "insertText", 2, 2, "\\").state;
    expect(secondSlash.session?.text).toBe("Q\\\\");
    expect(secondSlash.session?.workingSource).toContain("{Q\\\\};");

    const backspaceOnce = reduceInputIntent(secondSlash, "deleteContentBackward", 3, 3).state;
    expect(backspaceOnce.session?.text).toBe("Q\\");
    expect(backspaceOnce.session?.workingSource).toContain("{Q\\};");

    const backspaceTwice = reduceInputIntent(backspaceOnce, "deleteContentBackward", 2, 2).state;
    expect(backspaceTwice.session?.text).toBe("Q");
    expect(backspaceTwice.session?.workingSource).toBe(baseSource);
  });

  it("normalizes target spans that are shorter than the session text at session start", () => {
    const baseSource = String.raw`\begin{tikzpicture}
  \foreach \y in {1,2,3} {
    \node at (\y, 0) {\y};
  }
\end{tikzpicture}`;
    const canonicalTarget = buildTargetAtOccurrence(baseSource, String.raw`\y`, 2);
    const malformedTarget: EditableTextTarget = {
      ...canonicalTarget,
      sourceSpan: {
        from: canonicalTarget.sourceSpan.from,
        to: canonicalTarget.sourceSpan.from + 1
      }
    };

    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: baseSource,
      target: malformedTarget,
      selectionStart: 0,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    const firstInsert = reduceInputIntent(started, "insertText", 0, 2, "\\");
    expect(firstInsert.state.session?.text).toBe("\\");
    expect(firstInsert.effects).toHaveLength(1);
    expect(firstInsert.state.session?.workingSource).toContain(String.raw`{\};`);

    const secondInsert = reduceInputIntent(firstInsert.state, "insertText", 1, 1, "y units");
    expect(secondInsert.state.session?.text).toBe(String.raw`\y units`);
    expect(secondInsert.state.session?.workingSource).toContain(String.raw`{\y units};`);
    expect(secondInsert.state.session?.workingSource).not.toContain(String.raw`{\y unitsy};`);
  });

  it("keeps session span stable when source_reconciled target text diverges from session text", () => {
    const baseSource = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {Q};
  \node[draw] (B) at (1.5, -0.5) {B};
\end{tikzpicture}`;
    const target = buildTarget(baseSource, "Q");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: baseSource,
      target,
      selectionStart: 1,
      selectionEnd: 1,
      historyMergeKey: "merge"
    }).state;

    const firstSlash = reduceInputIntent(started, "insertText", 1, 1, "\\").state;
    const secondSlash = reduceInputIntent(firstSlash, "insertText", 2, 2, "\\").state;
    const secondSlashSession = secondSlash.session;
    expect(secondSlashSession).not.toBeNull();
    if (!secondSlashSession) {
      throw new Error("expected active text editing session after second slash");
    }
    expect(secondSlashSession.workingSource).toContain("{Q\\\\};");
    expect(secondSlashSession.sourceSpan.to).toBe(secondSlashSession.sourceSpan.from + 3);

    const reconciled = reduceCanvasTextEdit(secondSlash, {
      type: "source_reconciled",
      source: secondSlash.session?.workingSource ?? "",
      sourceRevision: 1,
      target: {
        ...target,
        sourceSpan: { from: target.sourceSpan.from, to: target.sourceSpan.to },
        text: "Q"
      }
    }).state;
    const reconciledSession = reconciled.session;
    expect(reconciledSession).not.toBeNull();
    if (!reconciledSession) {
      throw new Error("expected active text editing session after source reconcile");
    }
    expect(reconciledSession.sourceSpan.to).toBe(reconciledSession.sourceSpan.from + 3);

    const backspaceOnce = reduceInputIntent(reconciled, "deleteContentBackward", 3, 3).state;
    const backspaceTwice = reduceInputIntent(backspaceOnce, "deleteContentBackward", 2, 2).state;
    expect(backspaceTwice.session?.text).toBe("Q");
    expect(backspaceTwice.session?.workingSource).toBe(baseSource);
  });

  it("supports textarea-local undo and redo intents", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    const insertedBrace = reduceInputIntent(started, "insertText", 2, 2, "}").state;
    expect(insertedBrace.session?.text).toBe("$x}$");
    expect(insertedBrace.undoStack).toHaveLength(1);
    expect(insertedBrace.redoStack).toHaveLength(0);

    const insertedChar = reduceInputIntent(insertedBrace, "insertText", 3, 3, "a").state;
    expect(insertedChar.session?.text).toBe("$x}a$");
    expect(insertedChar.undoStack).toHaveLength(2);

    const undone = reduceInputIntent(insertedChar, "historyUndo", 4, 4).state;
    expect(undone.session?.text).toBe("$x}$");
    expect(undone.undoStack).toHaveLength(1);
    expect(undone.redoStack).toHaveLength(1);

    const redone = reduceInputIntent(undone, "historyRedo", 3, 3).state;
    expect(redone.session?.text).toBe("$x}a$");
    expect(redone.undoStack).toHaveLength(2);
    expect(redone.redoStack).toHaveLength(0);
  });

  it("throws on unsupported inputType in test mode", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    expect(() =>
      reduceInputIntent(started, "insertOrderedList", 2, 2, "x")
    ).toThrowError(/unsupported inputType/i);
  });
});
