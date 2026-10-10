import { parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { useEditorStore } from "../store/store";
import { loadPresentationOptions, presentationService } from "./service";
import type { PresentationMode, PresentationOptions } from "./types";

export function launchPresentation(from: "current" | "beginning", mode?: PresentationMode, options?: PresentationOptions): void {
  const state = useEditorStore.getState();
  if (state.documentKind !== "beamer") return;
  const root = parseDocumentRootId(state.activeRootId ?? "");
  const frame = from === "beginning" ? 0 : root?.kind === "beamer-frame" ? root.index : root?.kind === "beamer-frame-tikz" ? root.frameIndex : 0;
  const setup = { ...(options ?? loadPresentationOptions()), ...(mode ? { mode } : {}) };
  void presentationService.start(state.documents[state.activeDocumentId], setup, frame);
}

export const NEW_BEAMER_SOURCE = String.raw`\documentclass{beamer}
\title{Untitled Presentation}
\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\end{document}
`;
