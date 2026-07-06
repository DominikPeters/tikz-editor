import type { WorldTransform } from "../../coords/transforms.js";
import type { OptionEntry } from "../../options/types.js";
import type { ResolvedStyle } from "../types.js";
import type { StyleDiagnosticInput } from "./diagnostics.js";

export type ApplyOutcome = {
  style: ResolvedStyle;
  transform: WorldTransform;
  diagnostics: StyleDiagnosticInput[];
};

export type ApplyEntryFn = (entry: OptionEntry, style: ResolvedStyle, transform: WorldTransform) => ApplyOutcome;
