import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A function with a fixed identity that calls the latest `callback`.
 *
 * Every closure created in one render shares that render's scope, so a
 * memoized callback keeps its whole render alive, including the snapshot and
 * SVG it saw, and through the callbacks that scope captured, older renders
 * too. Callbacks that many others capture should be stable to cut that chain.
 * Do not call the result during render: it sees the previous render's callback.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result
): (...args: Args) => Result {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
