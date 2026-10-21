import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { isDeckSnapshotCurrent, type ComputeRequest } from "../../compute";
import type { SingleFlightScheduler } from "../compute-scheduler";
import { computeSchedulingPolicy, type ComputeSchedulingInput } from "../compute-scheduling";
import { afterNextPaint } from "../frame-scheduling";

/** Input must be memoized so snapshot/UI updates don't restart a typing timer. */
export function useScheduledCompute(
  schedulerRef: RefObject<SingleFlightScheduler<ComputeRequest> | null>,
  input: ComputeSchedulingInput
): void {
  const previousInput = useRef<ComputeSchedulingInput | null>(null);
  const cancelPendingRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    // Abort obsolete evaluation before a source render is scheduled, except
    // for a stream of edits: the render in flight then still shows the text
    // so far, where aborting it at every key would show nothing.
    if (!computeSchedulingPolicy(previousInput.current, input).afterPaint) {
      schedulerRef.current?.invalidate();
    }
    cancelPendingRef.current?.();
    cancelPendingRef.current = null;
  }, [input, schedulerRef]);

  useEffect(() => {
    const policy = computeSchedulingPolicy(previousInput.current, input);
    previousInput.current = input;
    if (input.publishedDeckSnapshot && isDeckSnapshotCurrent(input.publishedDeckSnapshot, { ...input.request, id: "current-snapshot" })) return;
    const schedule = () => {
      cancelPendingRef.current = null;
      schedulerRef.current?.schedule({
        ...input.request,
        id: crypto.randomUUID(),
        schedulingTrigger: policy.cause,
        // A navigation request may also need to render pending typed source.
        // Preserve parse inference independently of whether we delay it.
        // Only edit commands describe their own changes; undo and reloads
        // carry none, and would otherwise render from scratch.
        inferSourceChanges: input.sourceChangeOrigin !== "edit-command"
      }, { keepInFlight: policy.afterPaint === true });
    };
    if (!policy.afterPaint) {
      schedule();
      return;
    }
    cancelPendingRef.current = afterNextPaint(schedule);
    return () => {
      cancelPendingRef.current?.();
      cancelPendingRef.current = null;
    };
  }, [input, schedulerRef]);
}
