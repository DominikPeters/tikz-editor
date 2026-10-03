import { useEffect, useRef } from "react";
import { documentGraphicsWatchPaths } from "../image-asset-cache";
import type { PlatformFileApi } from "../platform/types";
import type { DocumentFileRef } from "../store/types";

type WatchState = {
  running: boolean;
  pending: readonly string[] | null;
  inFlight: readonly string[] | null;
  applied: readonly string[] | null;
  owner: symbol | null;
};
const watchStates = new WeakMap<PlatformFileApi, WatchState>();

function samePaths(left: readonly string[] | null, right: readonly string[]): boolean {
  return left?.length === right.length && left.every((path, index) => path === right[index]);
}

/** One active editor owns replacement; auxiliary renderers never register watches. */
export function createActiveDocumentAssetWatchOwner(files: PlatformFileApi) {
  let state = watchStates.get(files);
  if (!state) {
    state = { running: false, pending: null, inFlight: null, applied: null, owner: null };
    watchStates.set(files, state);
  }
  const ownedState = state;
  const owner = Symbol("active document asset watches");
  ownedState.owner = owner;
  function enqueue(paths: readonly string[]): void {
    if (ownedState.running) {
      // Returning to the in-flight set cancels a superseded pending update.
      ownedState.pending = samePaths(ownedState.inFlight, paths) ? null : paths;
      return;
    }
    if (samePaths(ownedState.applied, paths)) return;
    ownedState.pending = paths;
    ownedState.running = true;
    void (async () => {
      while (ownedState.pending !== null) {
        const next = ownedState.pending;
        ownedState.pending = null;
        ownedState.inFlight = next;
        try {
          await files.syncLocalAssetWatches?.(next);
          ownedState.applied = next;
        } catch (error) {
          // Native failure may leave a partially updated watcher. Retry the
          // next requested set even if it matches the last successful one.
          ownedState.applied = null;
          if (typeof console !== "undefined" && typeof console.info === "function") {
            console.info("[tikz-editor] Failed to synchronize active image asset watches.", error);
          }
        }
        ownedState.inFlight = null;
      }
      ownedState.running = false;
    })();
  }
  return {
    update(params: { source: string; documentFileRef?: DocumentFileRef | null }): void {
      if (ownedState.owner === owner) enqueue(documentGraphicsWatchPaths(params));
    },
    dispose(): void {
      if (ownedState.owner !== owner) return;
      ownedState.owner = null;
      enqueue([]);
    }
  };
}

export function useActiveDocumentAssetWatches(params: {
  files: PlatformFileApi | undefined;
  source: string;
  documentFileRef: DocumentFileRef | null;
}): void {
  const ownerRef = useRef<ReturnType<typeof createActiveDocumentAssetWatchOwner> | null>(null);
  useEffect(() => {
    if (!params.files?.syncLocalAssetWatches) return;
    const owner = createActiveDocumentAssetWatchOwner(params.files);
    ownerRef.current = owner;
    return () => {
      owner.dispose();
      ownerRef.current = null;
    };
  }, [params.files]);
  useEffect(() => {
    ownerRef.current?.update({ source: params.source, documentFileRef: params.documentFileRef });
  }, [params.files, params.source, params.documentFileRef]);
}
