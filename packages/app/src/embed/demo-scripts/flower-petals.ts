import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Draws a simple flower by adding ellipse petals around a center circle.
// Demonstrates building up a design with multiple shapes.
export const flowerPetalsDemo: DemoScript = {
  id: "flower-petals",
  duration: 7500,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-2,-2) rectangle (2,2);
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(-1.5), y: cm(1.2), visible: false },
    { t: 200,  x: cm(-1.5), y: cm(1.2), visible: true, ease: "easeOut", cursor: "crosshair" },

    // Draw center (yellow circle)
    { t: 500,  x: cm(0), y: cm(0), ease: "easeInOut" },
    { t: 700,  x: cm(0), y: cm(0), pressed: true },
    { t: 1100, x: cm(0.4), y: cm(0), pressed: true, ease: "easeOut" },
    { t: 1300, x: cm(0.4), y: cm(0), pressed: false },

    // Top petal (ellipse)
    { t: 1600, x: cm(0), y: cm(1), ease: "easeInOut" },
    { t: 1800, x: cm(0), y: cm(1), pressed: true },
    { t: 2200, x: cm(0.3), y: cm(1.6), pressed: true, ease: "easeOut" },
    { t: 2400, x: cm(0.3), y: cm(1.6), pressed: false },

    // Right petal
    { t: 2600, x: cm(1), y: cm(0), ease: "easeInOut" },
    { t: 2800, x: cm(1), y: cm(0), pressed: true },
    { t: 3200, x: cm(1.6), y: cm(0.3), pressed: true, ease: "easeOut" },
    { t: 3400, x: cm(1.6), y: cm(0.3), pressed: false },

    // Bottom petal
    { t: 3600, x: cm(0), y: cm(-1), ease: "easeInOut" },
    { t: 3800, x: cm(0), y: cm(-1), pressed: true },
    { t: 4200, x: cm(0.3), y: cm(-1.6), pressed: true, ease: "easeOut" },
    { t: 4400, x: cm(0.3), y: cm(-1.6), pressed: false },

    // Left petal
    { t: 4600, x: cm(-1), y: cm(0), ease: "easeInOut" },
    { t: 4800, x: cm(-1), y: cm(0), pressed: true },
    { t: 5200, x: cm(-1.6), y: cm(0.3), pressed: true, ease: "easeOut" },
    { t: 5400, x: cm(-1.6), y: cm(0.3), pressed: false },

    // Add stem with line tool
    { t: 5700, x: cm(0), y: cm(-0.4), ease: "easeInOut" },
    { t: 5900, x: cm(0), y: cm(-0.4), pressed: true },
    { t: 6500, x: cm(0), y: cm(-1.8), pressed: true, ease: "easeOut" },
    { t: 6700, x: cm(0), y: cm(-1.8), pressed: false },

    // Move away
    { t: 7100, x: cm(1.2), y: cm(1), ease: "easeOut" },
    { t: 7500, x: cm(1.2), y: cm(1), visible: false }
  ],
  events: [
    // Center circle
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addCircle" } },
    { t: 700,  kind: "pointerDown", x: cm(0), y: cm(0) },
    { t: 1300, kind: "pointerUp" },

    // Petals - ellipse tool
    { t: 1500, kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addEllipse" } },
    { t: 1800, kind: "pointerDown", x: cm(0), y: cm(1) },
    { t: 2400, kind: "pointerUp" },
    { t: 2800, kind: "pointerDown", x: cm(1), y: cm(0) },
    { t: 3400, kind: "pointerUp" },
    { t: 3800, kind: "pointerDown", x: cm(0), y: cm(-1) },
    { t: 4400, kind: "pointerUp" },
    { t: 4800, kind: "pointerDown", x: cm(-1), y: cm(0) },
    { t: 5400, kind: "pointerUp" },

    // Stem - line tool
    { t: 5600, kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addLine" } },
    { t: 5900, kind: "pointerDown", x: cm(0), y: cm(-0.4) },
    { t: 6700, kind: "pointerUp" }
  ]
};
