import type {
  AddonEngine,
  AddonManifest,
  AddonRegistration,
  AddonUi,
  OptionEntry,
  WorldPoint
} from "@tikz-editor/addon-api";

/**
 * The in-repo toy add-on used by the addon-api contract tests. It claims one
 * command, `\smiley[<style>] (<coordinate>);`, and exercises every Phase A
 * extension point: command claiming and payload parsing, style resolution,
 * coordinate evaluation, element factories, named-coordinate and
 * coordinate-system export, node geometry export, picture bounds, features,
 * and diagnostics.
 */

const PT_PER_UNIT = 28.4527559055; // 1cm in pt, the default smiley radius

export type SmileyPayload = {
  coordRaw: string | null;
  radius: number;
  styleEntries: OptionEntry[];
};

export const SMILEY_MANIFEST: AddonManifest = {
  id: "smiley",
  version: "0.0.1",
  apiVersion: "^0.2.0",
  displayName: "Smiley (test add-on)",
  license: "MIT",
  sourceUrl: "https://example.invalid/smiley",
  triggers: {
    commands: ["\\smiley"],
    macroCommands: ["\\smileyset"],
    environments: ["smileybox"],
    packages: ["smiley"]
  },
  requiredPreamble: ["\\usepackage{smiley}"],
  capabilities: [
    {
      featureId: "addon:smiley:smiley-command",
      parser: "stable",
      semantic: "stable",
      svg: "stable",
      edit: "none"
    }
  ],
  entries: { engine: "./engine.js" }
};

