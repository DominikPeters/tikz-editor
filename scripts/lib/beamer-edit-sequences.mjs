/** Pure generation: safe to run in the supervisor without loading the renderer. */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export const EDIT_FIELDS = ["text", "class-font", "aspect", "theme", "alignment", "date", "width", "rotation", "overlay", "color", "comment", "title", "scope", "bounds-width"];
export function withEditProbes(source) {
  // Freeze the date even for imported reproducers, including long runs crossing midnight.
  const preamble = String.raw`\newcommand{\editprobetext}{EditAlpha}
\definecolor{editpaint}{RGB}{255,0,255}
% edit-comment: initial
% edit-date
\year=2026\month=11\day=6
`;
  const probe = String.raw`\begin{frame}{EditTitleA}
\begin{tikzpicture}[remember picture,overlay,rotate=0]
% edit-layer-probe
\fill[editpaint] (-1,0) rectangle (1,0.6);
\node<2-> at (0,0) {EditNode};
\end{tikzpicture}
\end{frame}
\begin{frame}EditNeighbor
\begin{tikzpicture}
% edit-bounds
\fill[editpaint] (-1,0) rectangle (1,0.6);
\fill[editpaint,rotate=-25] (0,0) ellipse[x radius=.325cm,y radius=.35cm];
\end{tikzpicture}
\end{frame}
`;
  const themed = /\\usetheme\{/u.test(source) ? source : source.replace("\\usepackage{tikz}", "\\usepackage{tikz}\n\\usetheme{default}");
  return themed.replace("\\begin{document}", preamble + "\\begin{document}")
    .replace("\\begin{frame}", "\\begin{frame}\\raggedright \\editprobetext\\par ")
    .replace("\\end{document}", probe + "\\end{document}");
}

export function setBeamerEditField(source, field, value, probeVersion = source.includes("% edit-bounds") ? 2 : 1) {
  const replace = (pattern, project) => {
    const match = pattern.exec(source);
    return match ? source.slice(0, match.index) + project(match) + source.slice(match.index + match[0].length) : source;
  };
  switch (field) {
    case "text": return replace(/\\newcommand\{\\editprobetext\}\{[^}]*\}/u, () => `\\newcommand{\\editprobetext}{${value}}`);
    case "class-font": return replace(/(\\documentclass\[)\d+pt/u, m => `${m[1]}${value}pt`);
    case "aspect": return replace(/aspectratio=\d+/u, () => `aspectratio=${value}`);
    case "theme": return replace(/\\usetheme\{[^}]*\}/u, () => `\\usetheme{${value}}`);
    case "alignment": return replace(/\\(?:centering|raggedright|raggedleft)(?= \\editprobetext)/u, () => `\\${value}`);
    case "date": return replace(/(?<=% edit-date\n)\\year=\d+\\month=\d+\\day=\d+/u, () => `\\year=${value}\\month=11\\day=6`);
    case "width": {
      if (probeVersion !== 2 && /\\fill\[editpaint\] \(0,0\) rectangle/u.test(source)) {
        return replace(/(\\fill\[editpaint\] \(0,0\) rectangle \()[\d.]+(,0\.6\);)/u, m => `${m[1]}${value}${m[2]}`);
      }
      // Version-1 recipes had only one probe. New recipes retain its identity
      // after source reduction even when a different picture remains.
      const pattern = probeVersion === 2
        ? /(% edit-(?:layer-probe|overlay)\n)\\fill\[editpaint\] \(-[\d.]+,0\) rectangle \([\d.]+,0\.6\);/u
        : /()\\fill\[editpaint\] \(-[\d.]+,0\) rectangle \([\d.]+,0\.6\);/u;
      return replace(pattern, m => `${m[1]}\\fill[editpaint] (-${value},0) rectangle (${value},0.6);`);
    }
    case "bounds-width": return replace(/(% edit-bounds\n)\\fill\[editpaint\] \(-[\d.]+,0\) rectangle \([\d.]+,0\.6\);/u,
      m => `${m[1]}\\fill[editpaint] (-${value},0) rectangle (${value},0.6);`);
    case "rotation": return replace(/(remember picture,overlay,rotate=)-?[\d.]+/u, m => `${m[1]}${value}`);
    case "overlay": return replace(/\\node<[^>]+>(?= at \(0,0\) \{EditNode\})/u, () => `\\node<${value}>`);
    case "color": return replace(/\\definecolor\{editpaint\}\{RGB\}\{[^}]*\}/u, () => `\\definecolor{editpaint}{RGB}{${value}}`);
    case "comment": return replace(/% edit-comment:[^\n]*/u, () => `% edit-comment: ${value}`);
    case "title": return replace(/\\begin\{frame\}\{EditTitle[^}]*\}/u, () => `\\begin{frame}{EditTitle${value}}`);
    case "scope": return replace(/(?<= )(?:\{\\(?:centering|raggedright|raggedleft) )?\\editprobetext(?:\\par\})?/u,
      () => value === "plain" ? "\\editprobetext" : `{\\${value} \\editprobetext\\par}`);
  }
}

