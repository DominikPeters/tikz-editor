import { Modal } from "./Modal";
import css from "./RepeatModal.module.css";

type RepeatModalProps = {
  columns: number;
  rows: number;
  horizontalStepCm: number;
  verticalStepCm: number;
  horizontalGapCm: number;
  verticalGapCm: number;
  selectionWidthCm: number;
  selectionHeightCm: number;
  onColumnsChange: (value: number) => void;
  onRowsChange: (value: number) => void;
  onHorizontalStepChange: (value: number) => void;
  onVerticalStepChange: (value: number) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function RepeatModal({
  columns,
  rows,
  horizontalStepCm,
  verticalStepCm,
  horizontalGapCm,
  verticalGapCm,
  selectionWidthCm,
  selectionHeightCm,
  onColumnsChange,
  onRowsChange,
  onHorizontalStepChange,
  onVerticalStepChange,
  onClose,
  onConfirm
}: RepeatModalProps) {
  const confirmDisabled = columns <= 1 && rows <= 1;

  return (
    <Modal
      variant="panel"
      onClose={onClose}
      labelledBy="repeat-modal-title"
      dataTestId="repeat-modal"
      draggable
      closeOnBackdrop
      initialWidth={344}
      className={css.modal ?? ""}
    >
      <Modal.Header
        title="Repeat"
        titleId="repeat-modal-title"
        draggable
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close repeat dialog"
      />

      <Modal.Body padding="compact">
        <div className={css.grid}>
          <label className={css.field}>
            <span>Columns</span>
            <input
              data-testid="repeat-columns-input"
              type="number"
              min={1}
              step={1}
              value={columns}
              onChange={(event) => { onColumnsChange(Number(event.target.value)); }}
            />
          </label>
          <label className={css.field}>
            <span>Rows</span>
            <input
              data-testid="repeat-rows-input"
              type="number"
              min={1}
              step={1}
              value={rows}
              onChange={(event) => { onRowsChange(Number(event.target.value)); }}
            />
          </label>
          <label className={css.field}>
            <span>H Step (cm)</span>
            <input
              data-testid="repeat-horizontal-step-input"
              type="number"
              step={0.1}
              value={formatUiNumber(horizontalStepCm)}
              onChange={(event) => { onHorizontalStepChange(Number(event.target.value)); }}
            />
          </label>
          <label className={css.field}>
            <span>V Step (cm)</span>
            <input
              data-testid="repeat-vertical-step-input"
              type="number"
              step={0.1}
              value={formatUiNumber(verticalStepCm)}
              onChange={(event) => { onVerticalStepChange(Number(event.target.value)); }}
            />
          </label>
        </div>

        <div className={css.metrics}>
          <div className={css.metricRow}>
            <span className={css.metricLabel}>Selection</span>
            <strong>{formatMetric(selectionWidthCm)} × {formatMetric(selectionHeightCm)}</strong>
          </div>
          <div className={css.metricRow}>
            <span className={css.metricLabel}>Gap</span>
            <strong>
              <span data-testid="repeat-horizontal-gap">{formatMetric(horizontalGapCm)}</span>
              {" × "}
              <span data-testid="repeat-vertical-gap">{formatMetric(verticalGapCm)}</span>
            </strong>
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Modal.SecondaryButton onClick={onClose}>Cancel</Modal.SecondaryButton>
        <Modal.PrimaryButton
          onClick={onConfirm}
          disabled={confirmDisabled}
          data-testid="repeat-confirm-button"
        >
          Apply
        </Modal.PrimaryButton>
      </Modal.Footer>
    </Modal>
  );
}

function formatMetric(value: number): string {
  return `${formatUiNumber(value)} cm`;
}

function formatUiNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Number.parseFloat(value.toFixed(3)).toString();
}
