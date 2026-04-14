import type { EditAction } from "tikz-editor/edit/actions";
import type { EditorAction } from "../store/types";

export type Easing = "linear" | "easeInOut" | "easeOut";

// Cursor appearance styles matching common CSS cursor values.
export type CursorStyle =
  | "pointer"
  | "move"
  | "crosshair"
  | "grab"
  | "grabbing"
  | "ew-resize"
  | "ns-resize"
  | "nwse-resize"
  | "nesw-resize"
  | "text";

// Cursor keyframes are authored in WORLD coords (TikZ units) — the same
// coordinate space as pointer events. The overlay projects to screen pixels
// via the interaction SVG's CTM, so the cursor stays aligned with the canvas
// even under auto-fit.
export type CursorKeyframe = {
  t: number;
  x: number;
  y: number;
  ease?: Easing;
  visible?: boolean;
  pressed?: boolean;
  cursor?: CursorStyle;
};

export type PointerModifiers = {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

// Discrete events applied at their scheduled time. `dispatch`/`storeAction`
// mutate the store directly; `pointer*` events are dispatched as real
// PointerEvents at the embed's canvas interaction layer. Coordinates are in
// world (TikZ) space — the runner projects to client coords via getScreenCTM.
//
// Between a `pointerDown` and the matching `pointerUp`, the runner auto-emits
// a `pointermove` every frame using the interpolated cursor position, so drag
// scripts only need the down/up markers plus cursor keyframes.
export type DemoEvent =
  | { t: number; kind: "dispatch"; action: EditAction }
  | { t: number; kind: "storeAction"; action: EditorAction }
  | { t: number; kind: "loadSource"; source: string }
  | { t: number; kind: "pointerDown"; x: number; y: number; modifiers?: PointerModifiers }
  | { t: number; kind: "pointerMove"; x: number; y: number }
  | { t: number; kind: "pointerUp" }
  | { t: number; kind: "pointerCancel" };

export type DemoScript = {
  id: string;
  duration: number;
  initialSource: string;
  cursor: CursorKeyframe[];
  events: DemoEvent[];
};

export type CursorFrameState = {
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
  cursor: CursorStyle;
};

// Throws if the script's cursor or event tracks aren't sorted by `t`. Demos
// are authored by hand and forgetting to sort is easy — catch it early.
export function validateDemoScript(script: DemoScript): void {
  for (let i = 1; i < script.cursor.length; i += 1) {
    if (script.cursor[i]!.t < script.cursor[i - 1]!.t) {
      throw new Error(`DemoScript "${script.id}": cursor keyframes must be sorted by t (index ${i})`);
    }
  }
  for (let i = 1; i < script.events.length; i += 1) {
    if (script.events[i]!.t < script.events[i - 1]!.t) {
      throw new Error(`DemoScript "${script.id}": events must be sorted by t (index ${i})`);
    }
  }
  if (script.duration <= 0) {
    throw new Error(`DemoScript "${script.id}": duration must be > 0`);
  }
}

const EASING_FNS: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeOut: (t) => 1 - Math.pow(1 - t, 3)
};

// Resolve cursor state at time `t` from a sorted keyframe list. Returns null
// when the track is empty. Cursor style is taken from the most recent keyframe
// that specifies one (not interpolated).
export function resolveCursorAt(keyframes: readonly CursorKeyframe[], t: number): CursorFrameState | null {
  if (keyframes.length === 0) {
    return null;
  }

  // Find the most recent cursor style at or before time t.
  const resolveCursorStyle = (upToIndex: number): CursorStyle => {
    for (let j = upToIndex; j >= 0; j -= 1) {
      if (keyframes[j]!.cursor !== undefined) {
        return keyframes[j]!.cursor!;
      }
    }
    return "pointer";
  };

  if (t <= keyframes[0]!.t) {
    const kf = keyframes[0]!;
    return {
      x: kf.x,
      y: kf.y,
      visible: kf.visible ?? true,
      pressed: kf.pressed ?? false,
      cursor: kf.cursor ?? "pointer"
    };
  }
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i]!;
    const b = keyframes[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const raw = span <= 0 ? 1 : (t - a.t) / span;
      const eased = (EASING_FNS[b.ease ?? "linear"] ?? EASING_FNS.linear)(raw);
      // Cursor style is discrete (not interpolated) - use the most recent
      // keyframe's cursor, which is `a` (index i) until we reach `b`.
      return {
        x: a.x + (b.x - a.x) * eased,
        y: a.y + (b.y - a.y) * eased,
        visible: b.visible ?? a.visible ?? true,
        pressed: b.pressed ?? a.pressed ?? false,
        cursor: resolveCursorStyle(i)
      };
    }
  }
  const last = keyframes[keyframes.length - 1]!;
  return {
    x: last.x,
    y: last.y,
    visible: last.visible ?? true,
    pressed: last.pressed ?? false,
    cursor: resolveCursorStyle(keyframes.length - 1)
  };
}
