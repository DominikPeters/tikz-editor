export const IMAGE_FAMILIES = ["image-inline", "image-column", "image-block", "image-node", "image-overlay", "image-lookup", "image-pdf-pages", "image-key-order"];
const PROGRAMS = [[], ["width=18pt"], ["height=12pt"], ["scale=.75"], ["width=20pt", "height=10pt", "keepaspectratio"],
  ["trim=2 1 3 2", "clip", "width=20pt"], ["viewport=1 1 20 14", "clip"], ["bb=1 1 20 14", "clip"],
  ["width=18pt", "angle=90"], ["angle=90", "width=18pt"], ["origin=c", "angle=-30", "totalheight=18pt"],
  ["trim=2 1 3 2", "viewport=1 1 20 14", "clip=false"], ["draft", "width=18pt"]];

/** A genuine leaf production usable inside every recursive flow container. */
export function imageProduction(random) {
  const filename = ["fuzz-images/pattern.png", "fuzz-images/photo.jpg", "fuzz-images/pages.pdf", "fuzz-images/pattern.v2"][random(4)];
  const options = [...PROGRAMS[random(PROGRAMS.length)]];
  if (filename.endsWith(".pdf")) options.unshift(`page=${1 + random(2)}`);
  const gap = random(3) === 0 ? " % image argument\n" : "";
  return { filename, options, source: `\\includegraphics${gap}${options.length ? `[${options.join(",")}]${gap}` : ""}{${filename}}` };
}

export function generateImageBeamerCases({ seed, cases }) {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(cases) || cases < IMAGE_FAMILIES.length) throw new Error(`Require an integer seed and at least ${IMAGE_FAMILIES.length} image cases.`);
  let state = seed >>> 0;
  const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 8) % n; };
  return Array.from({ length: cases }, (_, index) => {
    const family = IMAGE_FAMILIES[index % IMAGE_FAMILIES.length];
    const image = imageProduction(random);
    let body = `Before ${image.source} after.`;
    let pages = 1;
    if (family === "image-column") body = `\\begin{columns}[T]\\begin{column}{.46\\textwidth}Before ${image.source} after.\\end{column}\\begin{column}{.46\\textwidth}Neighbor\\end{column}\\end{columns}`;
    if (family === "image-block") body = `\\begin{block}{Picture}Before ${image.source} after.\\end{block}`;
    if (family === "image-node") body = `\\begin{tikzpicture}\\node[draw,rotate=15] {Before ${image.source} after.};\\end{tikzpicture}`;
    if (family === "image-overlay") { body = `Before ${image.source.replace("\\includegraphics", "\\includegraphics<2-3>")} after.\\only<4>{}`; pages = 4; }
    if (family === "image-lookup") body = "Before \\includegraphics[width=20pt]{pattern} \\includegraphics[width=20pt]{pattern.v2} after.";
    // Beamer braces both optional arguments, which breaks graphics.sty's legacy
    // comma-delimited corner parser. That form belongs to the article grammar.
    if (family === "image-pdf-pages") body = "Before \\includegraphics[page=1,width=20pt]{fuzz-images/pages.pdf} \\includegraphics[page=2,width=20pt]{fuzz-images/pages.pdf} after.";
    if (family === "image-key-order") body = "Before \\includegraphics[width=18pt,angle=90]{fuzz-images/pattern.png} \\includegraphics[angle=90,width=18pt]{fuzz-images/pattern.png} after.";
    const id = `v4-seed-${seed}-${String(index).padStart(4, "0")}-${family}`;
    const source = `\\documentclass{beamer}\n\\usepackage{tikz}\n\\graphicspath{{fuzz-images/}{fuzz-images/nested/}}\n\\setbeamertemplate{navigation symbols}{}\n\\date{}\n\\begin{document}\n\\begin{frame}[t]{Images}\n${body}\n\\end{frame}\n\\end{document}\n`;
    const fixed = ["image-lookup", "image-pdf-pages", "image-key-order"].includes(family);
    const images = fixed ? 2 : image.options.includes("draft") ? 0 : 1;
    return { id, source, fixture: { id, file: `${id}.tex`, frame: 1, family, pages, paintImages: true,
      imagesByPage: Array.from({ length: pages }, (_, page) => family === "image-overlay" && (page === 0 || page === 3) ? 0 : images),
      choices: { alignment: "top", spec: family === "image-overlay" ? "2-3" : "1", width: 20, height: 0, images: fixed ? [] : [image] },
      oracleText: ["Before", "after."] } };
  });
}
