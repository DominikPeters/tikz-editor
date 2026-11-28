/**
 * E25 cases (behaviour AC, TikZ context around and inside an axis): which
 * pgfplots-drawn paths and texts receive the options of the tikzpicture, of
 * an enclosing scope, `every path`, `every mark`, `every node`, … (set `a`,
 * discovery; `b`, fresh validation), and how `\addplot` inside a scope in
 * the axis body behaves (set `s`, discovery; `t`, fresh validation).
 * `CASES`/`NAME` are what check-cases.mts reads (E25_SET=a|b|s|t).
 */

/** A picture holding one axis with every element kind (grid, ticks, box, labels, legend, marks, embedded TikZ). */
function rich(pre: string, picOpts: string, axisOpts = "", body = "", around: [string, string] = ["", ""]): string {
  const plots = body || [
    "\\addplot coordinates {(0,0.5) (1,1.5) (2,1)};",
    "\\addlegendentry{a}",
    "\\addplot[red] coordinates {(0,2) (2,2.5)};",
    "\\addlegendentry{b}",
    "\\draw (axis cs:0.5,0.2) -- (axis cs:1.5,0.4);",
    "\\node at (axis cs:1.5,2.8) {N};"
  ].join("\n");
  return `${pre}\\begin{tikzpicture}${picOpts ? `[${picOpts}]` : ""}\n${around[0]}\\begin{axis}[xmin=0,xmax=2,ymin=0,ymax=3,grid=major,title=T,xlabel=X,ylabel=Y,legend pos=south east,width=6cm,height=5cm${axisOpts ? `,${axisOpts}` : ""}]\n${plots}\n\\end{axis}${around[1]}\n\\end{tikzpicture}`;
}

export const a: Array<[string, string]> = [
  ["base", rich("", "")],
  ["pic-thick", rich("", "thick")],
  ["pic-lw", rich("", "line width=1.5pt")],
  ["pic-red", rich("", "red")],
  ["pic-draw-red", rich("", "draw=red")],
  ["pic-dashed", rich("", "dashed")],
  ["pic-font", rich("", "font=\\small")],
  ["pic-text", rich("", "text=blue")],
  ["pic-opacity", rich("", "opacity=0.5")],
  ["pic-mix", rich("", "thick,font=\\small,red")],
  ["scope-thick-blue", rich("", "", "", "", ["\\begin{scope}[thick,blue]\n", "\n\\end{scope}"])],
  ["scope-font", rich("", "", "", "", ["\\begin{scope}[font=\\footnotesize]\n", "\n\\end{scope}"])],
  ["every-picture-thick", rich("\\tikzset{every picture/.style={thick}}%\n", "")],
  ["pre-every-path-lw", rich("\\tikzset{every path/.append style={line width=1.5pt}}%\n", "")],
  ["pre-every-path-red", rich("\\tikzset{every path/.style={red}}%\n", "")],
  ["pre-every-path-draw", rich("\\tikzset{every path/.style={draw=green}}%\n", "")],
  ["pre-every-path-dashed", rich("\\tikzset{every path/.style={dashed}}%\n", "")],
  ["pic-every-path-lw", rich("", "every path/.style={line width=1pt}")],
  ["body-every-path-lw", rich("", "", "", "\\addplot coordinates {(0,0.5) (1,1.5) (2,1)};\n\\addlegendentry{a}\n\\tikzset{every path/.append style={line width=1pt}}\n\\addplot[red] coordinates {(0,2) (2,2.5)};\n\\addlegendentry{b}")],
  ["pre-every-mark-scale", rich("\\tikzset{every mark/.append style={scale=2}}%\n", "")],
  ["pre-every-mark-fill", rich("\\tikzset{every mark/.append style={fill=green}}%\n", "")],
  ["pre-every-mark-red", rich("\\tikzset{every mark/.style={red}}%\n", "")],
  ["pre-every-node-font", rich("\\tikzset{every node/.style={font=\\small}}%\n", "")],
  ["pre-every-node-draw", rich("\\tikzset{every node/.style={draw}}%\n", "")],
  ["pre-every-node-red", rich("\\tikzset{every node/.append style={red}}%\n", "")],
  ["pre-every-label", rich("\\tikzset{every label/.style={red}}%\n", "")],
  ["pre-every-path-errorbars", `\\tikzset{every path/.append style={line width=1pt}}%\n\\begin{tikzpicture}\n\\begin{axis}[xmin=0,xmax=3,ymin=0,ymax=4,width=6cm,height=5cm]\n\\addplot+[error bars/.cd,y dir=both,y explicit] coordinates {(1,1) +- (0,0.5) (2,2) +- (0,0.3)};\n\\end{axis}\n\\end{tikzpicture}`],
  ["pre-every-path-bars", `\\tikzset{every path/.append style={line width=1pt}}%\n\\begin{tikzpicture}\n\\begin{axis}[ybar,xmin=0,xmax=3,ymin=0,ymax=4,width=6cm,height=5cm]\n\\addplot coordinates {(1,1) (2,3)};\n\\end{axis}\n\\end{tikzpicture}`],
  ["pic-thick-axislines", rich("", "thick", "axis lines=left")],
  ["pic-red-axislines", rich("", "red", "axis lines=middle")]
];

