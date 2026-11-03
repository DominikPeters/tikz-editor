import { Modal } from "./Modal";
import css from "./UnsavedChangesModal.module.css";

export type FileConflictDecision = "reload" | "save-anyway" | "save-as" | "cancel";

export function FileConflictModal({
  documentTitle,
  onChoose
}: {
  documentTitle: string;
  onChoose: (decision: FileConflictDecision) => void;
}) {
  return (
    <Modal
      onClose={() => { onChoose("cancel"); }}
      closeOnBackdrop={false}
      size="sm"
      alert
      labelledBy="file-conflict-title"
      dataTestId="file-conflict-modal"
    >
      <Modal.Header title="File Changed on Disk" titleId="file-conflict-title" />
      <Modal.Body>
        <p className={css.message} data-select="text">
          The file for &quot;{documentTitle}&quot; changed outside TikZ Editor.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Modal.SecondaryButton onClick={() => { onChoose("cancel"); }} data-testid="file-conflict-cancel">
          Cancel
        </Modal.SecondaryButton>
        <Modal.SecondaryButton onClick={() => { onChoose("reload"); }} data-testid="file-conflict-reload">
          Reload from Disk
        </Modal.SecondaryButton>
        <Modal.SecondaryButton onClick={() => { onChoose("save-as"); }} data-testid="file-conflict-save-as">
          Save As
        </Modal.SecondaryButton>
        <Modal.DangerButton onClick={() => { onChoose("save-anyway"); }} data-testid="file-conflict-save-anyway">
          Save Anyway
        </Modal.DangerButton>
      </Modal.Footer>
    </Modal>
  );
}
