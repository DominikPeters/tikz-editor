import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { inAppPresentationView } from "./in-app-platform";
import { PresentationWindow } from "./PresentationWindow";
import css from "./InAppPresentation.module.css";

/** Shows the presentation view the in-app platform asks for over the editor. */
export function InAppPresentationHost() {
  const view = useSyncExternalStore(inAppPresentationView.subscribe, inAppPresentationView.get, () => null);
  if (!view) return null;
  return createPortal(
    <div className={css.host} data-role={view.role} data-owns-touches="" data-testid="in-app-presentation">
      <PresentationWindow key={view.role} role={view.role} sessionId={view.sessionId} embedded />
    </div>,
    document.body
  );
}
