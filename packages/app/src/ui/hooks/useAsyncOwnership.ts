import { useCallback, useLayoutEffect, useRef } from "react";

/** Capture whether async work still belongs to this mounted owner. */
export function useAsyncOwnership(owner: unknown): () => () => boolean {
  const epoch = useRef({ version: 0 });
  useLayoutEffect(() => {
    const state = epoch.current;
    const current = ++state.version;
    return () => { if (state.version === current) ++state.version; };
  }, [owner]);
  return useCallback(() => {
    const state = epoch.current;
    const current = state.version;
    return () => state.version === current;
  }, []);
}
