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
  // When the first key not yet rendered was typed.
  const typingSinceRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    // Abort obsolete evaluation before a delayed source render is scheduled,
    // except while typing: the render in flight then still shows the text
    // typed so far, where aborting it at every key would show nothing.
    if (computeSchedulingPolicy(previousInput.current, input).cause !== "source-typing") {
      schedulerRef.current?.invalidate();
    }
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [input, schedulerRef]);

  useEffect(() => {
    const policy = computeSchedulingPolicy(previousInput.current, input);
    previousInput.current = input;
    if (policy.cause !== "source-typing") typingSinceRef.current = null;
    if (input.publishedDeckSnapshot && isDeckSnapshotCurrent(input.publishedDeckSnapshot, { ...input.request, id: "current-snapshot" })) return;
    const schedule = () => {
      timerRef.current = null;
      typingSinceRef.current = null;
      schedulerRef.current?.schedule({
        ...input.request,
        id: crypto.randomUUID(),
        schedulingTrigger: policy.cause,
        // A navigation request may also need to render pending typed source.
        // Preserve parse inference independently of whether we delay it.
        // Only edit commands describe their own changes; undo and reloads
        // carry none, and would otherwise render from scratch.
        inferSourceChanges: input.sourceChangeOrigin !== "edit-command"
      }, { keepInFlight: policy.cause === "source-typing" });
    };
    if (policy.delayMs == null) {
      schedule();
      return;
    }
    let delayMs = policy.delayMs;
    if (policy.maxWaitMs != null) {
      const now = performance.now();
      typingSinceRef.current ??= now;
      delayMs = Math.max(0, Math.min(delayMs, typingSinceRef.current + policy.maxWaitMs - now));
    }
    timerRef.current = setTimeout(schedule, delayMs);
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [input, schedulerRef]);
}
