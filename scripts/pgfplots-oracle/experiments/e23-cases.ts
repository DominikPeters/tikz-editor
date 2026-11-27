/**
 * E23 scaled tick variants (behaviour T6): `scaled ticks=false|true|base
 * 10:e|real:num|manual:{label}{code}`, one direction only, and `scale ticks
 * above/below exponent`. Discovery set `a`, fresh set `b` (E23_SET=b).
 *   node --import tsx scripts/pgfplots-oracle/experiments/check-cases.mts ./e23-cases.ts
 */
const AX = "scale only axis,width=200pt,height=150pt";
const BIG = "\\addplot coordinates {(20000,0.0005) (40000,0.0010) (60000,0.0020)};";
const MID = "\\addplot coordinates {(0,100) (3,900) (6,400)};";

const A: Array<[string, string, string]> = [
  ["true", `${AX},scaled ticks=true`, BIG],
  ["false", `${AX},scaled ticks=false`, BIG],
  ["x-false", `${AX},scaled x ticks=false`, BIG],
  ["y-false", `${AX},scaled y ticks=false`, BIG],
  ["base10-3", `${AX},scaled ticks=base 10:3`, BIG],
  ["base10-0", `${AX},scaled x ticks=base 10:0`, BIG],
  ["base10-neg", `${AX},scaled y ticks=base 10:-3`, BIG],
  ["base10-mid", `${AX},scaled y ticks=base 10:2`, MID],
  ["real-2", `${AX},scaled x ticks=real:2,scaled y ticks=real:3`, MID],
  ["real-pi", `${AX},xtick={0,1.5708,...,7},domain=0:2*pi,scaled x ticks={real:3.1415}`, "\\addplot {sin(deg(x))};"],
  ["manual", `${AX},scaled y ticks=manual:{$+65\\,535$}{\\pgfmathparse{#1-65535}}`, "\\addplot coordinates {(0,65535) (13,65535) (14,65536) (15,65537) (30,65537)};"],
  ["manual-empty", `${AX},scaled y ticks=manual:{}{\\pgfmathparse{#1*2}}`, MID],
  ["above-1", `${AX},scale ticks above exponent=1`, MID],
  ["above-2", `${AX},scale ticks above exponent=2`, MID],
  ["below-3", `${AX},scale ticks below exponent=-3`, BIG],
  ["below-0", `${AX},scale ticks below exponent=0`, "\\addplot coordinates {(0,0.2) (1,0.5) (2,0.9)};"],
];
const B: Array<[string, string, string]> = [
  ["b-base10", "width=7cm,height=5cm,scaled x ticks=base 10:4", "\\addplot coordinates {(12000,1) (55000,3) (91000,2)};"],
  ["b-real", "width=7cm,height=5cm,scaled y ticks=real:0.5", "\\addplot coordinates {(0,1) (1,3) (2,2.5)};"],
  ["b-manual", "width=7cm,height=5cm,scaled x ticks=manual:{$-1000$}{\\pgfmathparse{#1-1000}}", "\\addplot coordinates {(1000,0) (1004,1) (1010,0.5)};"],
  ["b-above", "width=7cm,height=5cm,scale ticks above exponent=2", "\\addplot coordinates {(0,1500) (2,4800) (4,3100)};"],
  ["b-below", "width=7cm,height=5cm,scale ticks below exponent=-2", "\\addplot coordinates {(0,0.012) (1,0.08) (2,0.05)};"],
  ["b-yonly", "width=7cm,height=5cm,scaled y ticks=false", "\\addplot coordinates {(0,1e5) (1e5,3e5) (2e5,2e5)};"],
];
const SET = process.env.E23_SET ?? "a";
export const NAME = "e23-scaled";
export const CASES = (SET === "b" ? B : A).map(([id, opt, plots]) => ({ id, body: `\\begin{tikzpicture}\\begin{axis}[${opt}]\n${plots}\n\\end{axis}\\end{tikzpicture}` }));
