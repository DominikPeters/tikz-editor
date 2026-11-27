/**
 * E16: what TeX does with document idioms the parser had to learn (behaviour
 * section V0): two option lists on `\addplot`, `\foreach` and
 * `\pgfplotsinvokeforeach` around `\addplot`, `\pgfmathsetmacro`/`\def` in an
 * axis body, comparison operators in expressions, a braced group in the body,
 * an option list in the trailing path. Prints a digest per case.
 */
import { axisBody, runExperiment } from "./lib.js";
import { digest } from "./digest.js";

const cases: Array<[string, string, string]> = [
  ["two-opts", "xmin=0,xmax=1,ymin=0,ymax=2", "\\addplot[red][domain=0:0.5,samples=3] {x};"],
  ["two-opts-swapped", "xmin=0,xmax=1,ymin=0,ymax=2", "\\addplot[domain=0:0.5,samples=3][red] {x};"],
  ["one-opt", "xmin=0,xmax=1,ymin=0,ymax=2", "\\addplot[red,domain=0:0.5,samples=3] {x};"],
  ["two-opts-plus", "xmin=0,xmax=1,ymin=0,ymax=2", "\\addplot+[red][domain=0:0.5,samples=3] {x};"],
  ["foreach", "xmin=0,xmax=3,ymin=0,ymax=4", "\\foreach \\n in {1,2} {\\addplot[red!\\n0!blue,domain=0:1,samples=2] {x+\\n};}"],
  ["foreach-node", "xmin=0,xmax=3,ymin=0,ymax=4", "\\addplot coordinates {(0,0) (1,1)};\n\\foreach \\n in {1,2} {\\draw (axis cs:\\n,1) -- (axis cs:\\n,2);}"],
  ["invokeforeach", "xmin=0,xmax=3,ymin=0,ymax=4", "\\pgfplotsinvokeforeach{1,2}{\\addplot[domain=0:1,samples=2] {x+#1}; \\draw (axis cs:#1,1) -- (axis cs:#1,2);}"],
  ["ungrouped", "xmin=0,xmax=3,ymin=0,ymax=4", "\\pgfplotsforeachungrouped \\n in {1,2} {\\addplot[domain=0:1,samples=2] {x+\\n};}"],
  ["setmacro", "xmin=0,xmax=3,ymin=0,ymax=4", "\\pgfmathsetmacro\\va{1.5}\n\\addplot[domain=0:1,samples=2] {x+\\va};\n\\draw (axis cs:\\va,0) -- (axis cs:\\va,1);\n\\pgfmathsetmacro{\\va}{2.5}\n\\draw (axis cs:\\va,0) -- (axis cs:\\va,1);"],
  ["def", "xmin=0,xmax=3,ymin=0,ymax=4", "\\def\\va{1.5}\n\\addplot[domain=0:1,samples=2] {x+\\va};\n\\draw (axis cs:\\va,0) -- (axis cs:\\va,1);\n\\def\\va{2.5}\n\\addplot[domain=0:1,samples=2] {x+\\va};"],
  ["compare", "xmin=0,xmax=3,ymin=-1,ymax=2", "\\addplot[domain=0:3,samples=7] {(x<=1)*1 + (x>2)*(-1) + (x==1.5) + and(x>0.6,x<0.9)*0.5};"],
  ["brace-group", "xmin=0,xmax=3,ymin=0,ymax=4", "{\\addplot[domain=0:1,samples=2] {x+1};}\n\\addplot[domain=0:1,samples=2] {x+2};"],
  ["trailing-opts", "xmin=0,xmax=3,ymin=0,ymax=4", "\\addplot[domain=0:1,samples=2] {x+1} [yshift=3pt];"],
  ["foreach-expr", "xmin=0,xmax=3,ymin=0,ymax=4", "\\foreach \\n in {1,2} {\\addplot+[domain=0:1,samples=2] {x+\\n};}"],
  ["foreach-table", "xmin=0,xmax=3,ymin=0,ymax=4", "\\foreach \\n in {1,2} {\\addplot table[row sep=\\\\] {x y\\\\ 0 \\n\\\\ 1 2\\\\};}"],
  ["foreach-coords", "xmin=0,xmax=3,ymin=0,ymax=4", "\\foreach \\n in {1,2} {\\addplot coordinates {(0,\\n) (1,2)};}"],
  ["label-env", "xmin=0,xmax=3,ymin=0,ymax=4", "\\begin{scriptsize}\\addplot[domain=0:1,samples=2] {x+1};\\label{pl1}\\end{scriptsize}\\addplot[domain=0:1,samples=2] {x+2};"],
  ["truncate", "xmin=0,xmax=3,ymin=0,ymax=4", "\\pgfmathtruncatemacro\\vb{2.7}\n\\draw (axis cs:\\vb,0) -- (axis cs:\\vb,1);"],
];
const res = runExperiment("e16-syntax", cases.map(([id, opt, plots]) => ({ id, meta: { opt }, body: axisBody(opt, plots) })), { probes: ["limits", "map"] });
for (const r of res) console.log(`== ${r.id}\n${digest(r)}`);
