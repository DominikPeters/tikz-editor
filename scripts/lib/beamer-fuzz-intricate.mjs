import { imageProduction } from "./beamer-fuzz-images.mjs";
// Typed flow grammar: recursive block productions respect list depth and the
// available column width. Decisions are made before rendering, independently
// of either the native parser or TeX. Record the tree for auditing and replay.
export const INTRICATE_FAMILIES = ["nested-flow", "diagram-build", "math-layout", "table-flow", "scoped-typography", "overlay-composition", "image-layout"];
const TOPICS = ["Constraint propagation", "Cache invalidation", "Iterative refinement", "Message passing", "Geometric uncertainty", "Incremental analysis"];
const CLAUSES = [
  "A local update can change the measurements used by several neighboring components.",
  "The next pass must preserve the boundary conditions while revisiting dependent values.",
  "We compare the proposed solution with a reference computed from the complete input.",
  "Intermediate results carry both a numerical estimate and an explicit dependency set.",
  "A narrow column can change line breaking even when the underlying expression is unchanged.",
  "The final diagram records the order in which information crosses the partition.",
];
export function generateIntricateBeamerCases({ seed, cases, offset = 0 }) {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(cases) || cases < 1 || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid intricate campaign size or seed");
  return Array.from({ length: cases }, (_, localIndex) => {
    const index = offset + localIndex;
    let state = (seed + Math.imul(index + 1, 7919)) >>> 0;
    const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 8) % n; };
    const pick = xs => xs[random(xs.length)];
    const family = INTRICATE_FAMILIES[index % INTRICATE_FAMILIES.length];
    const fontSize = pick([9, 10, 11, 12]), aspectRatio = pick([43, 169]), theme = pick(["default", "Madrid", "Boadilla"]);
    const maxDepth = 4 + random(3), budget = 24 + random(13), pageCount = 3 + random(3);
    const features = {}, productions = [], pairs = new Set();
    let nextId = 0, maxObservedDepth = 0, anchored = false;
    const count = kind => { features[kind] = (features[kind] ?? 0) + 1; };
    const node = (kind, depth, parent, extra = {}) => {
      count(kind); maxObservedDepth = Math.max(maxObservedDepth, depth);
      if (parent) pairs.add(`${parent}>${kind}`);
      const result = { id: nextId++, kind, ...extra }; productions.push(result); return result;
    };
    const leaves = ["paragraph", "paragraph", "diagram", "equation", "table", "image", "image-node"];
    const expand = (depth, context, parent, forced, allowance = budget) => {
      const containers = ["group", "alignment", "block", "overlay", "sequence", ...(context.listDepth < 3 ? ["list", "list"] : []), ...(context.columnDepth < 2 && context.width > 4 && allowance >= 3 ? ["columns"] : [])];
      let kind = forced ?? (allowance <= 1 || depth >= maxDepth ? pick(leaves) : pick(depth < 3 ? containers : [...containers, ...leaves]));
      if (!forced && depth === 1 && allowance >= 5) kind = pick(containers.filter(value => ["columns", "list", "sequence"].includes(value)));
      if (!forced && !anchored && (allowance <= 1 || depth >= 3)) {
        kind = { "nested-flow": "paragraph", "diagram-build": "diagram", "math-layout": "equation", "table-flow": "table", "scoped-typography": "paragraph", "overlay-composition": "diagram", "image-layout": "image" }[family];
        anchored = true;
      }
      const result = node(kind, depth, parent);
      let divisor = 1;
      const child = (ctx = context, force) => expand(depth + 1, ctx, kind, force, Math.max(1, Math.floor((allowance - 1) / divisor)));
      if (kind === "image" || kind === "image-node") {
        result.image = imageProduction(random);
        for (const option of result.image.options) count(`graphics-key:${option.split("=")[0]}`);
        count(`graphics-format:${result.image.filename.split(".").at(-1)}`);
        return result;
      }
      if (kind === "paragraph") Object.assign(result, { sentences: [pick(CLAUSES), ...(random(3) === 0 ? [pick(CLAUSES)] : [])], math: pick(["x_i+x_{i+1}", "\\alpha+\\beta", "\\frac{a+b}{1+c}", "\\sum_{i=1}^{n}x_i"]), emphasis: pick(["textbf", "textit", "textrm"]) });
      else if (kind === "diagram") Object.assign(result, { width: Math.min(context.width * .75, 4.2), vertices: 4 + random(4), rotation: pick([0, -12, 17]), scale: pick([.8, 1, 1.1]), curve: Boolean(random(2)), clip: random(3) === 0, loop: Boolean(random(2)), overlay: random(2) ? "2-" : "1-", diagramId: result.id });
      else if (kind === "equation") result.expression = pick(["E=\\sum_{i=1}^{n}w_i x_i", "\\begin{aligned}a+b&=c\\\\ d-e&=f\\end{aligned}", "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\begin{pmatrix}x\\\\y\\end{pmatrix}"]);
      else if (kind === "table") result.rows = Array.from({ length: 2 + random(3) }, (_, row) => ({ label: pick(["Local", "Global", "Cached", "Fresh"]) + row, a: random(30), b: random(30) }));
      else if (kind === "columns") {
        divisor = 2;
        result.ratio = pick([.38, .46, .54, .62]); result.mode = pick(["t", "T", "c", "b"]);
        result.children = [child({ ...context, columnDepth: context.columnDepth + 1, width: context.width * result.ratio }), child({ ...context, columnDepth: context.columnDepth + 1, width: context.width * (.96 - result.ratio) })];
      } else if (kind === "list") {
        result.environment = pick(["itemize", "enumerate", "description"]);
        divisor = Math.min(allowance - 1, 2 + random(2));
        result.children = Array.from({ length: divisor }, () => child({ ...context, listDepth: context.listDepth + 1, width: Math.max(1.3, context.width - .6) }));
        result.build = Boolean(random(2));
      } else if (kind === "sequence") { divisor = Math.min(allowance - 1, 2 + random(2)); result.children = Array.from({ length: divisor }, () => child()); }
      else {
        if (kind === "group") Object.assign(result, { font: pick(["small", "footnotesize", "scriptsize"]), color: pick(["blue", "teal", "black"]), alignment: pick(["centering", "raggedleft", "raggedright"]) });
        if (kind === "alignment") result.environment = pick(["center", "flushleft", "flushright"]);
        if (kind === "block") Object.assign(result, { environment: pick(["block", "alertblock", "exampleblock"]), title: pick(TOPICS) });
        if (kind === "overlay") Object.assign(result, { command: pick(["only", "uncover", "visible", "alt"]), spec: pick(["1-2", "2-", "2-3", "1,3"]) });
        result.children = [child()];
      }
      return result;
    };
    // A sampled spine ensures substantial interaction depth; all descendants
    // still select independently from the grammar, rather than fixed templates.
    const rootKind = { "nested-flow": "columns", "diagram-build": "block", "math-layout": "list", "table-flow": "columns", "scoped-typography": "group", "overlay-composition": "overlay", "image-layout": "columns" }[family];
    const tree = expand(0, { listDepth: 0, columnDepth: 0, width: aspectRatio === 169 ? 13 : 10 }, null, rootKind);
    const diagram = n => {
      const gap = n.width / 3, prefix = `g${n.diagramId}`;
      const vertices = Array.from({ length: n.vertices }, (_, i) => `\\node[fuzzvertex] (${prefix}n${i}) at (${((i % 4) * gap).toFixed(3)},${i < 4 ? 0 : -.65}) {${String.fromCharCode(65 + i)}};`);
      const edges = Array.from({ length: n.vertices - 1 }, (_, i) => `\\draw<${n.overlay}>[->,thick] (${prefix}n${i}) ${n.curve && i % 2 ? 'to[bend left=20]' : '--'} (${prefix}n${i + 1});`);
      count("tikz-scope"); count(n.curve ? "tikz-curved-edges" : "tikz-edges");
      if (n.clip) count("tikz-clip"); if (n.loop) count("tikz-foreach");
      return `\\begin{tikzpicture}[font=\\scriptsize]
\\begin{scope}[scale=${n.scale},rotate=${n.rotation}]
${n.clip ? `\\clip (-.4,-1) rectangle (${(n.width + .5).toFixed(3)},.5);` : ''}
${n.loop ? `\\foreach \\x in {0,1,2,3} {\\draw[gray!30] (\\x*${gap.toFixed(3)},-.8)--(\\x*${gap.toFixed(3)},.35);}` : ''}
${vertices.join('\n')}
\\begin{scope}[xshift=.5pt,yshift=-.5pt]
${edges.join('\n')}
\\draw[blue] (0,-.9) .. controls (${(n.width * .3).toFixed(3)},-.3) and (${(n.width * .7).toFixed(3)},-1.1) .. (${n.width.toFixed(3)},-.8);
\\end{scope}
\\end{scope}
\\end{tikzpicture}`;
    };
    const emit = n => {
      const inner = () => n.children.map(emit).join('\n\\par\n');
      switch (n.kind) {
        case "image": return `Before ${n.image.source} after.`;
        case "image-node": return `\\begin{tikzpicture}\\node[draw] {${n.image.source}};\\end{tikzpicture}`;
        case "paragraph": return `\\${n.emphasis}{${n.sentences[0].split(' ').slice(0, 3).join(' ')}} ${n.sentences[0].split(' ').slice(3).join(' ')} ${n.sentences.slice(1).join(' ')} The estimate is $${n.math}$.`;
        case "diagram": return diagram(n);
        case "equation": return `\\[${n.expression}\\]`;
        case "table": return `\\begin{tabular}{lrr}Method&Cost&Error\\\\\\hline\n${n.rows.map(row => `${row.label}&${row.a}&${row.b}\\\\`).join('\n')}\n\\end{tabular}`;
        case "columns": return `\\begin{columns}[onlytextwidth,${n.mode}]\n${n.children.map((child, i) => `\\begin{column}{${(i ? .96 - n.ratio : n.ratio).toFixed(2)}\\textwidth}\n${emit(child)}\n\\end{column}`).join('\n')}\n\\end{columns}`;
        case "list": return `\\begin{${n.environment}}\n${n.children.map((child, i) => `\\item${n.build ? `<${Math.min(i + 1, pageCount - 1)}->` : ''}${n.environment === 'description' ? `[Stage ${i + 1}]` : ''} ${emit(child)}`).join('\n')}\n\\end{${n.environment}}`;
        case "sequence": return inner();
        case "group": return `{\\${n.font}\\color{${n.color}}\\${n.alignment}\n${inner()}\\par}`;
        case "block": return `\\begin{${n.environment}}{${n.title}}\n${inner()}\n\\end{${n.environment}}`;
        case "alignment": return `\\begin{${n.environment}}\n${inner()}\n\\end{${n.environment}}`;
        case "overlay": return n.command === 'alt' ? `\\alt<${n.spec}>{${inner()}}{Alternative estimate $x_0$.}` : `\\${n.command}<${n.spec}>{${inner()}}`;
        default: throw new Error(`Unknown grammar production ${n.kind}`);
      }
    };
    const body = emit(tree);
    // Explicit sentinels exercise appearance AND disappearance and give the
    // oracle visible witnesses on every state, even when a subtree is hidden.
    const sentinel = String.raw`\begin{tikzpicture}[font=\scriptsize]
\fill<2-3>[fuzzpaint] (0,0) rectangle (.8,.3);
\fill<3->[fuzzsecond] (1,0) rectangle (1.8,.3);
\node[anchor=west] at (2,0.15) {Witness};
\end{tikzpicture}`;
    count("overlay-sentinels"); count("macro-arguments"); count("macro-optional-default"); count("macro-composition"); count("macro-local-redefinition"); count("macro-frame-redefinition"); count("macro-let-alias");
    const contextFrames = 2 + random(3), topic = pick(TOPICS);
    const initialUnit = pick(["ms", "Hz", "steps"]), localUnit = pick(["ticks", "cycles", "samples"]);
    const initialStyle = pick(["textbf", "textit", "textrm"]), localStyle = pick(["textbf", "textit", "textrm"].filter(style => style !== initialStyle));
    const chainDepth = 1 + random(3), coefficient = 1 + random(4);
    const macroLayers = Array.from({ length: chainDepth }, (_, layer) => `\\newcommand{\\fuzzlayer${String.fromCharCode(65 + layer)}}[1]{\\${layer ? `fuzzlayer${String.fromCharCode(64 + layer)}` : initialStyle}{#1}}`).join('\n');
    let previousUnit = initialUnit;
    const contextFixtures = [];
    const context = Array.from({ length: contextFrames - 1 }, (_, i) => {
      const unit = pick(["s", "us", "min", "Hz", "steps"].filter(value => value !== previousUnit && value !== localUnit)); previousUnit = unit;
      contextFixtures.push({ frame: i + 2, unit, witness: `MacroStage${String.fromCharCode(66 + i)}` });
      return `\\renewcommand{\\fuzzunit}{${unit}}
\\renewcommand{\\fuzzcoefficient}{${i + 2}}
\\renewcommand{\\fuzzterm}[1]{{\\${pick(['textbf', 'textit', 'textrm'])}{#1}}}
\\section{${pick(TOPICS)}}
\\begin{frame}[t]{${pick(TOPICS)}}
\\fuzzpair{MacroStage${String.fromCharCode(66 + i)}}{Timing: 12\\fuzzunit, retained: 9\\fuzzoriginalunit.}\\par
{\\renewcommand{\\fuzzunit}{local}\\fuzzpair{FrameLocal}{Timing: 5\\fuzzunit.}\\par}
\\fuzzpair{FrameRestored}{Timing: 8\\fuzzunit; estimate $\\fuzzscale{x}$.}\\par
${i % 2 ? `\\begin{block}{Follow-up}\\fuzzterm{A revised value} depends on the preceding frame.\\end{block}\n\\[r_{k+1}=r_k-\\alpha d_k\\]` : `\\begin{columns}[T]\\begin{column}{.46\\textwidth}${pick(CLAUSES)}\\end{column}\\begin{column}{.46\\textwidth}\\begin{itemize}\\item Input state\\item Updated state\\end{itemize}\\end{column}\\end{columns}`}
\\end{frame}`; }).join('\n');
    const id = `v4-seed-${seed}-${String(index).padStart(4, '0')}-${family}`;
    const source = `\\documentclass[${fontSize}pt,aspectratio=${aspectRatio}]{beamer}
\\usepackage{tikz}
\\usetheme{${theme}}
\\setbeamertemplate{navigation symbols}{}
\\title{${topic}: experiments and bounds}
\\subtitle{Generated interaction study}
\\author{Research group}
\\date{}
\\year=2026\\month=11\\day=5
${macroLayers}
\\newcommand{\\fuzzterm}[1]{\\fuzzlayer${String.fromCharCode(64 + chainDepth)}{#1}}
\\newcommand{\\fuzzpair}[2]{\\fuzzterm{#1}: #2}
\\newcommand{\\fuzzunit}{${initialUnit}}
\\let\\fuzzoriginalunit\\fuzzunit
\\newcommand{\\fuzzcoefficient}{${coefficient}}
\\newcommand{\\fuzzscale}[2][\\fuzzcoefficient]{#1\\,#2}
\\definecolor{fuzzpaint}{RGB}{255,0,255}
\\definecolor{fuzzsecond}{RGB}{18,137,67}
\\tikzset{fuzzvertex/.style={draw,rounded corners=1pt,fill=blue!10,inner sep=1pt,minimum width=.35cm,minimum height=.25cm}}
\\begin{document}
\\section{${topic}}
\\begin{frame}[t,shrink=5]{${topic}}{Composed dependencies}
\\fuzzpair{Experiment}{Timing: 12\\fuzzunit; estimate $\\fuzzscale{x}+\\fuzzscale[2]{y}$.}\\par
{\\renewcommand{\\fuzzunit}{${localUnit}}\\let\\fuzzterm\\${localStyle}\\fuzzpair{LocalScope}{Timing: 7\\fuzzunit.}\\par}
\\fuzzpair{RestoredScope}{Timing: 11\\fuzzunit.}\\par
${body}
\\par ${sentinel}
\\only<${pageCount}>{}
\\end{frame}
${context}
\\end{document}
`;
    // The last state must follow every closed range endpoint.
    const pages = Math.max(4, pageCount);
    const finalSource = pages === pageCount ? source : source.replace(`\\only<${pageCount}>{}`, `\\only<${pages}>{}`);
    return { id, source: finalSource, additionalFixtures: contextFixtures.map(entry => ({ id: `${id}-frame-${entry.frame}`, file: id + '.tex', frame: entry.frame, family: 'intricate-macro-context', pages: 1, choices: { alignment: 'mixed', spec: '1', width: 0, height: 0 }, oracleText: [entry.witness, `12${entry.unit}`, `9${initialUnit}`, '5local', `8${entry.unit}`] })), fixture: { id, file: id + '.tex', frame: 1, family: `intricate-${family}`, pages, paintImages: true,
      choices: { alignment: 'mixed', spec: 'composed', width: 0, height: 0, fontSize, aspectRatio, theme,
        grammar: { version: 4, seed, index, maxDepth, budget, nodes: productions.length, depth: maxObservedDepth, frameCount: contextFrames, macroPlan: { initialUnit, localUnit, initialStyle, localStyle, chainDepth, coefficient, stages: contextFixtures }, features, pairs: [...pairs].sort(), tree } },
      paintColors: [{ color: '#ff00ff', visible: Array.from({ length: pages }, (_, i) => i + 1 >= 2 && i + 1 <= 3) }, { color: '#128943', visible: Array.from({ length: pages }, (_, i) => i + 1 >= 3) }],
      oracleText: ['Experiment', 'Witness', `7${localUnit}`, `11${initialUnit}`], oracleTextByPage: Array.from({ length: pages }, () => ['Experiment', 'Witness', `7${localUnit}`, `11${initialUnit}`]) } };
  });
}
