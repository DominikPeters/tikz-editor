import type { AddonEngine, AddonRegistration, AddonUi } from "@tikz-editor/addon-api";
import { createAddonRuntime, type AddonRuntime } from "@tikz-editor/core/addons/runtime";

import type { AddonsSettings } from "../settings/types";
import { setActiveAddonRuntime } from "./registry";

/** The addon-api version this host implements (kept in sync with packages/addon-api). */
const HOST_ADDON_API_VERSION = "0.1.0";

export type AddonLoadIssue = {
  addonId: string;
  message: string;
};

export type AddonLoadResult = {
  runtime: AddonRuntime;
  issues: AddonLoadIssue[];
};

let staticRegistrations: readonly AddonRegistration[] = [];
const urlRegistrationCache = new Map<string, Promise<AddonRegistration>>();
let refreshSequence = 0;
let lastLoadIssues: AddonLoadIssue[] = [];

export function getLastAddonLoadIssues(): readonly AddonLoadIssue[] {
  return lastLoadIssues;
}

/** Load a url-sourced add-on's registration, e.g. to read its manifest before installing. */
export async function peekAddonAtUrl(url: string): Promise<AddonRegistration> {
  return loadAddonFromUrl(url);
}

/**
 * Register statically bundled add-ons (dev iteration, tests, opt-in builds).
 * Call before the first refreshAddonRuntime; typically via <App addons={...}>.
 */
export function setStaticAddonRegistrations(registrations: readonly AddonRegistration[]): void {
  staticRegistrations = registrations;
}

export function getStaticAddonRegistrations(): readonly AddonRegistration[] {
  return staticRegistrations;
}

/**
 * Rebuild the active add-on runtime from the settings enablement state:
 * static registrations participate unless explicitly disabled; url-sourced
 * add-ons are dynamically imported (cached-promise per url). Load failures
 * disable the add-on for the session with a visible issue. The resulting
 * runtime is installed as the app-wide active runtime unless a newer
 * refresh superseded this one.
 */
export async function refreshAddonRuntime(settings: AddonsSettings): Promise<AddonLoadResult> {
  const sequence = ++refreshSequence;
  const issues: AddonLoadIssue[] = [];
  const registrations: AddonRegistration[] = [];

  for (const registration of staticRegistrations) {
    const addonId = registration.engine.manifest.id;
    const entry = settings.installed[addonId];
    if (entry && !entry.enabled) {
      continue;
    }
    const versionIssue = checkApiVersion(registration.engine);
    if (versionIssue) {
      issues.push({ addonId, message: versionIssue });
      continue;
    }
    registrations.push(registration);
  }

  for (const [addonId, entry] of Object.entries(settings.installed)) {
    if (!entry.enabled || entry.source.kind !== "url") {
      continue;
    }
    if (registrations.some((registration) => registration.engine.manifest.id === addonId)) {
      continue;
    }
    try {
      const registration = await loadAddonFromUrl(entry.source.url);
      const versionIssue = checkApiVersion(registration.engine);
      if (versionIssue) {
        issues.push({ addonId, message: versionIssue });
        continue;
      }
      if (registration.engine.manifest.id !== addonId) {
        issues.push({
          addonId,
          message: `Add-on at ${entry.source.url} identifies as "${registration.engine.manifest.id}", expected "${addonId}".`
        });
        continue;
      }
      registrations.push(registration);
    } catch (error) {
      urlRegistrationCache.delete(entry.source.url);
      issues.push({
        addonId,
        message: `Failed to load add-on from ${entry.source.url}: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  const runtime = createAddonRuntime(registrations);
  for (const issue of runtime.issues) {
    issues.push(issue);
  }
  if (sequence === refreshSequence) {
    lastLoadIssues = issues;
    setActiveAddonRuntime(runtime);
  }
  return { runtime, issues };
}

async function loadAddonFromUrl(url: string): Promise<AddonRegistration> {
  let cached = urlRegistrationCache.get(url);
  if (!cached) {
    cached = importAddonModules(url);
    urlRegistrationCache.set(url, cached);
  }
  return cached;
}

async function importAddonModules(url: string): Promise<AddonRegistration> {
  const engineModule = (await import(/* @vite-ignore */ url)) as { default?: AddonEngine };
  const engine = engineModule.default;
  if (!engine || typeof engine.evaluate !== "function" || engine.manifest == null) {
    throw new Error("Module does not default-export an add-on engine");
  }
  let ui: AddonUi | undefined;
  const uiSpecifier = engine.manifest.entries.ui;
  if (uiSpecifier) {
    try {
      const uiUrl = new URL(uiSpecifier, url).href;
      const uiModule = (await import(/* @vite-ignore */ uiUrl)) as { default?: AddonUi };
      ui = uiModule.default;
    } catch {
      // The ui entry is optional enhancement; engine-only operation is valid.
      ui = undefined;
    }
  }
  return { engine, ui };
}

/**
 * Minimal semver check for manifest apiVersion ranges: supports exact
 * versions ("0.1.0") and caret ranges ("^0.1.0"). Anything else is
 * rejected as unsupported.
 */
export function checkApiVersion(engine: AddonEngine): string | null {
  const range = engine.manifest.apiVersion.trim();
  const caret = range.startsWith("^");
  const base = parseSemver(caret ? range.slice(1) : range);
  const host = parseSemver(HOST_ADDON_API_VERSION);
  if (!base || !host) {
    return `Unsupported apiVersion range "${range}" (expected "x.y.z" or "^x.y.z").`;
  }
  const compatible = caret ? satisfiesCaret(host, base) : host.join(".") === base.join(".");
  if (!compatible) {
    return `Add-on targets addon-api ${range}, but this editor provides ${HOST_ADDON_API_VERSION}.`;
  }
  return null;
}

type Semver = [number, number, number];

function parseSemver(value: string): Semver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function satisfiesCaret(host: Semver, base: Semver): boolean {
  if (compareSemver(host, base) < 0) {
    return false;
  }
  if (base[0] > 0) {
    return host[0] === base[0];
  }
  if (base[1] > 0) {
    return host[0] === 0 && host[1] === base[1];
  }
  return host[0] === 0 && host[1] === 0 && host[2] === base[2];
}

function compareSemver(left: Semver, right: Semver): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}
