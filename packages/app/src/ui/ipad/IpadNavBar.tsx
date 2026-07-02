import { useCallback, useState } from "react";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiCloseLine,
  RiCodeLine,
  RiFolderOpenLine,
  RiFunctionLine,
  RiLayoutRightLine,
  RiMoreLine,
  RiShareForwardLine
} from "@remixicon/react";
import { useShallow } from "zustand/react/shallow";
import { APP_MENU_COMMAND_IDS, type AppMenuCommandId } from "../../app-menu";
import { useEditorStore } from "../../store/store";
import type { EditorCommandRuntime } from "../editor-command-runtime";
import { IpadMenu, IpadMenuItem, IpadMenuSeparator, IpadPopover } from "./IpadPopover";
import css from "./IpadNavBar.module.css";

type NavPopoverId = "documents" | "title" | "share" | "more";

export type IpadNavBarProps = {
  commandRuntime: EditorCommandRuntime;
  onRequestCloseDocument: (documentId: string) => void;
  showSourcePanel: boolean;
  onToggleSource: () => void;
  sourceToggleEnabled: boolean;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  inspectorToggleEnabled: boolean;
  hasMultipleFigures: boolean;
  showFiguresPanel: boolean;
  onToggleFigures: () => void;
  updateChip?: { version: string; onClick: () => void } | null;
};

