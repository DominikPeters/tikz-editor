import type { ProfilingScenarioManifest } from "./framework";

export const PROFILING_SCENARIOS: ProfilingScenarioManifest[] = [
  {
    id: "actions",
    category: "actions",
    description: "Menu and keyboard action profiling for editor commands.",
    specPath: "profiling/profile-actions.spec.ts"
  },
  {
    id: "basic-drag",
    category: "basic-drag",
    description: "Basic canvas drag profiling for move, resize, and shape creation.",
    specPath: "profiling/profile-drag.spec.ts"
  },
  {
    id: "paper-selection",
    category: "paper",
    description: "Selection hover and click profiling on the paper fixture.",
    specPath: "profiling/profile-paper-selection.spec.ts"
  },
  {
    id: "paper-drag",
    category: "paper",
    description: "Path endpoint drag profiling on the paper fixture.",
    specPath: "profiling/profile-paper-drag.spec.ts"
  },
  {
    id: "paper-color",
    category: "paper",
    description: "Inspector color change profiling on the paper fixture.",
    specPath: "profiling/profile-paper-color.spec.ts"
  },
  {
    id: "inspector-controls",
    category: "canvas-edit",
    description: "Inspector number input and dropdown property edit profiling.",
    specPath: "profiling/profile-inspector-controls.spec.ts"
  },
  {
    id: "scope-edit",
    category: "canvas-edit",
    description: "Scope drag and resize profiling on nested scope content.",
    specPath: "profiling/profile-scope-edit.spec.ts"
  },
  {
    id: "dense-path-edit",
    category: "canvas-edit",
    description: "Dense path selection and endpoint editing profiling.",
    specPath: "profiling/profile-dense-path-edit.spec.ts"
  },
  {
    id: "path-tool",
    category: "canvas-edit",
    description: "Bucket fill, multi-segment path creation, and rectangle tool drag profiling.",
    specPath: "profiling/profile-path-tool.spec.ts"
  },
  {
    id: "node-text-edit",
    category: "canvas-edit",
    description: "Canvas node text editing profiling for single-line, wrapped, explicit multiline, and matrix cell nodes.",
    specPath: "profiling/profile-node-text-edit.spec.ts"
  },
  {
    id: "node-text-latency",
    category: "canvas-edit",
    description: "One-keystroke canvas node text latency from textarea event through SVG patch.",
    specPath: "profiling/profile-node-text-latency.spec.ts"
  },
  {
    id: "beamer-canvas-text-latency",
    category: "canvas-edit",
    description: "Thirty paced direct-text edits on a warmed KKT Beamer frame.",
    specPath: "profiling/profile-beamer-canvas-text-latency.spec.ts"
  },
  {
    id: "source-typing",
    category: "source-edit",
    description: "Source editor typing profiling with paced keystrokes in small and dense TikZ documents.",
    specPath: "profiling/profile-source-typing.spec.ts"
  }
];

export function getProfilingScenarioById(id: string): ProfilingScenarioManifest | null {
  return PROFILING_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}
