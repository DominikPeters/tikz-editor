import { describe, expect, it } from "vitest";

import { FEATURE_IDS } from "../packages/core/src/capabilities/feature-ids.js";
import { capabilityMatrix } from "../packages/core/src/capabilities/matrix.js";
import {
  editFeatureRegistry,
  parserFeatureRegistry,
  semanticFeatureRegistry,
  svgFeatureRegistry
} from "../packages/core/src/capabilities/registries.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { capabilityFixtures } from "./capability-fixtures.js";
import { applyDeckDocumentEditAction, buildDeckDocumentInspector, scanBeamerDocument, type DeckDocumentEditAction } from "../packages/core/src/beamer/index.js";

describe("capability matrix guards", () => {
  it("justifies document inspector editing with source-backed page, navigation, metadata and color actions", () => {
    expect(capabilityMatrix.beamer_document_inspector.edit).toBe("partial");
    let source = capabilityFixtures.beamer_document_inspector;
    const actions: DeckDocumentEditAction[] = [
      { kind: "deckSetClassOption", key: "font-size", value: "12" },
      { kind: "deckSetNavigationSymbols", visible: false },
      { kind: "deckSetMetadataShort", field: "title", value: "Header" },
      { kind: "deckSetColor", role: "structure", side: "fg", value: "red" },
    ];
    for (const action of actions) {
      const result = applyDeckDocumentEditAction(source, action);
      if (result.kind !== "success") throw new Error("Expected a document inspector capability edit");
      source = result.newSource;
    }
    const document = scanBeamerDocument(source);
    const model = buildDeckDocumentInspector(document);
    expect(model.page.find(field => field.id === "class-font-size")).toMatchObject({ value: "12" });
    expect(model.page.find(field => field.id === "navigation-symbols")).toMatchObject({ value: "hidden" });
    expect(model.colors.find(field => field.id === "color:structure")).toMatchObject({ fg: { css: "#ff0000", expression: "red" } });
    expect(document.preamble.metadata.title?.value.value).toBe("Long title");
    expect(document.preamble.metadata.title?.shortValue?.value).toBe("Header");
  });
  it("has exact matrix coverage for all feature IDs", () => {
    const matrixKeys = Object.keys(capabilityMatrix).sort();
    expect(matrixKeys).toEqual([...FEATURE_IDS].sort());
  });

  it("requires fixture references for every feature row", () => {
    for (const featureId of FEATURE_IDS) {
      const row = capabilityMatrix[featureId];
      expect(row.fixtures.length, `Expected fixtures for ${featureId}`).toBeGreaterThan(0);
      for (const fixtureId of row.fixtures) {
        expect(capabilityFixtures[fixtureId], `Unknown fixture ${fixtureId} for ${featureId}`).toBeTypeOf("string");
      }
    }
  });

  it("keeps layer registries aligned with matrix statuses", () => {
    assertRegistryMatchesLayer("parser", parserFeatureRegistry);
    assertRegistryMatchesLayer("semantic", semanticFeatureRegistry);
    assertRegistryMatchesLayer("svg", svgFeatureRegistry);
    assertRegistryMatchesLayer("edit", editFeatureRegistry);
  });

  it("fails if stable semantic features are still unsupported", () => {
    for (const featureId of FEATURE_IDS) {
      const row = capabilityMatrix[featureId];
      for (const fixtureId of row.fixtures) {
        const source = capabilityFixtures[fixtureId];
        const result = renderTikzToSvg(source);

        const semanticUsage = result.semantic.featureUsage[featureId];
        if (row.semantic === "stable") {
          expect(
            semanticUsage,
            `Feature ${featureId} is stable in semantic matrix but not supported in fixture ${fixtureId}`
          ).toBe("used-supported");
        }

        if (row.semantic === "partial") {
          expect(
            semanticUsage,
            `Feature ${featureId} is semantic=partial but not exercised in fixture ${fixtureId}`
          ).not.toBe("unused");
        }

        if (row.semantic === "none") {
          expect(
            semanticUsage,
            `Feature ${featureId} is marked semantic=none but appears supported in fixture ${fixtureId}`
          ).not.toBe("used-supported");
        }
      }
    }
  });

  it("fails if stable SVG features are not emitted", () => {
    for (const featureId of FEATURE_IDS) {
      const row = capabilityMatrix[featureId];
      if (row.svg !== "stable") {
        continue;
      }

      for (const fixtureId of row.fixtures) {
        const source = capabilityFixtures[fixtureId];
        const rendered = renderTikzToSvg(source);
        const svg = rendered.svg.svg;

        if (featureId === "svg_path") {
          expect(svg).toContain("<path");
        }
        if (featureId === "svg_circle") {
          expect(svg).toContain("<circle");
        }
        if (featureId === "svg_text") {
          expect(svg).toContain("<text");
        }
        if (featureId === "render_pipeline") {
          expect(svg).toContain("<svg");
        }
        if (featureId === "arrow_tips") {
          expect(svg).toContain("data-arrow-tip-kind=");
          expect(svg).toContain("<path");
          expect(svg).not.toContain("marker-end=");
          expect(svg).not.toContain("marker-start=");
        }
      }
    }
  });

  it("keeps matrix edit capability justified with structural matrix action smoke tests", () => {
    const source = capabilityFixtures.matrix_basic;
    const addRow = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 2
    });
    expect(addRow.kind).toBe("success");
    if (addRow.kind !== "success") {
      throw new Error("Expected addMatrixRow capability smoke edit to succeed");
    }

    const transpose = applyEditAction(addRow.newSource, [], {
      kind: "transposeMatrix",
      matrixSourceId: "path:0"
    });
    expect(transpose.kind).toBe("success");
    if (transpose.kind !== "success") {
      throw new Error("Expected transposeMatrix capability smoke edit to succeed");
    }

    const rendered = renderTikzToSvg(transpose.newSource);
    expect(rendered.semantic.featureUsage.matrix_node).toBe("used-supported");
  });
});

function assertRegistryMatchesLayer(
  layer: "parser" | "semantic" | "svg" | "edit",
  registry: readonly (typeof FEATURE_IDS)[number][]
): void {
  const registrySet = new Set(registry);

  for (const featureId of FEATURE_IDS) {
    const status = capabilityMatrix[featureId][layer];
    if (status === "none" || status === "not-applicable") {
      expect(registrySet.has(featureId), `${featureId} has ${layer}=${status} but exists in registry`).toBe(false);
    } else {
      expect(registrySet.has(featureId), `${featureId} has ${layer}=${status} but is missing from registry`).toBe(true);
    }
  }

  for (const featureId of registrySet) {
    expect(FEATURE_IDS.includes(featureId), `Unknown feature id in ${layer} registry: ${featureId}`).toBe(true);
  }
}
