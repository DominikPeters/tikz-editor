/**
 * E24 cases (behaviour AB, settings inside the axis body): discovery set `a`,
 * exploration sets `c` and `d`, fresh validation set `b`. `CASES`/`NAME` are
 * what check-cases.mts reads (set chosen by E24_SET=a|b|c|d).
 */
import { axisBody } from "./lib.js";

const F = "xmin=0,xmax=4,ymin=0,ymax=10";
export const a: Array<[string, string, string]> = [
  // Plot-affecting keys between plots.
  ["p-domain", `${F},domain=0:1,samples=3`, "\\addplot[blue] {x};\n\\pgfplotsset{domain=2:3}\n\\addplot[red] {x^2};"],
  ["p-samples", `${F},domain=0:1,samples=3`, "\\addplot[blue] {x};\n\\pgfplotsset{samples=5}\n\\addplot[red] {x+1};"],
  ["p-pgfkeys", `${F},domain=0:1,samples=3`, "\\addplot[blue] {x};\n\\pgfkeys{/pgfplots/domain=2:3}\n\\addplot[red] {x};"],
  ["p-tikzset-domain", `${F},domain=0:1,samples=3`, "\\addplot[blue] {x};\n\\tikzset{domain=2:3}\n\\addplot[red] {x};"],
  ["p-every-plot", `${F},domain=0:1,samples=2`, "\\addplot {x};\n\\pgfplotsset{every axis plot/.append style={line width=2pt}}\n\\addplot {x+1};"],
  ["p-every-plot-post", `${F},domain=0:1,samples=2`, "\\addplot {x};\n\\pgfplotsset{every axis plot post/.append style={dashed}}\n\\addplot {x+1};"],
  ["p-cycle-list", `${F},domain=0:1,samples=2`, "\\addplot {x};\n\\pgfplotsset{cycle list={{green,mark=none},{orange,mark=none}}}\n\\addplot {x+1};\n\\addplot {x+2};"],
  ["p-cycle-name", `${F},domain=0:1,samples=2`, "\\addplot {x};\n\\pgfplotsset{cycle list name=black white}\n\\addplot {x+1};"],
  ["p-no-marks", `${F},domain=0:1,samples=2`, "\\addplot {x};\n\\pgfplotsset{no marks}\n\\addplot {x+1};"],
  ["p-mark", `${F},domain=0:1,samples=2`, "\\addplot[blue] {x};\n\\pgfplotsset{mark=square*}\n\\addplot[red] {x+1};"],
  ["p-forget", `${F},domain=0:1,samples=2`, "\\addplot {x};\n\\pgfplotsset{forget plot}\n\\addplot {x+1};\n\\addplot {x+2};"],
  ["p-def-color", `${F},domain=0:1,samples=2`, "\\def\\mycol{red}\n\\addplot[color=\\mycol] {x};\n\\def\\mycol{blue}\n\\addplot[color=\\mycol] {x+1};"],
  ["p-def-domain", `${F},samples=3`, "\\def\\dhi{1}\n\\addplot[blue,domain=0:\\dhi] {x};\n\\def\\dhi{3}\n\\addplot[red,domain=0:\\dhi] {x+1};"],
  ["p-def-expr", `${F},domain=0:1,samples=2`, "\\def\\k{1}\n\\addplot[blue] {x+\\k};\n\\def\\k{3}\n\\addplot[red] {x+\\k};"],
  ["p-tikz-style", `${F},domain=0:1,samples=2`, "\\tikzset{mystyle/.style={red}}\n\\addplot[mystyle] {x};\n\\tikzset{mystyle/.style={blue}}\n\\addplot[mystyle] {x+1};"],
  ["p-pgfplots-style", `${F},domain=0:1,samples=2`, "\\pgfplotsset{mystyle/.style={red}}\n\\addplot[mystyle] {x};\n\\pgfplotsset{mystyle/.style={blue}}\n\\addplot[mystyle] {x+1};"],
  ["p-every-mark", `${F},domain=0:1,samples=2`, "\\addplot[blue,mark=*] {x};\n\\tikzset{every mark/.append style={scale=2}}\n\\addplot[red,mark=*] {x+1};"],
  ["p-mark-options", `${F},domain=0:1,samples=2`, "\\addplot[blue,mark=*] {x};\n\\pgfplotsset{mark options={fill=green}}\n\\addplot[red,mark=*] {x+1};"],
  ["p-after-all", `${F},domain=0:1,samples=2`, "\\addplot[blue] {x};\n\\addplot[red] {x+1};\n\\pgfplotsset{every axis plot post/.append style={line width=3pt}}"],
  ["p-thick", `${F},domain=0:1,samples=2`, "\\addplot[blue] {x};\n\\tikzset{every path/.append style={line width=2pt}}\n\\addplot[red] {x+1};"],
  // Axis-level keys after some plots.
  ["a-xmin", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{xmin=-2}"],
  ["a-ymax", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{ymax=5}"],
  ["a-title", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{title=T}"],
  ["a-xlabel", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{xlabel=X}"],
  ["a-grid", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{grid=major}"],
  ["a-legend-pos", "domain=0:1,samples=2", "\\addplot {x};\n\\legend{a}\n\\pgfplotsset{legend pos=north west}"],
  ["a-width", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{width=5cm}"],
  ["a-axis-lines", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{axis lines=left}"],
  ["a-xtick", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{xtick={0,0.5,1}}"],
  ["a-enlarge", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{enlargelimits=false}"],
  ["a-clip", "xmin=0,xmax=1,ymin=0,ymax=1,domain=0:2,samples=2", "\\addplot {x};\n\\pgfplotsset{clip=false}"],
  ["a-hide", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{hide axis}"],
  ["a-before", "domain=0:1,samples=2", "\\pgfplotsset{xmin=-2,title=T}\n\\addplot {x};"],
  ["a-tick-style", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{every tick/.append style={red}}"],
  ["a-axis-style", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{every axis/.append style={title=T}}"],
  ["a-tikzset-title", "domain=0:1,samples=2", "\\addplot {x};\n\\tikzset{/pgfplots/title=T}"],
  ["a-thick-axis", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{axis line style={red}}"],
  // TeX groups and scopes.
  ["g-domain", `${F},domain=0:1,samples=3`, "{\\pgfplotsset{domain=2:3}\n\\addplot[blue] {x};}\n\\addplot[red] {x};"],
  ["g-xmin", "domain=0:1,samples=2", "\\addplot {x};\n{\\pgfplotsset{xmin=-2}}"],
  ["g-title", "domain=0:1,samples=2", "\\addplot {x};\n{\\pgfplotsset{title=T}}"],
  ["g-every-plot", `${F},domain=0:1,samples=2`, "{\\pgfplotsset{every axis plot/.append style={line width=2pt}}\n\\addplot {x};}\n\\addplot {x+1};"],
  ["g-def", `${F},domain=0:1,samples=2`, "\\def\\k{1}\n{\\def\\k{3}\n\\addplot[blue] {x+\\k};}\n\\addplot[red] {x+\\k};"],
  ["g-cycle", `${F},domain=0:1,samples=2`, "{\\pgfplotsset{cycle list={{green},{orange}}}\n\\addplot {x};}\n\\addplot {x+1};"],
  ["s-domain", `${F},domain=0:1,samples=3`, "\\begin{scope}\n\\pgfplotsset{domain=2:3}\n\\addplot[blue] {x};\n\\end{scope}\n\\addplot[red] {x};"],
  ["s-xmin", "domain=0:1,samples=2", "\\addplot {x};\n\\begin{scope}\\pgfplotsset{xmin=-2}\\end{scope}"],
  ["s-options", `${F},domain=0:1,samples=2`, "\\begin{scope}[red]\n\\addplot {x};\n\\end{scope}\n\\addplot {x+1};"]
];

// Fresh validation set: new values and combinations of the rules found on set a.
export const b: Array<[string, string, string]> = [
  ["b-domain-samples", "xmin=-1,xmax=5,ymin=-2,ymax=30,samples=4,domain=-1:0", "\\addplot[blue] {2*x};\n\\pgfplotsset{domain=1:4,samples=2}\n\\addplot[red] {x^2};\n\\pgfplotsset{samples=6}\n\\addplot[green] {x};"],
  ["b-pgfkeys-samples", "xmin=0,xmax=3,ymin=0,ymax=3,domain=0:3,samples=2", "\\addplot[blue] {x};\n\\pgfkeys{/pgfplots/samples=4}\n\\addplot[red] {3-x};"],
  ["b-every-plot-thin", "xmin=0,xmax=3,ymin=0,ymax=5,domain=0:3,samples=2", "\\addplot {x};\n\\addplot {x+0.5};\n\\pgfplotsset{every axis plot/.append style={dotted}}\n\\addplot {x+1};"],
  ["b-cycle-mid", "xmin=0,xmax=3,ymin=0,ymax=5,domain=0:3,samples=2", "\\addplot {x};\n\\addplot {x+1};\n\\pgfplotsset{cycle list={{brown},{violet},{teal}}}\n\\addplot {x+2};"],
  ["b-def-mixed", "xmin=0,xmax=4,ymin=0,ymax=10,samples=3", "\\def\\lo{0}\\def\\c{orange}\n\\addplot[\\c,domain=\\lo:2] {x};\n\\def\\lo{2}\\def\\c{teal}\n\\addplot[\\c,domain=\\lo:4] {x};"],
  ["b-ymin", "domain=1:2,samples=2", "\\addplot {x};\n\\pgfplotsset{ymin=0}"],
  ["b-xmax", "domain=1:2,samples=2", "\\pgfplotsset{xmax=4}\n\\addplot {x};"],
  ["b-title-late", "domain=1:2,samples=2", "\\addplot {x};\n\\pgfplotsset{title={Late}}\n\\addplot {x+1};"],
  ["b-label-group", "domain=1:2,samples=2", "\\addplot {x};\n{\\pgfplotsset{ylabel=Y}}\n\\pgfplotsset{xlabel=Q}"],
  ["b-tikzset-mark", "xmin=0,xmax=4,ymin=0,ymax=10,domain=0:2,samples=3", "\\addplot[blue] {x};\n\\tikzset{mark=triangle*}\n\\addplot[red] {x+1};\n\\addplot[green] {x+2};"],
  ["b-smooth-marksize", "xmin=0,xmax=4,ymin=0,ymax=10,domain=0:2,samples=3", "\\addplot[blue,mark=*] {x^2};\n\\pgfplotsset{smooth,mark size=3pt}\n\\addplot[red,mark=*] {x};"],
  ["b-nth-forget", "xmin=0,xmax=4,ymin=0,ymax=10,domain=0:2,samples=5", "\\addplot {x};\n\\pgfplotsset{each nth point=2,forget plot}\n\\addplot {x+1};\n\\addplot {x+2};"],
  ["b-tikz-noeffect", "xmin=0,xmax=4,ymin=0,ymax=10,domain=0:2,samples=2", "\\addplot[blue] {x};\n\\pgfplotsset{orange,line width=3pt}\n\\tikzset{dotted}\n\\addplot[red] {x+1};"],
  ["b-group-tikzset", "xmin=0,xmax=4,ymin=0,ymax=10,domain=0:2,samples=2", "{\\tikzset{/pgfplots/domain=1:2,mark=x}\n\\addplot[blue] {x};}\n\\addplot[red] {x+1};"],
  ["b-every-no", "xmin=0,xmax=4,ymin=0,ymax=10,domain=0:2,samples=2", "\\pgfplotsset{every axis plot no 1/.append style={line width=2pt}}\n\\addplot {x};\n\\addplot {x+1};\n\\pgfplotsset{every axis plot no 2/.append style={line width=2pt}}\n\\addplot {x+2};"],
  ["b-text-violet", "domain=0:2,samples=2,xlabel=Q,ylabel=R", "\\addplot {x};\n\\addlegendentry{Lg}\n\\tikzset{text=violet}\n\\node at (axis cs:1,1) {M};"],
  ["b-font-teal", "domain=0:2,samples=2,title={Ab}", "\\pgfplotsset{font=\\small,teal}\n\\addplot {x};\n\\addplot {x+1};\n{\\pgfplotsset{red}}\n\\legend{a,b}"],
  ["b-legend-entries-late", "domain=0:2,samples=2", "\\addplot {x};\n\\addplot {x+1};\n\\pgfplotsset{legend entries={P,Q},legend pos=south east}"],
  ["b-grid-minor", "domain=0:2,samples=2", "\\addplot {x};\n\\pgfplotsset{minor tick num=1,grid=both}"],
  ["b-scope-def", "xmin=0,xmax=4,ymin=0,ymax=10,domain=0:1,samples=2", "\\begin{scope}\n\\def\\k{4}\n\\pgfplotsset{samples=3}\n\\addplot[blue] {x+\\k};\n\\end{scope}\n\\addplot[red] {x};"],
  ["b-group-mark", "xmin=0,xmax=4,ymin=0,ymax=10,domain=0:2,samples=3", "{\\pgfplotsset{every axis plot post/.append style={mark=triangle*}}\n\\addplot[blue] {x};}\n\\addplot[red] {x+1};"]
];


// Exploration of TikZ keys at body level (set c).
export const c: Array<[string, string, string]> = [
  ["c-red", `${F},domain=0:1,samples=2`, "\\addplot[blue] {x};\n\\pgfplotsset{green}\n\\addplot[red] {x+1};\n\\addplot {x+2};"],
  ["c-thick", `${F},domain=0:1,samples=2`, "\\addplot[blue] {x};\n\\pgfplotsset{line width=2pt}\n\\addplot[red] {x+1};"],
  ["c-dashed", `${F},domain=0:1,samples=2`, "\\addplot[blue] {x};\n\\pgfplotsset{dashed}\n\\addplot[red] {x+1};"],
  ["c-tikzset-thick", `${F},domain=0:1,samples=2`, "\\addplot[blue] {x};\n\\tikzset{line width=2pt}\n\\addplot[red] {x+1};"],
  ["c-tikzset-mark", `${F},domain=0:1,samples=2`, "\\addplot[blue] {x};\n\\tikzset{mark=square*}\n\\addplot[red] {x+1};"],
  ["c-smooth", `${F},domain=0:1,samples=3`, "\\addplot[blue] {x^2};\n\\pgfplotsset{smooth}\n\\addplot[red] {x^2+1};"],
  ["c-only-marks", `${F},domain=0:1,samples=2`, "\\addplot[blue,mark=*] {x};\n\\pgfplotsset{only marks}\n\\addplot[red,mark=*] {x+1};"],
  ["c-mark-size", `${F},domain=0:1,samples=2`, "\\addplot[blue,mark=*] {x};\n\\pgfplotsset{mark size=4pt}\n\\addplot[red,mark=*] {x+1};"],
  ["c-each-nth", `${F},domain=0:1,samples=5`, "\\addplot[blue] {x};\n\\pgfplotsset{each nth point=2}\n\\addplot[red] {x+1};"],
  ["c-unbounded", `${F},domain=-1:1,samples=5`, "\\addplot[blue] {1/x};\n\\pgfplotsset{unbounded coords=jump}\n\\addplot[red] {1/x+5};"],
  ["c-scope-lw", `${F},domain=0:1,samples=2`, "\\begin{scope}[line width=2pt]\n\\addplot[blue] {x};\n\\end{scope}\n\\addplot[red] {x+1};"],
  ["c-scope-green", `${F},domain=0:1,samples=2`, "\\begin{scope}[green]\n\\addplot[blue] {x};\n\\addplot {x+1};\n\\end{scope}\n\\addplot {x+2};"],
  ["c-scope-mark", `${F},domain=0:1,samples=2`, "\\begin{scope}[mark=square*]\n\\addplot[blue] {x};\n\\end{scope}\n\\addplot[red] {x+1};"],
  ["c-scope-domain", `${F},domain=0:1,samples=3`, "\\begin{scope}[/pgfplots/domain=2:3]\n\\addplot[blue] {x};\n\\end{scope}\n\\addplot[red] {x};"],
  ["c-group-green", `${F},domain=0:1,samples=2`, "{\\pgfplotsset{green}\n\\addplot {x};}\n\\addplot {x+1};"],
  ["c-every-plot-before", `${F},domain=0:1,samples=2`, "\\pgfplotsset{every axis plot/.append style={green}}\n\\addplot[blue] {x};"],
  ["c-legend-style", "domain=0:1,samples=2", "\\addplot {x};\n\\addlegendentry{a}\n\\pgfplotsset{legend style={draw=red}}"],
  ["c-xtick", "domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{xtick={0,0.5,1},ytick={0,1}}"],
  ["c-variable", `${F},domain=0:1,samples=2`, "\\addplot[blue] {x};\n\\pgfplotsset{variable=t}\n\\addplot[red] {t+1};"],
  ["c-samples-at", `${F},domain=0:1,samples=2`, "\\addplot[blue] {x};\n\\pgfplotsset{samples at={0,2,3}}\n\\addplot[red] {x+1};"],
  ["c-declare", `${F},domain=0:1,samples=2`, "\\pgfplotsset{declare function={f(\\x)=\\x+1;}}\n\\addplot[blue] {f(x)};\n\\pgfplotsset{declare function={f(\\x)=\\x+3;}}\n\\addplot[red] {f(x)};"],
  ["c-every-axis-plot-no", `${F},domain=0:1,samples=2`, "\\addplot {x};\n\\pgfplotsset{every axis plot no 0/.append style={green}}\n\\addplot {x+1};"]
];

// Follow-up on `mark` set inside a group (set d).
export const d: Array<[string, string, string]> = [
  ["d-group-tikzset-mark", `${F},domain=0:2,samples=2`, "{\\tikzset{mark=x}\n\\addplot[blue] {x};}\n\\addplot[red] {x+1};"],
  ["d-group-pgfplotsset-mark", `${F},domain=0:2,samples=2`, "{\\pgfplotsset{mark=x}\n\\addplot[blue] {x};}\n\\addplot[red] {x+1};"],
  ["d-group-domain-mark", `${F},domain=0:2,samples=2`, "{\\tikzset{/pgfplots/domain=1:2,mark=x}\n\\addplot[blue] {x};}"],
  ["d-top-domain-mark", `${F},domain=0:2,samples=2`, "\\tikzset{/pgfplots/domain=1:2,mark=x}\n\\addplot[blue] {x};"],
  ["d-group-forget", `${F},domain=0:2,samples=2`, "{\\pgfplotsset{forget plot}\n\\addplot {x};}\n\\addplot {x+1};"],
  ["d-group-each-nth", `${F},domain=0:2,samples=5`, "{\\pgfplotsset{each nth point=2}\n\\addplot[blue] {x};}\n\\addplot[red] {x+1};"]
];

// Colour set by a TikZ key in the body (set e).
export const e: Array<[string, string, string]> = [
  ["e-green-all", "domain=0:1,samples=2,title=T,xlabel=X", "\\addplot {x};\n\\addlegendentry{L}\n\\node at (axis cs:0.5,0.5) {N};\n\\pgfplotsset{green}"],
  ["e-tikzset-green", "domain=0:1,samples=2,title=T", "\\addplot {x};\n\\tikzset{green}"],
  ["e-text-green", "domain=0:1,samples=2,title=T", "\\addplot {x};\n\\pgfplotsset{text=green}"],
  ["e-draw-green", "domain=0:1,samples=2,title=T", "\\addplot {x};\n\\pgfplotsset{draw=green,fill=red}"],
  ["e-color-key", "domain=0:1,samples=2,title=T", "\\addplot {x};\n\\pgfplotsset{color=orange}"],
  ["e-group-green", "domain=0:1,samples=2,title=T", "\\addplot {x};\n{\\pgfplotsset{green}}"],
  ["e-font", "domain=0:1,samples=2,title=T", "\\addplot {x};\n\\pgfplotsset{font=\\large}"],
  ["e-before-plot", "domain=0:1,samples=2,title=T", "\\pgfplotsset{green}\n\\addplot {x};"]
];

const set = process.env.E24_SET === "b" ? b : process.env.E24_SET === "c" ? c : process.env.E24_SET === "d" ? d : process.env.E24_SET === "e" ? e : a;
export const NAME = `e24-body-settings${process.env.E24_SET ? `-${process.env.E24_SET}` : ""}`;
export const CASES = set.map(([id, opt, plots]) => ({ id, meta: { opt }, body: axisBody(opt, plots) }));
