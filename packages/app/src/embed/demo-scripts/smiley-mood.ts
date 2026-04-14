import type { DemoScript } from "../demo-script";

const PT_PER_CM = 28.45274;
const cm = (value: number): number => value * PT_PER_CM;

// A smiley face with a bendable mouth - we drag the mouth curve from
// happy (smile) to sad (frown) and back. Whimsical and demonstrates
// path bend manipulation.
export const smileyMoodDemo: DemoScript = {
  id: "smiley-mood",
  duration: 5000,
  initialSource: String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-1.8,-1.8) rectangle (1.8,1.8);
  % Face
  \draw[thick,fill=yellow!70] (0,0) circle (1.5);
  % Eyes
  \fill (−0.5,0.5) circle (0.15);
  \fill (0.5,0.5) circle (0.15);
  % Mouth - a smiling curve
  \draw[thick] (-0.7,-0.4) .. controls (-0.3,-0.9) and (0.3,-0.9) .. (0.7,-0.4);
\end{tikzpicture}`,
  cursor: [
    { t: 0,    x: cm(0), y: cm(1.2), visible: false },
    { t: 200,  x: cm(0), y: cm(1.2), visible: true, ease: "easeOut", cursor: "pointer" },
    // Move toward the mouth curve's bend handle (roughly at midpoint)
    { t: 800,  x: cm(0), y: cm(-0.7), ease: "easeInOut", cursor: "move" },
    // Click to select the path
    { t: 1000, x: cm(0), y: cm(-0.7), pressed: true },
    { t: 1100, x: cm(0), y: cm(-0.7), pressed: false },
    // Grab the bend handle and pull down (make sad)
    { t: 1400, x: cm(0), y: cm(-0.7), pressed: true },
    { t: 2400, x: cm(0), y: cm(-0.2), pressed: true, ease: "easeInOut" },
    { t: 2600, x: cm(0), y: cm(-0.2), pressed: false },
    // Pause to show the sad face
    { t: 3000, x: cm(0), y: cm(-0.2) },
    // Now pull back down to make happy again
    { t: 3200, x: cm(0), y: cm(-0.2), pressed: true },
    { t: 4200, x: cm(0), y: cm(-0.9), pressed: true, ease: "easeInOut" },
    { t: 4400, x: cm(0), y: cm(-0.9), pressed: false },
    // Move away
    { t: 4700, x: cm(0.8), y: cm(-0.3), ease: "easeOut", cursor: "pointer" },
    { t: 5000, x: cm(0.8), y: cm(-0.3), visible: false }
  ],
  events: [
    { t: 100,  kind: "storeAction", action: { type: "SET_TOOL_MODE", mode: "select" } },
    { t: 1000, kind: "pointerDown", x: cm(0), y: cm(-0.7) },
    { t: 1100, kind: "pointerUp" },
    { t: 1400, kind: "pointerDown", x: cm(0), y: cm(-0.7) },
    { t: 2600, kind: "pointerUp" },
    { t: 3200, kind: "pointerDown", x: cm(0), y: cm(-0.2) },
    { t: 4400, kind: "pointerUp" }
  ]
};
