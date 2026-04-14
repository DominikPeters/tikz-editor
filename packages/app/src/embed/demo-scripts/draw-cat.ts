import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Draws a simple cat face step by step using multiple tools.
// Head (circle), then ears (triangular paths), eyes, nose, whiskers.
// Demonstrates switching between tools and building up a drawing.
export const drawCatDemo: DemoScript = {
  id: "draw-cat",
  duration: 8000,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-2,-1.8) rectangle (2,2.2);
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(-1.5), y: cm(1.5), visible: false },
    { t: 200,  x: cm(-1.5), y: cm(1.5), visible: true, ease: "easeOut", cursor: "crosshair" },

    // Draw head (circle from center)
    { t: 500,  x: cm(0), y: cm(0), ease: "easeInOut" },
    { t: 700,  x: cm(0), y: cm(0), pressed: true },
    { t: 1300, x: cm(1.2), y: cm(0), pressed: true, ease: "easeInOut" },
    { t: 1500, x: cm(1.2), y: cm(0), pressed: false },

    // Draw left ear (triangle)
    { t: 1800, x: cm(-0.8), y: cm(0.9), ease: "easeInOut" },
    { t: 2000, x: cm(-0.8), y: cm(0.9), pressed: true },
    { t: 2300, x: cm(-0.5), y: cm(1.8), pressed: true, ease: "easeOut" },
    { t: 2600, x: cm(-0.2), y: cm(1.0), pressed: true, ease: "easeOut" },
    { t: 2800, x: cm(-0.2), y: cm(1.0), pressed: false },

    // Draw right ear
    { t: 3000, x: cm(0.2), y: cm(1.0), ease: "easeInOut" },
    { t: 3200, x: cm(0.2), y: cm(1.0), pressed: true },
    { t: 3500, x: cm(0.5), y: cm(1.8), pressed: true, ease: "easeOut" },
    { t: 3800, x: cm(0.8), y: cm(0.9), pressed: true, ease: "easeOut" },
    { t: 4000, x: cm(0.8), y: cm(0.9), pressed: false },

    // Draw left eye (small circle)
    { t: 4300, x: cm(-0.4), y: cm(0.2), ease: "easeInOut" },
    { t: 4500, x: cm(-0.4), y: cm(0.2), pressed: true },
    { t: 4800, x: cm(-0.2), y: cm(0.2), pressed: true, ease: "easeOut" },
    { t: 5000, x: cm(-0.2), y: cm(0.2), pressed: false },

    // Draw right eye
    { t: 5200, x: cm(0.4), y: cm(0.2), ease: "easeInOut" },
    { t: 5400, x: cm(0.4), y: cm(0.2), pressed: true },
    { t: 5700, x: cm(0.6), y: cm(0.2), pressed: true, ease: "easeOut" },
    { t: 5900, x: cm(0.6), y: cm(0.2), pressed: false },

    // Draw nose (small triangle pointing down)
    { t: 6200, x: cm(-0.15), y: cm(-0.2), ease: "easeInOut" },
    { t: 6400, x: cm(-0.15), y: cm(-0.2), pressed: true },
    { t: 6600, x: cm(0), y: cm(-0.45), pressed: true, ease: "easeOut" },
    { t: 6800, x: cm(0.15), y: cm(-0.2), pressed: true, ease: "easeOut" },
    { t: 7000, x: cm(0.15), y: cm(-0.2), pressed: false },

    // Move away satisfied
    { t: 7500, x: cm(1.5), y: cm(1.2), ease: "easeOut", cursor: "pointer" },
    { t: 8000, x: cm(1.5), y: cm(1.2), visible: false }
  ],
  events: [
    // Head - circle tool
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addCircle" } },
    { t: 700,  kind: "pointerDown", x: cm(0), y: cm(0) },
    { t: 1500, kind: "pointerUp" },

    // Left ear - line tool (will draw connected segments)
    { t: 1700, kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addLine" } },
    { t: 2000, kind: "pointerDown", x: cm(-0.8), y: cm(0.9) },
    { t: 2800, kind: "pointerUp" },

    // Right ear
    { t: 3200, kind: "pointerDown", x: cm(0.2), y: cm(1.0) },
    { t: 4000, kind: "pointerUp" },

    // Eyes - back to circle
    { t: 4200, kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addCircle" } },
    { t: 4500, kind: "pointerDown", x: cm(-0.4), y: cm(0.2) },
    { t: 5000, kind: "pointerUp" },
    { t: 5400, kind: "pointerDown", x: cm(0.4), y: cm(0.2) },
    { t: 5900, kind: "pointerUp" },

    // Nose - line tool
    { t: 6100, kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addLine" } },
    { t: 6400, kind: "pointerDown", x: cm(-0.15), y: cm(-0.2) },
    { t: 7000, kind: "pointerUp" }
  ]
};
