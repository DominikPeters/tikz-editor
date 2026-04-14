import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Draws a rectangle by dragging from one corner to the opposite corner.
// Simple and satisfying - shows the addRect tool in action.
export const addRectangleDemo: DemoScript = {
  id: "add-rectangle",
  duration: 2800,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-0.5,-0.5) rectangle (4,2.5);
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(0.3), y: cm(1.8), visible: false },
    { t: 200,  x: cm(0.3), y: cm(1.8), visible: true, ease: "easeOut", cursor: "crosshair" },
    // Move to starting corner
    { t: 600,  x: cm(0.5), y: cm(0.5), ease: "easeInOut" },
    // Press to start drawing
    { t: 800,  x: cm(0.5), y: cm(0.5), pressed: true },
    // Drag to opposite corner
    { t: 1800, x: cm(3.5), y: cm(2), pressed: true, ease: "easeInOut" },
    // Release
    { t: 2000, x: cm(3.5), y: cm(2), pressed: false },
    // Move away
    { t: 2500, x: cm(3.8), y: cm(2.3), ease: "easeOut" },
    { t: 2800, x: cm(3.8), y: cm(2.3), visible: false }
  ],
  events: [
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addRect" } },
    { t: 800,  kind: "pointerDown", x: cm(0.5), y: cm(0.5) },
    { t: 2000, kind: "pointerUp" }
  ]
};