const VALUES = {
  text: ["EditAlpha", "EditAlpha stretches across several ordinary words", "EditBeta", "EditGamma"],
  "class-font": ["8", "9", "10", "11", "12", "14", "17", "20"], aspect: ["43", "169"],
  theme: ["default", "Madrid", "Boadilla"], alignment: ["centering", "raggedright", "raggedleft"], date: ["2000", "2024", "2026", "2031"],
  "bounds-width": ["0.01", "0.2", "1", "3"], width: ["0.01", "0.2", "0.6", "1", "2.4", "4.5"], rotation: ["0", "15", "-25", "45"],
  overlay: ["1-", "2-", "2", "2-3", "3-"], color: ["255,0,255", "18,137,67", "0,128,255"],
  comment: ["short", "long offset with astral 🖉 and accented é", "🖉🖉", ""], title: ["A", "B", "LongerTitle"], scope: ["plain", "centering", "raggedleft"],
};

export function generateBeamerEditSequence(source, family, seed, steps) {
  const random = makeRng(seed), pick = values => values[Math.floor(random() * values.length)];
  const actions = [{ kind: "navigate", frame: 0, step: 1 }, { kind: "neighbors" },
    { kind: "navigate", frame: 1, step: 2 }, { kind: "layer", enabled: true },
    { kind: "set", field: "width", value: "0.2", mode: "typing", render: true },
    { kind: "set", field: "width", value: "1", mode: "typing", render: true },
    { kind: "navigate", frame: 0, step: 1 }];
  let current = source;
  for (let index = 0; index < steps; index++) {
    const field = index < EDIT_FIELDS.length ? EDIT_FIELDS[index] : pick(EDIT_FIELDS);
    const choices = VALUES[field].filter(value => setBeamerEditField(current, field, value) !== current);
    if (!choices.length) continue;
    const value = pick(choices);
    const probe = ["width", "rotation", "overlay", "title"].includes(field);
    actions.push({ kind: "navigate", frame: field === "bounds-width" ? 2 : probe ? 1 : 0, step: 1 + Math.floor(random() * 4), ...(field === "bounds-width" ? { picture: true } : {}) });
    if (probe) actions.push({ kind: "layer", enabled: true });
    const mode = index % 7 === 3 ? pick(["typing", "command"]) : pick(["typing", "typing", "command", "race"]);
    actions.push({ kind: "set", field, value, mode, render: index % 7 !== 3 });
    current = setBeamerEditField(current, field, value);
    if (index % 7 === 3) {
      const comment = `coalesced-${index}-🖉`;
      actions.push({ kind: "set", field: "comment", value: comment, mode: "typing", render: false }, { kind: "render" });
      current = setBeamerEditField(current, "comment", comment);
    }
    if (index % 5 === 0) actions.push({ kind: "neighbors" });
    if (index % 9 === 4) actions.push({ kind: "abort", afterYields: pick([1, 3, 8]) });
    if (index % 11 === 5) actions.push({ kind: "mask", enabled: true }, { kind: "mask", enabled: false });
    // The next mutation derives from the restored source during materialization.
    // Generate undo as a round trip so its modeled source remains current.
    if (index % 8 === 6) actions.push({ kind: "undo" }, { kind: "undo" });
  }
  actions.push({ kind: "navigate", frame: 1, step: 2 }, { kind: "navigate", frame: 0, step: 1 }, { kind: "render" });
  return { formatVersion: 1, probeVersion: source.includes("% edit-bounds") ? 2 : 1, seed, family, source, actions };
}
