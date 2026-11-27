/**
 * E18 plot styling (behaviour P): plot handlers, named and custom cycle
 * lists, mark selection, plot styles. Discovery set `a`, fresh validation
 * set `b` (E18_SET=b). Checked with check-cases.mts ./e18-cases.js.
 */
const AX = "scale only axis,width=200pt,height=150pt";
const PTS = "(0,0.5) (1,2) (2,1.2) (3,2.8) (4,2.2) (5,3.5)";
const lines = (n: number, extra = "") => Array.from({ length: n }, (_, i) => `\\addplot${extra} coordinates {(0,${i}) (1,${i + 0.4}) (2,${i})};`).join("\n");

const A: Array<[string, string, string]> = [
  ["smooth", AX, `\\addplot+[smooth] coordinates {${PTS}};`],
  ["smooth-t1", AX, `\\addplot+[smooth, tension=1] coordinates {${PTS}};`],
  ["smooth-2pt", AX, "\\addplot+[smooth] coordinates {(0,0) (1,1)};\n\\addplot+[smooth] coordinates {(0,1) (1,3) (2,2)};"],
  ["const", AX, `\\addplot+[const plot] coordinates {${PTS}};`],
  ["const-right", AX, `\\addplot+[const plot mark right] coordinates {${PTS}};`],
  ["const-mid", AX, `\\addplot+[const plot mark mid] coordinates {${PTS}};`],
  ["jump-left", AX, `\\addplot+[jump mark left] coordinates {${PTS}};`],
  ["jump-right", AX, `\\addplot+[jump mark right] coordinates {${PTS}};`],
  ["jump-mid", AX, `\\addplot+[jump mark mid] coordinates {${PTS}};`],
  ["ycomb", `${AX},ymin=-1`, `\\addplot+[ycomb] coordinates {${PTS}};`],
  ["xcomb", `${AX},xmin=-1`, `\\addplot+[xcomb] coordinates {${PTS}};`],
  ["sharp", `${AX},smooth`, `\\addplot+[sharp plot] coordinates {${PTS}};\n\\addplot coordinates {(0,1) (2,3) (4,2)};`],
  ["exotic", `${AX},cycle list name=exotic`, lines(10)],
  ["blackwhite", `${AX},cycle list name=black white`, lines(10)],
  ["colorlist", `${AX},cycle list name=color list`, lines(12)],
  ["linestyles", `${AX},cycle list name=linestyles*`, lines(5)],
  ["marklist", `${AX},cycle list name=mark list`, lines(8)],
  ["cl-simple", `${AX},cycle list={red,blue}`, lines(3)],
  ["cl-braced", `${AX},cycle list={{red,mark=*},{blue,mark=square}}`, lines(3)],
  ["cl-backslash", `${AX},cycle list={green!50!black,mark=x\\\\orange,dashed\\\\}`, lines(3)],
  ["cl-shift", `${AX},cycle list shift=2`, lines(3)],
  ["mark-repeat", AX, `\\addplot+[mark repeat=2] coordinates {${PTS}};\n\\addplot+[mark repeat=3, mark phase=2] coordinates {(0,1) (1,1.5) (2,1) (3,1.5) (4,1) (5,1.5)};`],
  ["mark-indices", AX, `\\addplot+[mark indices={1,4,5}] coordinates {${PTS}};`],
  ["post", `${AX},every axis plot post/.append style={thick}`, lines(2)],
  ["plotno", `${AX},every axis plot no 1/.style={green,mark=x}`, lines(3, "+")],
  ["fill", AX, "\\addplot[fill=red!30, draw=blue] coordinates {(0,0) (1,2) (2,1)};\n\\addplot[fill=green, fill opacity=0.5, draw=none] coordinates {(2,0) (3,2) (4,0)};"],
  ["widths", AX, "\\addplot+[line width=2pt] coordinates {(0,0) (1,1)};\n\\addplot+[ultra thick] coordinates {(0,1) (1,2)};\n\\addplot+[very thin, mark size=3pt] coordinates {(0,2) (1,3)};"],
  ["nomarkers", `${AX},no markers`, lines(3)],
  ["smooth-jump", AX, "\\addplot+[smooth, unbounded coords=jump] coordinates {(0,0) (1,1) (2,0.5) (3,inf) (4,1) (5,2) (6,1.5)};"],
];

const B: Array<[string, string, string]> = [
  ["b-smooth", "width=7cm,height=5cm", "\\addplot+[smooth, tension=0.7, domain=0:6, samples=9] {sin(60*x)};\n\\addplot+[smooth, mark=none] coordinates {(0,-1) (2,0) (3,-0.5) (6,1)};"],
  ["b-const", "width=7cm,height=5cm,legend pos=north west", "\\addplot+[const plot mark mid] coordinates {(0,1) (1,3) (3,2) (4,4)};\n\\addplot+[jump mark mid] coordinates {(0,0) (1,2) (3,1) (4,3)};\n\\addplot+[const plot mark right, mark=none] coordinates {(0,2) (2,4) (3,3) (4,5)};\n\\legend{a,b,c}"],
  ["b-comb", "width=7cm,height=5cm,ymin=-2,xmin=-1", "\\addplot+[ycomb] coordinates {(0,1) (1,-1.5) (2,2)};\n\\addplot+[xcomb] coordinates {(1,0.5) (2.5,1.5)};"],
  ["b-exotic", "width=7cm,height=5cm,cycle list name=exotic,cycle list shift=3", lines(6)],
  ["b-bw", "width=7cm,height=5cm,cycle list name=black white,mark size=3pt", lines(4)],
  ["b-linestyles", "width=7cm,height=5cm,cycle list name=linestyles,legend pos=south east", `${lines(4)}\n\\legend{1,2,3,4}`],
  ["b-custom", "width=7cm,height=5cm,cycle list={{teal,thick,mark=triangle*},{violet,dashed,mark=o},{gray}}", lines(4, "+[mark size=2.5pt]")],
  ["b-marks", "width=7cm,height=5cm", "\\addplot+[mark repeat=4, mark phase=3, domain=0:10, samples=21] {x};\n\\addplot+[mark indices={2,...,5}, mark=diamond*] coordinates {(0,1) (1,2) (2,3) (3,4) (4,5) (5,6) (6,7)};"],
  ["b-styles", "width=7cm,height=5cm,every axis plot/.append style={semithick}", "\\addplot+[fill=yellow, fill opacity=0.3] coordinates {(0,0) (1,3) (2,1) (3,2)};\n\\addplot[draw=none, mark=*, red] coordinates {(0,1) (1,1) (2,1)};\n\\addplot+[line width=1.5pt, dashed] coordinates {(0,2) (3,0)};"],
  ["b-plotno", "width=7cm,height=5cm,every axis plot no 0/.append style={ultra thick},every axis plot no 2/.style={mark=x}", lines(3)],
];

const SET = process.env.E18_SET ?? "a";
export const NAME = "e18-styling";
export const CASES = (SET === "b" ? B : A).map(([id, opt, plots]) => ({ id, body: `\\begin{tikzpicture}\\begin{axis}[${opt}]\n${plots}\n\\end{axis}\\end{tikzpicture}` }));
