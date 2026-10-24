import { Modal } from "./Modal";
import css from "./UnsavedChangesModal.module.css";

export type UnsavedChangesDecision = "save" | "discard" | "cancel";

export function UnsavedChangesModal({
  documentTitles,
  onChoose
}: {
  documentTitles: string[];
  onChoose: (decision: UnsavedChangesDecision) => void;
}) {
  // Asked as a question, as AppKit and WinUI phrase it.
  const question =
    documentTitles.length === 1
      ? `Do you want to save the changes made to “${documentTitles[0]}”?`
      : `Do you want to save the changes to ${documentTitles.length} documents?`;

  return (
    <Modal
      onClose={() => { onChoose("cancel"); }}
      closeOnBackdrop={false}
      size="sm"
      alert
      labelledBy="unsaved-changes-title"
      dataTestId="unsaved-changes-modal"
    >
      <Modal.Header
        title={question}
        titleId="unsaved-changes-title"
      />
      <Modal.Body>
        <p className={css.message} data-select="text">Your changes will be lost if you don’t save them.</p>
        {documentTitles.length > 1 ? (
          <ul className={css.list} data-select="text">
            {documentTitles.map((title, index) => (
              <li key={`${title}-${index}`}>{title}</li>
            ))}
          </ul>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Modal.SecondaryButton
          onClick={() => { onChoose("cancel"); }}
          data-testid="unsaved-cancel"
        >
          Cancel
        </Modal.SecondaryButton>
        <Modal.DangerButton
          onClick={() => { onChoose("discard"); }}
          data-testid="unsaved-discard"
        >
          Don&apos;t Save
        </Modal.DangerButton>
        <Modal.PrimaryButton
          onClick={() => { onChoose("save"); }}
          data-testid="unsaved-save"
        >
          Save
        </Modal.PrimaryButton>
      </Modal.Footer>
    </Modal>
  );
}
