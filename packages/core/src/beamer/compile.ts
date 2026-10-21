import { scanBeamerDocument } from "./scan.js";
import { createBeamerSyntaxContext } from "./syntax.js";

export type BeamerTexEngine = "pdflatex" | "xelatex" | "lualatex";

const UNICODE_PACKAGES = new Set(["fontspec", "unicode-math", "polyglossia", "xeCJK", "xltxtra", "mathspec"]);
const LUA_PACKAGES = new Set(["luacode", "luatexja", "luatexja-fontspec", "lua-ul", "luamplib", "lua-visual-debug", "emoji"]);

/**
 * The engine a deck asks for: the `% !TEX program = …` line editors such as
 * TeXShop, TeXstudio and LaTeX Workshop read; else LuaLaTeX for Lua
 * packages, XeLaTeX for system fonts (fontspec and its kin), pdfLaTeX
 * otherwise.
 */
export function beamerTexEngine(source: string): BeamerTexEngine {
  const document = scanBeamerDocument(source);
  const preamble = document.preamble.span;
  const magic = /^[ \t]*%[ \t]*!\s*TeX\s+(?:TS-)?program\s*=\s*([\w-]+)/imu.exec(source.slice(0, preamble.to))?.[1]?.toLowerCase();
  if (magic?.includes("lua")) return "lualatex";
  if (magic?.includes("xe")) return "xelatex";
  if (magic) return "pdflatex";
  const context = createBeamerSyntaxContext(source);
  let unicode = false;
  for (const control of context.syntax.controlsIn(preamble)) {
    if (control.name === "directlua") return "lualatex";
    if (control.name !== "usepackage" && control.name !== "RequirePackage") continue;
    const optional = context.syntax.argumentAfter(control.span.to, "optional", preamble.to);
    const names = context.syntax.argumentAfter(optional?.span.to ?? control.span.to, "required", preamble.to);
    if (names?.complete !== true) continue;
    for (const name of source.slice(names.contentSpan.from, names.contentSpan.to).split(",").map(part => part.trim())) {
      if (LUA_PACKAGES.has(name)) return "lualatex";
      if (UNICODE_PACKAGES.has(name)) unicode = true;
    }
  }
  return unicode ? "xelatex" : "pdflatex";
}

/**
 * Notes, in the job's `.marks` file, what each shipped page shows: `page K`
 * for a page of the frame at index K (the frame's last line sets K, so
 * every build and break of the frame carries it), `page` for one outside
 * the deck's frames (a note page, a frame \AtBeginSection writes), and,
 * when pgfpages gathers pages onto sheets, `sheet` as each sheet ships.
 */
const PAGE_MARKS = String.raw`
% TikZ Editor: which frame each page shows, for its compiled view.
\edef\TikzEditorAtCode{\the\catcode64}\catcode64=11
\gdef\tikzeditor@frame{}
\protected\def\TikzEditorFrame#1{\gdef\tikzeditor@frame{#1}}
\newwrite\tikzeditor@marks
\immediate\openout\tikzeditor@marks=\jobname.marks\relax
\let\tikzeditor@beamerframe\frame
\def\frame{\gdef\tikzeditor@frame{}\tikzeditor@beamerframe}
\ifdefined\beamer@outsideframenote
  \let\tikzeditor@outsideframenote\beamer@outsideframenote
  \def\beamer@outsideframenote{\gdef\tikzeditor@frame{}\tikzeditor@outsideframenote}
\fi
\ifdefined\AddToHook
  \AddToHook{shipout/before}{\immediate\write\tikzeditor@marks{page \tikzeditor@frame}}
\fi
\AtBeginDocument{\ifdefined\pgfpages@shipoutshipoutbox
  \let\tikzeditor@shipoutsheet\pgfpages@shipoutshipoutbox
  \def\pgfpages@shipoutshipoutbox{\immediate\write\tikzeditor@marks{sheet}\tikzeditor@shipoutsheet}\fi}
\catcode64=\TikzEditorAtCode\relax
`;

/**
 * The deck as LaTeX should compile it for the editor to find each frame's
 * pages: the source, with PAGE_MARKS at the end of the preamble and
 * `\TikzEditorFrame{K}` on a line of its own before each `\end{frame}` (a
 * fragile frame needs `\end{frame}` to start its line).
 */
export function createBeamerCompileDocument(source: string): { text: string; engine: BeamerTexEngine } {
  const document = scanBeamerDocument(source);
  const engine = beamerTexEngine(source);
  if (!document.documentSpan) return { text: source, engine };
  const insertions: Array<{ at: number; text: string }> = [{ at: document.documentSpan.from, text: PAGE_MARKS }];
  document.frames.forEach((frame, index) => {
    if (!frame.endSpan) return;
    const end = frame.endSpan.from;
    const lineFrom = source.lastIndexOf("\n", end - 1) + 1;
    const mark = `\\TikzEditorFrame{${index}}`;
    insertions.push(lineFrom > frame.bodySpan.from && !source.slice(lineFrom, end).trim()
      ? { at: lineFrom, text: `${mark}%\n` }
      : { at: end, text: mark });
  });
  let text = "", from = 0;
  for (const insertion of insertions.sort((a, b) => a.at - b.at)) {
    text += source.slice(from, insertion.at) + insertion.text;
    from = insertion.at;
  }
  return { text: text + source.slice(from), engine };
}

/** What each page of a compiled deck shows, from the marks a createBeamerCompileDocument job wrote. */
export type BeamerCompiledPages = {
  pageCount: number;
  /** The frame index each page (from 1, at index 0) shows; null for pages outside frames, such as note pages. */
  pageFrames: Array<number | null>;
  /**
   * The pages of each frame, by frame index: its first run, which note
   * pages may interleave. A later `\againframe` showing the frame again
   * is not among them.
   */
  framePages: Map<number, number[]>;
};

export function beamerCompiledPages(marks: string): BeamerCompiledPages {
  const lines = marks.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const sheets = lines.includes("sheet");
  const pageFrames: Array<number | null> = [];
  let gathered: Array<number | null> = [];
  for (const line of lines) {
    if (line === "sheet") {
      pageFrames.push(gathered.find(frame => frame != null) ?? null);
      gathered = [];
      continue;
    }
    const match = /^page(?:\s+(\d+))?$/u.exec(line);
    if (!match) continue;
    const frame = match[1] == null ? null : Number(match[1]);
    if (sheets) gathered.push(frame);
    else pageFrames.push(frame);
  }
  const framePages = new Map<number, number[]>();
  const closed = new Set<number>();
  let open: number | null = null;
  pageFrames.forEach((frame, index) => {
    if (frame == null) return;
    if (frame !== open) {
      if (open != null) closed.add(open);
      open = frame;
    }
    if (closed.has(frame)) return;
    const list = framePages.get(frame) ?? [];
    list.push(index + 1);
    framePages.set(frame, list);
  });
  return { pageCount: pageFrames.length, pageFrames, framePages };
}
