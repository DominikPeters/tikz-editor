import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// Draws an arrow between two existing nodes using the path tool + anchor
// snapping. Exercises: tool-mode switch, hover-to-reveal green anchor dots on
// nodes, anchor-snap endpoint resolution on pointerDown/pointerUp, live source
// insertion of a new \draw command.
//
// Flow: cursor enters, switches to addPath/addArrow tool, hovers near node A
// (green anchors appear), clicks on A's east anchor, drags to B's west anchor,
// releases — a `\draw[->] (a) -- (b)` is added.
export const connectWithPathToolDemo: DemoScript = {
  id: "connect-with-path-tool",
  duration: 3600,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-0.8,-0.8) rectangle (3.8,0.8);
  \node[draw,circle,fill=blue!15,minimum size=10mm] (a) at (0,0) {$A$};
  \node[draw,circle,fill=green!15,minimum size=10mm] (b) at (3,0) {$B$};
\end{tikzpicture}`,
  cursor: [
    // Cursor appears near node A with crosshair (tool already active)
    { t: 0,    x: cm(-0.3), y: cm(0.5), visible: false },
    { t: 200,  x: cm(-0.3), y: cm(0.5), visible: true, ease: "easeOut", cursor: "crosshair" },
    // Move toward node A's east anchor
    { t: 800,  x: cm(0.4), y: cm(0.2), ease: "easeInOut" },
    // Hover near anchor so green dots appear
    { t: 1100, x: cm(0.5), y: cm(0), ease: "easeOut" },
    // Press at A's east anchor
    { t: 1300, x: cm(0.5), y: cm(0), pressed: true },
    // Drag across to B's west anchor
    { t: 2400, x: cm(2.5), y: cm(0), pressed: true, ease: "easeInOut" },
    // Release on B's west anchor
    { t: 2600, x: cm(2.5), y: cm(0), pressed: false },
    // Move away
    { t: 3300, x: cm(3.4), y: cm(0.5), ease: "easeOut" },
    { t: 3600, x: cm(3.4), y: cm(0.5), visible: false }
  ],
  events: [
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "addArrow" } },
    { t: 1300, kind: "pointerDown", x: cm(0.5), y: cm(0) },
    { t: 2600, kind: "pointerUp" }
  ]
};
