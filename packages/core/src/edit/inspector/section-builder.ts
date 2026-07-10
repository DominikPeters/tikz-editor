import type { SceneElement } from "../../semantic/types.js";
import type { PropertyTargetResolution } from "../property-target.js";
import type { InspectorSection, SetPropertyWriteTarget } from "./types.js";

export type InspectorSectionBuildContext = {
  source: string;
  element: SceneElement;
  resolvedTarget: PropertyTargetResolution | null;
  colorAliases: ReadonlyMap<string, string>;
  writeProperty: (key: string) => SetPropertyWriteTarget;
};

export type SectionBuilder = (context: InspectorSectionBuildContext) => InspectorSection | null;
