import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Draws a circle by dragging from the center outward.
// The addCircle tool draws from center to edge, making it easy to place.
export const drawCircleDemo: DemoScript = {
  id: "draw-circle",
  duration: 2600,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-0.5,-0.5) rectangle (3.5,2.5);
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(0.2), y: cm(1.8), visible: false },
    { t: 200,  x: cm(0.2), y: cm(1.8), visible: true, ease: "easeOut", cursor: "crosshair" },
    // Move to center position
    { t: 600,  x: cm(1.5), y: cm(1), ease: "easeInOut" },
    // Press at center
    { t: 800,  x: cm(1.5), y: cm(1), pressed: true },
    // Drag outward to define radius
    { t: 1600, x: cm(2.5), y: cm(1), pressed: true, ease: "easeInOut" },
    // Release
    { t: 1800, x: cm(2.5), y: cm(1), pressed: false },
    // Move away
    { t: 2300, x: cm(3.2), y: cm(1.8), ease: "easeOut" },
    { t: 2600, x: cm(3.2), y: cm(1.8), visible: false }
  ],
  events: [
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addCircle" } },
    { t: 800,  kind: "pointerDown", x: cm(1.5), y: cm(1) },
    { t: 1800, kind: "pointerUp" }
  ]
};
