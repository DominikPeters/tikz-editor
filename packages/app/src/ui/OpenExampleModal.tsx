import type { TikzOpenExample } from "./examples/open-example-catalog";
import { GENERATED_OPEN_EXAMPLE_PREVIEWS } from "./examples/generated-open-example-previews";
import { Modal } from "./Modal";
import css from "./OpenExampleModal.module.css";

type OpenExampleModalProps = {
  examples: readonly TikzOpenExample[];
  onClose: () => void;
  onSelectExample: (example: TikzOpenExample) => void;
};

export function OpenExampleModal({ examples, onClose, onSelectExample }: OpenExampleModalProps) {
  return (
    <Modal
      onClose={onClose}
      size="xl"
      labelledBy="open-example-title"
      dataTestId="open-example-modal"
      className={css.dialog ?? ""}
    >
      <Modal.Header
        title="Open Example"
        titleId="open-example-title"
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close open example dialog"
      />
      <Modal.Body padding="none">
        <div className={css.grid}>
          {examples.map((example) => {
            const preview = GENERATED_OPEN_EXAMPLE_PREVIEWS[example.id] ?? null;
            const hasPreview = Boolean(preview?.svg);
            return (
              <button
                key={example.id}
                type="button"
                className={css.card}
                data-testid={`open-example-card-${example.id}`}
                onClick={() => { onSelectExample(example); }}
              >
                <div className={css.previewFrame}>
                  {hasPreview ? (
                    <div
                      className={css.previewSvg}
                      dangerouslySetInnerHTML={{ __html: preview?.svg ?? "" }}
                    />
                  ) : (
                    <div className={css.previewFallback}>
                      <span>Preview unavailable</span>
                    </div>
                  )}
                </div>

                <div className={css.content}>
                  <h3 className={css.cardTitle}>{example.title}</h3>
                  <p className={css.cardDescription}>{example.description}</p>
                  <div className={css.tags}>
                    {example.featureLabels.map((label) => (
                      <span key={`${example.id}:${label}`} className={css.tag}>{label}</span>
                    ))}
                  </div>
                  {preview && (preview.errorCount > 0 || preview.warningCount > 0) ? (
                    <p className={css.diagnostics}>
                      {preview.errorCount} error{preview.errorCount === 1 ? "" : "s"}
                      {" · "}
                      {preview.warningCount} warning{preview.warningCount === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </Modal.Body>
    </Modal>
  );
}