export const b: Array<[string, string]> = [
  ["b-pic-very-thick", rich("", "very thick")],
  ["b-pic-blue-font", rich("", "blue,font=\\large")],
  ["b-pic-dotted-lw", rich("", "dotted,line width=0.8pt")],
  ["b-scope-red-semithick", rich("", "", "", "", ["\\begin{scope}[semithick,red]\n", "\n\\end{scope}"])],
  ["b-pre-every-path-orange", rich("\\tikzset{every path/.style={orange,line width=1pt}}%\n", "")],
  ["b-pre-every-mark-scale-fill", rich("\\tikzset{every mark/.append style={scale=1.5,fill=yellow}}%\n", "")],
  ["b-pre-every-node-teal", rich("\\tikzset{every node/.style={teal,font=\\footnotesize}}%\n", "")],
  ["b-pic-thick-every-path-dashed", rich("", "thick,every path/.style={densely dashed}")],
  ["b-pic-violet-axislines", rich("", "violet,ultra thin", "axis lines=box")]
];

/** A small axis with fixed limits whose body is `body`. */
function sAxis(body: string, axisOpts = "", picOpts = ""): string {
  return `\\begin{tikzpicture}${picOpts ? `[${picOpts}]` : ""}\n\\begin{axis}[xmin=0,xmax=4,ymin=0,ymax=10,width=6cm,height=5cm${axisOpts ? `,${axisOpts}` : ""}]\n${body}\n\\end{axis}\n\\end{tikzpicture}`;
}

