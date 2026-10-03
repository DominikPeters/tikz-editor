import { getActiveEditorPlatform } from "../platform/current";
import type { DocumentFileRef, ExternalChangeStatus, FileRevision } from "./types";
import { normalizeWorkspaceTabOrder, WORKSPACE_VERSION, type WorkspaceSeed } from "./workspace-state";
import type { IJsonModel } from "flexlayout-react";
import { isDockLayoutJson } from "../ui/dock-layout-validation";

const WORKSPACE_STORAGE_KEY = "tikz-editor:workspace";
const DOCK_LAYOUT_STORAGE_KEY = "tikz-editor:dock-layout";
const USER_WORKSPACES_STORAGE_KEY = "tikz-editor:user-workspaces";

function logStorageDebug(message: string, error?: unknown): void {
  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }
  if (error != null) {
    console.info(`[tikz-editor] ${message}`, error);
    return;
  }
  console.info(`[tikz-editor] ${message}`);
}

type PersistedWorkspace = {
  workspaceVersion: number;
  documents: Array<{
    id: string;
    title: string;
    source: string;
    activeRootId?: string | null;
    /** Pre-v4 name of `activeRootId`; read for migration, never written. */
    activeFigureId?: string | null;
    savedSource?: string;
    fileRef?: DocumentFileRef | null;
    diskRevision?: FileRevision | null;
    lastKnownDiskSource?: string | null;
    externalChangeStatus?: ExternalChangeStatus;
    assistantThreadId?: string | null;
    assistantWorkspacePath?: string | null;
    assistantFigurePath?: string | null;
    assistantPreviewPath?: string | null;
  }>;
  tabOrder: string[];
  activeDocumentId: string;
  recentDocumentIds: string[];
};

type PersistedWorkspaceDocument = PersistedWorkspace["documents"][number];

export function loadWorkspaceSeed(): WorkspaceSeed | null {
  try {
    const raw = getActiveEditorPlatform().persistence.load(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspace>;
    const migrated = migrateWorkspace(parsed);
    if (!migrated) {
      return null;
    }
    return migrated;
  } catch (error) {
    logStorageDebug("Failed to load persisted workspace; starting with a fresh workspace.", error);
    return null;
  }
}

function normalizeFileRef(raw: unknown): DocumentFileRef | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<DocumentFileRef>;
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    return null;
  }
  const kind =
    candidate.kind === "browser-file"
      ? "browser-file"
      : candidate.kind === "file"
        ? "file"
        : "virtual";
  return {
    kind,
    name: candidate.name,
    handleId: typeof candidate.handleId === "string" ? candidate.handleId : undefined,
    path: typeof candidate.path === "string" ? candidate.path : undefined,
    provider:
      candidate.provider === "browser-fsa" || candidate.provider === "download" || candidate.provider === "desktop-fs"
        ? candidate.provider
        : undefined
  };
}

function normalizeFileRevision(raw: unknown): FileRevision | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<FileRevision>;
  if (typeof candidate.hash !== "string" || candidate.hash.length === 0) {
    return null;
  }
  return {
    hash: candidate.hash,
    mtimeMs: typeof candidate.mtimeMs === "number" ? candidate.mtimeMs : undefined,
    size: typeof candidate.size === "number" ? candidate.size : undefined
  };
}

function normalizeExternalChangeStatus(raw: unknown): ExternalChangeStatus {
  return raw === "changed" || raw === "missing" || raw === "permission-needed" || raw === "error"
    ? raw
    : "none";
}

function migrateWorkspace(parsed: Partial<PersistedWorkspace>): WorkspaceSeed | null {
  const version = typeof parsed.workspaceVersion === "number" ? parsed.workspaceVersion : 1;
  // Version 4 renamed the per-document activeFigureId to activeRootId; the
  // stored values are unchanged, so version 3 payloads migrate by field read.
  if (version !== 1 && version !== 3 && version !== WORKSPACE_VERSION) {
    return null;
  }
  const rawDocuments = Array.isArray(parsed.documents) ? parsed.documents as unknown[] : [];
  const docs = rawDocuments
        .filter((doc): doc is PersistedWorkspaceDocument =>
          Boolean(doc && typeof doc === "object" && typeof (doc as Partial<PersistedWorkspaceDocument>).id === "string" && typeof (doc as Partial<PersistedWorkspaceDocument>).source === "string"))
        .map((doc) => ({
          id: doc.id,
          title: typeof doc.title === "string" && doc.title.trim().length > 0 ? doc.title : "Untitled",
          source: doc.source,
          activeRootId:
            typeof doc.activeRootId === "string"
              ? doc.activeRootId
              : typeof doc.activeFigureId === "string"
                ? doc.activeFigureId
                : null,
          savedSource: typeof doc.savedSource === "string" ? doc.savedSource : doc.source,
          fileRef: normalizeFileRef(doc.fileRef),
          diskRevision: normalizeFileRevision(doc.diskRevision),
          lastKnownDiskSource: typeof doc.lastKnownDiskSource === "string" ? doc.lastKnownDiskSource : null,
          externalChangeStatus: normalizeExternalChangeStatus(doc.externalChangeStatus),
          assistantThreadId: typeof doc.assistantThreadId === "string" ? doc.assistantThreadId : null,
          assistantWorkspacePath: typeof doc.assistantWorkspacePath === "string" ? doc.assistantWorkspacePath : null,
          assistantFigurePath: typeof doc.assistantFigurePath === "string" ? doc.assistantFigurePath : null,
          assistantPreviewPath: typeof doc.assistantPreviewPath === "string" ? doc.assistantPreviewPath : null
        }));
  if (docs.length === 0) {
    return null;
  }
  const tabOrderRaw = Array.isArray(parsed.tabOrder) ? parsed.tabOrder.filter((id): id is string => typeof id === "string") : [];
  const docIds = new Set(docs.map((doc) => doc.id));
  const tabOrder = normalizeWorkspaceTabOrder(tabOrderRaw, docIds);
  const activeDocumentId =
    typeof parsed.activeDocumentId === "string" && docIds.has(parsed.activeDocumentId)
      ? parsed.activeDocumentId
      : tabOrder.at(0) ?? docs[0].id;
  if (!Array.isArray(parsed.recentDocumentIds)) {
    return null;
  }
  const recentDocumentIds = [...new Set(parsed.recentDocumentIds.filter((id): id is string => typeof id === "string" && docIds.has(id)))];

  return {
    workspaceVersion: WORKSPACE_VERSION,
    documents: docs,
    tabOrder,
    activeDocumentId,
    recentDocumentIds
  };
}

