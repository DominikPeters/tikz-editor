/**
 * E27: the tick label and grid keys the axis inspector writes (Ticks and Grid
 * groups), each as the inspector writes it, checked with
 *   node --import tsx scripts/pgfplots-oracle/experiments/check-cases.mts ./e27-tick-grid-cases.ts
 * A key is offered in the inspector only if its cases pass both tiers here.
 */
import { axisBody } from "./lib.js";

const PLOT = "\\addplot coordinates {(0,0.12) (1,0.57) (2,0.31) (3,0.94)};";
const A = "xlabel={$x$}, ylabel={$y$}";

const cases: Array<[string, string, string]> = [
  ["font-small", `${A}, tick label style={font=\\small}`, PLOT],
  ["font-tiny", `${A}, tick label style={font=\\tiny}`, PLOT],
  ["font-large", `${A}, tick label style={font=\\large}`, PLOT],
  ["font-color", `${A}, tick label style={font=\\footnotesize, color=red}`, PLOT],
  ["color-blue", `${A}, tick label style={color=blue!70!black}`, PLOT],
  ["xrotate-45", `${A}, xticklabel style={rotate=45}`, PLOT],
  ["xrotate-90", `${A}, xticklabel style={rotate=90}`, PLOT],
  ["yrotate-90", `${A}, yticklabel style={rotate=90}`, PLOT],
  ["precision-3", `${A}, /pgf/number format/precision=3, ytick={0.123,0.4567,0.9}`, PLOT],
  ["fixed", `${A}, /pgf/number format/fixed`, "\\addplot coordinates {(0,0.0001) (1,0.0004) (2,0.0002)};"],
  ["sci", `${A}, /pgf/number format/sci`, PLOT],
  ["fixed-zerofill", `${A}, /pgf/number format/fixed, /pgf/number format/fixed zerofill, /pgf/number format/precision=2`, PLOT],
  ["xtick-list", `${A}, xtick={0,1.5,3}`, PLOT],
  ["xticklabels", `${A}, xtick={0,1,2,3}, xticklabels={a,b,c,d}`, PLOT],
  ["ytick-list", `${A}, ytick={0,0.25,0.5,0.75,1}`, PLOT],
  ["grid-red", `${A}, grid=major, grid style={red}`, PLOT],
  ["grid-dashed", `${A}, grid=major, grid style={dashed}`, PLOT],
  ["grid-both-dotted", `${A}, grid=both, grid style={blue!50, densely dotted}`, PLOT],
  ["grid-minor-style", `${A}, grid=both, minor tick num=1, minor grid style={gray!20}, major grid style={gray!60}`, PLOT],
  // The exact forms the inspector writes.
  ["w-tick-style", `${A}, tick label style={font=\\small, color=red}, xticklabel style={rotate=45}`, PLOT],
  ["w-grid-style", `${A}, grid=both, grid style={dashed, color=blue!50}, minor grid style={color=gray!30}`, PLOT],
  ["w-number-format", `${A}, /pgf/number format/fixed, /pgf/number format/precision=3`, PLOT],
  ["w-ticks-labels", `${A}, xtick={0,1,2}, xticklabels={a,b,c}, ytick={0,0.5,1}`, PLOT],
  ["grid-thick", `${A}, grid=major, grid style={line width=0.8pt}`, PLOT]
];

export const NAME = "e27-tick-grid";
export const CASES = cases.map(([id, options, plots]) => ({ id, body: axisBody(options, plots) }));
