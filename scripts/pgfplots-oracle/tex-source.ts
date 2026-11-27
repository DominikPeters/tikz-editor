/**
 * Build one batched TeX document holding N oracle cases, one picture per
 * page. See README.md for the probe techniques and their manual sections.
 *
 * Licence rule (design/pgfplots.md section 2): everything here uses
 * documented pgfplots keys/macros (`\pgfplotsextra`, `\pgfkeysvalueof`,
 * `xticklabel`, `\tick`, `\ticknum`, `\axisdefaultticklabel`, `title style`,
 * `legend style`, `current axis`, `rel axis cs`, `axis cs`) plus PGF/TikZ,
 * which is LPPL and readable. Nothing reads or dumps pgfplots internals.
 */
import { pgfplotsOracleLuaSource } from "./lua-trace.js";

export type OracleEngine = "lualatex" | "pdflatex";

/** Probe kinds. Each modifies (or reads) the document in one specific way. */
export const PROBE_KINDS = ["limits", "map", "axisAnchors", "ticks", "descriptions", "pictureBox"] as const;
export type ProbeKind = (typeof PROBE_KINDS)[number];

export interface CaseVariant {
  /** Probe kinds enabled for this page. */
  probes: readonly ProbeKind[];
  /** LuaTeX page walk for text boxes (LuaLaTeX only). */
  textboxTrace: boolean;
}

export const FULL_VARIANT: CaseVariant = { probes: PROBE_KINDS, textboxTrace: true };
export const BARE_VARIANT: CaseVariant = { probes: [], textboxTrace: false };

export interface BatchCase {
  /** Unique id within the batch; letters, digits and dashes. */
  id: string;
  /** Fixture body: one `tikzpicture` environment (see README). */
  body: string;
  variant: CaseVariant;
}

/** Anchors of the axis node, as listed in the manual's alignment section (pgfplots.reference.alignment.tex). */
export const AXIS_ANCHORS = [
  "center", "north", "south", "east", "west", "north east", "north west", "south east", "south west",
  "outer center", "outer north", "outer south", "outer east", "outer west",
  "outer north east", "outer north west", "outer south east", "outer south west",
  "above north", "above north east", "right of north east", "right of east", "right of south east",
  "below south east", "below south", "below south west", "left of south west", "left of west",
  "left of north west", "above north west",
  "origin", "above origin", "right of origin", "below origin", "left of origin",
] as const;

/** Standard TikZ node anchors read from named description and tick-label nodes. */
export const NODE_ANCHORS = [
  "center", "north", "south", "east", "west", "north east", "north west", "south east", "south west",
  "base", "base west", "base east", "mid",
] as const;

export const DESCRIPTION_KINDS = ["title", "xlabel", "ylabel", "legend"] as const;
export type DescriptionKind = (typeof DESCRIPTION_KINDS)[number];

/** Fixed preamble shared by all oracle documents (README: "Fixture format"). */
export const ORACLE_PREAMBLE = String.raw`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\pagestyle{empty}`;

const AXIS_BEGIN = /\\begin\{(axis|semilogxaxis|semilogyaxis|loglogaxis)\}/gu;

