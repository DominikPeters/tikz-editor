import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Picks up a labelled node and drags it across the canvas. Exercises: select
// tool, synthetic pointer drag, auto-emitted pointermove between down/up,
// live source update as the drag progresses.
//
// Source has two nodes — cursor grabs the "A" node at (0,0), drags it to
// (2, 1), releases. Runs ~3.2s then loops.
export const dragNodeDemo: DemoScript = {
  id: "drag-node",
  duration: 3200,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-0.8,-0.8) rectangle (3.8,1.8);
  \node[draw,circle,fill=blue!15,minimum size=10mm] (a) at (0,0) {$A$};
  \node[draw,circle,fill=green!15,minimum size=10mm] (b) at (3,0) {$B$};
  \draw[->,thick] (a) -- (b);
\end{tikzpicture}`,
  cursor: [
    // Cursor appears near node A
    { t: 0,    x: cm(-0.5), y: cm(0.6), visible: false },
    { t: 200,  x: cm(-0.5), y: cm(0.6), visible: true, ease: "easeOut", cursor: "pointer" },
    // Move to hover over node A - cursor changes to move
    { t: 700,  x: cm(0.25), y: cm(0), ease: "easeInOut", cursor: "move" },
    // Click to select
    { t: 900,  x: cm(0.25), y: cm(0), pressed: true },
    { t: 1000, x: cm(0.25), y: cm(0), pressed: false },
    // Click again to start drag
    { t: 1150, x: cm(0.25), y: cm(0), pressed: true },
    // Drag node up and to the right
    { t: 2100, x: cm(2.25), y: cm(1), pressed: true, ease: "easeInOut" },
    { t: 2300, x: cm(2.25), y: cm(1), pressed: false },
    // Move away - cursor back to pointer
    { t: 2900, x: cm(3.2), y: cm(1.4), ease: "easeOut", cursor: "pointer" },
    { t: 3200, x: cm(3.2), y: cm(1.4), visible: false }
  ],
  events: [
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "select" } },
    { t: 900,  kind: "pointerDown", x: cm(0.25), y: cm(0) },
    { t: 1000, kind: "pointerUp" },
    { t: 1150, kind: "pointerDown", x: cm(0.25), y: cm(0) },
    { t: 2300, kind: "pointerUp" }
  ]
};
