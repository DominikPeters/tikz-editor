import { useId, useMemo, useRef, useState, type JSX } from "react";
import { isExplicitBeamerBuildSpec } from "@tikz-editor/core/beamer/index";
import type { SessionSnapshot } from "../../compute";
import { useEditorStore } from "../../store/store";
import { applyShapeOverlayPatches, revealOverlayRow, shapeOverlayRule, type ShapeOverlayRule } from "../shape-overlay-rule";
import { SidePanel } from "../SidePanel";
import css from "./InspectorPanel.module.css";

/**
 * The overlay steps of a shape selected in a slide's picture or drawing
 * layer: its own specification, set or cleared here, or the rule it stands
 * under, which is edited in the Overlays panel.
 */
export function ShapeOverlaySection(props: { elementId: string; source: string; snapshot: SessionSnapshot }): JSX.Element | null {
  const { elementId, source, snapshot } = props;
  const activeRootId = useEditorStore((s) => s.activeRootId);
  const beamer = useEditorStore((s) => s.documentKind === "beamer");
  const rule = useMemo(() => beamer ? shapeOverlayRule({ source, activeRootId, statements: snapshot.parseResult?.figure.body,
    snapshotSource: snapshot.source, elementId }) : null, [activeRootId, beamer, elementId, snapshot, source]);
  if (!rule || (!rule.target.canSet && !rule.target.row)) return null;
  const owner = rule.target.canSet ? null : rule.target.row;
  return (
    <SidePanel.Section collapseId="inspector:shape-overlay">
      <SidePanel.SectionHeader>Overlay</SidePanel.SectionHeader>
      <SidePanel.SectionBody>
        {owner ? (
          <div className={css.property}>
            <span className={css.propertyLabel}>Steps</span>
            <button type="button" className={css.moreOptionsToggle} title={owner.label}
              onClick={() => { revealOverlayRow(rule.frameId, owner); }}>
              {owner.kind === "pause" ? "After a pause" : owner.spec ? `${owner.spec.source.value} · shared` : "Shared rule"}
            </button>
          </div>
        ) : <StepsField key={`${elementId}:${rule.ownSpec ?? ""}:${source.length}`} rule={rule} elementId={elementId} />}
      </SidePanel.SectionBody>
    </SidePanel.Section>
  );
}

function StepsField({ rule, elementId }: { rule: ShapeOverlayRule; elementId: string }): JSX.Element {
  const value = rule.ownSpec ?? "";
  const [draft, setDraft] = useState(value);
  const id = useId();
  const skipBlur = useRef(false);
  const valid = draft.trim() === "" || isExplicitBeamerBuildSpec(draft);
  const commit = () => {
    const next = draft.trim();
    if (!valid || next === value.trim()) return;
    const patch = next === "" ? null : rule.target.setSpec(next);
    applyShapeOverlayPatches(rule, next === "" ? rule.target.removePatches : patch ? [patch] : [], elementId);
  };
  return (
    <div className={css.property}>
      <label className={css.propertyLabel} htmlFor={id}>Steps</label>
      <input id={id} className={css.textInput} aria-label="Overlay steps" value={draft} placeholder="All" aria-invalid={!valid} spellCheck={false}
        onChange={(event) => { setDraft(event.target.value); }}
        onBlur={() => { if (!skipBlur.current) commit(); skipBlur.current = false; }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && valid) {
            event.preventDefault();
            skipBlur.current = true;
            commit();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            skipBlur.current = true;
            setDraft(value);
            event.currentTarget.blur();
          }
        }} />
    </div>
  );
}
