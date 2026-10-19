import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UpdateInfo } from "../platform/types";
import { Modal } from "./Modal";
import css from "./UpdateModal.module.css";

type UpdateInstallPhase =
  | { status: "idle" }
  | { status: "installing"; downloadedBytes: number; contentLength?: number }
  | { status: "failed"; message: string };

type UpdateModalProps = {
  update: UpdateInfo;
  phase: UpdateInstallPhase;
  isWindows: boolean;
  onInstall: () => void;
  onClose: () => void;
  onLater: () => void;
  onSkip: () => void;
};

export function UpdateModal({ update, phase, isWindows, onInstall, onClose, onLater, onSkip }: UpdateModalProps) {
  const installing = phase.status === "installing";
  const progressLabel =
    phase.status === "installing"
      ? formatProgress(phase.downloadedBytes, phase.contentLength)
      : null;
  const progressPercent =
    phase.status === "installing" && phase.contentLength && phase.contentLength > 0
      ? Math.max(0, Math.min(100, (phase.downloadedBytes / phase.contentLength) * 100))
      : null;

  return (
    <Modal
      onClose={() => {
        if (!installing) {
          onClose();
        }
      }}
      closeOnBackdrop={!installing}
      closeOnEscape={!installing}
      size="sm"
      className={css.dialog ?? ""}
      labelledBy="update-modal-title"
      dataTestId="update-modal"
    >
      <Modal.Header
        title="Update Available"
        titleId="update-modal-title"
        showCloseButton={!installing}
        {...(installing ? {} : { onClose })}
        closeAriaLabel="Close update"
      />
      <Modal.Body>
        <div className={css.summary} data-select="text">
          <div>
            <span className={css.label}>New version</span>
            <span className={css.value}>{update.version}</span>
          </div>
          <div>
            <span className={css.label}>Current version</span>
            <span className={css.value}>{update.currentVersion}</span>
          </div>
          {update.date ? (
            <div>
              <span className={css.label}>Published</span>
              <span className={css.value}>{formatDate(update.date)}</span>
            </div>
          ) : null}
        </div>

        {update.body ? (
          <div className={css.notes} data-testid="update-notes" data-select="text">
            <Markdown remarkPlugins={[remarkGfm]}>{update.body}</Markdown>
          </div>
        ) : null}

        {isWindows && phase.status !== "installing" ? (
          <p className={css.warning} data-select="text">
            Installing on Windows may close the app while the installer runs.
          </p>
        ) : null}

        {phase.status === "installing" ? (
          <div className={css.progressArea} data-testid="update-install-progress">
            <div className={css.progressHeader}>
              <span>Downloading update...</span>
              {progressLabel ? <span>{progressLabel}</span> : null}
            </div>
            <div className={css.progressTrack}>
              <div
                className={css.progressFill}
                style={progressPercent == null ? undefined : { width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}

        {phase.status === "failed" ? (
          <p className={css.error} data-testid="update-install-error" data-select="text">
            {phase.message}
          </p>
        ) : null}
      </Modal.Body>
      <Modal.Footer align="between" className={css.footer ?? ""}>
        <Modal.SecondaryButton
          onClick={onSkip}
          disabled={installing}
          data-testid="update-skip"
        >
          Skip this version
        </Modal.SecondaryButton>
        <div className={css.actions}>
          <Modal.SecondaryButton
            onClick={onLater}
            disabled={installing}
            data-testid="update-later"
          >
            Later
          </Modal.SecondaryButton>
          <Modal.PrimaryButton
            onClick={onInstall}
            disabled={installing}
            data-testid="update-install"
          >
            {phase.status === "failed" ? "Retry" : "Install and Relaunch"}
          </Modal.PrimaryButton>
        </div>
      </Modal.Footer>
    </Modal>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatProgress(downloadedBytes: number, contentLength?: number): string | null {
  if (!contentLength || contentLength <= 0) {
    return formatBytes(downloadedBytes);
  }
  return `${formatBytes(downloadedBytes)} of ${formatBytes(contentLength)}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