export const s: Array<[string, string]> = [
  ["s-plain", sAxis("\\begin{scope}\n\\addplot coordinates {(0,1) (2,3)};\n\\end{scope}\n\\addplot coordinates {(0,2) (2,5)};")],
  ["s-red-dashed", sAxis("\\begin{scope}[red,dashed]\n\\addplot coordinates {(0,1) (2,3)};\n\\addplot+[blue] coordinates {(0,4) (2,4)};\n\\end{scope}\n\\addplot coordinates {(0,2) (2,5)};")],
  ["s-lw-opacity", sAxis("\\begin{scope}[line width=2pt,opacity=0.5]\n\\addplot coordinates {(0,1) (2,3)};\n\\end{scope}")],
  ["s-xshift", sAxis("\\begin{scope}[xshift=1cm]\n\\addplot coordinates {(0,1) (2,3)};\n\\draw (axis cs:0,0) -- (axis cs:1,1);\n\\end{scope}")],
  ["s-yscale", sAxis("\\begin{scope}[yscale=2]\n\\addplot coordinates {(0,1) (2,3)};\n\\draw (axis cs:0,0) -- (axis cs:1,1);\n\\end{scope}")],
  ["s-shift-auto", "\\begin{tikzpicture}\n\\begin{axis}[width=6cm,height=5cm]\n\\begin{scope}[xshift=1cm]\n\\addplot coordinates {(0,1) (2,3)};\n\\end{scope}\n\\end{axis}\n\\end{tikzpicture}"],
  ["s-limits", "\\begin{tikzpicture}\n\\begin{axis}[width=6cm,height=5cm]\n\\addplot coordinates {(0,1) (1,2)};\n\\begin{scope}\n\\addplot coordinates {(3,5) (4,7)};\n\\end{scope}\n\\end{axis}\n\\end{tikzpicture}"],
  ["s-clip", sAxis("\\begin{scope}\n\\clip (axis cs:0,0) rectangle (axis cs:1,10);\n\\addplot[mark=*] coordinates {(0,1) (2,3)};\n\\end{scope}\n\\addplot coordinates {(0,2) (2,5)};")],
  ["s-clip-draw", sAxis("\\begin{scope}\n\\clip (axis cs:0,0) rectangle (axis cs:1,10);\n\\draw (axis cs:0,1) -- (axis cs:2,3);\n\\end{scope}\n\\draw (axis cs:0,2) -- (axis cs:2,5);")],
  ["s-cycle", sAxis("\\addplot coordinates {(0,1) (2,1)};\n\\begin{scope}\n\\addplot coordinates {(0,2) (2,2)};\n\\addplot coordinates {(0,3) (2,3)};\n\\end{scope}\n\\addplot coordinates {(0,4) (2,4)};")],
  ["s-legend", sAxis("\\addplot coordinates {(0,1) (2,1)};\n\\addlegendentry{a}\n\\begin{scope}[red]\n\\addplot coordinates {(0,2) (2,2)};\n\\addlegendentry{b}\n\\end{scope}")],
  ["s-legend-cmd", sAxis("\\begin{scope}\n\\addplot coordinates {(0,1) (2,1)};\n\\addplot coordinates {(0,2) (2,2)};\n\\legend{p,q}\n\\end{scope}")],
  ["s-order", sAxis("\\draw[green,line width=3pt] (axis cs:0,0) -- (axis cs:4,10);\n\\begin{scope}\n\\addplot[blue,line width=2pt] coordinates {(0,10) (4,0)};\n\\draw[orange,line width=3pt] (axis cs:0,5) -- (axis cs:4,5);\n\\end{scope}\n\\addplot[red,line width=2pt] coordinates {(2,0) (2,10)};")],
  ["s-marks", sAxis("\\begin{scope}\n\\addplot[blue,mark=*] coordinates {(1,1) (2,3)};\n\\draw[orange,line width=3pt] (axis cs:0,2) -- (axis cs:4,2);\n\\end{scope}\n\\draw[green,line width=3pt] (axis cs:0,3) -- (axis cs:4,3);")],
  ["s-background", "\\usetikzlibrary{backgrounds}%\n\\begin{tikzpicture}\n\\begin{axis}[xmin=0,xmax=4,ymin=0,ymax=10,width=6cm,height=5cm]\n\\addplot[blue,line width=2pt] coordinates {(0,10) (4,0)};\n\\begin{scope}[on background layer]\n\\addplot[red,line width=2pt] coordinates {(0,0) (4,10)};\n\\end{scope}\n\\end{axis}\n\\end{tikzpicture}"],
  ["s-nested", sAxis("\\begin{scope}[red]\n\\begin{scope}[dashed]\n\\addplot coordinates {(0,1) (2,3)};\n\\end{scope}\n\\addplot coordinates {(0,2) (2,4)};\n\\end{scope}")],
  ["s-group-addplot", sAxis("{\\pgfplotsset{every axis plot/.append style={red}}\n\\addplot coordinates {(0,1) (2,3)};}\n\\addplot coordinates {(0,2) (2,4)};")],
  ["s-foreach", sAxis("\\foreach \\k in {1,2,3} {\n\\addplot coordinates {(0,\\k) (2,\\k+1)};\n}")],
  ["s-foreach-scope", sAxis("\\foreach \\k in {1,2} {\n\\begin{scope}[dashed]\n\\addplot coordinates {(0,\\k) (2,\\k+1)};\n\\end{scope}\n}")],
  ["s-scope-pgfplotsset-forget", sAxis("\\begin{scope}\n\\pgfplotsset{forget plot}\n\\addplot coordinates {(0,1) (2,1)};\n\\end{scope}\n\\addplot coordinates {(0,2) (2,2)};")],
  ["s-scope-mark-options", sAxis("\\begin{scope}[mark options={fill=green}]\n\\addplot coordinates {(1,1) (2,3)};\n\\end{scope}")],
  ["s-scope-every-mark", sAxis("\\begin{scope}[every mark/.append style={scale=2}]\n\\addplot coordinates {(1,1) (2,3)};\n\\end{scope}")],
  ["s-scope-rotate", sAxis("\\begin{scope}[rotate=10]\n\\addplot coordinates {(1,1) (2,3)};\n\\end{scope}")],
  ["s-scope-fill", sAxis("\\begin{scope}[fill=yellow]\n\\addplot coordinates {(1,1) (2,3) (3,1)};\n\\end{scope}")]
];

