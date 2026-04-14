import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Demonstrates bending an existing path by dragging its bend handle.
// Starts with a straight line and curves it into an arc.
export const bendPathDemo: DemoScript = {
  id: "bend-path",
  duration: 3800,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-0.5,-0.5) rectangle (4,2.5);
  \draw[thick,blue] (0.5,1) -- (3.5,1);
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(0.5), y: cm(2), visible: false },
    { t: 200,  x: cm(0.5), y: cm(2), visible: true, ease: "easeOut", cursor: "pointer" },
    // Click on the path to select it
    { t: 600,  x: cm(2), y: cm(1), ease: "easeInOut" },
    { t: 800,  x: cm(2), y: cm(1), pressed: true, cursor: "move" },
    { t: 900,  x: cm(2), y: cm(1), pressed: false },
    // The bend handle should appear - grab it
    { t: 1200, x: cm(2), y: cm(1), cursor: "move" },
    { t: 1400, x: cm(2), y: cm(1), pressed: true },
    // Pull upward to create a curve
    { t: 2400, x: cm(2), y: cm(2.2), pressed: true, ease: "easeInOut" },
    { t: 2600, x: cm(2), y: cm(2.2), pressed: false },
    // Pause to admire
    { t: 3000, x: cm(2), y: cm(2.2) },
    // Move away
    { t: 3400, x: cm(3.2), y: cm(2), ease: "easeOut", cursor: "pointer" },
    { t: 3800, x: cm(3.2), y: cm(2), visible: false }
  ],
  events: [
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "select" } },
    { t: 800,  kind: "pointerDown", x: cm(2), y: cm(1) },
    { t: 900,  kind: "pointerUp" },
    { t: 1400, kind: "pointerDown", x: cm(2), y: cm(1) },
    { t: 2600, kind: "pointerUp" }
  ]
};
