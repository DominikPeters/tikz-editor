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

    parseCommand: (statement, context) => {
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
      if (statement.kind !== "AddonCommand") {
        return { kind: "unsupported", reason: "smiley only claims commands" };
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
