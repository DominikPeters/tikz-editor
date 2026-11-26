import type {
  SvgRenderModel,
  SvgRenderPart,
  SvgViewBox
} from "./types.js";
import { formatSvgNumber as fmt } from "./format.js";
import { texGlyphSvgDefinitions } from "../text/tex/fonts/glyph-svg.js";

type XmlFormatter = (xml: string, options?: XmlFormatterOptions) => string;

type XmlFormatterOptions = {
  indentation?: string;
  collapseContent?: boolean;
  lineSeparator?: string;
};

export type SerializeSvgModelAsyncOptions = {
  includeXmlns?: boolean;
  pretty?: boolean;
  indentation?: string;
  collapseContent?: boolean;
  lineSeparator?: string;
};

let xmlFormatterPromise: Promise<XmlFormatter> | null = null;

export type SvgModelPartInput = {
  basePartId: string;
  sourceId: string;
  elementId: string | null;
  markup: string;
  textRenderKey?: string;
};

export type SvgModelBuilder = {
  addPart: (input: SvgModelPartInput) => SvgRenderPart;
  addExistingPart: (part: SvgRenderPart) => SvgRenderPart;
  build: (input: {
    viewBox: SvgViewBox;
    defs: string[];
    diagnostics: Array<{ code: string; message: string }>;
    /** False when only the parts are used and a later model defines the glyphs (default true). */
    glyphDefs?: boolean;
  }) => SvgRenderModel;
};

export function createSvgModelBuilder(): SvgModelBuilder {
  const parts: SvgRenderPart[] = [];
  const baseIdCounts = new Map<string, number>();
  const usedPartIds = new Set<string>();

  const addPartWithId = (partId: string, input: Omit<SvgRenderPart, "partId" | "order">): SvgRenderPart => {
    if (usedPartIds.has(partId)) {
      throw new Error(`Duplicate svg part id generated: ${partId}`);
    }
    usedPartIds.add(partId);
    const part: SvgRenderPart = {
      partId,
      sourceId: input.sourceId,
      elementId: input.elementId,
      order: parts.length,
      markup: input.markup,
      fingerprint: input.fingerprint,
      ...(input.textRenderKey != null ? { textRenderKey: input.textRenderKey } : {})
    };
    parts.push(part);
    return part;
  };

  const addPart = (input: SvgModelPartInput): SvgRenderPart => {
    const base = sanitizePartIdBase(input.basePartId);
    let seenCount = baseIdCounts.get(base) ?? 0;
    let partId = seenCount === 0 ? base : `${base}#${seenCount + 1}`;
    while (usedPartIds.has(partId)) {
      seenCount += 1;
      partId = `${base}#${seenCount + 1}`;
    }
    baseIdCounts.set(base, seenCount + 1);

    return addPartWithId(partId, {
      sourceId: input.sourceId,
      elementId: input.elementId,
      markup: input.markup,
      ...(input.textRenderKey === undefined ? {} : { textRenderKey: input.textRenderKey }),
      fingerprint: input.markup
    });
  };

  const addExistingPart = (part: SvgRenderPart): SvgRenderPart => {
    return addPartWithId(part.partId, {
      sourceId: part.sourceId,
      ...(part.textRenderKey === undefined ? {} : { textRenderKey: part.textRenderKey }),
      elementId: part.elementId,
      markup: part.markup,
      fingerprint: part.fingerprint
    });
  };

  const build = (input: {
    viewBox: SvgViewBox;
    defs: string[];
    diagnostics: Array<{ code: string; message: string }>;
    glyphDefs?: boolean;
  }): SvgRenderModel => {
    // Text refers to its glyph outlines by id; the model defines each distinct
    // outline once, so every serialization of it is a standalone document.
    const defs = [...input.defs];
    const glyphDefs = input.glyphDefs === false ? [] : texGlyphSvgDefinitions(parts.map((part) => part.markup).join(""));
    return {
      viewBox: input.viewBox,
      defs,
      glyphDefs,
      defsFingerprint: fingerprintDefs(defs),
      parts: [...parts],
      diagnostics: [...input.diagnostics]
    };
  };

  return {
    addPart,
    addExistingPart,
    build
  };
}

export function serializeSvgModel(
  model: SvgRenderModel,
  includeXmlns = true
): string {
  return serializeSvgModelCompact(model, includeXmlns);
}

export async function serializeSvgModelAsync(
  model: SvgRenderModel,
  options: SerializeSvgModelAsyncOptions = {}
): Promise<string> {
  const includeXmlns = options.includeXmlns ?? true;
  const compact = serializeSvgModelCompact(model, includeXmlns);
  if (!options.pretty) {
    return compact;
  }
  const xmlFormatter = await getXmlFormatter();
  return xmlFormatter(compact, {
    indentation: options.indentation ?? "  ",
    collapseContent: options.collapseContent ?? true,
    lineSeparator: options.lineSeparator ?? "\n"
  });
}

function serializeSvgModelCompact(model: SvgRenderModel, includeXmlns: boolean): string {
  const xmlns = includeXmlns ? ` xmlns="http://www.w3.org/2000/svg"` : "";
  const allDefs = svgModelDefs(model);
  const defs = allDefs.length > 0 ? `<defs>${allDefs.join("")}</defs>` : "";
  const body = model.parts.map((part) => part.markup).join("");
  return (
    `<svg${xmlns} viewBox="${fmt(model.viewBox.x)} ${fmt(model.viewBox.y)} ${fmt(model.viewBox.width)} ${fmt(model.viewBox.height)}" role="img" aria-label="TikZ SVG preview">` +
    defs +
    body +
    `</svg>`
  );
}

/** Every definition the model's parts may refer to. */
export function svgModelDefs(model: Pick<SvgRenderModel, "defs" | "glyphDefs">): string[] {
  return model.glyphDefs?.length ? [...model.defs, ...model.glyphDefs] : model.defs;
}

export function fingerprintDefs(defs: readonly string[]): string {
  return defs.join("");
}

async function getXmlFormatter(): Promise<XmlFormatter> {
  xmlFormatterPromise ??= import("xml-formatter").then((mod) => {
      const formatter = mod.default;
      if (typeof formatter !== "function") {
        throw new Error("xml-formatter default export is not a function.");
      }
      return formatter;
    });
  return xmlFormatterPromise;
}

function sanitizePartIdBase(base: string): string {
  const trimmed = base.trim();
  if (trimmed.length === 0) {
    return "part";
  }
  return trimmed.replace(/\s+/g, "_");
}
