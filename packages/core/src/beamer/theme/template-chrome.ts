import { fragFromSource } from "./template-lexer.js";
import {
  applyElementFont,
  TemplateMachine,
  TemplateUnsupported,
  type TemplateBox,
  type TemplateEnvironment,
  type TemplatePaint,
} from "./template-machine.js";
import type {
  BeamerChromeTemplatePlan,
  BeamerFrameTemplateContext,
  BeamerInterpretedTemplate,
  BeamerTemplatePrimitive,
  BeamerThemeFont,
} from "./types.js";

const BEAMER_FOOTLINE_RESERVE_PT = 4;
const programs = new WeakMap<BeamerFrameTemplateContext, TemplateMachine | null>();

/** The preamble's definitions, run once per chrome plan; null when this host cannot lay out paragraphs. */
export function templateMachineFor(context: BeamerFrameTemplateContext, idPrefix: string, overrides: Partial<TemplateEnvironment> = {}): TemplateMachine | null {
  void overrides;
  const measure = context.measureTemplateParagraph;
  if (!measure) return null;
  const theme = context.theme;
  const env: TemplateEnvironment = {
    theme,
    metadata: context.document.preamble.metadata,
    owner: context.frame.span,
    paperWidth: context.page.page.width,
    paperHeight: context.page.page.height,
    width: context.page.page.width,
    leftMargin: theme.dimensions.textMarginLeftPt,
    rightMargin: theme.dimensions.textMarginRightPt,
    registers: context.lengthRegisters ?? new Map(),
    frameNumber: context.frameIndex + 1,
    totalFrames: context.totalFrames,
    idPrefix,
    font: theme.fonts["normal-text"],
    measure,
    ...overrides,
  };
  const machine = new TemplateMachine(env);
  try {
    for (const unit of theme.interpreted?.units ?? []) machine.runProgram(fragFromSource(unit.text, unit.offset));
  } catch (error) {
    if (error instanceof TemplateUnsupported) return null;
    throw error;
  }
  return machine;
}

function sharedMachine(context: BeamerFrameTemplateContext): TemplateMachine | null {
  if (!programs.has(context)) programs.set(context, templateMachineFor(context, `${context.frame.id}:template`));
  return programs.get(context) ?? null;
}

/** Paint a template box's content as chrome primitives placed at `top`. */
export function templatePrimitives(context: BeamerFrameTemplateContext, box: TemplateBox, top: number, name: string): BeamerTemplatePrimitive[] {
  const primitives: BeamerTemplatePrimitive[] = [];
  let index = 0;
  for (const paint of box.paint) {
    if (paint.kind === "slot") continue;
    index += 1;
    primitives.push(paintPrimitive(context, paint, top, `${context.frame.id}:${name}:${index}`));
  }
  return primitives;
}

function paintPrimitive(context: BeamerFrameTemplateContext, paint: Exclude<TemplatePaint, { kind: "slot" }>, top: number, id: string): BeamerTemplatePrimitive {
  if (paint.kind === "fill") {
    return {
      kind: "fill", id, sourceSpan: context.frame.span,
      bounds: { x: paint.x, y: top + paint.y, width: paint.w, height: paint.h },
      colorRole: "normal text", paint: "background", colorHex: paint.color,
    };
  }
  return {
    kind: "text", id, sourceSpan: paint.sourceSpan,
    bounds: { x: paint.x, y: top + paint.y, width: paint.w, height: paint.height },
    source: { kind: "text", mapped: paint.mapped, sourceSpan: paint.sourceSpan },
    fontRole: "headline", colorRole: "normal text", colorHex: paint.color, font: paint.font,
    alignment: paint.alignment, verticalAlignment: "top", baselineY: top + paint.y + paint.firstBaseline,
    baselineSkipPt: paint.baselineSkipPt, justify: paint.justify,
  };
}

/**
 * Lay out an interpreted headline or footline. Returns null when the body is
 * outside the vocabulary (or this host cannot measure), for the caller's
 * fallback.
 */
export function planInterpretedEdge(context: BeamerFrameTemplateContext, source: BeamerInterpretedTemplate, edge: "headline" | "footline"): BeamerChromeTemplatePlan | null {
  if (source.unsupported !== undefined) return null;
  const machine = sharedMachine(context);
  if (!machine) return null;
  let box: TemplateBox;
  try {
    box = machine.runTemplate(fragFromSource(source.body, source.offset), { font: edgeFont(context, edge), colorRole: edge });
  } catch (error) {
    if (error instanceof TemplateUnsupported) return null;
    throw error;
  }
  return edgePlan(context, box, edge);
}

/** `\usebeamertemplate***{headline}` sets the element's font over the page font. */
function edgeFont(context: BeamerFrameTemplateContext, edge: "headline" | "footline"): BeamerThemeFont {
  const declared = context.theme.elementFonts?.[edge];
  const base = context.theme.fonts[edge];
  return declared ? applyElementFont(base, declared) : base;
}

function edgePlan(context: BeamerFrameTemplateContext, box: TemplateBox, edge: "headline" | "footline"): BeamerChromeTemplatePlan {
  const extent = box.h + box.d;
  if (edge === "headline") return { inset: extent, primitives: templatePrimitives(context, box, 0, "headline") };
  return {
    inset: extent + BEAMER_FOOTLINE_RESERVE_PT,
    primitives: templatePrimitives(context, box, context.page.page.height - extent, "footline"),
  };
}

/**
 * A headline whose template cannot be laid out: title, author and institute
 * centred in the headline colours, so that a poster does not lose its title.
 */
export function planFallbackHeadline(context: BeamerFrameTemplateContext): BeamerChromeTemplatePlan {
  const metadata = context.document.preamble.metadata;
  const fields: string[] = [];
  if (metadata.title?.value.value.trim()) fields.push("\\usebeamerfont{title}\\inserttitle\\par");
  if (metadata.author?.value.value.trim()) fields.push("\\usebeamerfont{author}\\insertauthor\\par");
  if (metadata.institute?.value.value.trim()) fields.push("\\usebeamerfont{institute}\\insertinstitute\\par");
  if (fields.length === 0) return { inset: 0, primitives: [] };
  const machine = templateMachineFor(context, `${context.frame.id}:fallback-headline`);
  if (!machine) return { inset: 0, primitives: [] };
  try {
    const box = machine.runTemplate(fragFromSource(
      `\\begin{beamercolorbox}[wd=\\paperwidth,sep=1ex,center]{headline}${fields.join("")}\\end{beamercolorbox}`, null));
    return edgePlan(context, box, "headline");
  } catch (error) {
    if (error instanceof TemplateUnsupported) return { inset: 0, primitives: [] };
    throw error;
  }
}
