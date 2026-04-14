import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Draws a simple house: rectangle body, triangular roof, door, and windows.
// A classic demo that shows building up a scene.
export const houseDrawingDemo: DemoScript = {
  id: "house-drawing",
  duration: 9000,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-0.5,-0.5) rectangle (4.5,3.5);
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(0), y: cm(2.5), visible: false },
    { t: 200,  x: cm(0), y: cm(2.5), visible: true, ease: "easeOut", cursor: "crosshair" },

    // Draw house body (rectangle)
    { t: 500,  x: cm(0.5), y: cm(0.2), ease: "easeInOut" },
    { t: 700,  x: cm(0.5), y: cm(0.2), pressed: true },
    { t: 1300, x: cm(3.5), y: cm(2), pressed: true, ease: "easeInOut" },
    { t: 1500, x: cm(3.5), y: cm(2), pressed: false },

    // Draw roof (triangle with line tool)
    { t: 1800, x: cm(0.3), y: cm(2), ease: "easeInOut" },
    { t: 2000, x: cm(0.3), y: cm(2), pressed: true },
    { t: 2400, x: cm(2), y: cm(3.2), pressed: true, ease: "easeOut" },
    { t: 2800, x: cm(3.7), y: cm(2), pressed: true, ease: "easeOut" },
    { t: 3000, x: cm(3.7), y: cm(2), pressed: false },

    // Draw door (small rectangle)
    { t: 3300, x: cm(1.6), y: cm(0.2), ease: "easeInOut" },
    { t: 3500, x: cm(1.6), y: cm(0.2), pressed: true },
    { t: 3900, x: cm(2.4), y: cm(1.2), pressed: true, ease: "easeOut" },
    { t: 4100, x: cm(2.4), y: cm(1.2), pressed: false },

    // Draw left window (small rectangle)
    { t: 4400, x: cm(0.8), y: cm(1.3), ease: "easeInOut" },
    { t: 4600, x: cm(0.8), y: cm(1.3), pressed: true },
    { t: 5000, x: cm(1.3), y: cm(1.8), pressed: true, ease: "easeOut" },
    { t: 5200, x: cm(1.3), y: cm(1.8), pressed: false },

    // Draw right window
    { t: 5400, x: cm(2.7), y: cm(1.3), ease: "easeInOut" },
    { t: 5600, x: cm(2.7), y: cm(1.3), pressed: true },
    { t: 6000, x: cm(3.2), y: cm(1.8), pressed: true, ease: "easeOut" },
    { t: 6200, x: cm(3.2), y: cm(1.8), pressed: false },

    // Draw chimney (small rectangle)
    { t: 6500, x: cm(2.8), y: cm(2.4), ease: "easeInOut" },
    { t: 6700, x: cm(2.8), y: cm(2.4), pressed: true },
    { t: 7100, x: cm(3.3), y: cm(3), pressed: true, ease: "easeOut" },
    { t: 7300, x: cm(3.3), y: cm(3), pressed: false },

    // Draw smoke (freehand squiggle)
    { t: 7600, x: cm(3.05), y: cm(3), ease: "easeInOut" },
    { t: 7800, x: cm(3.05), y: cm(3), pressed: true },
    { t: 8100, x: cm(3.2), y: cm(3.3), pressed: true, ease: "easeOut" },
    { t: 8300, x: cm(3.0), y: cm(3.4), pressed: true, ease: "easeOut" },
    { t: 8400, x: cm(3.0), y: cm(3.4), pressed: false },

    // Move away
    { t: 8700, x: cm(4), y: cm(2.5), ease: "easeOut" },
    { t: 9000, x: cm(4), y: cm(2.5), visible: false }
  ],
  events: [
    // House body - rectangle
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addRect" } },
    { t: 700,  kind: "pointerDown", x: cm(0.5), y: cm(0.2) },
    { t: 1500, kind: "pointerUp" },

    // Roof - line tool
    { t: 1700, kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addLine" } },
    { t: 2000, kind: "pointerDown", x: cm(0.3), y: cm(2) },
    { t: 3000, kind: "pointerUp" },

    // Door, windows, chimney - rectangles
    { t: 3200, kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addRect" } },
    { t: 3500, kind: "pointerDown", x: cm(1.6), y: cm(0.2) },
    { t: 4100, kind: "pointerUp" },
    { t: 4600, kind: "pointerDown", x: cm(0.8), y: cm(1.3) },
    { t: 5200, kind: "pointerUp" },
    { t: 5600, kind: "pointerDown", x: cm(2.7), y: cm(1.3) },
    { t: 6200, kind: "pointerUp" },
    { t: 6700, kind: "pointerDown", x: cm(2.8), y: cm(2.4) },
    { t: 7300, kind: "pointerUp" },

    // Smoke - freehand
    { t: 7500, kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addFreehand" } },
    { t: 7800, kind: "pointerDown", x: cm(3.05), y: cm(3) },
    { t: 8400, kind: "pointerUp" }
  ]
};
