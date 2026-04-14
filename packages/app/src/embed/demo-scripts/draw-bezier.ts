import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Draws a Bezier curve using the addBezier tool.
// First drag: set endpoints. Second drag: adjust the curve bend.
export const drawBezierDemo: DemoScript = {
  id: "draw-bezier",
  duration: 4200,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-0.5,-0.5) rectangle (4.5,2.5);
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(0), y: cm(1.5), visible: false },
    { t: 200,  x: cm(0), y: cm(1.5), visible: true, ease: "easeOut", cursor: "crosshair" },
    // Move to start point
    { t: 500,  x: cm(0.5), y: cm(0.5), ease: "easeInOut" },
    // First drag: define endpoints
    { t: 700,  x: cm(0.5), y: cm(0.5), pressed: true },
    { t: 1500, x: cm(4), y: cm(0.5), pressed: true, ease: "easeInOut" },
    { t: 1700, x: cm(4), y: cm(0.5), pressed: false },
    // Move to midpoint for bend adjustment
    { t: 2100, x: cm(2.25), y: cm(0.5), ease: "easeInOut" },
    // Second drag: pull up to create the curve
    { t: 2300, x: cm(2.25), y: cm(0.5), pressed: true },
    { t: 3200, x: cm(2.25), y: cm(2), pressed: true, ease: "easeInOut" },
    { t: 3400, x: cm(2.25), y: cm(2), pressed: false },
    // Move away
    { t: 3900, x: cm(3.5), y: cm(2.2), ease: "easeOut" },
    { t: 4200, x: cm(3.5), y: cm(2.2), visible: false }
  ],
  events: [
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addBezier" } },
    { t: 700,  kind: "pointerDown", x: cm(0.5), y: cm(0.5) },
    { t: 1700, kind: "pointerUp" },
    { t: 2300, kind: "pointerDown", x: cm(2.25), y: cm(0.5) },
    { t: 3400, kind: "pointerUp" }
  ]
};
