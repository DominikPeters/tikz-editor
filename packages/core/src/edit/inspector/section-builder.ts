import type { SceneElement } from "../../semantic/types.js";
import type { EditParseOptions } from "../parse-options.js";
import type { PropertyTargetResolution } from "../property-target.js";
import type { InspectorTargetResolver } from "./target-resolver.js";
import type { InspectorSection, SetPropertyWriteTarget } from "./types.js";

export type InspectorSectionBuildContext = {
  source: string;
  element: SceneElement;
  targetId: string | null;
  targetKind: string | null;
  resolvedTarget: PropertyTargetResolution | null;
  parseOptions: EditParseOptions | undefined;
  resolveTarget: InspectorTargetResolver;
  colorAliases: ReadonlyMap<string, string>;
  writeProperty: (key: string) => SetPropertyWriteTarget;
  writePropertyForElementId: (elementId: string | null, key: string) => SetPropertyWriteTarget;
};

export type SectionBuilder = (context: InspectorSectionBuildContext) => InspectorSection | null;
