import type { BeamerContentsBodyNode } from "./content-types.js";
import type { LaidParagraph, PreparedContents } from "./render-model.js";
import type { BeamerSectionModel } from "./types.js";
import type { BeamerThemeFont, ResolvedBeamerTheme } from "./theme/types.js";
import { createBeamerTexTextFontProfile } from "./theme/font.js";
import { resolveBeamerThemeColor } from "./theme/resolve.js";
import { beamerNamedFontSize } from "./theme/font-sizes.js";
import { texLength } from "../text/tex/coordinates.js";
import { beamerContentsSphere } from "./theme/list-markers.js";
import { createIdentityMappedText, createGeneratedMappedText, type MappedText } from "../text/source-map.js";

/** Stock section/subsection TOC: section vboxes compete for frame \vfill;
 * subsection paragraphs follow with ordinary interline glue. */
export function prepareBeamerContents(params: {
  node: BeamerContentsBodyNode; sections: readonly BeamerSectionModel[];
  currentSectionId: string | null; theme: ResolvedBeamerTheme; width: number;
  layout: (mapped: MappedText, font: BeamerThemeFont, width: number, id: string) => LaidParagraph | null;
}): PreparedContents {
  const { node, theme } = params;
  const font = theme.fonts["normal-text"];
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(profile.defaultFontState, texLength(font.sizePt), profile.metricProvider);
  const ex = resolved.data.fontdimen.xheight * font.sizePt;
  const ball = theme.templates.enumerations[0].id.endsWith("/ball");
  const options = new Set((node.options?.value ?? "").split(",").map(value => value.trim()));
  const fixedSectionSpacing = options.has("hideallsubsections") || options.has("hideothersubsections");
  const rows: PreparedContents["rows"] = [];
  let cursor = -.5 * font.sizePt, previousDepth = 0, fills = 0, sectionIndex = 0;
  for (const section of params.sections) {
    if (section.starred) continue;
    if (section.level === 2 && (options.has("hideallsubsections") ||
      (options.has("hideothersubsections") && section.parentSectionId !== params.currentSectionId))) continue;
    const topLevel = section.level === 1;
    if (topLevel) {
      if (fixedSectionSpacing) cursor += 1.5 * font.sizePt;
      else fills++;
      sectionIndex++;
    }
    const indent = ball ? (topLevel ? 2.75 : 5) * ex : topLevel ? 0 : 1.5 * font.sizePt;
    const paragraph = params.layout(createIdentityMappedText(section.title.value, section.title.contentSpan.from), font,
      Math.max(1, params.width - indent), `${node.id}:${section.id}`);
    if (!paragraph) continue;
    const first = paragraph.layout.report.lines[0];
    if (!first) continue;
    const firstHeight = Number(first.ascent);
    const lastDepth = Number(paragraph.layout.report.lines.at(-1)?.descent ?? 0);
    const last = paragraph.layout.vlistLayout.items.at(-1);
    const extent = last ? Number(last.y + last.metrics.height + last.metrics.depth) : 0;
    // The old PGF picture uses the bottom of its declared bounds as the
    // baseline: 1.7ex height, zero depth. Its shading extends past that box.
    const markerExtra = topLevel && ball ? Math.max(0, 1.7 * ex - firstHeight) : 0;
    const endingDepth = lastDepth;
    const height = extent + markerExtra;
    const boxHeight = topLevel ? height - endingDepth : firstHeight;
    const skip = font.lineHeightPt - previousDepth - boxHeight;
    cursor += skip >= 0 ? skip : 1;
    const row: PreparedContents["rows"][number] = {
      paragraph, x: indent, top: cursor + markerExtra, fillWeight: fills,
      colorRole: topLevel ? "section in toc" : "subsection in toc",
    };
    if (ball) {
      const baseline = cursor + markerExtra + firstHeight;
      const size = (topLevel ? 2.6 : 1.06) * ex;
      const centerX = topLevel ? .5 * ex : indent - ex - size / 2;
      const centerY = baseline - (topLevel ? .7 : .63) * ex;
      const bounds = { x: centerX - size / 2, y: centerY - size / 2, width: size, height: size };
      const background = resolveBeamerThemeColor(theme, topLevel ? "section number projected" : "subsection number projected").bg ?? resolveBeamerThemeColor(theme, "item projected").bg ?? "#3333b3";
      const canvas = resolveBeamerThemeColor(theme, "normal text").bg ?? "#ffffff";
      const id = `${node.id}:${section.id}:sphere`.replace(/[^A-Za-z0-9_-]/gu, "-");
      row.marker = { bounds, markup: beamerContentsSphere({ id, x: centerX, y: centerY, size, background, canvas, section: topLevel }) };
      if (topLevel) {
        const numberFont = { ...font, ...beamerNamedFontSize(String(theme.options["class-font-size"] ?? "11"), "scriptsize") };
        const number = params.layout(createGeneratedMappedText(String(sectionIndex), "Beamer section number", section.span), numberFont, size, `${node.id}:${section.id}:number`);
        if (number) {
          const line = number.layout.report.lines[0];
          const textWidth = Number(line?.naturalWidth ?? 0);
          row.number = { paragraph: number, x: centerX - textWidth / 2,
            top: centerY - Number(line?.ascent ?? 0) / 2 - Number(line?.descent ?? 0) / 2 };
        }
      }
    }
    rows.push(row);
    cursor += height;
    previousDepth = endingDepth;
  }
  return { node, rows, naturalHeight: cursor, fillWeight: fills + 1 };
}