export function saveWorkspace(state: {
  workspaceVersion: number;
  documents: Record<string, {
    id: string;
    title: string;
    source: string;
    activeRootId: string | null;
    savedSource: string;
    fileRef: DocumentFileRef | null;
    diskRevision?: FileRevision | null;
    lastKnownDiskSource?: string | null;
    externalChangeStatus?: ExternalChangeStatus;
    assistantThreadId: string | null;
    assistantWorkspacePath: string | null;
    assistantFigurePath: string | null;
    assistantPreviewPath: string | null;
  }>;
  tabOrder: string[];
  activeDocumentId: string;
  recentDocumentIds: string[];
}): void {
  const tabOrder = normalizeWorkspaceTabOrder(state.tabOrder, Object.keys(state.documents));
  const validIds = new Set(tabOrder);
  const activeDocumentId = validIds.has(state.activeDocumentId) ? state.activeDocumentId : tabOrder[0];
  const recentDocumentIds = [...new Set(state.recentDocumentIds.filter((id) => validIds.has(id)))];
  const payload: PersistedWorkspace = {
    workspaceVersion: WORKSPACE_VERSION,
    documents: tabOrder
      .map((id) => state.documents[id])
      .filter((doc): doc is NonNullable<typeof state.documents[string]> => Boolean(doc))
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        source: doc.source,
        activeRootId: doc.activeRootId,
        savedSource: doc.savedSource,
        fileRef: doc.fileRef,
        diskRevision: doc.diskRevision ?? null,
        lastKnownDiskSource: doc.lastKnownDiskSource ?? null,
        externalChangeStatus: doc.externalChangeStatus ?? "none",
        assistantThreadId: doc.assistantThreadId,
        assistantWorkspacePath: doc.assistantWorkspacePath,
        assistantFigurePath: doc.assistantFigurePath,
        assistantPreviewPath: doc.assistantPreviewPath
      })),
    tabOrder,
    activeDocumentId,
    recentDocumentIds: recentDocumentIds.length > 0 ? recentDocumentIds : [activeDocumentId]
  };
  try {
    getActiveEditorPlatform().persistence.save(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    logStorageDebug("Failed to save workspace state.", error);
  }
}

// ── Dock layout persistence ───────────────────────────────────────────────────

export function loadDockLayout(): IJsonModel | null {
  try {
    const raw = getActiveEditorPlatform().persistence.load(DOCK_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isDockLayoutJson(parsed) ? parsed : null;
  } catch (error) {
    logStorageDebug("Failed to load persisted dock layout.", error);
    return null;
  }
}

export function saveDockLayout(json: IJsonModel): void {
  try {
    getActiveEditorPlatform().persistence.save(DOCK_LAYOUT_STORAGE_KEY, JSON.stringify(json));
  } catch (error) {
    logStorageDebug("Failed to save dock layout.", error);
  }
}

// ── User workspaces persistence ───────────────────────────────────────────────

export type UserWorkspace = {
  id: string;
  name: string;
  json: IJsonModel;
  createdAt: number;
};

type PersistedUserWorkspacesV1 = {
  version: 1;
  items: UserWorkspace[];
};

export function loadUserWorkspaces(): UserWorkspace[] {
  try {
    const raw = getActiveEditorPlatform().persistence.load(USER_WORKSPACES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const candidate = parsed as Partial<PersistedUserWorkspacesV1>;
    if (candidate.version !== 1 || !Array.isArray(candidate.items)) return [];
    const rawItems = candidate.items as unknown[];
    return rawItems
      .filter((item): item is UserWorkspace =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as Partial<UserWorkspace>).id === "string" &&
            typeof (item as Partial<UserWorkspace>).name === "string" &&
            isDockLayoutJson((item as Partial<UserWorkspace>).json) &&
            typeof (item as Partial<UserWorkspace>).createdAt === "number"
        )
      );
  } catch (error) {
    logStorageDebug("Failed to load user workspaces.", error);
    return [];
  }
}

export function saveUserWorkspaces(items: readonly UserWorkspace[]): void {
  const payload: PersistedUserWorkspacesV1 = {
    version: 1,
    items: [...items],
  };
  try {
    getActiveEditorPlatform().persistence.save(USER_WORKSPACES_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    logStorageDebug("Failed to save user workspaces.", error);
  }
}
