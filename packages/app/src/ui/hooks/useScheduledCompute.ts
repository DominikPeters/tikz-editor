import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { isDeckSnapshotCurrent, type ComputeRequest } from "../../compute";
import type { SingleFlightScheduler } from "../compute-scheduler";
import { computeSchedulingPolicy, type ComputeSchedulingInput } from "../compute-scheduling";

/** Input must be memoized so snapshot/UI updates don't restart a typing timer. */
export function useScheduledCompute(
  schedulerRef: RefObject<SingleFlightScheduler<ComputeRequest> | null>,
  input: ComputeSchedulingInput
): void {
  const previousInput = useRef<ComputeSchedulingInput | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    // Abort obsolete evaluation before a delayed source render is scheduled.
    schedulerRef.current?.invalidate();
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [input, schedulerRef]);

  useEffect(() => {
    const policy = computeSchedulingPolicy(previousInput.current, input);
    previousInput.current = input;
    if (input.publishedDeckSnapshot && isDeckSnapshotCurrent(input.publishedDeckSnapshot, { ...input.request, id: "current-snapshot" })) return;
    const schedule = () => {
      timerRef.current = null;
      schedulerRef.current?.schedule({
        ...input.request,
        id: crypto.randomUUID(),
        schedulingTrigger: policy.cause,
        // A navigation request may also need to render pending typed source.
        // Preserve parse inference independently of whether we delay it.
        inferSourceChanges: input.sourceChangeOrigin === "source-editor" || input.sourceChangeOrigin === "assistant"
      });
    };
    if (policy.delayMs == null) schedule();
    else timerRef.current = setTimeout(schedule, policy.delayMs);
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [input, schedulerRef]);
}
