import { BROAD_ONLY_FAMILIES, BEAMER_FUZZ_GENERATOR_VERSION, generateBroadBeamerCases } from "./beamer-fuzz-broad.mjs";
export { BEAMER_FUZZ_GENERATOR_VERSION };
// Small, valid documents crossing Beamer's text/flow/TikZ boundaries.
// Every run covers each family before sampling additional combinations.
export const BEAMER_FUZZ_SMOKE_FAMILIES = ["alignment", "column-alignment", "column-picture", "mixed-center", "block-picture", "draw-overlay", "node-overlay", "only-in-picture", "uncover-in-picture", "outer-overlay", "date", "default-date", "mixed-alignment", "path-options-overlay", "relative-overlays", "nested-overlays", "alt-in-picture", "visible-in-picture", "invisible-in-picture", "overlay-flow", "column-overlay-flow", "remembered-overlays", "column-block-alignment"];
export const BEAMER_FUZZ_FAMILIES = [...BEAMER_FUZZ_SMOKE_FAMILIES, ...BROAD_ONLY_FAMILIES];

export function generateBeamerFuzzCases({ seed = 20261105, cases = 48, profile = "broad" } = {}) {
  const families = profile === "smoke" ? BEAMER_FUZZ_SMOKE_FAMILIES : BEAMER_FUZZ_FAMILIES;
  if (!["smoke", "broad"].includes(profile)) throw new Error(`Unknown Beamer fuzz profile ${profile}.`);
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(cases) || cases < families.length) throw new Error(`Require an integer seed and at least ${families.length} cases.`);
  if (profile === "broad") return generateBroadBeamerCases({ seed, cases, families });
  return generateSmokeCases({ seed, cases });
}