export function createSmileyAddon(): AddonRegistration {
  // Cloned so tests can mutate manifests without leaking into other tests.
  const manifest = structuredClone(SMILEY_MANIFEST);
  const engine: AddonEngine = {
    manifest,

    parseEnvironment: (statement, context) => {
      const optionEntries = statement.options?.entries ?? [];
      const paddingEntry = optionEntries.find((entry) => entry.kind === "kv" && entry.key === "padding");
      const padding =
        paddingEntry?.kind === "kv" && Number.isFinite(Number.parseFloat(paddingEntry.valueRaw))
          ? Number.parseFloat(paddingEntry.valueRaw) * PT_PER_UNIT
          : 0.25 * PT_PER_UNIT;
      void context;
      return { kind: "success", payload: { padding } };
    },

    parseCommand: (statement, context) => {
      if (statement.commandName === "\\smileyset") {
        const rawArgs = context.slice(statement.argsSpan);
        const braceOffset = rawArgs.indexOf("{");
        const group = braceOffset >= 0 ? context.readBalancedGroup(statement.argsSpan.from + braceOffset) : null;
        return {
          kind: "success",
          payload: { configRaw: group ? context.slice({ from: group.from + 1, to: group.to - 1 }).trim() : "" }
        };
      }
      const args = context.slice(statement.argsSpan);
      const coordMatch = /\(([^()]*)\)/.exec(args);
      const optionsMatch = /\[[^\]]*\]/.exec(args);
      const options = optionsMatch
        ? context.parseOptionList(optionsMatch[0], statement.argsSpan.from + optionsMatch.index)
        : context.parseOptionList("[draw=black, fill=yellow]", statement.argsSpan.from);
      let radius = PT_PER_UNIT;
      const radiusEntry = options.entries.find((entry) => entry.kind === "kv" && entry.key === "radius");
      if (radiusEntry && radiusEntry.kind === "kv") {
        const parsed = Number.parseFloat(radiusEntry.valueRaw);
        if (Number.isFinite(parsed) && parsed > 0) {
          radius = parsed * PT_PER_UNIT;
        }
      }
      const payload: SmileyPayload = {
        coordRaw: coordMatch ? coordMatch[1] : null,
        radius,
        styleEntries: options.entries.filter((entry) => entry.kind === "unknown" || entry.key !== "radius")
      };
      return { kind: "success", payload };
    },

    evaluate: (statement, context) => {
      if (statement.kind === "AddonEnvironment") {
        const payload = statement.payload as { padding: number } | undefined;
        const padding = payload?.padding ?? 0.25 * PT_PER_UNIT;
        const bodyElements = context.evaluateTikzStatements(statement.body ?? []);
        const border = context.makePath({
          commands: [
            { kind: "M", to: { x: -padding, y: -padding } },
            { kind: "L", to: { x: 3 * PT_PER_UNIT + padding, y: -padding } },
            { kind: "L", to: { x: 3 * PT_PER_UNIT + padding, y: 3 * PT_PER_UNIT + padding } },
            { kind: "L", to: { x: -padding, y: 3 * PT_PER_UNIT + padding } },
            { kind: "Z" }
          ]
        });
        context.markFeature("addon:smiley:smileybox-environment", "supported");
        return { kind: "success", elements: [...bodyElements, border] };
      }
      if (statement.commandName === "\\smileyset") {
        const payload = statement.payload as { configRaw: string } | undefined;
        context.markFeature("addon:smiley:smileyset-command", "supported");
        if (!payload) {
          return { kind: "error", message: "missing \\smileyset payload" };
        }
        return { kind: "success", elements: [] };
      }
      const payload = statement.payload as SmileyPayload | undefined;
      if (!payload || payload.coordRaw == null) {
        context.pushDiagnostic({
          severity: "error",
          message: "\\smiley requires a coordinate, e.g. \\smiley (1,2);",
          span: statement.span,
          code: "addon:smiley:missing-coordinate"
        });
        return { kind: "error", message: "missing coordinate" };
      }

      const center = context.evaluateCoordinate(payload.coordRaw);
      if (!center) {
        context.pushDiagnostic({
          severity: "error",
          message: `\\smiley coordinate could not be evaluated: (${payload.coordRaw})`,
          span: statement.span,
          code: "addon:smiley:invalid-coordinate"
        });
        return { kind: "error", message: "invalid coordinate" };
      }

      const radius = payload.radius;
      const { style } = context.resolveStyle(payload.styleEntries);

      const face = context.makeCircle({ center, radius, style });
      const eyeOffsetX = radius * 0.35;
      const eyeY = center.y + radius * 0.3;
      const eyeRadius = radius * 0.1;
      const leftEye = context.makeCircle({ center: { x: center.x - eyeOffsetX, y: eyeY }, radius: eyeRadius, style });
      const rightEye = context.makeCircle({ center: { x: center.x + eyeOffsetX, y: eyeY }, radius: eyeRadius, style });

      const mouthHalfWidth = radius * 0.5;
      const mouthY = center.y - radius * 0.25;
      const mouthDepth = radius * 0.35;
      const mouth = context.makePath({
        commands: [
          { kind: "M", to: { x: center.x - mouthHalfWidth, y: mouthY } },
          {
            kind: "C",
            c1: { x: center.x - mouthHalfWidth * 0.5, y: mouthY - mouthDepth },
            c2: { x: center.x + mouthHalfWidth * 0.5, y: mouthY - mouthDepth },
            to: { x: center.x + mouthHalfWidth, y: mouthY }
          }
        ],
        style
      });

      context.writeNamedCoordinate("smiley center", center);
      context.registerNodeGeometry("smiley", {
        center,
        halfWidth: radius,
        halfHeight: radius,
        shape: "circle",
        radius
      });
      const capturedCenter: WorldPoint = { ...center };
      context.registerCoordinateSystem("smiley", (args) => {
        const parts = args.split(",").map((part) => Number.parseFloat(part.trim()));
        if (parts.length !== 2 || !parts.every(Number.isFinite)) {
          return null;
        }
        return {
          x: capturedCenter.x + parts[0] * radius,
          y: capturedCenter.y + parts[1] * radius
        };
      });
      context.extendPictureBounds({
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius
      });
      context.createHandle({
        role: "center",
        world: center,
        data: { statementId: statement.id }
      });
      context.markFeature("addon:smiley:smiley-command", "supported");

      return { kind: "success", elements: [face, leftEye, rightEye, mouth] };
    },

    planHandleDrag: (handle, newWorld) => {
      if (handle.role !== "center") {
        return null;
      }
      return {
        kind: "move-center",
        statementId: handle.sourceId,
        x: newWorld.x / PT_PER_UNIT,
        y: newWorld.y / PT_PER_UNIT
      } satisfies SmileyEdit;
    },

    applyEdit: (edit, context) => {
      const smileyEdit = edit as SmileyEdit;
      const statement = context.findStatement(smileyEdit.statementId);
      if (!statement || statement.kind !== "AddonCommand") {
        return { kind: "error", message: `Statement ${smileyEdit.statementId} not found` };
      }
      if (smileyEdit.kind === "move-center") {
        const argsRaw = context.slice(statement.argsSpan);
        const coordMatch = /\(([^()]*)\)/.exec(argsRaw);
        if (!coordMatch || coordMatch.index == null) {
          return { kind: "unsupported", reason: "\\smiley has no coordinate to move" };
        }
        const from = statement.argsSpan.from + coordMatch.index + 1;
        const to = from + coordMatch[1].length;
        const format = (value: number) => String(Math.round(value * 1000) / 1000);
        return {
          kind: "success",
          patches: [{ span: { from, to }, replacement: `${format(smileyEdit.x)},${format(smileyEdit.y)}` }],
          changedSourceIds: [statement.id]
        };
      }
      const patch = context.rewriteOptionList(statement, [
        { key: "radius", value: String(Math.round(smileyEdit.radius * 1000) / 1000) }
      ]);
      if (!patch) {
        return { kind: "unsupported", reason: "Could not rewrite \\smiley options" };
      }
      return { kind: "success", patches: [patch], changedSourceIds: [statement.id] };
    }
  };

  const formatUnits = (value: number) => String(Math.round((value / PT_PER_UNIT) * 1000) / 1000);

  const ui: AddonUi = {
    manifest,
    templates: [
      {
        id: "addon:smiley:smiley",
        label: "Smiley",
        // Filled smiley glyph (24x24, evenodd cutouts for eyes and mouth).
        iconPath:
          "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" +
          "M8.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" +
          "M15.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" +
          "M6.6 14.2c1.1 2.5 3 3.8 5.4 3.8s4.3-1.3 5.4-3.8l-1.8-.8c-.8 1.8-2 2.6-3.6 2.6s-2.8-.8-3.6-2.6z",
        placement: "drag-rect",
        generateSource: (at, opposite) => {
          if (!opposite) {
            return `\\smiley (${formatUnits(at.x)},${formatUnits(at.y)});`;
          }
          const centerX = (at.x + opposite.x) / 2;
          const centerY = (at.y + opposite.y) / 2;
          const radius = Math.max(
            0.1 * PT_PER_UNIT,
            Math.max(Math.abs(opposite.x - at.x), Math.abs(opposite.y - at.y)) / 2
          );
          return `\\smiley[radius=${formatUnits(radius)}] (${formatUnits(centerX)},${formatUnits(centerY)});`;
        }
      }
    ],
    insertMenu: {
      kind: "item",
      item: {
        commandId: "addon:smiley:insert-smiley",
        label: "Smiley",
        action: { kind: "insert-template", templateId: "addon:smiley:smiley" }
      }
    },
    contextMenu: (statement) => {
      if (statement.kind !== "AddonCommand" || statement.commandName !== "\\smiley") {
        return [];
      }
      const payload = statement.payload as SmileyPayload | undefined;
      const radius = (payload?.radius ?? PT_PER_UNIT) / PT_PER_UNIT;
      return [
        {
          commandId: "addon:smiley:grow",
          label: "Grow smiley",
          edit: {
            kind: "set-radius",
            statementId: statement.id,
            radius: Math.round(radius * 1.25 * 1000) / 1000
          } satisfies SmileyEdit
        }
      ];
    },
    inspector: (statement) => {
      if (statement.kind !== "AddonCommand" || statement.commandName !== "\\smiley") {
        return [];
      }
      const payload = statement.payload as SmileyPayload | undefined;
      const radius = (payload?.radius ?? PT_PER_UNIT) / PT_PER_UNIT;
      return [
        {
          id: "smiley",
          title: "Smiley",
          properties: [
            {
              kind: "number",
              id: "addon:smiley:radius",
              label: "Radius",
              value: radius,
              min: 0.1,
              step: 0.1,
              buildEdit: (newValue: number): SmileyEdit => ({
                kind: "set-radius",
                statementId: statement.id,
                radius: newValue
              })
            }
          ]
        }
      ];
    }
  };

  return { engine, ui };
}

export type SmileyEdit =
  | { kind: "move-center"; statementId: string; x: number; y: number }
  | { kind: "set-radius"; statementId: string; radius: number };
