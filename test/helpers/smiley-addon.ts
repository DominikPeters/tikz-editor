import type {
  AddonEngine,
  AddonManifest,
  AddonRegistration,
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
  apiVersion: "^0.1.0",
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
  const engine: AddonEngine = {
    manifest: SMILEY_MANIFEST,

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
      context.markFeature("addon:smiley:smiley-command", "supported");

      return { kind: "success", elements: [face, leftEye, rightEye, mouth] };
    }
  };

  return { engine };
}
