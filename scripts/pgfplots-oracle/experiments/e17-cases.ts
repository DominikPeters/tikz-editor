/**
 * E17 legend cases (behaviour L): discovery set `LEGEND_CASES`, fresh
 * validation set `LEGEND_CASES_B`. `CASES`/`NAME` are what check-cases.mts
 * reads (set chosen by E17_SET=a|b).
 */
const P3 = [
  "\\addplot coordinates {(0,0) (1,1)};",
  "\\addplot coordinates {(0,1) (1,2)};",
  "\\addplot coordinates {(0,2) (1,3)};",
].join("\n");
const AX = "scale only axis,width=200pt,height=150pt,xmin=-1,xmax=2,ymin=-1,ymax=4";

export const LEGEND_CASES: Array<[string, string, string]> = [
  ["base", AX, `${P3}\n\\legend{a,b,c}`],
  ["heights", AX, `${P3}\n\\legend{$x^2$,g,{\\Large Ag}}`],
  ["wide", AX, `${P3}\n\\legend{a,much wider entry,c}`],
  ["cols2", `${AX},legend columns=2`, `${P3}\n\\legend{a,bb,ccc}`],
  ["colsall", `${AX},legend columns=-1`, `${P3}\n\\legend{a,bb,ccc}`],
  ["left", `${AX},legend cell align=left`, `${P3}\n\\legend{a,much wider,c}`],
  ["right", `${AX},legend cell align=right`, `${P3}\n\\legend{a,much wider,c}`],
  ["pos-sw", `${AX},legend pos=south west`, `${P3}\n\\legend{a,b,c}`],
  ["pos-se", `${AX},legend pos=south east`, `${P3}\n\\legend{a,b,c}`],
  ["pos-nw", `${AX},legend pos=north west`, `${P3}\n\\legend{a,b,c}`],
  ["pos-ne", `${AX},legend pos=north east`, `${P3}\n\\legend{a,b,c}`],
  ["pos-one", `${AX},legend pos=outer north east`, `${P3}\n\\legend{a,b,c}`],
  ["drawnone", `${AX},legend style={draw=none,fill=yellow}`, `${P3}\n\\legend{a,b,c}`],
  ["onlymarks", AX, "\\addplot+[only marks] coordinates {(0,0) (1,1)};\n\\addplot+[no markers] coordinates {(0,1) (1,2)};\n\\addplot[red,thick] coordinates {(0,2) (1,3)};\n\\legend{a,b,c}"],
  ["area", `${AX},area legend`, "\\addplot+[fill=red!30] coordinates {(0,0) (1,1)};\n\\addplot+[line legend] coordinates {(0,1) (1,2)};\n\\legend{a,b}"],
  ["empty", AX, "\\addplot coordinates {(0,0) (1,1)};\n\\addlegendimage{empty legend}\n\\addplot coordinates {(0,1) (1,2)};\n\\legend{a,sep,b}"],
  ["plotright", `${AX},legend plot pos=right`, `${P3}\n\\legend{a,bb,c}`],
  ["plotnone", `${AX},legend plot pos=none`, `${P3}\n\\legend{a,bb,c}`],
  ["reverse", `${AX},reverse legend`, `${P3}\n\\legend{a,b,c}`],
  ["transpose", `${AX},legend columns=2,transpose legend`, `${P3}\n\\addplot coordinates {(0,3) (1,4)};\n\\legend{a,b,c,d}`],
  ["fewer", AX, `${P3}\n\\legend{a,b}`],
  ["more", AX, "\\addplot coordinates {(0,0) (1,1)};\n\\legend{a,b,c}"],
  ["emptyentry", AX, `${P3}\n\\legend{a,,c}`],
  ["forget", AX, "\\addplot coordinates {(0,0) (1,1)};\n\\addplot+[forget plot] coordinates {(0,1) (1,2)};\n\\addplot coordinates {(0,2) (1,3)};\n\\legend{a,b}"],
  ["entryopts", AX, "\\addplot coordinates {(0,0) (1,1)};\\addlegendentry[red]{a}\n\\addplot coordinates {(0,1) (1,2)};\\addlegendentry[font=\\small]{b}"],
  ["font", `${AX},legend style={font=\\small}`, `${P3}\n\\legend{a,b,c}`],
  ["postmark", `${AX},legend image post style={mark=*}`, "\\addplot+[no markers] coordinates {(0,0) (1,1)};\n\\legend{a}"],
  ["marksize", AX, "\\addplot+[mark size=4pt,thick] coordinates {(0,0) (1,1)};\n\\legend{a}"],
  ["entries", `${AX},legend entries={a,[red]b}`, "\\addplot coordinates {(0,0) (1,1)};\n\\addplot coordinates {(0,1) (1,2)};"],
];