function generateSmokeCases({ seed, cases }) {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(cases) || cases < BEAMER_FUZZ_SMOKE_FAMILIES.length) throw new Error(`Require an integer seed and at least ${BEAMER_FUZZ_SMOKE_FAMILIES.length} cases.`);
  let state = seed >>> 0;
  const next = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 8) % n; };
  const output = [];
  const column = (body, mode = "") => `\\begin{columns}[onlytextwidth${mode ? "," + mode : ""}]\\begin{column}{.48\\textwidth}${body}\\end{column}\\begin{column}{.48\\textwidth}Neighbor\\end{column}\\end{columns}`;
  const block = body => `\\begin{block}{Block}${body}\\end{block}`;
  for (let index = 0; index < cases; index++) {
    const family = BEAMER_FUZZ_SMOKE_FAMILIES[index < BEAMER_FUZZ_SMOKE_FAMILIES.length ? index : next(BEAMER_FUZZ_SMOKE_FAMILIES.length)];
    const alignment = ["centering", "raggedleft", "raggedright"][next(3)];
    const step = 2 + next(2), end = step + next(2);
    const spec = next(2) ? `${step}-` : `${step}-${end}`;
    const steps = spec.endsWith("-") ? step : end;
    const w = 1 + next(3), h = 1 + next(2);
    // Unique flat paint catches missing paths even when glyphs match.
    const path = `\\fill[fuzzpaint] (0,0) rectangle (${w},${h});`;
    const picture = inner => `\\begin{tikzpicture}${inner}\\end{tikzpicture}`;
    const normal = picture(path);
    let body, pages = 1, visible = [true], paint = false;
    switch (family) {
      case "alignment": body = `\\${alignment} Alpha\\par Omega`; break;
      case "column-alignment": body = column(`\\${alignment} Alpha\\par Omega`); break;
      case "column-picture": body = column(next(2) ? `\\begin{center}${normal}\\end{center}` : `\\${alignment} ${normal}`); paint = true; break;
      case "mixed-center": body = `\\begin{center}Alpha\\par ${normal}\\par Omega\\end{center}`; if (next(2)) body = column(body); paint = true; break;
      case "block-picture": body = block(normal); if (next(2)) body = column(body); paint = true; break;
      case "draw-overlay": body = picture(`\\fill<${spec}>[fuzzpaint] (0,0) rectangle (${w},${h});`); pages = steps; paint = true; break;
      case "node-overlay": body = picture(`\\node<${spec}>[fill=fuzzpaint,minimum width=${w}cm,minimum height=${h}cm] {Alpha};`); pages = steps; paint = true; break;
      case "only-in-picture": body = picture(`\\only<${spec}>{${path}}`); pages = steps; paint = true; break;
      case "uncover-in-picture": body = picture(`\\uncover<${spec}>{${path}}`); pages = steps; paint = true; break;
      case "outer-overlay": body = `\\only<${spec}>{${normal}}`; if (next(2)) body = column(body); pages = steps; paint = true; break;
      case "mixed-alignment": body = `\\${alignment} Alpha\\par ${normal}\\par Omega`; if (next(2)) body = column(body); paint = true; break;
      case "path-options-overlay": body = picture(`\\path[fill=fuzzpaint]<${spec}> (0,0) rectangle (${w},${h});`); pages = steps; paint = true; break;
      case "relative-overlays": body = picture(`\\fill<+->[fuzzpaint] (0,0) rectangle (${w},${h});\\node<+-> at (0,0) {Alpha};`); pages = 2; paint = true; visible = [true,true]; break;
      case "nested-overlays": body = picture(`\\only<2->{\\uncover<3->{${path}}}`); pages = 3; paint = true; visible = [false,false,true]; break;
      case "alt-in-picture": body = picture(`\\alt<2>{${path}}{\\fill[blue] (0,0) rectangle (${w},${h});}`); pages = 2; paint = true; visible = [false,true]; break;
      case "visible-in-picture": body = picture(`\\visible<${spec}>{${path}}`); pages = steps; paint = true; break;
      case "invisible-in-picture": body = picture(`\\invisible<${spec}>{${path}}`); pages = steps; paint = true; break;
      case "overlay-flow":
      case "column-overlay-flow": body = `Alpha\\par ${picture(`\\fill<2->[fuzzpaint] (0,0) rectangle (${w},${h});`)}\\par Omega`; if (family === "column-overlay-flow") body = column(body); pages = 2; paint = true; visible = [false,true]; break;
      case "remembered-overlays": body = `Alpha\\par \\begin{tikzpicture}[remember picture,overlay]\\fill<${spec}>[fuzzpaint] (0,0) rectangle (${w},${h});\\end{tikzpicture}\\par Omega`; pages = steps; paint = true; break;
      case "column-block-alignment": body = column(block(normal), ["t", "b", "T"][w - 1]); paint = true; break;
      case "date": body = String.raw`Today: \today`; break;
      case "default-date": body = String.raw`\titlepage`; break;
    }
    if (pages > 1 && !["relative-overlays", "nested-overlays", "alt-in-picture", "overlay-flow", "column-overlay-flow"].includes(family)) visible = Array.from({length: pages}, (_, i) => i + 1 >= step && (spec.endsWith("-") || i + 1 <= end));
    if (family === "invisible-in-picture") visible = visible.map(value => !value);
    const id = `seed-${seed}-${String(index).padStart(3,"0")}-${family}`;
    const source = `\\documentclass[11pt,aspectratio=169]{beamer}\n\\usepackage{tikz}\n\\definecolor{fuzzpaint}{RGB}{255,0,255}\n\\setbeamertemplate{navigation symbols}{}\n\\title{Probe}\n\\year=2026\\month=11\\day=5\n${family === "default-date" ? "" : "\\date{}\n"}\\begin{document}\n\\begin{frame}${body}\\end{frame}\n\\end{document}\n`;
    output.push({ id, source, fixture: { id, file: `${id}.tex`, frame: 1, family, pages, choices: { alignment, spec, width: w, height: h }, ...(paint ? { paintColors: [{ color: "#ff00ff", visible }] } : {}), oracleText: family === "column-block-alignment" ? ["Block", "Neighbor"] : family.includes("date") ? ["November", "2026"] : family.includes("alignment") || family === "mixed-center" ? ["Alpha","Omega"] : family === "node-overlay" ? ["Alpha"] : [] } });
  }
  return output;
}
