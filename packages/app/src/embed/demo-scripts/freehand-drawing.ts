import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Draws a freehand squiggle using the addFreehand tool.
// The tool smooths the input into a nice curve.
export const freehandDrawingDemo: DemoScript = {
  id: "freehand-drawing",
  duration: 3200,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-0.5,-0.5) rectangle (4,2.5);
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(0.2), y: cm(1.5), visible: false },
    { t: 200,  x: cm(0.2), y: cm(1.5), visible: true, ease: "easeOut", cursor: "crosshair" },
    // Move to start
    { t: 500,  x: cm(0.5), y: cm(1), ease: "easeInOut" },
    // Start drawing - a wavy line
    { t: 700,  x: cm(0.5), y: cm(1), pressed: true },
    { t: 1000, x: cm(1.2), y: cm(1.8), pressed: true, ease: "easeOut" },
    { t: 1300, x: cm(2), y: cm(0.5), pressed: true, ease: "easeInOut" },
    { t: 1600, x: cm(2.8), y: cm(1.6), pressed: true, ease: "easeInOut" },
    { t: 1900, x: cm(3.5), y: cm(0.8), pressed: true, ease: "easeOut" },
    { t: 2100, x: cm(3.5), y: cm(0.8), pressed: false },
    // Move away
    { t: 2800, x: cm(3.8), y: cm(2), ease: "easeOut" },
    { t: 3200, x: cm(3.8), y: cm(2), visible: false }
  ],
  events: [
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addFreehand" } },
    { t: 700,  kind: "pointerDown", x: cm(0.5), y: cm(1) },
    { t: 2100, kind: "pointerUp" }
  ]
};
