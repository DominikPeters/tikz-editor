/**
 * E17: table input (behaviour section V). Each case plots an inline table
 * into fixed limits; the digest gives the plotted path in data units, so
 * which rows survive, in which order, and where the line jumps can be read
 * directly. Run: node --import tsx scripts/pgfplots-oracle/experiments/e17-tables.mts
 */
import { axisBody, runExperiment } from "./lib.js";
import { digest } from "./digest.js";

const L = "xmin=-1,xmax=10,ymin=-1,ymax=10";
const cases: Array<[string, string, string, string?]> = [
  ["names", L, "\\addplot table [x=b,y=a] {\na b c\n1 2 3\n4 5 6\n};"],
  ["index", L, "\\addplot table [x index=2,y index=0] {\na b c\n1 2 3\n4 5 6\n};"],
  ["name-over-index", L, "\\addplot table [x=c,x index=0,y=a] {\na b c\n1 2 3\n4 5 6\n};"],
  ["no-header-default", L, "\\addplot table {\n1 2 3\n4 5 6\n};"],
  ["header-false", L, "\\addplot table [header=false] {\n1 2 3\n4 5 6\n};"],
  ["has-colnames", L, "\\addplot table [header=has colnames,x=3,y=1] {\n1 2 3\n4 5 6\n7 8 9\n};"],
  ["skip-first", L, "\\addplot table [skip first n=2] {\njunk line here\nmore junk\na b\n1 2\n3 4\n};"],
  // A `#` line cannot be tested here: the harness passes the body through a macro, where TeX rejects `#`.
  ["comments", L, "\\addplot table {\n% first\na b\n% second\n1 2\n%third\n3 4\n};"],
  ["comment-chars", L, "\\addplot table [comment chars=!] {\n! c\na b\n1 2 ! tail\n3 4\n};"],
  ["comma", L, "\\addplot table [col sep=comma] {\na,b\n1, 2\n3 ,4\n};"],
  ["semicolon", L, "\\addplot table [col sep=semicolon] {\na;b\n1;2\n3;4\n};"],
  ["colon", L, "\\addplot table [col sep=colon] {\na:b\n1:2\n3:4\n};"],
  ["ampersand", L, "\\addplot table [col sep=&, row sep=\\\\] {\na & b \\\\ 1 & 2 \\\\ 3 & 4 \\\\\n};"],
  ["crcr", L, "\\addplot table [row sep=crcr] {%\na b\\\\\n1 2\\\\\n3 4\\\\\n};"],
  ["nan-discard", L, "\\addplot table {\na b\n1 1\n2 nan\n3 3\n4 inf\n5 5\n6 -inf\n7 7\n};"],
  ["nan-jump", `${L},unbounded coords=jump`, "\\addplot table {\na b\n1 1\n2 nan\n3 3\n4 inf\n5 5\n};"],
  ["nan-limits", "", "\\addplot table {\na b\n1 1\n2 nan\n3 3\nnan 9\n};"],
  ["empty-line", L, "\\addplot table {\na b\n1 1\n2 2\n\n3 3\n4 4\n};"],
  ["expr-coordindex", L, "\\addplot table [x expr=\\coordindex, y expr=\\thisrow{b}*2] {\n% c\na b\n5 1\n% c\n6 2\n\n7 3\n};"],
  ["expr-lineno", L, "\\addplot table [x expr=\\lineno, y expr=\\thisrowno{1}] {%\na b\n5 1\n% c\n6 2\n\n7 3\nnan 4\n8 5\n};"],
  ["expr-lineno-skip", L, "\\addplot table [skip first n=1, x expr=\\lineno, y expr=\\coordindex] {\njunk\na b\n5 1\n6 2\n};"],
  ["each-nth", L, "\\addplot table [x=a,y=b,each nth point=3] {\na b\n0 0\n1 1\n2 2\n3 3\n4 4\n5 5\n6 6\n7 7\n};"],
  ["each-nth-plot", L, "\\addplot[each nth point=3] table {\na b\n0 0\n1 1\n2 2\n3 3\n4 4\n5 5\n6 6\n7 7\n};"],
  ["restrict-expr", L, "\\addplot[restrict expr to domain={\\thisrow{a}}{2:5}] table {\na b\n0 0\n1 1\n2 2\n3 3\n4 4\n5 5\n6 6\n};"],
  ["restrict-expr-star", L, "\\addplot[restrict expr to domain*={\\thisrow{a}}{2:5}] table {\na b\n0 0\n1 1\n2 2\n3 3\n4 4\n5 5\n6 6\n};"],
  ["restrict-expr-limits", "", "\\addplot[restrict expr to domain={\\coordindex}{1:2}] table {\na b\n0 0\n1 1\n2 2\n3 3\n};"],
  ["ignore-chars", L, "\\addplot table [ignore chars={(,)}] {\na b\n(1) (2)\n(3) 4\n};"],
  ["whitespace-chars", L, "\\addplot table [white space chars={;}] {\na b\n1;2\n3 ; 4\n};"],
  ["pgfplotstableread", L, "\\addplot table [x=b,y=a] {\\tbl};", "\\pgfplotstableread[row sep=\\\\]{a b\\\\ 1 2\\\\ 3 4\\\\}\\tbl"],
  ["pgfplotstableread-nl", L, "\\addplot table [x=b,y=a] {\\tbl};", "\\pgfplotstableread{\na b\n1 2\n3 4\n}\\tbl"],
  ["table-set", L, "\\addplot table {\na,b\n1,2\n3,4\n};", "\\pgfplotstableset{col sep=comma}"],
  ["each-nth-nan", L, "\\addplot table [each nth point=2] {\na b\n0 0\n1 nan\n2 2\n3 3\n4 4\n};"],
  ["coordindex-nan", L, "\\addplot table [x expr=\\coordindex, y=b] {\na b\n0 0\n1 nan\n2 2\n\n3 3\n};"],
  ["skip-first-brace", L, "\\addplot table [skip first n=1] {%\njunk line\na b\n1 2\n3 4\n};"],
  ["short-row", L, "\\addplot table [x=a,y=c] {\na b c\n1 2 3\n4 5\n6 7 8\n};"],
  ["trailing-percent", L, "\\addplot table {\na b\n1 2 % c\n3 4\n5 6\n};"],
  ["percent-line-empty", L, "\\addplot table {\na b\n1 1\n% c\n\n2 2\n3 3\n};"],
  ["numbers", L, "\\addplot table {\na b\n+1 .5e1\n2E0 1e-0\n};"],
  ["x-expr-only", L, "\\addplot table [x expr=\\thisrow{b}+1] {\na b\n1 2\n3 4\n};"],
  ["y-expr-columnx", L, "\\addplot table [x=a, y expr=\\thisrow{a}+\\thisrow{b}] {\na b\n1 2\n3 4\n};"],
];
const res = runExperiment("e17-tables", cases.map(([id, opt, plots, before]) => ({ id, meta: { opt }, body: axisBody(opt, plots, "", before ? `\n${before}` : "") })), { probes: ["limits", "map"] });
for (const r of res) {
  const lines = digest(r, { max: 20 }).split("\n").filter((line) => !/DeviceGray\(0\.5\)|DeviceGray\(0\) lw0\.4 clip0|glyphs|clip   /u.test(line));
  console.log(`== ${r.id}\n${lines.join("\n")}`);
}
