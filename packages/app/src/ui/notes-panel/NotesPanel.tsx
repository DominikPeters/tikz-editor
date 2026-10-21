import { useId, useMemo, useRef, useState } from "react";
import { beamerFrameNotes, checkBeamerNoteBody, editBeamerFrameNote, type BeamerFrameNote, type BeamerNoteBodyProblem } from "@tikz-editor/core/beamer/index";
import { formatDocumentRootId, parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { TYPING_RUN_PAUSE_MS } from "@tikz-editor/core/editing/transaction/index";
import { useEditorStore } from "../../store/store";
import { SidePanel } from "../SidePanel";
import inspector from "../inspector-panel/InspectorPanel.module.css";
import css from "./NotesPanel.module.css";

/**
 * The active slide's speaker notes, as the `\note` commands that write
 * them: one field per note, holding its LaTeX. A slide without notes
 * offers an empty field, whose first keystroke writes `\note{…}` at the
 * end of the frame.
 */
export function NotesPanel() {
  const kind = useEditorStore((s) => s.documentKind);
  const source = useEditorStore((s) => s.source);
  const rootId = useEditorStore((s) => s.activeRootId);
  const locked = useEditorStore((s) => s.documents[s.activeDocumentId]?.assistantLockReason != null);
  const root = parseDocumentRootId(rootId ?? "");
  // A picture on a slide shows the slide's notes.
  const frameId = root?.kind === "beamer-frame-tikz" ? formatDocumentRootId({ kind: "beamer-frame", index: root.frameIndex }) : rootId;
  const notes = useMemo(() => kind === "beamer" && frameId ? beamerFrameNotes(source, frameId) : null, [frameId, kind, source]);
  const labelled = notes != null && (notes.length > 1 || notes.some((note) => note.overlay || note.option || note.placement === "after"));
  return (
    <SidePanel className={css.panel ?? ""}>
      <SidePanel.Content className={css.content ?? ""}>
        {kind !== "beamer" ? <p className={inspector.hint}>Speaker notes belong to Beamer slides.</p>
          : !notes || !frameId ? <p className={inspector.hint}>Select a slide to write its notes.</p>
            : notes.length === 0 ? <NoteField key={`${frameId}:0`} frameId={frameId} index={0} note={null} label={null} locked={locked} />
              : notes.map((note, index) => <NoteField key={`${frameId}:${index}`} frameId={frameId} index={index} note={note}
                label={labelled ? noteLabel(note) : null} locked={locked} />)}
      </SidePanel.Content>
    </SidePanel>
  );
}

function noteLabel(note: BeamerFrameNote): { text: string; title: string } {
  if (note.placement === "after") {
    return { text: note.option ? `Page after the slide · ${note.option}` : "Page after the slide",
      title: "Written after \\end{frame}: a note page of its own, which a second screen shows with the slide's last build." };
  }
  const builds = buildsLabel(note.overlay);
  const written = `\\note${note.overlay ? `<${note.overlay}>` : ""}${note.option ? `[${note.option}]` : ""}{…}`;
  return { text: note.option === "item" ? `${builds} · list item` : builds,
    title: `Written as ${written} in the frame.${note.option === "item" ? " Items follow the note's other text as a numbered list." : ""}` };
}

function buildsLabel(spec: string): string {
  const single = /^(\d+)$/u.exec(spec), from = /^(\d+)-$/u.exec(spec), range = /^(\d+)-(\d+)$/u.exec(spec);
  return !spec ? "Every build" : single ? `Build ${single[1]}` : from ? `From build ${from[1]}`
    : range ? `Builds ${range[1]}–${range[2]}` : `Builds ${spec}`;
}

const PROBLEMS: Record<BeamerNoteBodyProblem, string> = {
  "unbalanced": "Not saved until its braces balance: each { needs a }. Write \\{ or \\} for a brace itself.",
  "open-comment": "Not saved: a % on the last line would hide the note's closing brace. Write \\% for a percent sign.",
  "open-escape": "Not saved: a final \\ would escape the note's closing brace.",
  "frame-boundary": "Not saved: Beamer ends the frame at \\end{frame}, even inside a note.",
};

type Draft = { text: string; base: string };

function NoteField({ frameId, index, note, label, locked }: {
  frameId: string; index: number; note: BeamerFrameNote | null; label: { text: string; title: string } | null; locked: boolean;
}) {
  const dispatch = useEditorStore((s) => s.dispatch);
  const documentId = useEditorStore((s) => s.activeDocumentId);
  const hintId = useId();
  const text = note?.text ?? "";
  // Text TeX would not read as the note's argument stays here, unsaved,
  // until it would; any change to the note itself (undo, the source) drops it.
  const [draft, setDraft] = useState<Draft | null>(null);
  const value = draft?.base === text ? draft.text : text;
  const { problem, comment } = checkBeamerNoteBody(value);
  const run = useRef({ key: 0, at: -Infinity });
  const write = (edit: { kind: "set"; text: string } | { kind: "remove" }) => {
    const state = useEditorStore.getState();
    if (state.activeDocumentId !== documentId) return false;
    const result = editBeamerFrameNote(state.source, { ...edit, frameId, index });
    if (!result) return false;
    const now = performance.now();
    if (now - run.current.at > TYPING_RUN_PAUSE_MS) run.current.key++;
    run.current.at = now;
    dispatch({ type: "APPLY_SOURCE_PATCHES", documentId, baseRevision: state.sourceRevision, patches: [result.patch],
      changedSourceIds: [], historyMergeKey: `note:${frameId}:${index}:${run.current.key}` });
    return true;
  };
  const change = (next: string) => {
    if (!note && !next) { setDraft(null); return; }
    if (checkBeamerNoteBody(next).problem) { setDraft({ text: next, base: text }); return; }
    setDraft(null);
    write({ kind: "set", text: next });
  };
  const hint = problem ? PROBLEMS[problem] : comment ? "TeX skips the rest of a line after %. Write \\% for a percent sign." : null;
  return (
    <section className={css.note} data-placement={note?.placement}>
      {label ? <div className={css.label} title={label.title}>{label.text}</div> : null}
      <textarea className={css.field} value={value} disabled={locked || (note != null && !note.editable)}
        aria-label={label ? `Speaker note: ${label.text}` : "Speaker notes"} aria-invalid={problem != null} aria-describedby={hint ? hintId : undefined}
        placeholder={note ? undefined : "Speaker notes for this slide"}
        onChange={(event) => { change(event.target.value); }}
        onBlur={() => { if (note && !value.trim()) write({ kind: "remove" }); }}
        onKeyDown={(event) => {
          const key = event.key.toLowerCase();
          if ((event.metaKey || event.ctrlKey) && (key === "z" || key === "y")) {
            // The document's history, which the field's own undo does not know.
            event.preventDefault();
            event.stopPropagation();
            dispatch({ type: event.shiftKey || key === "y" ? "REDO" : "UNDO" });
          } else if (event.key === "Escape") {
            event.currentTarget.blur();
          }
        }} />
      {hint ? <p id={hintId} className={problem ? css.problem : css.hint} role={problem ? "alert" : undefined}>{hint}</p> : null}
    </section>
  );
}
