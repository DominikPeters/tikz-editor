import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Demonstrates resizing a node by dragging its corner handle.
// Shows the resize cursor and live updating of the node size.
export const resizeNodeDemo: DemoScript = {
  id: "resize-node",
  duration: 3400,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-0.5,-0.5) rectangle (4,2.5);
  \node[draw,fill=blue!20,minimum width=15mm,minimum height=10mm] (box) at (1.2,1) {Box};
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(0), y: cm(1.8), visible: false },
    { t: 200,  x: cm(0), y: cm(1.8), visible: true, ease: "easeOut", cursor: "pointer" },
    // Click to select the node
    { t: 600,  x: cm(1.2), y: cm(1), ease: "easeInOut" },
    { t: 800,  x: cm(1.2), y: cm(1), pressed: true, cursor: "move" },
    { t: 900,  x: cm(1.2), y: cm(1), pressed: false },
    // Move to bottom-right resize handle
    { t: 1200, x: cm(1.95), y: cm(0.65), ease: "easeInOut", cursor: "nwse-resize" },
    // Drag to resize
    { t: 1400, x: cm(1.95), y: cm(0.65), pressed: true },
    { t: 2400, x: cm(3.2), y: cm(0.3), pressed: true, ease: "easeInOut" },
    { t: 2600, x: cm(3.2), y: cm(0.3), pressed: false },
    // Move away
    { t: 3100, x: cm(3.6), y: cm(1.5), ease: "easeOut", cursor: "pointer" },
    { t: 3400, x: cm(3.6), y: cm(1.5), visible: false }
  ],
  events: [
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "select" } },
    { t: 800,  kind: "pointerDown", x: cm(1.2), y: cm(1) },
    { t: 900,  kind: "pointerUp" },
    { t: 1400, kind: "pointerDown", x: cm(1.95), y: cm(0.65) },
    { t: 2600, kind: "pointerUp" }
  ]
};
