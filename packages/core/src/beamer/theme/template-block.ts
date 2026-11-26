import type { Span } from "../../ast/types.js";
import { concatMappedText, createGeneratedMappedText, sliceMappedText, type MappedText } from "../../text/source-map.js";
import type { BeamerBlockEnvironment } from "../content-types.js";
import { fragFromSource } from "./template-lexer.js";
import {
  TemplateMachine,
  TemplateUnsupported,
  type TemplateBox,
  type TemplateDefinitionsSnapshot,
  type TemplateEnvironment,
  type TemplatePaint,
  type TemplateParagraphMeasure,
  type TemplateParagraphRequest,
  type TemplateSlotContext,
} from "./template-machine.js";
import type { BeamerInterpretedTemplate, ResolvedBeamerTheme } from "./types.js";

const definitions = new WeakMap<ResolvedBeamerTheme, TemplateDefinitionsSnapshot | null>();

const ROLES: Readonly<Record<BeamerBlockEnvironment, readonly [string, string]>> = {
  block: ["block begin", "block end"],
  alertblock: ["block alerted begin", "block alerted end"],
  exampleblock: ["block example begin", "block example end"],
};

export type InterpretedBlockInput = {
  theme: ResolvedBeamerTheme;
  environment: BeamerBlockEnvironment;
  metadata: TemplateEnvironment["metadata"];
  owner: Span;
  width: number;
  paperWidth: number;
  paperHeight: number;
  registers: ReadonlyMap<string, number> | undefined;
  title: { value: string; from: number };
  idPrefix: string;
  measure: (request: TemplateParagraphRequest) => TemplateParagraphMeasure | null;
};

export type InterpretedBlockBody = {
  extent: number;
  endingDepth: number;
  firstHeight: number;
  baselineSkip: number;
};

export type InterpretedBlockLayout = {
  /** The text paints (the block title) and fills, relative to the block's top left. */
  paint: TemplatePaint[];
  slot: { x: number; y: number; width: number };
  height: number;
  firstHeight: number;
  endingDepth: number;
};

export type InterpretedBlockPlan = {
  /** Where the body goes and in what typographic state, known before the body is laid out. */
  slot: TemplateSlotContext;
  layout(body: InterpretedBlockBody): InterpretedBlockLayout;
};

function machineFor(input: InterpretedBlockInput): TemplateMachine | null {
  const theme = input.theme;
  const env: TemplateEnvironment = {
    theme, metadata: input.metadata, owner: input.owner, paperWidth: input.paperWidth, paperHeight: input.paperHeight,
    width: input.width, leftMargin: theme.dimensions.textMarginLeftPt, rightMargin: theme.dimensions.textMarginRightPt,
    registers: input.registers ?? new Map(), frameNumber: 1, totalFrames: 1, idPrefix: input.idPrefix,
    font: theme.fonts["block-body"], measure: input.measure,
    blockTitle: { text: input.title.value, origin: Array.from({ length: input.title.value.length }, (_, index) => input.title.from + index) },
  };
  const machine = new TemplateMachine(env);
  try {
    const known = definitions.get(theme);
    if (known) machine.loadDefinitions(known);
    else if (known === undefined) {
      for (const unit of theme.interpreted?.units ?? []) machine.runProgram(fragFromSource(unit.text, unit.offset));
      definitions.set(theme, machine.snapshotDefinitions());
    } else return null;
  } catch (error) {
    if (error instanceof TemplateUnsupported) { definitions.set(theme, null); return null; }
    throw error;
  }
  return machine;
}

/**
 * Interpret a theme's `block begin` and `block end` as one stream around the
 * body. Returns null when either half is missing or outside the vocabulary,
 * so the caller draws the stock block (the body is never discarded).
 */
export function interpretBlockTemplate(input: InterpretedBlockInput): InterpretedBlockPlan | null {
  if (input.theme.templates.block.id !== "interpreted/block") return null;
  const [beginRole, endRole] = ROLES[input.environment];
  const templates = input.theme.interpreted?.templates;
  const begin: BeamerInterpretedTemplate | undefined = templates?.[beginRole];
  const end: BeamerInterpretedTemplate | undefined = templates?.[endRole];
  if (!begin || !end || begin.unsupported !== undefined || end.unsupported !== undefined) return null;
  const run = (body: InterpretedBlockBody | null): { box: TemplateBox; slot: TemplateSlotContext } | null => {
    const machine = machineFor(input);
    if (!machine) return null;
    // The two halves are one stream: begin, the body, end.
    const frag = fragFromSource(`${begin.body}\\tikzeditorbodyslot ${end.body}`, null);
    try {
      const box = machine.runTemplate(frag, {
        font: input.theme.fonts["block-body"], normalBaselines: true,
        slot: context => ({
          w: context.width, h: body ? body.extent - body.endingDepth : 0, d: body?.endingDepth ?? 0,
          firstH: body?.firstHeight ?? 0, paint: [], ...(body ? { baselineSkip: body.baselineSkip } : {}),
        }),
      });
      return machine.slotContext ? { box, slot: machine.slotContext } : null;
    } catch (error) {
      if (error instanceof TemplateUnsupported) return null;
      throw error;
    }
  };
  const probe = run(null);
  if (!probe) return null;
  return {
    slot: probe.slot,
    layout: body => {
      const result = run(body);
      if (!result) throw new TemplateUnsupported("block template");
      const slot = result.box.paint.find((paint): paint is Extract<TemplatePaint, { kind: "slot" }> => paint.kind === "slot");
      if (!slot) throw new TemplateUnsupported("block body");
      return {
        paint: result.box.paint.filter(paint => paint.kind !== "slot"),
        slot: { x: slot.x, y: slot.y, width: slot.w },
        height: result.box.h + result.box.d,
        firstHeight: result.box.firstH,
        endingDepth: result.box.lastDepth ?? 0,
      };
    },
  };
}

/**
 * A template's `\parskip` between the paragraphs of a body: each blank line
 * outside environments and groups becomes `\par\vspace{...}`, which the text
 * engine lays out (it does not read `\parskip` itself).
 */
export function withParagraphSkip(mapped: MappedText, parskipPt: number, owner: Span): MappedText {
  if (parskipPt === 0) return mapped;
  const text = mapped.text;
  const pieces: MappedText[] = [];
  let last = 0;
  let depth = 0;
  const pattern = /\\(begin|end)\s*\{[^}]*\}|\\.|[{}]|\n[ \t]*\n\s*/gu;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const token = match[0];
    if (match[1] === "begin") depth += 1;
    else if (match[1] === "end") depth -= 1;
    else if (token === "{") depth += 1;
    else if (token === "}") depth -= 1;
    else if (token.startsWith("\n") && depth === 0) {
      pieces.push(sliceMappedText(mapped, last, match.index), createGeneratedMappedText(`\\par\\vspace{${parskipPt}pt}`, "Beamer template paragraph skip", owner));
      last = match.index + token.length;
    }
  }
  if (last === 0) return mapped;
  pieces.push(sliceMappedText(mapped, last, text.length));
  return concatMappedText(pieces);
}
