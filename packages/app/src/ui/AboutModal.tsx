import { Modal } from "./Modal";
import css from "./AboutModal.module.css";

const APP_VERSION = (import.meta.env.TIKZ_EDITOR_VERSION as string | undefined) ?? "0.1.0";
const APP_AUTHOR = "Dominik Peters";
const APP_LICENSE = "MIT";
const APP_WEBSITE = "https://tikz.dev/editor/";

type AboutModalProps = {
  onClose: () => void;
};

export function AboutModal({ onClose }: AboutModalProps) {
  return (
    <Modal
      size="sm"
      labelledBy="about-title"
      onClose={onClose}
      dataTestId="about-modal"
    >
      <Modal.Body padding="none" scroll={false}>
        <section className={css.about}>
          <button
            type="button"
            className={css.closeButton}
            aria-label="Close about dialog"
            onClick={onClose}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
          </button>

          <div className={css.logo} aria-hidden="true">
            <span className={css.logoSlash}>{"\\"}</span>
            <span>t</span>
          </div>

          <h2 id="about-title" className={css.title}>
            <span className={css.titleStrong}>TikZ Editor</span>{" "}
            <span className={css.titleQualifier}>Web</span>
          </h2>

          <p className={css.version}>Version {APP_VERSION}</p>

          <dl className={css.meta}>
            <div className={css.metaRow}>
              <dt>Author:</dt>
              <dd>{APP_AUTHOR}</dd>
            </div>
            <div className={css.metaRow}>
              <dt>License:</dt>
              <dd>{APP_LICENSE}</dd>
            </div>
            <div className={css.metaRow}>
              <dt>Website:</dt>
              <dd>
                <a href={APP_WEBSITE} target="_blank" rel="noreferrer">
                  {APP_WEBSITE}
                </a>
              </dd>
            </div>
          </dl>
        </section>
      </Modal.Body>
    </Modal>
  );
}
