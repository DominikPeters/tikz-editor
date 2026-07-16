import { useState } from "react";

import type { AddonManifest } from "@tikz-editor/addon-api";

import { getLastAddonLoadIssues, getStaticAddonRegistrations, peekAddonAtUrl } from "../addons/loader";
import { useAddonRuntimeRevision } from "../addons/registry";
import { useSettingsStore } from "../settings/useSettingsStore";
import css from "./SettingsModal.module.css";

type AddonRow = {
  manifest: AddonManifest;
  enabled: boolean;
  sourceKind: "builtin" | "url";
  sourceUrl?: string;
  removable: boolean;
};

/**
 * The add-on manager tab of the settings modal: lists installed add-ons with
 * license/version/source, enable/disable toggles, and an add-by-URL form.
 */
export function AddonSettingsPanel() {
  useAddonRuntimeRevision();
  const settings = useSettingsStore((s) => s.settings);
  const setInstalledAddon = useSettingsStore((s) => s.setInstalledAddon);
  const removeInstalledAddon = useSettingsStore((s) => s.removeInstalledAddon);
  const [urlDraft, setUrlDraft] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const rows = new Map<string, AddonRow>();
  for (const registration of getStaticAddonRegistrations()) {
    const manifest = registration.engine.manifest;
    rows.set(manifest.id, {
      manifest,
      enabled: settings.addons.installed[manifest.id]?.enabled ?? true,
      sourceKind: "builtin",
      removable: false
    });
  }
  for (const [addonId, entry] of Object.entries(settings.addons.installed)) {
    if (entry.source.kind !== "url" || rows.has(addonId)) {
      continue;
    }
    rows.set(addonId, {
      manifest: {
        id: addonId,
        version: entry.version,
        apiVersion: "",
        displayName: addonId,
        license: "",
        sourceUrl: entry.source.url,
        triggers: {},
        entries: { engine: entry.source.url }
      },
      enabled: entry.enabled,
      sourceKind: "url",
      sourceUrl: entry.source.url,
      removable: true
    });
  }
  const issues = getLastAddonLoadIssues();

  const setEnabled = (row: AddonRow, enabled: boolean) => {
    const existing = settings.addons.installed[row.manifest.id];
    setInstalledAddon(row.manifest.id, {
      enabled,
      source: existing?.source ?? (row.sourceKind === "url" && row.sourceUrl
        ? { kind: "url", url: row.sourceUrl }
        : { kind: "builtin" }),
      version: existing?.version ?? row.manifest.version,
      settings: existing?.settings
    });
  };

  const installFromUrl = async () => {
    const url = urlDraft.trim();
    if (!url) {
      return;
    }
    setInstalling(true);
    setInstallError(null);
    try {
      const registration = await peekAddonAtUrl(url);
      const manifest = registration.engine.manifest;
      setInstalledAddon(manifest.id, {
        enabled: true,
        source: { kind: "url", url },
        version: manifest.version
      });
      setUrlDraft("");
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className={css.panel}>
      <div className={css.panelTitle}>Add-ons</div>
      <div className={css.settingsGroup}>
        {rows.size === 0 ? (
          <div className={css.settingRow}>
            <span className={css.settingDesc}>No add-ons are installed.</span>
          </div>
        ) : (
          [...rows.values()].map((row) => (
            <div key={row.manifest.id} className={css.settingRow} data-testid={`addon-row-${row.manifest.id}`}>
              <label className={css.settingLabel} htmlFor={`addon-enabled-${row.manifest.id}`}>
                {row.manifest.displayName}
                <span className={css.settingDesc}>
                  {[
                    `v${row.manifest.version}`,
                    row.manifest.license || null,
                    row.sourceKind === "builtin" ? "bundled" : row.sourceUrl
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </label>
              <span>
                <input
                  id={`addon-enabled-${row.manifest.id}`}
                  type="checkbox"
                  className={css.checkbox}
                  checked={row.enabled}
                  onChange={(event) => { setEnabled(row, event.target.checked); }}
                />
                {row.removable ? (
                  <button
                    type="button"
                    className={css.resetButton}
                    onClick={() => { removeInstalledAddon(row.manifest.id); }}
                  >
                    Remove
                  </button>
                ) : null}
              </span>
            </div>
          ))
        )}

        <div className={css.settingRow}>
          <label className={css.settingLabel} htmlFor="addon-install-url">
            Add from URL
            <span className={css.settingDesc}>
              Loads a trusted add-on bundle (ES module). Add-ons run with full access to the editor.
            </span>
          </label>
          <span>
            <input
              id="addon-install-url"
              type="text"
              className={css.select}
              placeholder="https://…/addon.js"
              value={urlDraft}
              onChange={(event) => { setUrlDraft(event.target.value); }}
            />
            <button
              type="button"
              className={css.resetButton}
              disabled={installing || urlDraft.trim().length === 0}
              onClick={() => { void installFromUrl(); }}
            >
              {installing ? "Loading…" : "Install"}
            </button>
          </span>
        </div>

        {installError ? (
          <div className={css.settingRow}>
            <span className={css.settingDesc}>{installError}</span>
          </div>
        ) : null}
        {issues.map((issue) => (
          <div key={`${issue.addonId}:${issue.message}`} className={css.settingRow}>
            <span className={css.settingDesc}>⚠ {issue.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