export const t: Array<[string, string]> = [
  ["t-green-thick", sAxis("\\addplot coordinates {(0,1) (3,2)};\n\\begin{scope}[green!50!black,very thick]\n\\addplot coordinates {(0,3) (3,6)};\n\\addplot+[dotted] coordinates {(0,5) (3,5)};\n\\end{scope}\n\\addplot coordinates {(0,7) (3,8)};")],
  ["t-xshift-mm", sAxis("\\begin{scope}[yshift=5mm,xshift=-3mm]\n\\addplot[red] coordinates {(1,2) (3,4)};\n\\end{scope}\n\\addplot[blue] coordinates {(1,2) (3,4)};")],
  ["t-xscale", sAxis("\\begin{scope}[xscale=0.5]\n\\addplot[red] coordinates {(1,2) (3,4)};\n\\end{scope}", "xmin=-2")],
  ["t-rotate-origin", sAxis("\\begin{scope}[rotate=-15]\n\\addplot[mark=square*] coordinates {(1,2) (3,4)};\n\\draw (axis cs:0,0) -- (axis cs:2,2);\n\\end{scope}", "xmin=-1,ymin=-5")],
  ["t-clip-plots", sAxis("\\addplot coordinates {(0,1) (4,9)};\n\\begin{scope}\n\\clip (axis cs:1,0) rectangle (axis cs:3,10);\n\\addplot coordinates {(0,9) (4,1)};\n\\addplot[mark=square*] coordinates {(0,5) (4,5)};\n\\end{scope}")],
  ["t-legend-mixed", sAxis("\\begin{scope}[dashed]\n\\addplot coordinates {(0,1) (2,1)};\n\\addlegendentry{u}\n\\end{scope}\n\\addplot coordinates {(0,2) (2,2)};\n\\addlegendentry{v}\n\\begin{scope}\n\\addplot coordinates {(0,3) (2,3)};\n\\addlegendentry{w}\n\\end{scope}", "legend pos=north west")],
  ["t-nested-order", sAxis("\\begin{scope}[blue]\n\\draw[line width=3pt] (axis cs:0,1) -- (axis cs:4,1);\n\\begin{scope}[line width=2pt]\n\\addplot coordinates {(0,0) (4,10)};\n\\end{scope}\n\\end{scope}\n\\addplot[red] coordinates {(0,10) (4,0)};")],
  ["t-foreach-scope-red", sAxis("\\foreach \\k in {2,4} {\n\\begin{scope}[red]\n\\addplot coordinates {(0,\\k) (3,\\k)};\n\\end{scope}\n}\n\\addplot coordinates {(0,7) (3,7)};")],
  ["t-pic-thick-scope", sAxis("\\begin{scope}[blue]\n\\addplot coordinates {(0,2) (3,4)};\n\\end{scope}", "", "thick")]
];

