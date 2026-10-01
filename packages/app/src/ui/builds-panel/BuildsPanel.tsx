import { useCallback, useEffect, useMemo, useState } from "react";
import {
  beamerBuildSpecPatch,
  beamerBuildStateAt,
  buildBeamerBuildModel,
  firstVisibleBeamerBuildStep,
  isExplicitBeamerBuildSpec,
  reconcileBeamerBuildRow,
  type BeamerBuildModel,
  type BeamerBuildRow,
} from "@tikz-editor/core/beamer/index";
import { useEditorStore } from "../../store/store";
import { rootKey } from "../../root-key";
import { getDockLayoutHandle } from "../DockLayout";
import { SidePanel } from "../SidePanel";
import css from "./BuildsPanel.module.css";

const PAGE_SIZE = 4;

export function BuildsPanel() {
  const source = useEditorStore((s) => s.source);
  const sourceRevision = useEditorStore((s) => s.sourceRevision);
  const documentId = useEditorStore((s) => s.activeDocumentId);
  const frameId = useEditorStore((s) => s.activeRootId);
  const activeSelection = useEditorStore((s) => s.deckBuildSelection);
  const requestedStep = useEditorStore((s) => s.deckStepByRootKey[rootKey(s.activeDocumentId, s.activeRootId)] ?? 1);
  const locked = useEditorStore((s) => s.documents[s.activeDocumentId]?.assistantLockReason != null || s.activeCanvasTextEditSourceId != null);
  const dispatch = useEditorStore((s) => s.dispatch);
  const model = useMemo(() => frameId ? buildBeamerBuildModel(source, frameId) : null, [frameId, source]);
  const [selection, setSelection] = useState<{ documentId: string; model: BeamerBuildModel; rowId: string } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [pageOverride, setPageOverride] = useState<number | null>(null);
  const selected = model && activeSelection && activeSelection.rowId === selection?.rowId && selection.documentId === documentId
    ? reconcileBeamerBuildRow(selection.model, selection.rowId, model) : null;
  const step = Math.min(requestedStep, model?.stepCount ?? 1);
  const page = Math.min(pageOverride ?? Math.floor((step - 1) / PAGE_SIZE), Math.floor(((model?.stepCount ?? 1) - 1) / PAGE_SIZE));
  const steps = Array.from({ length: Math.min(PAGE_SIZE, (model?.stepCount ?? 1) - page * PAGE_SIZE) }, (_, index) => page * PAGE_SIZE + index + 1);

  const publishSelection = useCallback((row: BeamerBuildRow, revealSource = false) => {
    if (!model) return;
    dispatch({ type: "SET_DECK_BUILD_SELECTION", selection: {
      documentId, frameId: model.frameId, sourceRevision, rowId: row.id,
      step,
      sourceSpan: revealSource ? row.ruleSpan : row.sourceSpan,
      contentSpans: beamerBuildStateAt(model, row, step).contentSpans,
      revealSource,
    } });
  }, [dispatch, documentId, model, sourceRevision, step]);

  useEffect(() => {
    if (selected && selection?.model !== model) setSelection({ documentId, model: model!, rowId: selected.id });
    if (selected) publishSelection(selected);
    else dispatch({ type: "SET_DECK_BUILD_SELECTION", selection: null });
  }, [dispatch, documentId, model, publishSelection, selected, selection?.model]);

  useEffect(() => () => { dispatch({ type: "SET_DECK_BUILD_SELECTION", selection: null }); }, [dispatch]);

  const select = (row: BeamerBuildRow) => {
    if (!model) return;
    setSelection({ documentId, model, rowId: row.id });
    publishSelection(row);
  };
  const preview = (next: number) => {
    if (!model) return;
    setPageOverride(null);
    dispatch({ type: "SET_DECK_STEP", rootId: model.frameId, step: next });
  };
  const reveal = () => {
    if (!selected) return;
    const layout = getDockLayoutHandle();
    if (layout && !layout.getModel().getNodeById("source")) layout.togglePanel("source");
    publishSelection(selected, true);
  };
  const rowById = new Map(model?.rows.map((row) => [row.id, row]));
  const ancestors = (row: BeamerBuildRow): BeamerBuildRow[] => {
    const result: BeamerBuildRow[] = [];
    let parent = row.parentId ? rowById.get(row.parentId) : null;
    while (parent) { result.push(parent); parent = parent.parentId ? rowById.get(parent.parentId) : null; }
    return result;
  };
  const firstVisible = selected && model ? firstVisibleBeamerBuildStep(model, selected) : null;
  const state = selected && model ? beamerBuildStateAt(model, selected, step) : null;
  const hasUnknown = model?.rows.some((row) => row.kind !== "list" && beamerBuildStateAt(model, row, step).visibility === "unknown");

  return (
    <SidePanel className={css.panel}>
      <SidePanel.Header>Builds <span>Step {step} / {model?.stepCount ?? 1}</span></SidePanel.Header>
      <SidePanel.Content className={css.content}>
        {!model ? <p className={css.hint}>Open a Beamer slide to inspect its builds.</p>
          : model.rows.length === 0 ? <p className={css.hint}>This slide has no overlay rules. Select a bullet or block and set its Overlay in the Inspector, or add a rule in Source.</p>
            : <>
              <div className={css.pagination}>
                <button type="button" aria-label="Earlier build steps" disabled={page === 0} onClick={() => { setPageOverride(page - 1); }}>‹</button>
                <span>Steps {steps[0]}–{steps.at(-1)}</span>
                <button type="button" aria-label="Later build steps" disabled={(page + 1) * PAGE_SIZE >= model.stepCount} onClick={() => { setPageOverride(page + 1); }}>›</button>
              </div>
              <table className={css.timeline} aria-label="Slide builds">
                <thead><tr><th scope="col">Content</th>{steps.map((value) => <th scope="col" key={value}>
                  <button type="button" aria-label={`Preview step ${value}`} aria-pressed={step === value} onClick={() => { preview(value); }}>{value}</button>
                </th>)}</tr></thead>
                <tbody>{model.rows.filter((row) => !ancestors(row).some((parent) => collapsed.has(parent.id))).map((row) => {
                  const parents = ancestors(row);
                  const expandable = model.rows.some((child) => child.parentId === row.id);
                  return <tr key={row.id} data-testid="build-row" data-build-id={row.id} data-selected={selected?.id === row.id}>
                    <th scope="row"><div className={css.rowLabel} style={{ paddingLeft: Math.min(parents.length, 5) * 10 }}>
                      {expandable ? <button type="button" className={css.disclosure} aria-label={`${collapsed.has(row.id) ? "Expand" : "Collapse"} ${row.label}`} aria-expanded={!collapsed.has(row.id)} onClick={() => {
                        setCollapsed((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; });
                      }}>{collapsed.has(row.id) ? "▸" : "▾"}</button> : null}
                      <button type="button" className={css.label} title={`${row.label}\nLine ${source.slice(0, row.sourceSpan.from).split("\n").length}`} aria-pressed={selected?.id === row.id} onClick={() => { select(row); }}>
                        {row.label}<small>{row.provenance === "list-default" ? "From list default" : row.kind === "list" ? "List default" : row.provenance === "relative" ? "Relative rule" : row.kind === "branch" ? "Branch" : row.spec ? `<${row.spec.source.value}>` : row.provenance === "pause" ? "Source boundary" : "Unsupported"}</small>
                      </button>
                    </div></th>
                    {steps.map((value) => {
                      const cell = beamerBuildStateAt(model, row, value);
                      return <td key={value} data-state={row.kind === "list" ? "default" : cell.visibility} title={`Step ${value}: ${cell.label}`}>
                        <button type="button" aria-label={`${row.label}, step ${value}: ${cell.label}`} onClick={() => { select(row); preview(value); }}>
                          {row.kind === "list" ? "·" : cell.visibility === "visible" ? "●" : cell.visibility === "hidden" ? "○" : cell.visibility === "removed" ? "—" : "?"}
                        </button>
                      </td>;
                    })}
                  </tr>;
                })}</tbody>
              </table>
              <p className={css.legend}>● Visible · ○ Covered (space kept) · — Absent</p>
              {hasUnknown ? <p className={css.hint}>? Unsupported rule. The timeline and preview may be incomplete.</p> : null}
            </>}
        {model && selected ? <section className={css.details} aria-label="Build rule">
          <h3>{selected.label}</h3>
          <p>{selected.explanation}</p>
          {selected.spec ? <p className={css.rule}>Source <code>&lt;{selected.spec.source.value}&gt;</code>
            {selected.kind !== "list" && selected.spec.source.value !== selected.spec.resolved ? <> · Resolved <code>&lt;{selected.spec.resolved}&gt;</code></> : null}</p> : null}
          {ancestors(selected).filter((parent) => parent.kind !== "list").map((parent) => <p key={parent.id} className={css.hint}>
            Enclosing: <button type="button" className={css.link} onClick={() => { select(parent); }}>{parent.label}</button>{parent.spec ? ` <${parent.spec.source.value}>` : ""}
          </p>)}
          {selected.kind !== "list" && state ? <p data-testid="build-effective-state">Step {step}: <strong>{state.label}</strong>.
            {firstVisible == null && state.visibility !== "unknown" ? " No step currently makes this content visible." : null}
          </p> : null}
          {firstVisible != null && state?.visibility !== "visible" ? <button type="button" onClick={() => { preview(firstVisible); }}>Preview on step {firstVisible}</button> : null}
          {selected.editable && selected.spec ? <BuildRuleEditor key={`${selected.id}:${selected.spec.source.value}:${sourceRevision}`} value={selected.spec.source.value} disabled={locked} onApply={(value) => {
            const patch = beamerBuildSpecPatch(model, selected.id, value);
            if (patch) dispatch({ type: "APPLY_SOURCE_PATCHES", documentId, baseRevision: sourceRevision, patches: [patch], changedSourceIds: [] });
          }} /> : null}
          <button type="button" className={css.link} onClick={reveal}>Edit rule in source</button>
        </section> : null}
      </SidePanel.Content>
    </SidePanel>
  );
}

function BuildRuleEditor({ value, disabled, onApply }: { value: string; disabled: boolean; onApply: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const valid = isExplicitBeamerBuildSpec(draft);
  return <form className={css.editor} onSubmit={(event) => { event.preventDefault(); if (valid && !disabled) onApply(draft); }}>
    <label>Steps<input aria-label="Build steps" value={draft} disabled={disabled} aria-invalid={!valid} spellCheck={false} placeholder="2-, 1,3, or 2-4" onChange={(event) => { setDraft(event.target.value); }} /></label>
    <button type="submit" disabled={disabled || !valid || draft.trim() === value}>Apply</button>
    {!valid ? <p role="alert">Use positive steps or ranges, such as 2-, 1,3, or 2-4.</p> : null}
    {disabled ? <p>Rule editing is unavailable while another edit is in progress.</p> : null}
  </form>;
}
