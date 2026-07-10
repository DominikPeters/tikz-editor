import { formatNumber } from "@tikz-editor/core/edit/format";
import {
  computeScrubbedValue,
  fractionDigits,
  shouldStartScrub,
  type ScrubModifierState
} from "../../scrub-utils";

export type NumberScrubState = {
  startX: number;
  startValue: number;
  step: number;
  min?: number;
  max?: number;
  hasActivated: boolean;
  lastValue: number;
};

export type NumberScrubMoveResult = {
  nextState: NumberScrubState;
  didActivate: boolean;
  nextValue: number | null;
};

export type NumberScrubFormat = {
  precision: number;
  minDisplayPrecision: number;
};

export function createNumberScrubState(input: {
  startX: number;
  startValue: number;
  step: number;
  min?: number;
  max?: number;
}): NumberScrubState {
  return {
    ...input,
    hasActivated: false,
    lastValue: input.startValue
  };
}

export function updateNumberScrubState(
  state: NumberScrubState,
  input: { currentX: number; modifiers: ScrubModifierState }
): NumberScrubMoveResult {
  const deltaX = input.currentX - state.startX;
  if (!state.hasActivated && !shouldStartScrub(deltaX)) {
    return {
      nextState: state,
      didActivate: false,
      nextValue: null
    };
  }

  const nextValue = computeScrubbedValue({
    startX: state.startX,
    currentX: input.currentX,
    startValue: state.startValue,
    step: state.step,
    min: state.min,
    max: state.max,
    modifiers: input.modifiers
  });
  const didActivate = !state.hasActivated;

  if (nextValue === state.lastValue) {
    return {
      nextState: {
        ...state,
        hasActivated: true
      },
      didActivate,
      nextValue: null
    };
  }

  return {
    nextState: {
      ...state,
      hasActivated: true,
      lastValue: nextValue
    },
    didActivate,
    nextValue
  };
}

export function deriveNumberScrubFormat(value: number, step: number): NumberScrubFormat {
  const sourcePrecision = fractionDigits(formatNumber(value));
  const stepPrecision = fractionDigits(step.toString());
  return {
    precision: Math.max(sourcePrecision, stepPrecision),
    minDisplayPrecision: sourcePrecision
  };
}