function instrumentation(engine: OracleEngine): string {
  const anchorList = (anchors: readonly string[]) => anchors.join(",");
  const lua = engine === "lualatex";
  return String.raw`\makeatletter
% ---- pgfplots oracle instrumentation (scripts/pgfplots-oracle) ----
\newwrite\pgfplotsoracle@out
\immediate\openout\pgfplotsoracle@out=\jobname-probe.tsv
\def\pgfplotsoracle@case{none}
\def\pgfplotsoracle@rec#1{\immediate\write\pgfplotsoracle@out{\pgfplotsoracle@case\string|#1}}
\pgfplotsoracle@rec{VERSION|pgf=\pgfversion|pgfplots=\pgfplotsversion|engine=${engine}}
\newif\ifpgfplotsoracle@limits \newif\ifpgfplotsoracle@map \newif\ifpgfplotsoracle@axisAnchors
\newif\ifpgfplotsoracle@ticks \newif\ifpgfplotsoracle@descriptions \newif\ifpgfplotsoracle@pictureBox
\newif\ifpgfplotsoracle@trace
% Read one anchor of a named node in picture (canvas) coordinates. Silent
% when the node or anchor does not exist.
\def\pgfplotsoracle@anchor#1#2#3{%
  \pgfutil@ifundefined{pgf@sh@ns@#2}{}{%
    \edef\pgfplotsoracle@shape{\csname pgf@sh@ns@#2\endcsname}%
    \pgfutil@ifundefined{pgf@anchor@\pgfplotsoracle@shape @#3}{%
      \pgfutil@ifundefined{pgf@anchor@generic@#3}{\pgfplotsoracle@rec{NOANCHOR|#1|#2|#3}}{\pgfplotsoracle@anchor@{#1}{#2}{#3}}}%
      {\pgfplotsoracle@anchor@{#1}{#2}{#3}}}}
\def\pgfplotsoracle@anchor@#1#2#3{\begingroup\pgftransformreset\pgfpointanchor{#2}{#3}%
  \pgfplotsoracle@rec{A|#1|#2|#3|\the\pgf@x|\the\pgf@y}\endgroup}
\def\pgfplotsoracle@anchors#1#2#3{\pgfutil@for\pgfplotsoracle@a:=#3\do{\pgfplotsoracle@anchor{#1}{#2}{\pgfplotsoracle@a}}}
\def\pgfplotsoracle@nodeanchors{${anchorList(NODE_ANCHORS)}}
\def\pgfplotsoracle@axisanchors{${anchorList(AXIS_ANCHORS)}}
% Tick probe: documented xticklabel code; reports \tick and \ticknum, then
% typesets the documented default label.
% The tick scale label (scaled ticks) is typeset with the tick label style
% but outside the tick loop, where \ticknum is undefined; there it expands
% to "S" (behaviour log, harness notes; painting unchanged, disturbance.mts).
\def\ticknum{S}
\def\pgfplotsoracle@ticklist{}
\def\pgfplotsoracle@tick#1#2{%
  \pgfplotsoracle@rec{TICK|#1|#2|\ticknum|\tick}%
  \xdef\pgfplotsoracle@ticklist{\pgfplotsoracle@ticklist,#2\ticknum}}
\def\pgfplotsoracle@readticks#1{\pgfutil@for\pgfplotsoracle@t:=\pgfplotsoracle@ticklist\do{%
  \ifx\pgfplotsoracle@t\pgfutil@empty\else
    \edef\pgfplotsoracle@tn{pgfplotsoracle-\pgfplotsoracle@case-#1-\pgfplotsoracle@t}%
    \pgfplotsoracle@anchors{tick}{\pgfplotsoracle@tn}{\pgfplotsoracle@nodeanchors}%
  \fi}}
% Injected immediately before \begin{axis}. #2/#3: the documented default
% label macro for x/y (\axisdefaultticklabel or \axisdefaultticklabellog),
% chosen from the environment name.
% #4/#5: the detected scale of x/y (linear or log), recorded for assembly.
% Extra ticks (extra x ticks) reuse \ticknum, so their probe reports under
% the letter xe/ye through the documented every extra x tick style.
\def\pgfplotsoracle@beforeaxis#1#2#3#4#5{%
  \gdef\pgfplotsoracle@ticklist{}%
  \pgfplotsoracle@rec{AXIS|#1}%
  \pgfplotsoracle@rec{MODE|#1|#4|#5}%
  \ifpgfplotsoracle@ticks
    \pgfplotsset{every axis/.append style={%
      xticklabel={\pgfplotsoracle@tick{#1}{x}#2},
      yticklabel={\pgfplotsoracle@tick{#1}{y}#3},
      xticklabel style={name=pgfplotsoracle-\pgfplotsoracle@case-#1-x\ticknum},
      yticklabel style={name=pgfplotsoracle-\pgfplotsoracle@case-#1-y\ticknum}},
      every extra x tick/.append style={%
      xticklabel={\pgfplotsoracle@tick{#1}{xe}#2},
      xticklabel style={name=pgfplotsoracle-\pgfplotsoracle@case-#1-xe\ticknum}},
      every extra y tick/.append style={%
      yticklabel={\pgfplotsoracle@tick{#1}{ye}#3},
      yticklabel style={name=pgfplotsoracle-\pgfplotsoracle@case-#1-ye\ticknum}}}%
  \fi
  \ifpgfplotsoracle@descriptions
    \pgfplotsset{every axis/.append style={%
      title style={name=pgfplotsoracle-\pgfplotsoracle@case-#1-title},
      xlabel style={name=pgfplotsoracle-\pgfplotsoracle@case-#1-xlabel},
      ylabel style={name=pgfplotsoracle-\pgfplotsoracle@case-#1-ylabel},
      legend style={name=pgfplotsoracle-\pgfplotsoracle@case-#1-legend}}}%
  \fi}
% Injected immediately before \end{axis}.
\def\pgfplotsoracle@inaxis#1{%
  \ifpgfplotsoracle@limits
    \pgfplotsextra{\pgfplotsoracle@rec{LIMITS|#1|\pgfkeysvalueof{/pgfplots/xmin}|\pgfkeysvalueof{/pgfplots/xmax}|\pgfkeysvalueof{/pgfplots/ymin}|\pgfkeysvalueof{/pgfplots/ymax}}}%
  \fi
  \ifpgfplotsoracle@map
    \coordinate[overlay] (pgfplotsoracle-\pgfplotsoracle@case-#1-r00) at (rel axis cs:0,0);
    \coordinate[overlay] (pgfplotsoracle-\pgfplotsoracle@case-#1-r10) at (rel axis cs:1,0);
    \coordinate[overlay] (pgfplotsoracle-\pgfplotsoracle@case-#1-r01) at (rel axis cs:0,1);
    \coordinate[overlay] (pgfplotsoracle-\pgfplotsoracle@case-#1-r11) at (rel axis cs:1,1);
    \coordinate[overlay] (pgfplotsoracle-\pgfplotsoracle@case-#1-d00) at (axis cs:\pgfkeysvalueof{/pgfplots/xmin},\pgfkeysvalueof{/pgfplots/ymin});
    \coordinate[overlay] (pgfplotsoracle-\pgfplotsoracle@case-#1-d10) at (axis cs:\pgfkeysvalueof{/pgfplots/xmax},\pgfkeysvalueof{/pgfplots/ymin});
    \coordinate[overlay] (pgfplotsoracle-\pgfplotsoracle@case-#1-d01) at (axis cs:\pgfkeysvalueof{/pgfplots/xmin},\pgfkeysvalueof{/pgfplots/ymax});
    \pgfplotsextra{\pgfplotsoracle@rec{MAPDATA|#1|\pgfkeysvalueof{/pgfplots/xmin}|\pgfkeysvalueof{/pgfplots/xmax}|\pgfkeysvalueof{/pgfplots/ymin}|\pgfkeysvalueof{/pgfplots/ymax}}}%
  \fi}
% Injected immediately after \end{axis}.
\def\pgfplotsoracle@afteraxis#1{%
  \ifpgfplotsoracle@axisAnchors\pgfplotsoracle@anchors{axis}{current axis}{\pgfplotsoracle@axisanchors}\fi
  \ifpgfplotsoracle@map
    \pgfutil@for\pgfplotsoracle@m:={r00,r10,r01,r11,d00,d10,d01}\do{%
      \edef\pgfplotsoracle@n{pgfplotsoracle-\pgfplotsoracle@case-#1-\pgfplotsoracle@m}%
      \pgfplotsoracle@anchor{map}{\pgfplotsoracle@n}{center}}%
  \fi
  \ifpgfplotsoracle@ticks\pgfplotsoracle@readticks{#1}\fi
  \ifpgfplotsoracle@descriptions
    \pgfplotsoracle@anchors{desc}{pgfplotsoracle-\pgfplotsoracle@case-#1-title}{\pgfplotsoracle@nodeanchors}%
    \pgfplotsoracle@anchors{desc}{pgfplotsoracle-\pgfplotsoracle@case-#1-xlabel}{\pgfplotsoracle@nodeanchors}%
    \pgfplotsoracle@anchors{desc}{pgfplotsoracle-\pgfplotsoracle@case-#1-ylabel}{\pgfplotsoracle@nodeanchors}%
    \pgfplotsoracle@anchors{desc}{pgfplotsoracle-\pgfplotsoracle@case-#1-legend}{\pgfplotsoracle@nodeanchors}%
  \fi}
% Injected immediately before \end{tikzpicture}: read-only.
\def\pgfplotsoracle@endpicture{%
  \ifpgfplotsoracle@pictureBox
    \pgfplotsoracle@anchor{bbox}{current bounding box}{south west}%
    \pgfplotsoracle@anchor{bbox}{current bounding box}{north east}%
  \fi}
% One page per case: the page is exactly the picture box.
\newsavebox\pgfplotsoracle@box
\hoffset=-1in \voffset=-1in
\newenvironment{pgfplotsoraclecase}[2]{%
  \gdef\pgfplotsoracle@case{#1}%
  \pgfplotsoracle@limitsfalse\pgfplotsoracle@mapfalse\pgfplotsoracle@axisAnchorsfalse
  \pgfplotsoracle@ticksfalse\pgfplotsoracle@descriptionsfalse\pgfplotsoracle@pictureBoxfalse
  \pgfplotsoracle@tracefalse
  \pgfutil@for\pgfplotsoracle@f:={#2}\do{\ifx\pgfplotsoracle@f\pgfutil@empty\else\csname pgfplotsoracle@\pgfplotsoracle@f true\endcsname\fi}%
  ${lua ? String.raw`\ifpgfplotsoracle@trace\directlua{pgfplotsoracle.enabled=true}\else\directlua{pgfplotsoracle.enabled=false}\fi` : ""}%
  \begin{lrbox}{\pgfplotsoracle@box}}{%
  \end{lrbox}%
  ${lua ? String.raw`\pagewidth` : String.raw`\pdfpagewidth`}=\wd\pgfplotsoracle@box
  ${lua ? String.raw`\pageheight` : String.raw`\pdfpageheight`}=\dimexpr\ht\pgfplotsoracle@box+\dp\pgfplotsoracle@box\relax
  \pgfplotsoracle@rec{PAGE|\the\wd\pgfplotsoracle@box|\the\ht\pgfplotsoracle@box|\the\dp\pgfplotsoracle@box}%
  \shipout\hbox{\box\pgfplotsoracle@box}%
  ${lua ? String.raw`\directlua{pgfplotsoracle.enabled=false}` : ""}}
${lua ? String.raw`\directlua{dofile("pgfplots-oracle-trace.lua")}
% String-backed literal with the identical payload, so the page walk can read
% transforms (see lua-trace.ts).
\let\pgfplotsoracle@invoke\pgfsys@invoke
\def\pgfsys@invoke#1{\ifpgfplotsoracle@trace\directlua{pgfplotsoracle.literal("\luaescapestring{#1}")}\else\pgfplotsoracle@invoke{#1}\fi}
\let\pgfplotsoracle@hbox\pgfsys@hbox
\def\pgfsys@hbox#1{\ifpgfplotsoracle@trace\directlua{pgfplotsoracle.tagbox(\number#1)}\fi\pgfplotsoracle@hbox#1}` : ""}
\makeatother`;
}

/** The `[...]` option text right after `\begin{axis}`, braces respected. */
function axisOptions(body: string, start: number): string {
  let i = start;
  while (i < body.length && /\s/u.test(body[i] ?? "")) i += 1;
  if (body[i] !== "[") return "";
  let depth = 0;
  for (let j = i + 1; j < body.length; j += 1) {
    const c = body[j];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === "]" && depth === 0) return body.slice(i + 1, j);
  }
  return "";
}

/**
 * Insert the probe hooks into a fixture body. Hooks are no-ops for probe
 * kinds the page does not enable, so every variant shares one injected
 * source and differs only in the page's flag list.
 */
export function injectProbes(body: string): string {
  let axisIndex = 0;
  const ids: string[] = [];
  let result = body.replace(AXIS_BEGIN, (match, environment: string, offset: number) => {
    axisIndex += 1;
    const id = `a${axisIndex}`;
    ids.push(id);
    // Log mode from the environment name, or a literal `xmode=log` in the
    // environment's own options or anywhere in the body before this axis
    // (\pgfplotsset, style definitions); a later `xmode=normal` there wins.
    // A mode set through a macro or an outside file is not detected
    // (README: limitations).
    const options = axisOptions(body, offset + match.length);
    const before = body.slice(0, offset);
    const label = (log: boolean) => (log ? "\\axisdefaultticklabellog" : "\\axisdefaultticklabel");
    const lastMode = (text: string, letter: string): string | undefined => [...text.matchAll(new RegExp(`\\b${letter}mode\\s*=\\s*(log|normal|linear)\\b`, "gu"))].at(-1)?.[1];
    const isLog = (letter: string, envLog: boolean): boolean => {
      const own = lastMode(options, letter);
      if (own !== undefined) return own === "log";
      if (envLog) return true;
      return lastMode(before, letter) === "log";
    };
    const xlog = isLog("x", environment === "semilogxaxis" || environment === "loglogaxis");
    const ylog = isLog("y", environment === "semilogyaxis" || environment === "loglogaxis");
    const mode = (log: boolean) => (log ? "log" : "linear");
    return `\\pgfplotsoraclebeforeaxis{${id}}{${label(xlog)}}{${label(ylog)}}{${mode(xlog)}}{${mode(ylog)}}${match}`;
  });
  let endIndex = 0;
  result = result.replace(/\\end\{(axis|semilogxaxis|semilogyaxis|loglogaxis)\}/gu, (match) => {
    const id = ids[endIndex] ?? `a${endIndex + 1}`;
    endIndex += 1;
    return `\\pgfplotsoracleinaxis{${id}}${match}\\pgfplotsoracleafteraxis{${id}}`;
  });
  if (endIndex !== axisIndex) throw new Error(`Unbalanced axis environments (${axisIndex} begin, ${endIndex} end).`);
  const ends = result.match(/\\end\{tikzpicture\}/gu)?.length ?? 0;
  if (ends !== 1) throw new Error(`A fixture body must contain exactly one tikzpicture (found ${ends}).`);
  return result.replace(/\\end\{tikzpicture\}/u, "\\pgfplotsoracleendpicture\\end{tikzpicture}");
}

/** Hook names usable without \makeatletter in the document body. */
const BODY_ALIASES = String.raw`\makeatletter
\let\pgfplotsoraclebeforeaxis\pgfplotsoracle@beforeaxis
\let\pgfplotsoracleinaxis\pgfplotsoracle@inaxis
\let\pgfplotsoracleafteraxis\pgfplotsoracle@afteraxis
\let\pgfplotsoracleendpicture\pgfplotsoracle@endpicture
\makeatother`;

function flagList(variant: CaseVariant, engine: OracleEngine): string {
  const flags: string[] = [...variant.probes];
  if (variant.textboxTrace && engine === "lualatex") flags.push("trace");
  return flags.join(",");
}

/**
 * `extraPreamble` goes after the fixed preamble; the noise-floor run uses it
 * to give both engines the same (TFM) text fonts.
 */
export function buildBatchDocument(cases: readonly BatchCase[], engine: OracleEngine, extraPreamble = ""): string {
  for (const entry of cases) {
    if (!/^[A-Za-z0-9-]+$/u.test(entry.id)) throw new Error(`Invalid case id ${entry.id}`);
  }
  const pages = cases.map((entry) => String.raw`\begin{pgfplotsoraclecase}{${entry.id}}{${flagList(entry.variant, engine)}}%
${injectProbes(entry.body.trim())}%
\end{pgfplotsoraclecase}`);
  return `${ORACLE_PREAMBLE}
${extraPreamble}
${instrumentation(engine)}
${BODY_ALIASES}
\\begin{document}
${pages.join("\n")}
\\end{document}
`;
}

/** A plain, uninstrumented document for one fixture (for manual inspection). */
export function buildStandaloneDocument(body: string): string {
  return `${ORACLE_PREAMBLE}
\\begin{document}
${body.trim()}
\\end{document}
`;
}

export { pgfplotsOracleLuaSource };
