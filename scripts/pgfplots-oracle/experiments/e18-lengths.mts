/**
 * E18: document lengths in axis sizes (behaviour section Y). The harness
 * preamble is article 10pt (\textwidth = \linewidth = 345pt, measured). Each
 * case prints the axis box size; the rule predicts width − 45pt etc. (A2).
 */
import { axisBody, rectOf, runExperiment } from "./lib.js";

const P = "\\addplot coordinates {(0,0) (1,1)};";
const cases: Array<[string, string, number | null, number | null]> = [
  ["textwidth-half", "width=0.5\\textwidth", 0.5 * 345 - 45, null],
  ["linewidth", "width=0.48\\linewidth", 0.48 * 345 - 45, null],
  ["columnwidth-braced", "width={0.9\\columnwidth}, height=0.3\\textwidth", 0.9 * 345 - 45, 0.3 * 345 - 45],
  ["divided", "width=\\textwidth/2.3", 345 / 2.3 - 45, null],
  ["times", "width=0.5*\\columnwidth", 0.5 * 345 - 45, null],
  // \axisdefaultwidth is a macro holding `240pt`, not a register: `0.8\axisdefaultwidth` is `0.8240pt` and TeX stops ("Plot width 0.824pt is too small").
  ["axisdefault", "width=\\axisdefaultwidth, height=\\axisdefaultheight", 240 - 45, 207 - 45],
  ["axisdefault-text", "scale only axis, width=1\\axisdefaultwidth", 1240, null],
  ["register", "width=\\figw", 0.45 * 345 - 45, null],
  ["register-scaled", "width=2\\figw, scale only axis", 2 * 0.45 * 345, null],
  ["macro", "width=\\figwidth", 6 * 72.27 / 2.54 - 45, null],
  ["textheight-scaled", "scale only axis, height=0.2\\textheight", null, 0.2 * 550],
];
const res = runExperiment("e18-lengths", cases.map(([id, opt]) => ({ id, meta: { opt }, body: axisBody(opt, P) })), {
  probes: ["limits", "map"],
  extraPreamble: "\\newlength\\figw\\setlength{\\figw}{0.45\\textwidth}\\def\\figwidth{6cm}"
});
let max = 0;
for (const r of res) {
  const rect = rectOf(r.axis);
  const [, , w, h] = cases.find((c) => c[0] === r.id) ?? [];
  const dw = w == null || !rect ? 0 : rect.rw - w;
  const dh = h == null || !rect ? 0 : rect.rh - h;
  max = Math.max(max, Math.abs(dw), Math.abs(dh));
  console.log(`${r.id.padEnd(20)} box ${rect?.rw.toFixed(4)} x ${rect?.rh.toFixed(4)}  predicted ${w?.toFixed(4) ?? "-"} x ${h?.toFixed(4) ?? "-"}  err ${dw.toFixed(4)} ${dh.toFixed(4)}`);
}
console.log(`max error ${max.toFixed(4)} pt`);
