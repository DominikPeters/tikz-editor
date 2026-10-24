import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { xml } from "@codemirror/lang-xml";
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import css from "./SvgCodeEditor.module.css";

const svgHighlightStyle = HighlightStyle.define([
  { tag: t.tagName, color: "#0f766e", fontWeight: "600" },
  { tag: t.attributeName, color: "#1d4ed8" },
  { tag: t.attributeValue, color: "#9a3412" },
  { tag: t.string, color: "#9a3412" },
  { tag: t.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: [t.angleBracket, t.bracket], color: "#78716c" },
  { tag: t.meta, color: "#7c3aed" }
]);

type SvgCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
};

export function SvgCodeEditor({ value, onChange, ariaLabel }: SvgCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialValueRef = useRef(value);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) {
        return;
      }
      onChange(update.state.doc.toString());
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          EditorState.tabSize.of(2),
          EditorView.lineWrapping,
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          indentOnInput(),
          bracketMatching(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          xml(),
          syntaxHighlighting(svgHighlightStyle),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                backgroundColor: "var(--bg-pane)",
                color: "var(--text)"
              },
              ".cm-scroller": {
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                lineHeight: "1.5"
              },
              ".cm-content": {
                padding: "12px"
              },
              ".cm-focused": {
                outline: "none"
              },
              ".cm-gutters": {
                backgroundColor: "var(--bg-app)",
                color: "var(--text-dim)",
                borderRight: "1px solid var(--border-light)"
              },
              ".cm-activeLine": {
                backgroundColor: "color-mix(in srgb, var(--bg-header) 55%, transparent)"
              },
              ".cm-activeLineGutter": {
                backgroundColor: "color-mix(in srgb, var(--bg-header) 72%, transparent)"
              },
              ".cm-selectionBackground, ::selection": {
                backgroundColor: "color-mix(in srgb, var(--control-accent) 24%, var(--bg-pane))"
              },
              ".cm-cursor, .cm-dropCursor": {
                borderLeftColor: "var(--control-accent)"
              },
              ".cm-matchingBracket": {
                backgroundColor: "color-mix(in srgb, var(--control-accent) 14%, var(--bg-pane))",
                outline: "1px solid color-mix(in srgb, var(--control-accent) 28%, transparent)"
              }
            },
            { dark: false }
          ),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            spellcheck: "false"
          }),
          updateListener
        ]
      }),
      parent: containerRef.current
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [ariaLabel, onChange]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }
    const selection = view.state.selection.main;
    const anchor = Math.min(selection.anchor, value.length);
    const head = Math.min(selection.head, value.length);
    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
      selection: { anchor, head }
    });
  }, [value]);

  return <div ref={containerRef} className={css.editor} />;
}
