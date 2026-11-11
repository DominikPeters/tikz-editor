import { useMemo, useRef, useState, type JSX } from "react";
import {
  includegraphicsSections,
  setIncludegraphicsOption,
  type DeckInspectorCommand,
  type DeckInspectorWrite
} from "@tikz-editor/core/beamer/index";
import type { Span } from "@tikz-editor/core/ast/types";
import { imageNodeCommandSpan } from "@tikz-editor/core/edit/graphics-node-size";
import { useEditorStore } from "../../store/store";
import { replaceTikzNodeGraphics } from "../deck-graphics-replacement";
import { SidePanel } from "../SidePanel";
import { DeckField } from "./deck-fields";
import css from "./InspectorPanel.module.css";

/** Node properties that mean nothing for a node holding only an image. */
export const IMAGE_NODE_HIDDEN_PROPERTY_IDS: ReadonlySet<string> = new Set(["node-text-align", "node-text-width", "node-font", "node-text-color"]);

/** The selected node's `\includegraphics` span, when it is an image node of the current snapshot. */
export function useImageNodeSpan(elementId: string | undefined): Span | null {
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  return useMemo(() => {
    const body = snapshot.parseResult?.figure.body;
    if (!elementId || !body || snapshot.source !== source) return null;
    return imageNodeCommandSpan(source, body, elementId);
  }, [elementId, snapshot, source]);
}

function optionValue(write: Extract<DeckInspectorWrite, { kind: "setGraphicsOption" | "setGraphicsFlag" }>, value: string | number | boolean | null): string | true | null {
  if (write.kind === "setGraphicsFlag") return value === true ? true : null;
  if (value == null || value === "") return null;
  return typeof value === "number" ? `${String(Number(value.toFixed(4)))}${write.suffix}` : String(value);
}

/**
 * File and Size for a TikZ node that holds an image, with the slide image
 * inspector's fields: lengths default to centimetres, and there is no crop.
 */
export function ImageNodeSections(props: { elementId: string; span: Span }): JSX.Element | null {
  const { elementId, span } = props;
  const source = useEditorStore((s) => s.source);
  const sourceRevision = useEditorStore((s) => s.sourceRevision);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const dispatch = useEditorStore((s) => s.dispatch);
  const [error, setError] = useState<string | null>(null);
  const replacing = useRef(false);
  const sections = useMemo(() => includegraphicsSections(source, span, { lengthSuffix: { width: "cm", height: "cm" }, crop: false }), [source, span]);

  const commit = (write: DeckInspectorWrite, value: string | number | boolean | null): void => {
    if (write.kind !== "setGraphicsOption" && write.kind !== "setGraphicsFlag") return;
    const result = setIncludegraphicsOption(source, span, write.key, optionValue(write, value));
    if (result.kind !== "success") {
      setError(result.kind === "unsupported" ? result.reason : "The image could not be changed.");
      return;
    }
    setError(null);
    if (result.patches.length === 0) return;
    dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: activeDocumentId, baseRevision: sourceRevision, changedSourceIds: [elementId], patches: result.patches });
  };

  const command = (next: DeckInspectorCommand): void => {
    if (next.kind !== "replaceGraphics" || replacing.current) return;
    replacing.current = true;
    setError(null);
    void replaceTikzNodeGraphics({ getState: useEditorStore.getState, dispatch, elementId }).then((result) => {
      replacing.current = false;
      if (result.status === "failed") setError(result.reason);
    });
  };

  return (
    <>
      {sections.map((section) => (
        <SidePanel.Section key={section.id} collapseId={`inspector:image-${section.id}`}>
          {section.title ? <SidePanel.SectionHeader>{section.title}</SidePanel.SectionHeader> : null}
          <SidePanel.SectionBody>
            {section.fields.map((field) => (
              <DeckField key={field.id} field={field} onCommit={commit} onCommand={command} />
            ))}
            {section.id === "image" && error ? <p className={css.deckReadOnlyReason}>{error}</p> : null}
          </SidePanel.SectionBody>
        </SidePanel.Section>
      ))}
    </>
  );
}
