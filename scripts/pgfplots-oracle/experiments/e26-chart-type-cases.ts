/**
 * E26: every chart type switch the editor offers (packages/core/src/edit/pgfplots/chart-type.ts),
 * applied to the charts of test/fixtures/pgfplots/chart-type-fixtures.ts, rendered by LuaLaTeX
 * and compared with the editor at the design tolerances:
 *   node --import tsx scripts/pgfplots-oracle/experiments/check-cases.mts ./e26-chart-type-cases.ts
 * Case ids: `<fixture>` (the chart as written), `<fixture>--axis-<kind>`, `<fixture>--plot<i>-<type>`.
 */
import { parseTikz } from "../../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../../packages/core/src/semantic/evaluate.js";
import { applyChangeChartTypeAction, readChartTypeConversions } from "../../../packages/core/src/edit/pgfplots/chart-type.js";
import { CHART_TYPE_FIXTURES, CHART_TYPE_PREAMBLE } from "../../../test/fixtures/pgfplots/chart-type-fixtures.js";

export const NAME = "e26-chart-type";

function conversions(source: string): Array<{ id: string; source: string }> {
  const parsed = parseTikz(source, { includeContextDefinitions: true, recover: true });
  const axis = parsed.figure.body.find((statement) => statement.kind === "Axis");
  if (axis?.kind !== "Axis") return [];
  const elements = evaluateTikzFigure(parsed.figure, source).scene.elements;
  const out: Array<{ id: string; source: string }> = [];
  const targets = [{ elementId: axis.id, label: "axis" }, ...axis.body.flatMap((item, index) => (item.kind === "AddPlot" ? [{ elementId: item.id, label: `plot${String(axis.body.filter((other, j) => j < index && other.kind === "AddPlot").length)}` }] : []))];
  for (const target of targets) {
    const list = readChartTypeConversions(source, target.elementId, elements);
    for (const option of list?.options ?? []) {
      if (!option.available) continue;
      const result = applyChangeChartTypeAction(source, target.elementId, option.kind);
      if (result.kind === "success") out.push({ id: `${target.label}-${option.kind}`, source: result.newSource });
    }
  }
  return out;
}

export const CASES: Array<{ id: string; body: string }> = CHART_TYPE_FIXTURES.flatMap((fixture) => {
  const source = `${CHART_TYPE_PREAMBLE}${fixture.picture}`;
  const strip = (text: string) => text.slice(CHART_TYPE_PREAMBLE.length);
  return [
    { id: fixture.id, body: fixture.picture },
    ...conversions(source).map((conversion) => ({ id: `${fixture.id}--${conversion.id}`, body: strip(conversion.source) }))
  ];
});