const AXB = "width=230pt,height=170pt";
const P5 = [1, 2, 3, 4, 5].map((i) => `\\addplot coordinates {(0,${i}) (1,${i + 1}) (2,${i})};`).join("\n");
const P10 = Array.from({ length: 10 }, (_, i) => `\\addplot coordinates {(0,${i}) (1,${i + 0.5})};`).join("\n");
/** Fresh validation set: new values for every rule of the discovery set, and combinations it never saw. */
export const LEGEND_CASES_B: Array<[string, string, string]> = [
  ["b-title", `${AXB},title=Title,xlabel=$x$,ylabel=$y$,legend pos=north west`, `${P5}\n\\legend{$a_1$,$b_2$,$c^3$,$d$,$e$}`],
  ["b-cols3", `${AXB},legend columns=3,legend style={at={(0.5,-0.2)},anchor=north}`, `${P5}\n\\legend{one,two,three,four,five}`],
  ["b-evencol", `${AXB},legend columns=-1,legend style={at={(axis description cs:0.5,1.02)},anchor=south,/tikz/every even column/.append style={column sep=0.4cm}}`, `${P5}\n\\legend{p,q,r,s,t}`],
  ["b-colsep", `${AXB},legend columns=2,legend style={column sep=5pt,row sep=3pt}`, `${P5}\n\\legend{p,q,r,s,t}`],
  ["b-cycle10", `${AXB},legend pos=outer north east`, `${P10}\n\\legend{0,1,2,3,4,5,6,7,8,9}`],
  ["b-dots", `${AXB},legend pos=south east`, `${P5}\n\\legend{1,2,...,5}`],
  ["b-sep", `${AXB},legend style={inner sep=5pt,draw=red,fill=blue!10,thick}`, `${P5}\n\\legend{a,b,c,d,e}`],
  ["b-rounded", `${AXB},legend style={rounded corners=2pt,legend cell align=left}`, `${P5}\n\\legend{alpha,be,gammagamma,d,e}`],
  ["b-entryopts", AXB, "\\addplot coordinates {(0,0) (1,1)};\\addlegendentry[blue]{blue text}\n\\addplot+[dashed,mark options={fill=yellow}] coordinates {(0,1) (1,2)};\\addlegendentry[text=green!50!black]{green}\n\\addplot+[only marks,mark=triangle*] coordinates {(0,2) (1,3)};\\addlegendentry{marks}"],
  ["b-image", `${AXB},legend style={nodes={right}}`, "\\addplot coordinates {(0,0) (1,1)};\\addlegendentry{x}\n\\addlegendimage{red,ultra thick}\\addlegendentry{red}\n\\addlegendimage{only marks,mark=square*,blue}\\addlegendentry{sq}\n\\addlegendimage{area legend,fill=gray!40,draw=black}\\addlegendentry{area}"],
  ["b-post", `${AXB},legend image post style={thick,mark=x}`, "\\addplot+[forget plot,only marks] coordinates {(0,0) (1,1)};\n\\addplot+[no markers] coordinates {(0,1) (1,2)};\n\\addplot[green!60!black] coordinates {(0,2) (1,3)};\n\\legend{line,plain}"],
  ["b-revtrans", `${AXB},legend columns=3,transpose legend,reverse legend,legend style={at={(1.02,0)},anchor=south west}`, `${P5}\n\\legend{a,b,c,d,e}`],
  ["b-entrykey", `${AXB},legend entries={{[red]first},second,{third, with comma}},legend plot pos=right`, `${P5}`],
  ["b-textwidth", `${AXB},legend style={nodes={text width=40pt}}`, "\\addplot coordinates {(0,0) (1,1)};\n\\addplot coordinates {(0,1) (1,2)};\n\\legend{short,a somewhat longer entry}"],
  ["b-addleg-order", AXB, "\\addlegendentry{early}\n\\addplot coordinates {(0,0) (1,1)};\n\\addplot coordinates {(0,1) (1,2)};\n\\addlegendentry{late}"],
  ["b-legend-wins", `${AXB},legend entries={x,y}`, "\\addplot coordinates {(0,0) (1,1)};\\addlegendentry{a}\n\\addplot coordinates {(0,1) (1,2)};\\addlegendentry{b}\n\\legend{L1,L2}"],
  ["b-markopts", `${AXB},mark size=3pt`, "\\addplot+[mark=pentagon*,mark options={fill=red,scale=1.5}] coordinates {(0,0) (1,1)};\n\\addplot+[mark=o,very thick] coordinates {(0,1) (1,2)};\n\\legend{pent,circ}"],
  ["b-fill", AXB, "\\addplot[fill=red!20,draw=red] coordinates {(0,0) (1,1) (2,0)};\n\\addplot+[area legend,fill=blue!20] coordinates {(0,1) (1,2) (2,1)};\n\\legend{filled line,filled area}"],
];

const SET = process.env.E17_SET ?? "a";
export const NAME = "e17-legend-check";
export const CASES = (SET === "b" ? LEGEND_CASES_B : LEGEND_CASES).map(([id, opt, plots]) => ({ id, body: `\\begin{tikzpicture}\\begin{axis}[${opt}]\n${plots}\n\\end{axis}\\end{tikzpicture}` }));
