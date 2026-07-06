import { parseTikz } from "../../parser/index.js";
import type { PathItem, PathStatement } from "../../ast/types.js";
import type { OptionListAst } from "../../options/types.js";
import { parseCoordinateLike, parseLength } from "../../semantic/coords/parse-length.js";
import type { SceneElement } from "../../semantic/types.js";
import type { StyleChainEntry } from "../../semantic/style-chain.js";
import { CM_PER_PT } from "../format.js";
import type { EditParseOptions } from "../parse-options.js";
import { normalizeOptionKey } from "../option-key.js";
import { findPathStatementById } from "../statement-find.js";

const GRID_DEFAULT_STEP_CM = 1;

export type GridInspectorState = {
  keywordId: string;
  step: number;
  xstep: number;
  ystep: number;
};

export function resolveGridInspectorState(
  element: SceneElement,
  source: string,
  parseOptions: EditParseOptions = {}
): GridInspectorState | null {
  const pathStatement = findPathStatementInSource(source, element.sourceRef.sourceId, parseOptions);
  if (!pathStatement) {
    return null;
  }

  const gridKeywords = collectGridKeywords(pathStatement.items);
  if (gridKeywords.length !== 1) {
    return null;
  }

  const gridKeyword = gridKeywords[0];
  if (!gridKeyword) {
    return null;
  }
  const values = resolveGridStepValuesFromStyleChainAndOptions(element.styleChain, gridKeyword.options);
  return {
    keywordId: gridKeyword.keyword.id,
    step: values.step,
    xstep: values.xstep,
    ystep: values.ystep
  };
}

export function findPathStatementInSource(source: string, sourceId: string, parseOptions: EditParseOptions = {}): PathStatement | null {
  if (
    parseOptions.analysisView?.source === source &&
    parseOptions.analysisView.activeFigureId === parseOptions.activeFigureId
  ) {
    return parseOptions.analysisView.findPathStatement(sourceId);
  }
  const parsed = parseTikz(source, {
    recover: true,
    activeFigureId: parseOptions.activeFigureId,
  });
  return findPathStatementById(parsed.figure.body, sourceId);
}

function collectGridKeywords(
  items: readonly PathItem[]
): Array<{ keyword: Extract<PathItem, { kind: "PathKeyword" }>; options: Extract<PathItem, { kind: "PathOption" }> | null }> {
  const collected: Array<{ keyword: Extract<PathItem, { kind: "PathKeyword" }>; options: Extract<PathItem, { kind: "PathOption" }> | null }> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    if (item.kind === "PathKeyword" && item.keyword === "grid") {
      const next = items[index + 1];
      collected.push({
        keyword: item,
        options: next?.kind === "PathOption" ? next : null
      });
      continue;
    }
    if (item.kind === "ChildOperation") {
      collected.push(...collectGridKeywords(item.body));
    }
  }

  return collected;
}

function resolveGridStepValuesFromStyleChainAndOptions(
  styleChain: readonly StyleChainEntry[],
  optionItem: Extract<PathItem, { kind: "PathOption" }> | null
): { step: number; xstep: number; ystep: number } {
  const optionLists = [
    ...styleChain.flatMap((entry) => entry.rawOptions),
    ...(optionItem ? [optionItem.options] : [])
  ];

  return resolveGridStepValuesFromOptionLists(optionLists);
}

function resolveGridStepValuesFromOptionLists(optionLists: readonly OptionListAst[]): { step: number; xstep: number; ystep: number } {
  let xstep = GRID_DEFAULT_STEP_CM;
  let ystep = GRID_DEFAULT_STEP_CM;

  for (const optionList of optionLists) {
    for (const entry of optionList.entries) {
      if (entry.kind !== "kv") {
        continue;
      }

      const key = normalizeOptionKey(entry.key);
      if (key === "step") {
        const parsed = parseGridStepValueCm(entry.valueRaw);
        if (!parsed) {
          continue;
        }
        xstep = parsed.x;
        ystep = parsed.y;
        continue;
      }

      if (key === "xstep" || key === "x step") {
        const parsed = parseGridLengthCm(entry.valueRaw);
        if (parsed != null) {
          xstep = parsed;
        }
        continue;
      }

      if (key === "ystep" || key === "y step") {
        const parsed = parseGridLengthCm(entry.valueRaw);
        if (parsed != null) {
          ystep = parsed;
        }
      }
    }
  }

  return {
    step: Math.abs(xstep - ystep) <= 1e-6 ? xstep : GRID_DEFAULT_STEP_CM,
    xstep,
    ystep
  };
}

function parseGridStepValueCm(raw: string): { step: number | null; x: number; y: number } | null {
  const pair = parseCoordinateLike(raw);
  if (pair) {
    const x = parseGridLengthCm(pair.x);
    const y = parseGridLengthCm(pair.y);
    if (x == null || y == null) {
      return null;
    }
    return {
      step: Math.abs(x - y) <= 1e-6 ? x : null,
      x,
      y
    };
  }

  const scalar = parseGridLengthCm(raw);
  if (scalar == null) {
    return null;
  }
  return {
    step: scalar,
    x: scalar,
    y: scalar
  };
}

function parseGridLengthCm(raw: string): number | null {
  const parsedPt = parseLength(raw, "cm");
  if (parsedPt == null || !Number.isFinite(parsedPt) || parsedPt <= 0) {
    return null;
  }
  return normalizeTinyNumber(parsedPt * CM_PER_PT);
}

function normalizeTinyNumber(value: number): number {
  return Math.abs(value) <= 1e-9 ? 0 : value;
}