export function IpadNavBar({
  commandRuntime,
  onRequestCloseDocument,
  showSourcePanel,
  onToggleSource,
  sourceToggleEnabled,
  inspectorOpen,
  onToggleInspector,
  inspectorToggleEnabled,
  hasMultipleFigures,
  showFiguresPanel,
  onToggleFigures,
  updateChip = null
}: IpadNavBarProps) {
  const [openPopover, setOpenPopover] = useState<NavPopoverId | null>(null);
  const { documents, tabOrder, activeDocumentId, dispatch } = useEditorStore(useShallow((s) => ({
    documents: s.documents,
    tabOrder: s.tabOrder,
    activeDocumentId: s.activeDocumentId,
    dispatch: s.dispatch
  })));
  const activeDocument = documents[activeDocumentId] ?? null;

  const closePopover = useCallback(() => { setOpenPopover(null); }, []);
  const togglePopover = useCallback((id: NavPopoverId) => {
    setOpenPopover((current) => (current === id ? null : id));
  }, []);

  const runCommand = useCallback((commandId: AppMenuCommandId) => {
    setOpenPopover(null);
    commandRuntime.runCommand(commandId, "platform");
  }, [commandRuntime]);

  const commandEnabled = useCallback((commandId: AppMenuCommandId): boolean => {
    return commandRuntime.bindings[commandId]?.enabled === true;
  }, [commandRuntime]);

  const commandChecked = useCallback((commandId: AppMenuCommandId): boolean => {
    return commandRuntime.bindings[commandId]?.checked === true;
  }, [commandRuntime]);

  return (
    <header className={css.navBar} data-select="chrome" data-testid="ipad-nav-bar">
      <div className={[css.cluster, css.clusterLeading].join(" ")}>
        <IpadPopover
          open={openPopover === "documents"}
          onClose={closePopover}
          align="start"
          ariaLabel="Documents"
          testId="ipad-documents-popover"
          trigger={
            <button
              type="button"
              className={[css.iconButton, openPopover === "documents" ? css.iconButtonActive : ""].filter(Boolean).join(" ")}
              aria-label="Documents"
              title="Documents"
              aria-haspopup="dialog"
              aria-expanded={openPopover === "documents"}
              onClick={() => { togglePopover("documents"); }}
              data-testid="ipad-documents-button"
            >
              <RiFunctionLine size={22} aria-hidden />
            </button>
          }
        >
          <div className={css.documentList} role="list" aria-label="Open documents">
            {tabOrder.map((id) => {
              const doc = documents[id];
              if (!doc) {
                return null;
              }
              const active = id === activeDocumentId;
              return (
                <div
                  key={id}
                  className={[css.documentRow, active ? css.documentRowActive : ""].filter(Boolean).join(" ")}
                  role="listitem"
                >
                  <button
                    type="button"
                    className={css.documentSwitch}
                    onClick={() => {
                      dispatch({ type: "SWITCH_DOCUMENT", documentId: id });
                      closePopover();
                    }}
                    data-testid={`ipad-document-switch-${id}`}
                  >
                    <span className={css.documentTitle}>{doc.title}</span>
                    {doc.dirty ? <span className={css.dirtyDot} aria-label="Unsaved changes" /> : null}
                  </button>
                  <button
                    type="button"
                    className={css.documentClose}
                    aria-label={`Close ${doc.title}`}
                    onClick={() => { onRequestCloseDocument(id); }}
                    data-testid={`ipad-document-close-${id}`}
                  >
                    <RiCloseLine size={17} aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
          <IpadMenu ariaLabel="Document actions">
            <IpadMenuSeparator />
            <IpadMenuItem
              label="New Document"
              icon={<RiAddLine size={18} />}
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.NEW_DOCUMENT)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.NEW_DOCUMENT); }}
              testId="ipad-menu-new-document"
            />
            <IpadMenuItem
              label="Open…"
              icon={<RiFolderOpenLine size={18} />}
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT); }}
            />
            <IpadMenuItem
              label="Open Example…"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE); }}
            />
          </IpadMenu>
        </IpadPopover>
        <button
          type="button"
          className={[css.iconButton, showSourcePanel ? css.iconButtonActive : ""].filter(Boolean).join(" ")}
          aria-label="Source"
          title="Source"
          aria-pressed={showSourcePanel}
          disabled={!sourceToggleEnabled}
          onClick={onToggleSource}
          data-testid="ipad-source-toggle"
        >
          <RiCodeLine size={21} aria-hidden />
        </button>
      </div>

      <div className={css.titleCluster}>
        <IpadPopover
          open={openPopover === "title"}
          onClose={closePopover}
          align="center"
          ariaLabel="Document menu"
          testId="ipad-title-popover"
          trigger={
            <button
              type="button"
              className={css.titleButton}
              aria-haspopup="dialog"
              aria-expanded={openPopover === "title"}
              onClick={() => { togglePopover("title"); }}
              data-testid="ipad-title-button"
            >
              <span className={css.titleText}>{activeDocument?.title ?? "Untitled"}</span>
              {activeDocument?.dirty ? <span className={css.dirtyDot} aria-label="Unsaved changes" /> : null}
              <RiArrowDownSLine size={16} className={css.titleChevron} aria-hidden />
            </button>
          }
        >
          <IpadMenu ariaLabel="Document menu">
            <IpadMenuItem
              label="Save"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT); }}
            />
            <IpadMenuItem
              label="Save As…"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT_AS)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT_AS); }}
            />
            <IpadMenuSeparator />
            <IpadMenuItem
              label="Show Compiled Picture"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.SHOW_COMPILED_PICTURE)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.SHOW_COMPILED_PICTURE); }}
            />
            <IpadMenuSeparator />
            <IpadMenuItem
              label="Close Document"
              onSelect={() => {
                closePopover();
                onRequestCloseDocument(activeDocumentId);
              }}
            />
          </IpadMenu>
        </IpadPopover>
      </div>

      <div className={[css.cluster, css.clusterTrailing].join(" ")}>
        <button
          type="button"
          className={css.iconButton}
          aria-label="Undo"
          title="Undo"
          disabled={!commandEnabled(APP_MENU_COMMAND_IDS.UNDO)}
          onClick={() => { runCommand(APP_MENU_COMMAND_IDS.UNDO); }}
          data-testid="ipad-undo-button"
        >
          <RiArrowGoBackLine size={21} aria-hidden />
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label="Redo"
          title="Redo"
          disabled={!commandEnabled(APP_MENU_COMMAND_IDS.REDO)}
          onClick={() => { runCommand(APP_MENU_COMMAND_IDS.REDO); }}
          data-testid="ipad-redo-button"
        >
          <RiArrowGoForwardLine size={21} aria-hidden />
        </button>
        <button
          type="button"
          className={[css.iconButton, inspectorOpen ? css.iconButtonActive : ""].filter(Boolean).join(" ")}
          aria-label="Inspector"
          title="Inspector"
          aria-pressed={inspectorOpen}
          disabled={!inspectorToggleEnabled}
          onClick={onToggleInspector}
          data-testid="ipad-inspector-toggle"
        >
          <RiLayoutRightLine size={21} aria-hidden />
        </button>
        <IpadPopover
          open={openPopover === "share"}
          onClose={closePopover}
          align="end"
          ariaLabel="Share and export"
          testId="ipad-share-popover"
          trigger={
            <button
              type="button"
              className={[css.iconButton, openPopover === "share" ? css.iconButtonActive : ""].filter(Boolean).join(" ")}
              aria-label="Share"
              title="Share"
              aria-haspopup="dialog"
              aria-expanded={openPopover === "share"}
              onClick={() => { togglePopover("share"); }}
              data-testid="ipad-share-button"
            >
              <RiShareForwardLine size={21} aria-hidden />
            </button>
          }
        >
          <IpadMenu ariaLabel="Share and export">
            <IpadMenuItem
              label="Copy SVG"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY); }}
            />
            <IpadMenuSeparator />
            <IpadMenuItem
              label="Share SVG…"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD); }}
            />
            <IpadMenuItem
              label="Share PDF…"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD); }}
            />
            <IpadMenuItem
              label="Share PNG…"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD); }}
            />
            <IpadMenuItem
              label="Share LaTeX…"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD); }}
            />
          </IpadMenu>
        </IpadPopover>
        <IpadPopover
          open={openPopover === "more"}
          onClose={closePopover}
          align="end"
          ariaLabel="More"
          testId="ipad-more-popover"
          trigger={
            <button
              type="button"
              className={[css.iconButton, openPopover === "more" ? css.iconButtonActive : ""].filter(Boolean).join(" ")}
              aria-label="More"
              title="More"
              aria-haspopup="dialog"
              aria-expanded={openPopover === "more"}
              onClick={() => { togglePopover("more"); }}
              data-testid="ipad-more-button"
            >
              <RiMoreLine size={21} aria-hidden />
            </button>
          }
        >
          <IpadMenu ariaLabel="More">
            {hasMultipleFigures ? (
              <>
                <IpadMenuItem
                  label="Figures"
                  checked={showFiguresPanel}
                  onSelect={() => {
                    closePopover();
                    onToggleFigures();
                  }}
                  testId="ipad-menu-figures"
                />
                <IpadMenuSeparator />
              </>
            ) : null}
            <IpadMenuItem
              label="Show Grid"
              checked={commandChecked(APP_MENU_COMMAND_IDS.TOGGLE_GRID)}
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.TOGGLE_GRID)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.TOGGLE_GRID); }}
            />
            <IpadMenuItem
              label="Show Rulers"
              checked={commandChecked(APP_MENU_COMMAND_IDS.TOGGLE_RULERS)}
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.TOGGLE_RULERS)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.TOGGLE_RULERS); }}
            />
            <IpadMenuSeparator />
            <IpadMenuItem
              label="Import Ipe…"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.IMPORT_IPE)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.IMPORT_IPE); }}
            />
            <IpadMenuItem
              label="Import PowerPoint…"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.IMPORT_POWERPOINT)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.IMPORT_POWERPOINT); }}
            />
            <IpadMenuItem
              label="Import SVG…"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.IMPORT_SVG)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.IMPORT_SVG); }}
            />
            <IpadMenuSeparator />
            <IpadMenuItem
              label="Settings…"
              disabled={!commandEnabled(APP_MENU_COMMAND_IDS.OPEN_SETTINGS)}
              onSelect={() => { runCommand(APP_MENU_COMMAND_IDS.OPEN_SETTINGS); }}
            />
          </IpadMenu>
        </IpadPopover>
        {updateChip ? (
          <button type="button" className={css.updateButton} onClick={updateChip.onClick}>
            {updateChip.version}
          </button>
        ) : null}
      </div>
    </header>
  );
}
