// A bounded document grammar. Visibility expectations come from the generated
// overlay program, independently of the renderer's Beamer decoder.
export const BROAD_ONLY_FAMILIES = [
  "alignment-environment", "picture-in-list", "list-builds", "overlay-union",
  "overlapping-shapes", "picture-transforms", "scoped-alignment", "multi-picture",
  "math-prose", "two-overlay-programs",
];
export const BEAMER_FUZZ_GENERATOR_VERSION = 4;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function generateBroadBeamerCases({ seed, cases, families }) {
  let state = seed >>> 0;
  const random = n => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) % n;
  };
  const pick = values => values[random(values.length)];
  const output = [];
  for (let index = 0; index < cases; index++) {
    const family = families[index < families.length ? index : random(families.length)];
    const alignment = pick(["centering", "raggedleft", "raggedright"]);
    const fontSize = pick([8, 9, 10, 11, 12, 14, 17, 20]);
    const aspectRatio = pick([43, 169]);
    const theme = pick(["default", "Madrid", "Boadilla"]);
    const columnMode = pick(["c", "t", "b", "T"]);
    const columnWidth = pick([.32, .4, .48, .56, .62]);
    const width = pick([.4, .65, 1, 1.35, 1.8, 2.25]);
    const height = pick([.4, .7, 1, 1.4, 1.8]);
    const shape = pick(["rectangle", "triangle", "circle", "ellipse"]);
    const transform = pick(["", "scale=.8", "scale=1.15", "rotate=15", "rotate=-25"]);
    const label = pick(["A", "Alpha", "Beta;]", "Kappa"]);
    const blockKind = pick(["block", "alertblock", "exampleblock"]);
    const environment = pick(["center", "flushleft", "flushright"]);
    const text = pick(["Alpha", "Alpha has a short argument.", "Alpha preserves the constraints."]);
    const tail = pick(["Omega", "Omega is the conclusion.", "Omega follows the picture."]);
    const dateFamily = family === "date" || family === "default-date";
    const chosenYear = pick([2000, 2024, 2026, 2031]), chosenMonth = 1 + random(12), chosenDay = 1 + random(28);
    // Do not manufacture source novelty with date registers unused by the case.
    const year = dateFamily ? chosenYear : 2026, month = dateFamily ? chosenMonth : 11, day = dateFamily ? chosenDay : 5;
    const from = 1 + random(4), to = from + random(3), open = random(2) === 0;
    const spec = open ? `${from}-` : from === to ? `${from}` : `${from}-${to}`;
    const active = step => step >= from && (open || step <= to);
    const programLast = open ? from : to;
    const paint = [], witnesses = new Set();
    let last = 1, animated = false;
    const register = (color, visible, minimumLast = 1) => {
      paint.push({ color, visible });
      last = Math.max(last, minimumLast);
    };
    const schedule = visible => { animated = true; last = Math.max(last, programLast); return visible; };
    const path = (color, overlay = "", dx = 0) => {
      const command = `\\fill${overlay ? `<${overlay}>` : ""}[${color}]`;
      if (shape === "circle") return `${command} (${dx},0) circle[radius=${width / 2}cm];`;
      if (shape === "ellipse") return `${command} (${dx},0) ellipse[x radius=${width / 2}cm,y radius=${height / 2}cm];`;
      if (shape === "triangle") return `${command} (${dx},0)--(${dx + width},0)--(${dx + width / 2},${height})--cycle;`;
      return `${command} (${dx},0) rectangle (${dx + width},${height});`;
    };
    const picture = (body, options = transform) => `\\begin{tikzpicture}${options ? `[${options}]` : ""}${body}\\end{tikzpicture}`;
    const columns = (body, mode = columnMode) => `\\begin{columns}[onlytextwidth,${mode}]\\begin{column}{${columnWidth}\\textwidth}${body}\\end{column}\\begin{column}{${Number((.94 - columnWidth).toFixed(2))}\\textwidth}Neighbor\\end{column}\\end{columns}`;
    const block = body => `\\begin{${blockKind}}{Block}${body}\\end{${blockKind}}`;
    const prose = () => { witnesses.add("Alpha"); witnesses.add("Omega"); return `${text}\\par ${tail}`; };
    const normal = () => { register("#ff00ff", () => true); return picture(path("fuzzpaint")); };
    const surround = body => { witnesses.add("Alpha"); witnesses.add("Omega"); return `${text}\\par ${body}\\par ${tail}`; };
    let body;
    switch (family) {
      case "alignment": body = `\\${alignment} ${prose()}`; break;
      case "column-alignment": body = columns(`\\${alignment} ${prose()}`); break;
      case "column-picture": body = columns(random(2) ? `\\begin{center}${normal()}\\end{center}` : `\\${alignment} ${normal()}`); break;
      case "mixed-center": body = `\\begin{center}${surround(normal())}\\end{center}`; if (random(2)) body = columns(body); break;
      case "block-picture": body = block(normal()); if (random(2)) body = columns(body); witnesses.add("Block"); break;
      case "column-block-alignment": body = columns(block(normal())); witnesses.add("Block"); break;
      case "mixed-alignment": body = `\\${alignment} ${surround(normal())}`; if (random(2)) body = columns(body); break;
      case "draw-overlay": register("#ff00ff", schedule(active)); body = picture(path("fuzzpaint", spec)); break;
      case "path-options-overlay": register("#ff00ff", schedule(active)); body = picture(path("fuzzpaint").replace("\\fill[fuzzpaint]", `\\path[fill=fuzzpaint]<${spec}>`)); break;
      case "node-overlay": {
        register("#ff00ff", schedule(active)); witnesses.add(label);
        body = picture(`\\node<${spec}>[fill=fuzzpaint,minimum width=${width}cm,minimum height=${height}cm] {${label}};`);
        break;
      }
      case "only-in-picture":
      case "uncover-in-picture":
      case "visible-in-picture":
      case "invisible-in-picture": {
        const command = family.replace("-in-picture", "");
        register("#ff00ff", schedule(step => command === "invisible" ? !active(step) : active(step)));
        body = picture(`\\${command}<${spec}>{${path("fuzzpaint")}}`);
        break;
      }
      case "outer-overlay": register("#ff00ff", schedule(active)); body = `\\only<${spec}>{${picture(path("fuzzpaint"))}}`; if (random(2)) body = columns(body); break;
      case "relative-overlays":
        animated = true; last = 2;
        register("#ff00ff", () => true); register("#128943", step => step >= 2);
        body = picture(`${path("fuzzpaint", "+-")}\\node<+-> at (0,0) {${label}};${path("fuzzsecond", ".-", width + .4)}`);
        witnesses.add(label); break;
      case "nested-overlays":
        animated = true; last = 3; register("#ff00ff", step => step >= 3);
        body = picture(`\\only<2->{\\uncover<3->{${path("fuzzpaint")}}}`); break;
      case "alt-in-picture":
        animated = true; last = 2; register("#ff00ff", step => step === 2); register("#128943", step => step !== 2);
        body = picture(`\\alt<2>{${path("fuzzpaint")}}{${path("fuzzsecond")}}`); break;
      case "overlay-flow":
      case "column-overlay-flow":
        register("#ff00ff", schedule(active)); body = surround(picture(path("fuzzpaint", spec))); if (family === "column-overlay-flow") body = columns(body); break;
      case "remembered-overlays":
        register("#ff00ff", schedule(active)); body = surround(picture(path("fuzzpaint", spec), "remember picture,overlay")); break;
      case "date": body = String.raw`Today: \today`; witnesses.add(MONTHS[month - 1]); witnesses.add(String(year)); break;
      case "default-date": body = String.raw`\titlepage`; witnesses.add(MONTHS[month - 1]); witnesses.add(String(year)); break;
      case "alignment-environment": body = `\\begin{${environment}}${surround(normal())}\\end{${environment}}`; if (random(2)) body = columns(body); break;
      case "picture-in-list":
        body = `\\begin{itemize}\\item ${text}\\par ${normal()}\\item ${tail}\\end{itemize}`;
        witnesses.add("Alpha"); witnesses.add("Omega"); if (random(2)) body = columns(body); break;
      case "list-builds":
        animated = true; last = 2; register("#ff00ff", step => step >= 2);
        body = `\\begin{enumerate}\\item<1-> ${text}\\item<2-> ${picture(path("fuzzpaint"))}\\par ${tail}\\end{enumerate}`;
        witnesses.add("Alpha"); witnesses.add("Omega"); if (random(2)) body = columns(body); break;
      case "overlay-union": {
        animated = true; last = from + 2; const union = `${from},${last}`;
        register("#ff00ff", step => step === from || step === last);
        body = surround(picture(path("fuzzpaint", union))); break;
      }
      case "overlapping-shapes":
        register("#ff00ff", () => true); register("#128943", () => true);
        body = picture(`${path("fuzzpaint")}\\begin{scope}[shift={(${width * .45},${height * .3})}]${path("fuzzsecond")}\\end{scope}`);
        break;
      case "picture-transforms": body = surround(normal()); if (random(2)) body = columns(body); break;
      case "scoped-alignment":
        witnesses.add("Alpha"); witnesses.add("Omega");
        body = `\\relax{\\${alignment} ${text}\\par}${normal()}\\par ${tail}`; break;
      case "multi-picture":
        register("#ff00ff", () => true); register("#128943", () => true);
        body = surround(`${picture(path("fuzzpaint"))}\\par ${picture(path("fuzzsecond"))}`); break;
      case "math-prose": body = `\\${alignment} Alpha $x_1+x^2$ is feasible.\\par ${normal()}\\par Omega $a\\leq b$.`; witnesses.add("Alpha"); witnesses.add("Omega"); if (random(2)) body = columns(body); break;
      case "two-overlay-programs": {
        animated = true; last = Math.max(programLast, 3);
        register("#ff00ff", active); register("#128943", step => step >= 2 && step <= 3);
        body = picture(`${path("fuzzpaint", spec)}${path("fuzzsecond", "2-3", width + .3)}`); break;
      }
      default: throw new Error(`Unknown broad family ${family}`);
    }
    // An independent empty overlay forces the page AFTER a range's endpoint.
    // This catches closed ranges that incorrectly remain visible forever.
    const pages = animated ? last + 1 : 1;
    if (animated) body += `\\only<${pages}>{}`;
    const id = `v2-seed-${seed}-${String(index).padStart(4, "0")}-${family}`;
    const source = `\\documentclass[${fontSize}pt,aspectratio=${aspectRatio}]{beamer}\n\\usepackage{tikz}\n${theme === "default" ? "" : `\\usetheme{${theme}}\n`}\\definecolor{fuzzpaint}{RGB}{255,0,255}\n\\definecolor{fuzzsecond}{RGB}{18,137,67}\n\\setbeamertemplate{navigation symbols}{}\n\\title{Probe}\n\\year=${year}\\month=${month}\\day=${day}\n${family === "default-date" ? "" : "\\date{}\n"}\\begin{document}\n\\begin{frame}${body}\\end{frame}\n\\end{document}\n`;
    output.push({ id, source, fixture: { id, file: `${id}.tex`, frame: 1, family, pages,
      choices: { alignment, spec, width, height, fontSize, aspectRatio, theme, columnMode, columnWidth, shape, transform, label, blockKind, environment, year, month, day },
      ...(paint.length ? { paintColors: paint.map(entry => ({ color: entry.color, visible: Array.from({ length: pages }, (_, i) => entry.visible(i + 1)) })) } : {}), oracleText: [...witnesses] } });
  }
  return output;
}
