import type { PlatformPresentationApi } from "./types";

type FocusUnlisten = () => void | Promise<void>;

/** Focus tracking is optional; failed or late native registration must not leak. */
export function bindPresentationFocus(
  api: Pick<PlatformPresentationApi, "onFocus"> | undefined,
  receive: () => void
): () => void {
  let disposed = false;
  let unbind: FocusUnlisten | undefined;
  const release = async (listener: FocusUnlisten) => {
    try {
      await listener();
    } catch (error) {
      console.info("[tikz-editor] Couldn’t release presentation window focus tracking.", error);
    }
  };
  if (api?.onFocus) {
    void Promise.resolve().then(() => {
      if (disposed) return;
      return api.onFocus?.(() => { if (!disposed) receive(); });
    }).then(value => {
      if (!value) return;
      if (disposed) return release(value);
      else unbind = value;
    }).catch((error: unknown) => {
      if (!disposed) console.info("[tikz-editor] Couldn’t register presentation window focus tracking.", error);
    });
  }
  return () => {
    disposed = true;
    const listener = unbind;
    unbind = undefined;
    if (listener) void release(listener);
  };
}
