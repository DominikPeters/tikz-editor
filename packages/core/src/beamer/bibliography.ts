import type { DocumentGraphicsResolver } from "../graphics/types.js";
import { getTexSyntaxIndex, matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";
import { beamerDocumentParser } from "@tikz-editor/lezer-tex";
import type { BeamerBibliographyStyle } from "./references.js";
import { bibliographyIcons } from "./bibliography-icons.js";
import { resolveBeamerThemeColor, type ResolvedBeamerTheme } from "./theme/index.js";

const iconPrefix = "beamer-bibliography-icon:";

/** Resolve the stock templates from beamerinnerthemedefault.sty / beamerbaseauxtemplates.sty. */
export function beamerBibliographyStyle(params: {
  source: string;
  sourceStart: number;
  theme?: ResolvedBeamerTheme;
  widestLabel: string;
  fontSizePt: number;
  layoutFontSizePt: number;
  measure: (tex: string) => number;
}): BeamerBibliographyStyle {
  const { source, sourceStart, theme, measure } = params;
  const syntax = getTexSyntaxIndex(source, beamerDocumentParser);
  const environments = [...matchTexSyntaxEnvironments(syntax).values()];
  let template = "default";
  for (const command of syntax.controlsIn({ from: 0, to: sourceStart })) {
    if (command.name !== "setbeamertemplate") continue;
    if (environments.some((env) => env.contentSpan.from <= command.span.from && command.span.to <= env.contentSpan.to && env.span.to <= sourceStart)) continue;
    const role = syntax.argumentAfter(command.span.to, "required", sourceStart);
    if (!role || source.slice(role.contentSpan.from, role.contentSpan.to).trim() !== "bibliography item") continue;
    const option = syntax.argumentAfter(role.span.to, "optional", sourceStart);
    if (option) template = source.slice(option.contentSpan.from, option.contentSpan.to).trim();
  }
  const color = (role: string, fallback: string) => theme ? resolveBeamerThemeColor(theme, role).fg ?? fallback : fallback;
  const declaration = (role: string, fallback: string) => `\\color{${color(role, fallback)}}`;
  const marker = (label: string): string => {
    if (template === "text") return `[${label}]`;
    if (template === "triangle") return "\\raisebox{1.25pt}{\\fontsize{8pt}{9.5pt}\\selectfont$\\blacktriangleright$}";
    const name = template === "book" || template === "online" ? template : "article";
    const icon = bibliographyIcons[name];
    const lower = name === "article" ? 3.5 : name === "book" ? 2 : 3;
    const graphic = `\\includegraphics[width=${icon.width}pt,height=${icon.height}pt]{${iconPrefix}${name}}`;
    return `\\raisebox{-${lower}pt}{${name === "article" ? "\\rule{2pt}{0pt}" : ""}${graphic}${name === "article" ? "\\rule{1pt}{0pt}" : ""}}`;
  };
  const labelWidth = measure(marker(params.widestLabel));
  // This register is set by the class, before local size declarations.
  const labelSep = (theme?.fonts["normal-text"].sizePt ?? 10.95) * 0.5;
  return {
    marginEm: (labelWidth + labelSep) / params.layoutFontSizePt,
    label: (label) => {
      const body = marker(label);
      // LaTeX's \@item pads short labels to \labelwidth; long labels shift
      // only the first body line. Beamer's \makelabel uses trailing \hfil.
      const width = Math.max(labelWidth, measure(body)) + labelSep;
      return `\\makebox[${width}pt][l]{${declaration("bibliography item", "#3333b3")}${body}}`;
    },
    author: declaration("bibliography entry author", "#3333b3") + `\\rule{0pt}{${params.fontSizePt * 1.5}pt}`,
    title: declaration("bibliography entry title", "#000000"),
    location: declaration("bibliography entry location", "#7a7acd"),
    note: declaration("bibliography entry note", "#7a7acd"),
  };
}

export function beamerBibliographyGraphicsResolver(parent?: DocumentGraphicsResolver): DocumentGraphicsResolver {
  return {
    cacheKey: `beamer-bibliography-icons-v1:${parent?.cacheKey ?? ""}`,
    resolve(request) {
      if (request.filename.startsWith(iconPrefix)) {
        const name = request.filename.slice(iconPrefix.length) as keyof typeof bibliographyIcons;
        const icon = Object.hasOwn(bibliographyIcons, name) ? bibliographyIcons[name] : undefined;
        if (icon) return {
          status: "resolved", mimeType: "image/svg+xml", dataBase64: icon.data,
          naturalWidthPt: icon.width, naturalHeightPt: icon.height,
          revision: `beamer-bibliography-${name}-v1`,
        };
      }
      return parent?.resolve(request) ?? { status: "missing" };
    },
  };
}
