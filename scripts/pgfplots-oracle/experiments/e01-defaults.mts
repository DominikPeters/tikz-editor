/** E01: read documented defaults at run time (values of documented keys/macros). */
import { axisBody, runExperiment, saveTable } from "./lib.js";

const keys = [
  "width", "height", "max space between ticks", "try min ticks", "try min ticks log", "major tick length", "minor tick length",
  "enlargelimits", "enlarge x limits", "x tick placement tolerance", "minor tick num", "xtick", "scaled ticks", "tick align", "xtick pos", "tick pos",
  "scale ticks below exponent", "scale ticks above exponent", "samples", "domain", "xtick distance", "compat",
];
const recs = keys.map((k) => `\\xrec{${k}=\\pgfkeysvalueof{/pgfplots/${k}}}`).join("\n");
const macros = ["axisdefaultwidth", "axisdefaultheight"].map((m) => `\\xrec{\\string\\${m}=\\csname ${m}\\endcsname}`).join("\n");
const body = axisBody("", "\\addplot coordinates {(0,0) (1,1)};", `\\pgfplotsextra{${recs}\n${macros}\\xrec{markstyle=\\pgfkeysvalueof{/pgf/number format/precision}}}`);
const res = runExperiment("e01-defaults", [{ id: "defaults", body }], { probes: ["limits"] });
const rows = res[0]!.x.map(([k, v]) => ({ key: k, value: v }));
console.log(rows.map((r) => `${r.key} = ${r.value}`).join("\n"));
saveTable("e01-defaults", "defaults.tsv", rows);
