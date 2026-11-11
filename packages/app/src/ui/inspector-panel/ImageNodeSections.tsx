import { useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import {
  includegraphicsSections,
  setIncludegraphicsOption,
  type DeckInspectorCommand,
  type DeckInspectorField,
  type DeckInspectorWrite
} from "@tikz-editor/core/beamer/index";
import type { Span, Statement } from "@tikz-editor/core/ast/types";
import { imageNodeCommandSpan } from "@tikz-editor/core/edit/graphics-node-size";
import { useEditorStore } from "../../store/store";
import { replaceTikzNodeGraphics } from "../deck-graphics-replacement";
import { SidePanel } from "../SidePanel";
import { DeckField } from "./deck-fields";
import css from "./InspectorPanel.module.css";

/** Node properties that mean nothing for a node holding only an image. */
export const IMAGE_NODE_HIDDEN_PROPERTY_IDS: ReadonlySet<string> = new Set(["node-text-align", "node-text-width", "node-font", "node-text-color"]);

/**
 * The selected node's `\includegraphics` span, when it is an image node.
 * `source` and `snapshot` are the inspector's, which move together, so the
 * section stays put while a scrub previews new source ahead of the snapshot.
 */
export function useImageNodeSpan(elementId: string | undefined, source: string, snapshot: { readonly source: string; readonly parseResult: { readonly figure: { readonly body: readonly Statement[] } } | null }): Span | null {
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
/** The inspector's number-label scrub, shared with every other scrubbable label. */
export type BeginNumberLabelScrub = (event: ReactPointerEvent<HTMLElement>, binding: {
  writable: boolean; value: number; step: number; min?: number; max?: number;
  onPreview: (value: number) => void; onCommit: (value: number) => void;
}) => void;

export function ImageNodeSections(props: { elementId: string; span: Span; source: string; beginNumberLabelScrub: BeginNumberLabelScrub }): JSX.Element | null {
  const { elementId, span, source, beginNumberLabelScrub } = props;
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const dispatch = useEditorStore((s) => s.dispatch);
  const [error, setError] = useState<string | null>(null);
  const replacing = useRef(false);
  const sections = useMemo(() => includegraphicsSections(source, span, { lengthSuffix: { width: "cm", height: "cm" }, crop: false }), [source, span]);

  /** The edit against `base`, applied only while the document still is `base`. */
  const applyOption = (base: string, write: Extract<DeckInspectorWrite, { kind: "setGraphicsOption" | "setGraphicsFlag" }>, value: string | number | boolean | null): void => {
    const result = setIncludegraphicsOption(base, span, write.key, optionValue(write, value));
    if (result.kind !== "success") {
      setError(result.kind === "unsupported" ? result.reason : "The image could not be changed.");
      return;
    }
    setError(null);
    const live = useEditorStore.getState();
    if (result.patches.length === 0 || live.source !== base) return;
    dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: activeDocumentId, baseRevision: live.sourceRevision, changedSourceIds: [elementId], patches: result.patches });
  };

  const commit = (write: DeckInspectorWrite, value: string | number | boolean | null): void => {
    if (write.kind === "setGraphicsOption" || write.kind === "setGraphicsFlag") applyOption(source, write, value);
  };

  /** Dragging a size label previews the image at each step and commits one undoable edit. */
  const beginScrub = (event: ReactPointerEvent<HTMLElement>, field: Extract<DeckInspectorField, { kind: "number" }>): void => {
    const write = field.write;
    if (write?.kind !== "setGraphicsOption" || field.value == null) return;
    const base = source;
    beginNumberLabelScrub(event, {
      writable: true,
      value: field.value,
      step: field.step,
      ...(field.min === undefined ? {} : { min: field.min }),
      ...(field.max === undefined ? {} : { max: field.max }),
      onPreview: (next) => {
        const result = setIncludegraphicsOption(base, span, write.key, optionValue(write, next));
        if (result.kind === "success") dispatch({ type: "SET_SOURCE_TRANSIENT", source: result.newSource, changedSourceIds: [elementId] });
      },
      // The scrub helper restores the base source before committing.
      onCommit: (next) => { applyOption(base, write, next); }
    });
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
              <DeckField key={field.id} field={field} onCommit={commit} onCommand={command} onBeginScrub={beginScrub} />
            ))}
            {section.id === "image" && error ? <p className={css.deckReadOnlyReason}>{error}</p> : null}
          </SidePanel.SectionBody>
        </SidePanel.Section>
      ))}
    </>
  );
}
