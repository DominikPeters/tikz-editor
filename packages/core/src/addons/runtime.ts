import type { AddonEngine, AddonRegistration, AddonUi } from "@tikz-editor/addon-api";

export type AddonRuntimeIssue = {
  addonId: string;
  message: string;
};

export type AddonEngineRoute = {
  addonId: string;
  engine: AddonEngine;
};

/**
 * The host-side registry of active add-ons: engines plus the routing tables
 * consulted by the parser and the semantic evaluator. Built once per set of
 * enabled add-ons; conflicts are resolved at construction (first registration
 * wins, later conflicting add-ons are deactivated with a visible issue).
 */
export type AddonRuntime = {
  engines: ReadonlyMap<string, AddonEngine>;
  uis: ReadonlyMap<string, AddonUi>;
  issues: readonly AddonRuntimeIssue[];
  engineForCommand(commandName: string): AddonEngineRoute | null;
  engineForEnvironment(envName: string): AddonEngineRoute | null;
  engineById(addonId: string): AddonEngine | null;
  /** Cheap prescan: does this document mention any trigger of any active add-on? */
  isTriggeredBy(source: string): boolean;
};

export function createAddonRuntime(registrations: readonly AddonRegistration[]): AddonRuntime {
  const engines = new Map<string, AddonEngine>();
  const uis = new Map<string, AddonUi>();
  const commandRouting = new Map<string, string>();
  const environmentRouting = new Map<string, string>();
  const issues: AddonRuntimeIssue[] = [];

  for (const registration of registrations) {
    const engine = registration.engine;
    const addonId = engine.manifest.id;
    if (engines.has(addonId)) {
      issues.push({ addonId, message: `Add-on "${addonId}" is registered more than once; later registration ignored.` });
      continue;
    }

    const triggers = engine.manifest.triggers;
    const claimedCommands = (triggers.commands ?? []).map(normalizeCommandName);
    const claimedEnvironments = triggers.environments ?? [];

    const commandConflict = claimedCommands.find((name) => commandRouting.has(name));
    const environmentConflict = claimedEnvironments.find((name) => environmentRouting.has(name));
    if (commandConflict != null || environmentConflict != null) {
      const claim = commandConflict ?? `environment "${environmentConflict}"`;
      const owner = commandRouting.get(commandConflict ?? "") ?? environmentRouting.get(environmentConflict ?? "");
      issues.push({
        addonId,
        message: `Add-on "${addonId}" claims ${claim}, already claimed by "${owner}"; "${addonId}" is deactivated.`
      });
      continue;
    }

    engines.set(addonId, engine);
    if (registration.ui) {
      uis.set(addonId, registration.ui);
    }
    for (const name of claimedCommands) {
      commandRouting.set(name, addonId);
    }
    for (const name of claimedEnvironments) {
      environmentRouting.set(name, addonId);
    }
  }

  const routeFor = (routing: Map<string, string>, name: string): AddonEngineRoute | null => {
    const addonId = routing.get(name);
    if (addonId == null) {
      return null;
    }
    const engine = engines.get(addonId);
    return engine ? { addonId, engine } : null;
  };

  return {
    engines,
    uis,
    issues,
    engineForCommand: (commandName) => routeFor(commandRouting, normalizeCommandName(commandName)),
    engineForEnvironment: (envName) => routeFor(environmentRouting, envName),
    engineById: (addonId) => engines.get(addonId) ?? null,
    isTriggeredBy: (source) => isTriggeredBySource(source, engines.values())
  };
}

function normalizeCommandName(name: string): string {
  return name.startsWith("\\") ? name : `\\${name}`;
}

function isTriggeredBySource(source: string, engines: Iterable<AddonEngine>): boolean {
  for (const engine of engines) {
    const triggers = engine.manifest.triggers;
    for (const command of triggers.commands ?? []) {
      if (source.includes(normalizeCommandName(command))) {
        return true;
      }
    }
    for (const environment of triggers.environments ?? []) {
      if (source.includes(`\\begin{${environment}}`)) {
        return true;
      }
    }
    for (const packageName of triggers.packages ?? []) {
      if (new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{[^}]*\\b${escapeRegExp(packageName)}\\b[^}]*\\}`).test(source)) {
        return true;
      }
    }
    for (const library of triggers.tikzLibraries ?? []) {
      if (new RegExp(`\\\\use\\w*library\\{[^}]*\\b${escapeRegExp(library)}\\b[^}]*\\}`).test(source)) {
        return true;
      }
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