/** Exploration of reset and order details (set c). */
const P2 = "\\addplot[blue] coordinates {(0,0.5) (1,1.5) (2,1)};\n\\addplot+[thick] coordinates {(0,2) (2,2.5)};\n\\addplot[line width=1pt,mark=*] coordinates {(0,1) (2,1.2)};";
export const c: Array<[string, string]> = [
  ["c-base", rich("", "", "", P2)],
  ["c-every-path-red", rich("\\tikzset{every path/.style={red}}%\n", "", "", P2)],
  ["c-every-path-lw", rich("\\tikzset{every path/.style={line width=2pt}}%\n", "", "", P2)],
  ["c-every-path-axisplot", rich("\\tikzset{every path/.style={red,line width=2pt}}%\n", "", "every axis plot/.append style={green,thin}", P2)],
  ["c-pic-cap-join", rich("", "line cap=round,line join=round", "", P2)],
  ["c-pic-fill", rich("", "fill=yellow", "", P2)],
  ["c-pic-arrow", rich("", "->", "", P2)],
  ["c-pic-draw-opacity", rich("", "draw opacity=0.5", "", P2)],
  ["c-pic-semithick-draw", rich("", "semithick,draw=red,blue", "", P2)],
  ["c-every-picture-red-font", rich("\\tikzset{every picture/.style={red,font=\\small}}%\n", "", "", P2)],
  ["c-every-picture-lw2", rich("\\tikzset{every picture/.style={line width=2pt}}%\n", "", "", P2)],
  ["c-every-picture-draw", rich("\\tikzset{every picture/.style={draw=red}}%\n", "", "", P2)],
  ["c-every-mark-body-scale", rich("", "", "", "\\tikzset{every mark/.append style={scale=2}}\n\\addplot coordinates {(0,0.5) (1,1.5) (2,1)};")],
  ["c-every-mark-pic-scale", rich("", "every mark/.append style={scale=2}", "", "\\addplot coordinates {(0,0.5) (1,1.5) (2,1)};")],
  ["c-every-mark-pre-style-scale", rich("\\tikzset{every mark/.style={scale=2}}%\n", "", "", "\\addplot coordinates {(0,0.5) (1,1.5) (2,1)};")],
  ["c-every-mark-pre-lw", rich("\\tikzset{every mark/.append style={line width=1pt,blue!50}}%\n", "", "", "\\addplot coordinates {(0,0.5) (1,1.5) (2,1)};")],
  ["c-every-mark-axis-scale", rich("", "", "every mark/.append style={scale=2}", "\\addplot coordinates {(0,0.5) (1,1.5) (2,1)};")],
  ["c-every-node-axis", rich("", "", "every node/.style={red}", "")],
  ["c-every-path-scope-around", rich("", "", "", "", ["\\begin{scope}[every path/.style={line width=1pt}]\n", "\n\\end{scope}"])],
  ["c-scope-dashed-opacity", rich("", "", "", "", ["\\begin{scope}[dashed,opacity=0.5,text=red]\n", "\n\\end{scope}"])]
];

const set = process.env.E25_SET === "b" ? b : process.env.E25_SET === "s" ? s : process.env.E25_SET === "t" ? t : process.env.E25_SET === "c" ? c : a;
export const NAME = `e25-tikz-context${process.env.E25_SET ? `-${process.env.E25_SET}` : ""}`;
export const CASES = set.map(([id, body]) => ({ id, body }));
