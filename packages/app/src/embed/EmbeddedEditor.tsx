import { memo, useEffect, useMemo, type CSSProperties } from "react";
import { CanvasPanel } from "../ui/CanvasPanel";
import { WORKSPACE_VERSION } from "../store/reducer";
import { createEditorStore, EditorStoreProvider, type EditorStoreApi } from "../store/store";
import { useEmbedComputeDriver } from "./useEmbedComputeDriver";

// The store is created once at mount from the initial props. Later changes to
// initialSource / documentTitle / activeFigureId are NOT reflected; to swap
// content, either mutate via `storeRef` or remount via a React `key`. This
// matches how demo players expect to use the embed — they own the content
// lifecycle and drive updates through dispatched EditActions.
export type EmbeddedEditorProps = {
  initialSource: string;
  documentTitle?: string;
  activeFigureId?: string | null;
  className?: string;
  style?: CSSProperties;
  storeRef?: (store: EditorStoreApi | null) => void;
};

function buildEmbedStore(props: Pick<EmbeddedEditorProps, "initialSource" | "documentTitle" | "activeFigureId">): EditorStoreApi {
  const documentId = "embed-doc";
  return createEditorStore({
    persist: false,
    seed: {
      workspaceVersion: WORKSPACE_VERSION,
      documents: [
        {
          id: documentId,
          title: props.documentTitle ?? "Embed",
          source: props.initialSource,
          activeFigureId: props.activeFigureId ?? null,
          savedSource: props.initialSource
        }
      ],
      tabOrder: [documentId],
      activeDocumentId: documentId,
      recentDocumentIds: [documentId]
    }
  });
}

function EmbedComputeBridge(): null {
  useEmbedComputeDriver();
  return null;
}

export const EmbeddedEditor = memo(function EmbeddedEditor(props: EmbeddedEditorProps) {
  const store = useMemo(
    () => buildEmbedStore(props),
    // Intentionally empty deps: store is snapshotted from initial props. See
    // EmbeddedEditorProps doc comment for how to swap content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const { storeRef } = props;
  useEffect(() => {
    storeRef?.(store);
    return () => {
      storeRef?.(null);
    };
  }, [storeRef, store]);

  return (
    <EditorStoreProvider store={store}>
      <EmbedComputeBridge />
      <div className={props.className} style={{ position: "relative", width: "100%", height: "100%", ...props.style }}>
        <CanvasPanel />
      </div>
    </EditorStoreProvider>
  );
});
