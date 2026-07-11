import type {
  TikzEditorProfilingComputeTiming,
  TikzEditorProfilingCounter,
  TikzEditorProfilingRecorder,
  TikzEditorProfilingSourcePanelSyncTiming,
  TikzEditorProfilingSvgPatchTiming
} from "@tikz-editor/core/profiling";

export type AppProfilingSnapshot = {
  label: string | null;
  startedAtIso: string | null;
  counters: Record<TikzEditorProfilingCounter, number>;
  computeTimings: TikzEditorProfilingComputeTiming[];
  svgPatchTimings: TikzEditorProfilingSvgPatchTiming[];
  sourcePanelSyncTimings: TikzEditorProfilingSourcePanelSyncTiming[];
};

type ProfilingState = AppProfilingSnapshot;

const EMPTY_COUNTERS: Record<TikzEditorProfilingCounter, number> = {
  parseTikzCalls: 0,
  parseTikzForEditCalls: 0,
  resolvePropertyTargetCalls: 0,
  buildStylesCascadeModelCalls: 0,
  resolveColorSyntaxValueCalls: 0
};

function cloneCounters(): Record<TikzEditorProfilingCounter, number> {
  return { ...EMPTY_COUNTERS };
}

const state: ProfilingState = {
  label: null,
  startedAtIso: null,
  counters: cloneCounters(),
  computeTimings: [],
  svgPatchTimings: [],
  sourcePanelSyncTimings: []
};

function recorder(): TikzEditorProfilingRecorder {
  return {
    incrementCounter(counter, amount = 1) {
      state.counters[counter] += amount;
    },
    recordComputeTiming(timing) {
      state.computeTimings.push({ ...timing });
    },
    recordSvgPatchTiming(timing) {
      state.svgPatchTimings.push({ ...timing });
    },
    recordSourcePanelSyncTiming(timing) {
      state.sourcePanelSyncTimings.push({ ...timing });
    }
  };
}

function ensureRecorderInstalled(): void {
  globalThis.__TIKZ_EDITOR_PROFILING_RECORDER__ ??= recorder();
}

export function installAppProfilingRecorder(): void {
  ensureRecorderInstalled();
}

export function resetAppProfilingSession(label: string | null = null): void {
  ensureRecorderInstalled();
  state.label = label;
  state.startedAtIso = new Date().toISOString();
  state.counters = cloneCounters();
  state.computeTimings = [];
  state.svgPatchTimings = [];
  state.sourcePanelSyncTimings = [];
}

export function readAppProfilingSnapshot(): AppProfilingSnapshot {
  ensureRecorderInstalled();
  return {
    label: state.label,
    startedAtIso: state.startedAtIso,
    counters: { ...state.counters },
    computeTimings: state.computeTimings.map((entry) => ({ ...entry })),
    svgPatchTimings: state.svgPatchTimings.map((entry) => ({ ...entry })),
    sourcePanelSyncTimings: state.sourcePanelSyncTimings.map((entry) => ({ ...entry }))
  };
}
