import { useMemo, useState } from "react";
import { capabilityMatrix, type CapabilityRow } from "tikz-editor/capabilities";
import type { Diagnostic } from "tikz-editor/diagnostics/types";
import type { SemanticDependencyGraph } from "tikz-editor/semantic";
import type { EditHandle, FeatureUsage, SceneElement } from "tikz-editor/semantic/types";
import { useEditorStore } from "../store/store";
import { TreeView } from "./TreeView";
import { Modal } from "./Modal";
import css from "./DevPanel.module.css";

type Tab = "overview" | "selection" | "editing" | "logs" | "dependencies" | "pipeline";
type PipelineView = "cst" | "ast" | "scene" | "svg" | "snapshot";

type DiagnosticRow = Diagnostic & {
  source: "parse" | "semantic";
};

const PANEL_TITLE_ID = "developer-panel-title";
const PANEL_INITIAL_WIDTH = 940;
const PANEL_INITIAL_HEIGHT = 680;
const MAX_LIST_ROWS = 80;

export function DevPanel() {
  const showDevPanel = useEditorStore((s) => s.showDevPanel);
  const dispatch = useEditorStore((s) => s.dispatch);
  const snapshot = useEditorStore((s) => s.snapshot);
  const source = useEditorStore((s) => s.source);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const activeHandleId = useEditorStore((s) => s.activeHandleId);
  const pendingRequestId = useEditorStore((s) => s.pendingRequestId);
  const lastEditChangedSourceIds = useEditorStore((s) => s.lastEditChangedSourceIds);
  const lastEditPatches = useEditorStore((s) => s.lastEditPatches);
  const lastEditWarningMessage = useEditorStore((s) => s.lastEditWarningMessage);
  const history = useEditorStore((s) => s.history);
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const toolMode = useEditorStore((s) => s.toolMode);
  const developerLogs = useEditorStore((s) => s.developerLogs);
  const snapDebug = useEditorStore((s) => s.snapDebug);

  const [tab, setTab] = useState<Tab>("overview");
  const [pipelineView, setPipelineView] = useState<PipelineView>("cst");

  const selectedIds = useMemo(() => Array.from(selectedElementIds), [selectedElementIds]);
  const diagnostics = useMemo(() => collectDiagnostics(snapshot), [snapshot]);
  const selectedElements = useMemo(
    () => collectSelectedElements(snapshot.scene?.elements ?? [], selectedIds),
    [selectedIds, snapshot.scene?.elements]
  );
  const selectedHandles = useMemo(
    () => collectSelectedHandles(snapshot.editHandles, selectedElements, selectedIds),
    [selectedElements, selectedIds, snapshot.editHandles]
  );
  const featureSummary = useMemo(
    () => summarizeFeatureUsage(snapshot.semanticResult?.featureUsage ?? null),
    [snapshot.semanticResult?.featureUsage]
  );
  const dependencySummary = useMemo(
    () => summarizeDependencies(snapshot.semanticResult?.dependencies ?? null),
    [snapshot.semanticResult?.dependencies]
  );
  const currentHistoryEntry = historyIndex >= 0 ? history[historyIndex] : null;

  if (!showDevPanel) return null;

  const close = () => { dispatch({ type: "TOGGLE_DEV_PANEL" }); };

  return (
    <Modal
      variant="panel"
      draggable
      resizable
      initialWidth={PANEL_INITIAL_WIDTH}
      initialHeight={PANEL_INITIAL_HEIGHT}
      labelledBy={PANEL_TITLE_ID}
      dataTestId="developer-panel"
      className={css.dialog}
      onClose={close}
    >
      <Modal.Header
        title="Developer Panel"
        titleId={PANEL_TITLE_ID}
        showCloseButton
        onClose={close}
        closeAriaLabel="Close developer panel"
        draggable
        trailing={<span className={css.revisionPill}>rev {snapshot.revision}</span>}
      />

      <Modal.Body padding="none" scroll={false}>
        <div className={css.shell}>
          <nav className={css.tabs} aria-label="Developer panel sections">
            {([
              ["overview", "Overview"],
              ["selection", "Selection"],
              ["editing", "Editing"],
              ["logs", "Logs"],
              ["dependencies", "Dependencies"],
              ["pipeline", "Pipeline"]
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${css.tab} ${tab === id ? css.tabActive : ""}`}
                onClick={() => { setTab(id); }}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className={css.content}>
            {tab === "overview" ? (
              <OverviewTab
                activeFigureId={snapshot.activeFigureId}
                diagnostics={diagnostics}
                dependencySummary={dependencySummary}
                featureSummary={featureSummary}
                figureCount={snapshot.figures.length}
                pendingRequestId={pendingRequestId}
                sceneElementCount={snapshot.scene?.elements.length ?? 0}
                selectedCount={selectedIds.length}
                sourceLength={source.length}
                snapshot={snapshot}
                toolMode={toolMode}
              />
            ) : null}
            {tab === "selection" ? (
              <SelectionTab
                activeHandleId={activeHandleId}
                selectedElements={selectedElements}
                selectedHandles={selectedHandles}
                source={source}
              />
            ) : null}
            {tab === "editing" ? (
              <EditingTab
                activeHandleId={activeHandleId}
                currentHistoryEntry={currentHistoryEntry}
                handleCount={snapshot.editHandles.length}
                lastEditChangedSourceIds={lastEditChangedSourceIds}
                lastEditPatches={lastEditPatches}
                lastEditWarningMessage={lastEditWarningMessage}
                selectedHandles={selectedHandles}
              />
            ) : null}
            {tab === "logs" ? (
              <LogsTab
                developerLogs={developerLogs}
                dispatch={dispatch}
                lastEditWarningMessage={lastEditWarningMessage}
                snapDebug={snapDebug}
                snapshot={snapshot}
              />
            ) : null}
            {tab === "dependencies" ? (
              <DependenciesTab
                dependencySummary={dependencySummary}
                graph={snapshot.semanticResult?.dependencies ?? null}
                unresolvedSymbols={snapshot.semanticResult?.unresolvedSymbols ?? []}
                symbolDependencyEdges={snapshot.semanticResult?.symbolDependencyEdges ?? []}
              />
            ) : null}
            {tab === "pipeline" ? (
              <PipelineTab
                pipelineView={pipelineView}
                setPipelineView={setPipelineView}
                snapshot={snapshot}
                source={source}
              />
            ) : null}
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
}

function OverviewTab({
  activeFigureId,
  diagnostics,
  dependencySummary,
  featureSummary,
  figureCount,
  pendingRequestId,
  sceneElementCount,
  selectedCount,
  sourceLength,
  snapshot,
  toolMode
}: {
  activeFigureId: string | null;
  diagnostics: readonly DiagnosticRow[];
  dependencySummary: DependencySummary;
  featureSummary: FeatureSummary;
  figureCount: number;
  pendingRequestId: string | null;
  sceneElementCount: number;
  selectedCount: number;
  sourceLength: number;
  snapshot: ReturnType<typeof useEditorStore.getState>["snapshot"];
  toolMode: string;
}) {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.length - errorCount;
  return (
    <div className={css.stack}>
      <section className={css.summaryGrid} aria-label="Developer panel summary">
        <Metric label="Diagnostics" value={`${errorCount} errors / ${warningCount} warnings`} tone={errorCount > 0 ? "bad" : warningCount > 0 ? "warn" : "good"} />
        <Metric label="Figures" value={String(figureCount)} detail={activeFigureId ?? "No active figure"} />
        <Metric label="Scene" value={`${sceneElementCount} elements`} detail={`${snapshot.editHandles.length} edit handles`} />
        <Metric label="Selection" value={`${selectedCount} selected`} detail={`Tool: ${toolMode}`} />
        <Metric label="Features" value={`${featureSummary.supported.length} supported`} detail={`${featureSummary.unsupported.length} unsupported`} tone={featureSummary.unsupported.length > 0 ? "warn" : "neutral"} />
        <Metric label="Dependencies" value={`${dependencySummary.sourceCount} sources`} detail={`${dependencySummary.resourceCount} resources, ${dependencySummary.edgeCount} edges`} />
        <Metric label="Compute" value={snapshot.incremental ? "Incremental" : "Full"} detail={pendingRequestId ? `Pending ${pendingRequestId}` : "Settled"} />
        <Metric label="Source" value={`${sourceLength} chars`} detail={`Snapshot rev ${snapshot.revision}`} />
      </section>

      <Section title="Problems">
        {diagnostics.length === 0 ? (
          <EmptyState text="No parse or semantic diagnostics." />
        ) : (
          <DiagnosticList diagnostics={diagnostics} />
        )}
      </Section>

      <Section title="Incremental Compute">
        {snapshot.incremental ? (
          <KeyValueGrid
            rows={[
              ["trigger", snapshot.incremental.trigger],
              ["changed source ids", joinList(snapshot.incremental.changedSourceIds)],
              ["parse strategy", snapshot.incremental.parseStrategy],
              ["parse fallback", snapshot.incremental.parseFallbackReason ?? "none"],
              ["parse patch", snapshot.incremental.parsePatchApplication ?? "none"],
              ["reparsed statements", String(snapshot.incremental.reparsedStatementCount)],
              ["parser reused statements", String(snapshot.incremental.parserReusedStatementCount)],
              ["semantic strategy", snapshot.incremental.strategy],
              ["semantic fallback", snapshot.incremental.fallbackReason ?? "none"],
              ["recomputed statements", String(snapshot.incremental.recomputedStatementCount)],
              ["reused statements", String(snapshot.incremental.reusedStatementCount)],
              ["affected statements", formatNullableNumber(snapshot.incremental.affectedStatementCount)]
            ]}
          />
        ) : (
          <EmptyState text="Last settled render was a full compute." />
        )}
      </Section>
    </div>
  );
}

function SelectionTab({
  activeHandleId,
  selectedElements,
  selectedHandles,
  source
}: {
  activeHandleId: string | null;
  selectedElements: readonly SceneElement[];
  selectedHandles: readonly EditHandle[];
  source: string;
}) {
  return (
    <div className={css.stack}>
      <Section title="Selected Elements">
        {selectedElements.length === 0 ? (
          <EmptyState text="No scene elements selected." />
        ) : (
          <div className={css.itemList}>
            {selectedElements.slice(0, MAX_LIST_ROWS).map((element) => (
              <article key={element.runtimeId} className={css.item}>
                <div className={css.itemHeader}>
                  <span className={css.itemTitle}>{element.kind}</span>
                  <code>{element.sourceRef.sourceId}</code>
                </div>
                <KeyValueGrid
                  rows={[
                    ["element id", element.id],
                    ["runtime id", element.runtimeId],
                    ["source span", formatSpan(element.sourceRef.sourceSpan, source)],
                    ["style", summarizeStyle(element)],
                    ["geometry", summarizeGeometry(element)],
                    ["origin", summarizeOrigin(element)],
                    ["matrix cell", element.matrixCell ? `r${element.matrixCell.row + 1} c${element.matrixCell.column + 1} (${element.matrixCell.cellSourceId})` : "none"],
                    ["tree child", element.treeChild ? `level ${element.treeChild.level}, index ${element.treeChild.childIndex}` : "none"],
                    ["path attachment", element.pathAttachment ? `${element.pathAttachment.hostPathSourceId} @ ${element.pathAttachment.pos}` : "none"]
                  ]}
                />
                <SourcePreview source={source} span={element.sourceRef.sourceSpan} />
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title="Selection Handles">
        {selectedHandles.length === 0 ? (
          <EmptyState text="No edit handles attached to the current selection." />
        ) : (
          <HandleList activeHandleId={activeHandleId} handles={selectedHandles} />
        )}
      </Section>
    </div>
  );
}

function EditingTab({
  activeHandleId,
  currentHistoryEntry,
  handleCount,
  lastEditChangedSourceIds,
  lastEditPatches,
  lastEditWarningMessage,
  selectedHandles
}: {
  activeHandleId: string | null;
  currentHistoryEntry: ReturnType<typeof useEditorStore.getState>["history"][number] | null;
  handleCount: number;
  lastEditChangedSourceIds: readonly string[] | null;
  lastEditPatches: ReadonlyArray<{ oldSpan: { from: number; to: number }; newSpan: { from: number; to: number }; replacement: string }> | null;
  lastEditWarningMessage: string | null;
  selectedHandles: readonly EditHandle[];
}) {
  return (
    <div className={css.stack}>
      <Section title="Edit State">
        <KeyValueGrid
          rows={[
            ["total handles", String(handleCount)],
            ["selected handles", String(selectedHandles.length)],
            ["active handle", activeHandleId ?? "none"],
            ["last changed source ids", joinList(lastEditChangedSourceIds ?? [])],
            ["last edit warning", lastEditWarningMessage ?? "none"],
            ["undo entry", currentHistoryEntry ? `${currentHistoryEntry.kind}: ${currentHistoryEntry.label}` : "none"]
          ]}
        />
      </Section>

      <Section title="Last Patches">
        {!lastEditPatches || lastEditPatches.length === 0 ? (
          <EmptyState text="No WYSIWYG source patches recorded." />
        ) : (
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th>Old span</th>
                  <th>New span</th>
                  <th>Replacement</th>
                </tr>
              </thead>
              <tbody>
                {lastEditPatches.map((patch, index) => (
                  <tr key={`${patch.oldSpan.from}-${patch.oldSpan.to}-${index}`}>
                    <td><code>{patch.oldSpan.from}:{patch.oldSpan.to}</code></td>
                    <td><code>{patch.newSpan.from}:{patch.newSpan.to}</code></td>
                    <td><code>{truncate(patch.replacement.replace(/\n/g, "\\n"), 80)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Undo Entry">
        {currentHistoryEntry ? (
          <KeyValueGrid
            rows={[
              ["kind", currentHistoryEntry.kind],
              ["label", currentHistoryEntry.label],
              ["merge key", currentHistoryEntry.mergeKey ?? "none"],
              ["backward patches", String(currentHistoryEntry.backward.length)],
              ["forward patches", String(currentHistoryEntry.forward.length)],
              ["source before", `${currentHistoryEntry.sourceBefore.length} chars`],
              ["source after", `${currentHistoryEntry.sourceAfter.length} chars`]
            ]}
          />
        ) : (
          <EmptyState text="No WYSIWYG undo entry has been applied." />
        )}
      </Section>

      <Section title="Selected Handles">
        {selectedHandles.length === 0 ? (
          <EmptyState text="Select an editable element to inspect its handles." />
        ) : (
          <HandleList activeHandleId={activeHandleId} handles={selectedHandles} />
        )}
      </Section>
    </div>
  );
}

function LogsTab({
  developerLogs,
  dispatch,
  lastEditWarningMessage,
  snapDebug,
  snapshot
}: {
  developerLogs: ReturnType<typeof useEditorStore.getState>["developerLogs"];
  dispatch: ReturnType<typeof useEditorStore.getState>["dispatch"];
  lastEditWarningMessage: string | null;
  snapDebug: ReturnType<typeof useEditorStore.getState>["snapDebug"];
  snapshot: ReturnType<typeof useEditorStore.getState>["snapshot"];
}) {
  const syntheticLogs = buildSyntheticLogs({ lastEditWarningMessage, snapshot });
  const logs = [...syntheticLogs, ...developerLogs].slice(0, MAX_LIST_ROWS);
  return (
    <div className={css.stack}>
      <Section title="Event Log">
        <div className={css.sectionToolbar}>
          <Modal.SecondaryButton
            onClick={() => { dispatch({ type: "CLEAR_DEVELOPER_LOGS" }); }}
            disabled={developerLogs.length === 0}
          >
            Clear Snap Logs
          </Modal.SecondaryButton>
        </div>
        {logs.length === 0 ? (
          <EmptyState text="No developer events recorded yet." />
        ) : (
          <div className={css.itemList}>
            {logs.map((entry) => (
              <article key={entry.id} className={`${css.logEntry} ${css[`logEntry_${entry.level}`]}`}>
                <div className={css.itemHeader}>
                  <span className={css.itemTitle}>{entry.source} / {entry.level}</span>
                  <code>{entry.atIso}</code>
                </div>
                <p>{entry.message}</p>
                {entry.data !== undefined ? <pre className={css.json}>{stringifyDebug(entry.data)}</pre> : null}
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title="Snap Debug">
        {snapDebug ? (
          <>
            <KeyValueGrid
              rows={[
                ["phase", snapDebug.phase],
                ["time", snapDebug.atIso],
                ["note", snapDebug.note ?? "none"],
                ["drag kind", snapDebug.dragKind ?? "none"],
                ["snapshot matches source", String(snapDebug.snapshotMatchesSource)],
                ["snap lines", String(snapDebug.lineCount)]
              ]}
            />
            <pre className={css.json}>{stringifyDebug(snapDebug)}</pre>
          </>
        ) : (
          <EmptyState text="Trigger a snap interaction while the Developer Panel is open to populate snap diagnostics." />
        )}
      </Section>
    </div>
  );
}

function DependenciesTab({
  dependencySummary,
  graph,
  symbolDependencyEdges,
  unresolvedSymbols
}: {
  dependencySummary: DependencySummary;
  graph: SemanticDependencyGraph | null;
  symbolDependencyEdges: readonly unknown[];
  unresolvedSymbols: readonly unknown[];
}) {
  const opaqueNodes = graph?.nodes.filter((node) => node.kind === "source" && node.opaque) ?? [];
  const resources = graph?.nodes.filter((node) => node.kind === "resource") ?? [];
  return (
    <div className={css.stack}>
      <section className={css.summaryGrid}>
        <Metric label="Source nodes" value={String(dependencySummary.sourceCount)} />
        <Metric label="Resources" value={String(dependencySummary.resourceCount)} />
        <Metric label="Edges" value={String(dependencySummary.edgeCount)} />
        <Metric label="Opaque" value={String(dependencySummary.opaqueCount)} tone={dependencySummary.opaqueCount > 0 ? "warn" : "neutral"} />
      </section>

      <Section title="Opaque Boundaries">
        {opaqueNodes.length === 0 ? (
          <EmptyState text="No opaque foreach or macro boundaries in the dependency graph." />
        ) : (
          <div className={css.itemList}>
            {opaqueNodes.map((node) => (
              <div key={node.id} className={css.compactRow}>
                <code>{node.kind === "source" ? node.sourceId : node.id}</code>
                <span>{node.kind === "source" ? node.opaqueReasons.join(", ") : ""}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Resources">
        {resources.length === 0 ? (
          <EmptyState text="No named geometry resources recorded." />
        ) : (
          <div className={css.itemList}>
            {resources.slice(0, MAX_LIST_ROWS).map((node) => (
              <div key={node.id} className={css.compactRow}>
                <code>{node.kind === "resource" ? node.resourceKind : node.id}</code>
                <span>{node.kind === "resource" ? node.resourceKey : ""}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Symbol State">
        <KeyValueGrid
          rows={[
            ["unresolved symbols", String(unresolvedSymbols.length)],
            ["symbol dependency edges", String(symbolDependencyEdges.length)]
          ]}
        />
        {unresolvedSymbols.length > 0 ? (
          <pre className={css.json}>{stringifyDebug(unresolvedSymbols.slice(0, 30))}</pre>
        ) : null}
      </Section>

      <Section title="Dependency Graph JSON">
        {graph ? <pre className={css.json}>{stringifyDebug(graph)}</pre> : <EmptyState text="No semantic dependency graph available." />}
      </Section>
    </div>
  );
}

function PipelineTab({
  pipelineView,
  setPipelineView,
  snapshot,
  source
}: {
  pipelineView: PipelineView;
  setPipelineView: (view: PipelineView) => void;
  snapshot: ReturnType<typeof useEditorStore.getState>["snapshot"];
  source: string;
}) {
  return (
    <div className={css.pipeline}>
      <div className={css.subtabs} aria-label="Pipeline views">
        {([
          ["cst", "CST"],
          ["ast", "AST"],
          ["scene", "Scene"],
          ["svg", "SVG"],
          ["snapshot", "Snapshot"]
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`${css.subtab} ${pipelineView === id ? css.subtabActive : ""}`}
            onClick={() => { setPipelineView(id); }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={css.pipelineBody}>
        {pipelineView === "cst" ? (
          <div className={css.treeWrap}>
            <TreeView
              tree={snapshot.parseResult?.tree ?? null}
              source={source}
              onHover={() => {}}
            />
          </div>
        ) : null}
        {pipelineView === "ast" ? (
          <pre className={css.json}>{stringifyDebug({
            activeFigureId: snapshot.parseResult?.activeFigureId,
            figures: snapshot.parseResult?.figures,
            figure: snapshot.parseResult?.figure,
            diagnostics: snapshot.parseResult?.diagnostics
          })}</pre>
        ) : null}
        {pipelineView === "scene" ? (
          <pre className={css.json}>{stringifyDebug({
            scene: snapshot.semanticResult?.scene,
            featureUsage: snapshot.semanticResult?.featureUsage,
            editHandles: snapshot.semanticResult?.editHandles,
            diagnostics: snapshot.semanticResult?.diagnostics
          })}</pre>
        ) : null}
        {pipelineView === "svg" ? (
          <pre className={css.json}>{stringifyDebug({
            hasSvg: snapshot.svg != null,
            viewBox: snapshot.svg?.viewBox,
            svgLength: snapshot.svg?.svg.length ?? 0,
            model: snapshot.svgModel
          })}</pre>
        ) : null}
        {pipelineView === "snapshot" ? (
          <pre className={css.json}>{stringifyDebug({
            revision: snapshot.revision,
            source: snapshot.source.slice(0, 500) + (snapshot.source.length > 500 ? "..." : ""),
            activeFigureId: snapshot.activeFigureId,
            figures: snapshot.figures,
            editHandles: snapshot.editHandles.length,
            sceneElements: snapshot.scene?.elements.length ?? 0,
            hasSvg: snapshot.svg != null,
            svgLength: snapshot.svg?.svg.length ?? 0,
            incremental: snapshot.incremental
          })}</pre>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={css.section}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <div className={`${css.metric} ${css[`metric_${tone}`]}`}>
      <span className={css.metricLabel}>{label}</span>
      <strong>{value}</strong>
      {detail ? <span className={css.metricDetail}>{detail}</span> : null}
    </div>
  );
}

function KeyValueGrid({ rows }: { rows: readonly [string, string][] }) {
  return (
    <dl className={css.kvGrid}>
      {rows.map(([key, value]) => (
        <div key={key} className={css.kvRow}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className={css.empty}>{text}</p>;
}

function DiagnosticList({ diagnostics }: { diagnostics: readonly DiagnosticRow[] }) {
  return (
    <div className={css.itemList}>
      {diagnostics.slice(0, MAX_LIST_ROWS).map((diagnostic, index) => (
        <article key={`${diagnostic.source}-${diagnostic.span.from}-${diagnostic.span.to}-${index}`} className={`${css.diagnostic} ${diagnostic.severity === "error" ? css.diagnosticError : css.diagnosticWarning}`}>
          <div className={css.itemHeader}>
            <span className={css.itemTitle}>{diagnostic.source} {diagnostic.severity}</span>
            <code>{diagnostic.code ?? "diagnostic"}</code>
          </div>
          <p>{diagnostic.message}</p>
          <span className={css.meta}>{formatSpan(diagnostic.span)}</span>
        </article>
      ))}
    </div>
  );
}

function HandleList({ activeHandleId, handles }: { activeHandleId: string | null; handles: readonly EditHandle[] }) {
  return (
    <div className={css.itemList}>
      {handles.slice(0, MAX_LIST_ROWS).map((handle) => (
        <article key={handle.runtimeId} className={`${css.item} ${handle.id === activeHandleId ? css.itemActive : ""}`}>
          <div className={css.itemHeader}>
            <span className={css.itemTitle}>{handle.handleType} / {handle.kind}</span>
            <code>{handle.sourceRef.sourceId}</code>
          </div>
          <KeyValueGrid
            rows={[
              ["handle id", handle.id],
              ["runtime id", handle.runtimeId],
              ["rewrite mode", handle.rewriteMode],
              ["coordinate form", handle.coordinateForm],
              ["world", formatPoint(handle.world)],
              ["source text", truncate(handle.sourceText, 80)],
              ["rewrite target", handle.rewriteTargetHandleId ?? "none"],
              ["positioning", "positioningContext" in handle && handle.positioningContext ? `${handle.positioningContext.direction} of ${handle.positioningContext.targetNodeName}` : "none"],
              ["path attachment", "pathAttachmentContext" in handle && handle.pathAttachmentContext ? `${handle.pathAttachmentContext.hostPathSourceId} @ ${handle.pathAttachmentContext.pos}` : "none"]
            ]}
          />
        </article>
      ))}
    </div>
  );
}

function SourcePreview({ source, span }: { source: string; span: { from: number; to: number } }) {
  const preview = source.slice(span.from, span.to).trim().replace(/\s+/g, " ");
  if (!preview) return null;
  return <pre className={css.sourcePreview}>{truncate(preview, 260)}</pre>;
}

function collectDiagnostics(snapshot: ReturnType<typeof useEditorStore.getState>["snapshot"]): DiagnosticRow[] {
  return [
    ...(snapshot.parseResult?.diagnostics ?? []).map((diagnostic) => ({ ...diagnostic, source: "parse" as const })),
    ...(snapshot.semanticResult?.diagnostics ?? []).map((diagnostic) => ({ ...diagnostic, source: "semantic" as const }))
  ].sort((left, right) => left.span.from - right.span.from);
}

function buildSyntheticLogs({
  lastEditWarningMessage,
  snapshot
}: {
  lastEditWarningMessage: string | null;
  snapshot: ReturnType<typeof useEditorStore.getState>["snapshot"];
}): ReturnType<typeof useEditorStore.getState>["developerLogs"] {
  const logs: ReturnType<typeof useEditorStore.getState>["developerLogs"] = [];
  logs.push({
    id: `compute:${snapshot.revision}`,
    atIso: "current",
    source: "compute",
    level: snapshot.parseResult || snapshot.semanticResult ? "info" : "error",
    message: snapshot.incremental
      ? `Snapshot ${snapshot.revision} settled with incremental ${snapshot.incremental.trigger}.`
      : `Snapshot ${snapshot.revision} settled with full compute.`,
    data: snapshot.incremental ?? {
      figures: snapshot.figures.length,
      sceneElements: snapshot.scene?.elements.length ?? 0,
      editHandles: snapshot.editHandles.length
    }
  });
  if (lastEditWarningMessage) {
    logs.push({
      id: `editing-warning:${snapshot.revision}`,
      atIso: "current",
      source: "editing",
      level: "warning",
      message: lastEditWarningMessage
    });
  }
  return logs;
}

function collectSelectedElements(elements: readonly SceneElement[], selectedIds: readonly string[]): SceneElement[] {
  if (selectedIds.length === 0) return [];
  const selected = new Set(selectedIds);
  return elements.filter((element) =>
    selected.has(element.id) ||
    selected.has(element.runtimeId) ||
    selected.has(element.sourceRef.sourceId) ||
    (element.identityRef?.sourceId ? selected.has(element.identityRef.sourceId) : false)
  );
}

function collectSelectedHandles(
  handles: readonly EditHandle[],
  selectedElements: readonly SceneElement[],
  selectedIds: readonly string[]
): EditHandle[] {
  if (selectedElements.length === 0 && selectedIds.length === 0) return [];
  const sourceIds = new Set(selectedIds);
  for (const element of selectedElements) {
    sourceIds.add(element.sourceRef.sourceId);
    if (element.identityRef?.sourceId) {
      sourceIds.add(element.identityRef.sourceId);
    }
  }
  return handles.filter((handle) =>
    sourceIds.has(handle.id) ||
    sourceIds.has(handle.runtimeId) ||
    sourceIds.has(handle.sourceRef.sourceId) ||
    (handle.identityRef?.sourceId ? sourceIds.has(handle.identityRef.sourceId) : false)
  );
}

type FeatureSummary = {
  supported: string[];
  unsupported: string[];
};

function summarizeFeatureUsage(featureUsage: FeatureUsage | null): FeatureSummary {
  if (!featureUsage) {
    return { supported: [], unsupported: [] };
  }
  const supported: string[] = [];
  const unsupported: string[] = [];
  for (const [feature, state] of Object.entries(featureUsage)) {
    if (state === "used-supported") {
      supported.push(formatFeature(feature));
    } else if (state === "used-unsupported") {
      unsupported.push(formatCapabilityFeature(feature, capabilityMatrix[feature as keyof typeof capabilityMatrix]));
    }
  }
  return {
    supported: supported.sort(),
    unsupported: unsupported.sort()
  };
}

function formatCapabilityFeature(feature: string, row: CapabilityRow | undefined): string {
  if (!row) return formatFeature(feature);
  return `${formatFeature(feature)} (edit ${row.edit}, svg ${row.svg})`;
}

type DependencySummary = {
  sourceCount: number;
  resourceCount: number;
  edgeCount: number;
  opaqueCount: number;
};

function summarizeDependencies(graph: SemanticDependencyGraph | null): DependencySummary {
  if (!graph) {
    return { sourceCount: 0, resourceCount: 0, edgeCount: 0, opaqueCount: 0 };
  }
  let sourceCount = 0;
  let resourceCount = 0;
  let opaqueCount = 0;
  for (const node of graph.nodes) {
    if (node.kind === "source") {
      sourceCount += 1;
      if (node.opaque) {
        opaqueCount += 1;
      }
    } else {
      resourceCount += 1;
    }
  }
  return {
    sourceCount,
    resourceCount,
    edgeCount: graph.edges.length,
    opaqueCount
  };
}

function summarizeStyle(element: SceneElement): string {
  const stroke = element.style.stroke ?? "none";
  const fill = element.style.fill ?? "none";
  const lineWidth = element.style.lineWidth;
  return `stroke ${stroke}, fill ${fill}, line ${formatNumber(lineWidth)}pt`;
}

function summarizeGeometry(element: SceneElement): string {
  if (element.kind === "Text") {
    return `pos ${formatPoint(element.position)}, text "${truncate(element.text, 60)}"`;
  }
  if (element.kind === "Circle") {
    return `center ${formatPoint(element.center)}, r ${formatNumber(element.radius)}`;
  }
  if (element.kind === "Ellipse") {
    return `center ${formatPoint(element.center)}, rx ${formatNumber(element.rx)}, ry ${formatNumber(element.ry)}`;
  }
  return `${element.commands.length} commands${element.shapeHint ? `, ${element.shapeHint}` : ""}`;
}

function summarizeOrigin(element: SceneElement): string {
  const foreachCount = element.origin?.foreachStack.length ?? 0;
  const macroCount = element.origin?.macroStack?.length ?? 0;
  if (foreachCount === 0 && macroCount === 0) {
    return "direct";
  }
  return `${foreachCount} foreach frames, ${macroCount} macro frames`;
}

function formatSpan(span: { from: number; to: number }, source?: string): string {
  const base = `${span.from}:${span.to}`;
  if (!source) return base;
  return `${base} (${offsetToLine(source, span.from)})`;
}

function offsetToLine(source: string, offset: number): string {
  let line = 1;
  let column = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let index = 0; index < end; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return `line ${line}, col ${column}`;
}

function formatPoint(point: { x: number; y: number }): string {
  return `(${formatNumber(point.x)}, ${formatNumber(point.y)})`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatNullableNumber(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "none";
}

function formatFeature(feature: string): string {
  return feature.replace(/_/g, " ");
}

function joinList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function stringifyDebug(value: unknown): string {
  const replacer = (_key: string, current: unknown): unknown => {
    if (current instanceof Map) {
      const entries: Array<[string, unknown]> = [];
      for (const [entryKey, entryValue] of current as ReadonlyMap<unknown, unknown>) {
        entries.push([String(entryKey), entryValue]);
      }
      return Object.fromEntries(entries);
    }
    if (current instanceof Set) {
      const values: unknown[] = [];
      for (const entryValue of current as ReadonlySet<unknown>) {
        values.push(entryValue);
      }
      return values;
    }
    return current;
  };
  return JSON.stringify(
    value,
    replacer,
    2
  );
}
