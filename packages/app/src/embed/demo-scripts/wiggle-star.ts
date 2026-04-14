import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// A star shape that we select and rotate back and forth, making it "wiggle".
// Fun and demonstrates the rotation handle interaction.
export const wiggleStarDemo: DemoScript = {
  id: "wiggle-star",
  duration: 4500,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-2,-2) rectangle (2,2.5);
  % 5-pointed star
  \fill[yellow!80!orange] (90:1.5) -- (162:0.6) -- (234:1.5) -- (306:0.6) -- (18:1.5) -- (90:0.6) -- (162:1.5) -- (234:0.6) -- (306:1.5) -- (18:0.6) -- cycle;
  \draw[orange!80!black,thick] (90:1.5) -- (162:0.6) -- (234:1.5) -- (306:0.6) -- (18:1.5) -- (90:0.6) -- (162:1.5) -- (234:0.6) -- (306:1.5) -- (18:0.6) -- cycle;
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(-1.5), y: cm(1.5), visible: false },
    { t: 200,  x: cm(-1.5), y: cm(1.5), visible: true, ease: "easeOut", cursor: "pointer" },
    // Click to select the star
    { t: 600,  x: cm(0), y: cm(0.5), ease: "easeInOut" },
    { t: 800,  x: cm(0), y: cm(0.5), pressed: true, cursor: "move" },
    { t: 900,  x: cm(0), y: cm(0.5), pressed: false },
    // Move to rotation handle (above the star)
    { t: 1200, x: cm(0), y: cm(2.2), ease: "easeInOut", cursor: "grab" },
    // Rotate clockwise
    { t: 1400, x: cm(0), y: cm(2.2), pressed: true, cursor: "grabbing" },
    { t: 2000, x: cm(1), y: cm(1.8), pressed: true, ease: "easeInOut" },
    // Rotate counter-clockwise (past center)
    { t: 2800, x: cm(-1), y: cm(1.8), pressed: true, ease: "easeInOut" },
    // Back to center
    { t: 3400, x: cm(0), y: cm(2.2), pressed: true, ease: "easeInOut" },
    { t: 3600, x: cm(0), y: cm(2.2), pressed: false, cursor: "grab" },
    // Move away
    { t: 4100, x: cm(1.2), y: cm(1.8), ease: "easeOut", cursor: "pointer" },
    { t: 4500, x: cm(1.2), y: cm(1.8), visible: false }
  ],
  events: [
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "select" } },
    { t: 800,  kind: "pointerDown", x: cm(0), y: cm(0.5) },
    { t: 900,  kind: "pointerUp" },
    { t: 1400, kind: "pointerDown", x: cm(0), y: cm(2.2) },
    { t: 3600, kind: "pointerUp" }
  ]
};
