import { describe, expect, it } from "vitest";
import { buildBeamerCaretStopDomain, prepareBeamerDocument } from "../../packages/core/src/beamer/index.js";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { createEditViewCache, renderedVisibility } from "../../packages/core/src/editing/position/index.js";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { beamerScenarioDocument } from "../../packages/core/src/editing/testing/index.js";

describe("rendered overlay branch visibility", () => {
  it.each([
    [String.raw`a \alt<2>{first}{second} b`, [1, 2], [1, 0]],
    [String.raw`a \temporal<2>{before}{during}{after} b \only<3>{}`, [1, 2, 3], [0, 1, 2]],
    [String.raw`a \alt<2>{first}{} b`, [1, 2], [1, 0]],
    [String.raw`a \alt<2>{}{second} b`, [1, 2], [1, 0]],
  ] as const)("has caret stops only in the displayed branch: %s", async (body, steps, selected) => {
    const { source, bodyFrom } = beamerScenarioDocument(body);
    const prepared = prepareBeamerDocument(source);
    const commands = createCommandTable();
    const views = createEditViewCache();
    const tree = buildEditTree(body, { commands });
    const overlay = tree.nodes.find((node) => node.kind === "overlay")!;
    for (const [index, step] of steps.entries()) {
      const page = await prepared.renderFrame({ step });
      const domain = buildBeamerCaretStopDomain({ source, paragraphs: page.layout.paragraphs, overlayBranches: page.layout.overlayBranches });
      const visibility = renderedVisibility(tree, domain, bodyFrom)!;
      const view = views(body, commands, visibility);
      overlay.slots.forEach((slot, branch) => {
        expect(view.stops.some((stop) => stop.slot === slot)).toBe(branch === selected[index]);
      });
    }
  });

  it("ignores visibility published for an older buffer", () => {
    const tree = buildEditTree(String.raw`\alt<2>{first}{second}`);
    expect(renderedVisibility(tree, { source: "old", offsets: [] }, 0)).toBeNull();
  });
});
