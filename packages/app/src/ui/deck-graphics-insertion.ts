import { create } from "zustand";
import { applyDeckEditAction, buildBeamerObjectIndex, scanBeamerDocument, type BeamerGraphicsPlacement } from "@tikz-editor/core/beamer/index";
import { planGraphicsFileName, planGraphicsFolder, type GraphicsFolderListing } from "@tikz-editor/core/graphics/index";
import { userText } from "@tikz-editor/core/edit/fragment";
import { analyzeSimpleTexResources } from "@tikz-editor/core/text/tex/index";
import { beginDocumentEdit, canContinueDocumentEdit } from "../edit-session.js";
import { prepareGraphics, sameBytes, type PreparedGraphics } from "../graphics-bytes.js";
import { graphicBytesBase64, graphicBytesFromBase64, importedGraphicPath, replacementGraphicPath, storeImportedGraphic } from "../imported-graphics.js";
import { getActiveEditorPlatform } from "../platform/current.js";
import type { DocumentFileRef, EditorAction, EditorState } from "../store/types.js";
import { requestDeckReselect, takeDeckCaret } from "./canvas-panel/deck-insertion-bridge.js";

/**
 * Inserting an image on the active slide: the file goes where the document
 * keeps its images (see core's insertion planner), and a notice says where,
 * with Undo and, for a file it wrote, Change….
 */

/** `path`: where the file is on disk, when the platform says (the desktop file panel). */
export type GraphicsInput = { readonly bytes: ArrayBuffer; readonly name: string | null; readonly mimeType: string; readonly path?: string | null };

export type GraphicsNotice = {
  readonly id: number;
  readonly documentId: string;
  /** saved: written by this insertion; linked: an identical file was there; browser: kept in browser storage. */
  readonly kind: "saved" | "linked" | "browser";
  readonly fileName: string;
  /** Folder shown to the user, `figures/`; the document's own folder by name. */
  readonly folderLabel: string;
  /** The outermost folder this insertion created, relative to the document. */
  readonly createdFolder: string | null;
  readonly absolutePath: string | null;
  readonly size: number;
  readonly createdDirectories: readonly string[];
  readonly texPath: string;
  /** The document right after the insertion: Undo applies while it is unchanged. */
  readonly sourceAfter: string;
  readonly compileDirectory: string | null;
};

export type GraphicsMessage = { readonly id: number; readonly documentId: string; readonly kind: "error"; readonly message: string };

type GraphicsNoticeStore = {
  readonly notice: GraphicsNotice | GraphicsMessage | null;
  readonly show: (notice: GraphicsNotice | GraphicsMessage) => void;
  readonly dismiss: (id?: number) => void;
};

let nextNoticeId = 1;
export const useGraphicsNoticeStore = create<GraphicsNoticeStore>((set, get) => ({
  notice: null,
  show: (notice) => { set({ notice }); },
  dismiss: (id) => { if (id === undefined || get().notice?.id === id) set({ notice: null }); },
}));

function showError(documentId: string, message: string): void {
  useGraphicsNoticeStore.getState().show({ id: nextNoticeId++, documentId, kind: "error", message });
}

const GENERIC_NAME = /^(?:image|img|blob|unknown|untitled|pasted[ -]?image)(?:\.\w+)?$/iu;

/** A name for a pasted image from its slide: the frame title, else `slide-<n>`. */
function slideImageName(source: string, frameId: string): string {
  const frames = scanBeamerDocument(source).frames;
  const index = frames.findIndex((frame) => frame.id === frameId);
  const title = frames[index]?.title?.value ?? "";
  const words = title.replace(/\\[A-Za-z@]+\*?/gu, " ").replace(/[{}$^_~\\]/gu, " ").trim();
  return /[A-Za-z0-9]/u.test(words) ? words : `slide-${index + 1}`;
}

function dirname(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash < 0 ? "" : path.slice(0, slash);
}

function joinNative(directory: string, relative: string): string {
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/u, "")}${separator}${separator === "\\" ? relative.replaceAll("/", "\\") : relative}`;
}

function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/** `width=<f>\linewidth` that keeps the image inside the text area; null keeps a small image's natural size. */
function insertionWidth(prepared: PreparedGraphics, textArea: { width: number; height: number }): number | null {
  const PT_PER_BP = 72.27 / 72;
  const maxHeight = 0.6 * textArea.height;
  if (!prepared.pixelSize) return 0.5;
  const { width, height } = prepared.pixelSize;
  if (width <= 0 || height <= 0) return 0.5;
  const naturalWidth = width * PT_PER_BP;
  const naturalHeight = height * PT_PER_BP;
  if (naturalWidth <= 0.5 * textArea.width && naturalHeight <= maxHeight) return null;
  const fraction = Math.min(0.5, maxHeight / (textArea.width * (height / width)));
  return Math.max(0.1, Math.floor(fraction * 20) / 20);
}

async function identicalFiles(directory: string, listing: GraphicsFolderListing, prepared: PreparedGraphics): Promise<Set<string>> {
  const read = getActiveEditorPlatform().files?.readLocalAsset;
  const identical = new Set<string>();
  if (!read) return identical;
  const candidates = listing.files.filter((file) => file.size === prepared.bytes.byteLength && file.path.toLowerCase().endsWith(prepared.extension)).slice(0, 16);
  for (const file of candidates) {
    const result = await read(joinNative(directory, file.path));
    if (result.status !== "ok") continue;
    const bytes = new Uint8Array(graphicBytesFromBase64(result.bytesBase64));
    if (sameBytes(prepared.bytes, bytes)) identical.add(file.path);
  }
  return identical;
}

/** A MIME type for a file name, for decoders that go by it. */
export function graphicsMimeType(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf", svg: "image/svg+xml",
    heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" };
  return types[extension] ?? "";
}

type PlacedGraphics = { texPath: string; notice: Omit<GraphicsNotice, "id" | "sourceAfter" | "texPath"> };

/**
 * Put the image where the document keeps images and return how to name it:
 * a file already in the project is linked where it is; anything else is
 * written into the planned folder; with no folder to write to, the image
 * stays in browser storage.
 */
export async function placeGraphicsFile(params: {
  source: string;
  /** Where in the source the reference goes, for the nearest-image rule. */
  offset: number;
  documentId: string;
  documentRef: DocumentFileRef | null;
  input: GraphicsInput;
  prepared: PreparedGraphics;
  name: string;
}): Promise<PlacedGraphics | { error: string }> {
  const { source, offset, documentId, documentRef, input, prepared, name } = params;
  const platform = getActiveEditorPlatform();
  const files = platform.files;
  const directory = documentRef?.provider === "desktop-fs" && documentRef.path ? dirname(documentRef.path) : null;
  if (!directory || !files?.listGraphicsFiles || !files.writeGraphicsFile) {
    const texPath = importedGraphicPath(`${name.replace(/\.[A-Za-z0-9]+$/u, "")}${prepared.extension}`);
    if (files?.storeGraphicAsset) await files.storeGraphicAsset({ path: texPath, bytes: prepared.bytes });
    else storeImportedGraphic(platform.persistence, { path: texPath, payload: graphicBytesBase64(prepared.bytes) });
    return { texPath, notice: { documentId, kind: "browser", fileName: basename(texPath), folderLabel: "", createdFolder: null, absolutePath: null,
      size: prepared.bytes.byteLength, createdDirectories: [], compileDirectory: null } };
  }
  const listing = await files.listGraphicsFiles(directory);
  const folderLabel = (folder: string) => folder === "" ? `${basename(directory)}/` : `${folder}/`;

  // A file picked from inside the project is referenced where it is.
  const relative = input.path && !prepared.converted
    ? replacementGraphicPath({ kind: "file", name: basename(input.path), path: input.path, provider: "desktop-fs" }, documentRef)
    : null;
  if (relative !== null && isInside(relative)) {
    const plan = planGraphicsFileName(source, { folder: dirname(relative), reason: "nearest" }, basename(relative), extensionOf(relative),
      { files: [...listing.files, { path: relative }] }, new Set([relative]));
    return { texPath: plan.texPath, notice: { documentId, kind: "linked", fileName: basename(relative), folderLabel: folderLabel(dirname(relative)),
      createdFolder: null, absolutePath: input.path ?? null, size: prepared.bytes.byteLength, createdDirectories: [], compileDirectory: directory } };
  }

  const identical = await identicalFiles(directory, listing, prepared);
  let choice = planGraphicsFolder(source, offset, listing);
  // The same picture elsewhere in the project (dragged in from there): link it.
  const elsewhere = [...identical].find((path) => dirname(path) !== choice.folder);
  if (elsewhere !== undefined && ![...identical].some((path) => dirname(path) === choice.folder)) choice = { ...choice, folder: dirname(elsewhere) };
  const plan = planGraphicsFileName(source, choice, name, prepared.extension, listing, identical);
  const absolutePath = joinNative(directory, plan.path);
  let createdDirectories: string[] = [];
  if (!plan.reuse) {
    const written = await files.writeGraphicsFile(absolutePath, prepared.bytes);
    if (written.status === "exists") return { error: `${basename(plan.path)} already exists.` };
    createdDirectories = written.createdDirectories;
  }
  const outermost = createdDirectories[0];
  return { texPath: plan.texPath, notice: {
    documentId, kind: plan.reuse ? "linked" : "saved", fileName: basename(plan.path), folderLabel: folderLabel(plan.folder),
    createdFolder: outermost ? outermost.slice(directory.length).replace(/^[\\/]+/u, "").replaceAll("\\", "/") : null,
    absolutePath, size: prepared.bytes.byteLength, createdDirectories, compileDirectory: directory,
  } };
}

/** The name to save an image under: its own, unless generic, else the slide's. */
export function graphicsFileName(input: GraphicsInput, source: string, frameId: string): string {
  const given = input.name?.trim() ?? "";
  return given && !GENERIC_NAME.test(given) ? given : slideImageName(source, frameId);
}

function extensionOf(path: string): string {
  const name = basename(path);
  return name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
}

/** Insert → Image…: the system file panel, then insertion. */
export async function pickAndInsertDeckGraphics(getState: () => EditorState, dispatch: (action: EditorAction) => void): Promise<void> {
  const picker = getActiveEditorPlatform().files?.openBinary;
  if (!picker) return;
  await insertDeckGraphics({ getState, dispatch, load: async () => {
    const opened = await picker({ addToRecent: false, kind: "graphics-import" });
    if (!opened) return null;
    const name = opened.fileRef?.name ?? null;
    return { bytes: opened.bytes, name, mimeType: name ? graphicsMimeType(name) : "", path: opened.fileRef?.provider === "desktop-fs" ? opened.fileRef.path ?? null : null };
  } });
}

export async function insertDeckGraphics(params: {
  getState: () => EditorState;
  dispatch: (action: EditorAction) => void;
  /** Reads the image once the place on the slide is known; null when cancelled. */
  load: () => Promise<GraphicsInput | null>;
}): Promise<"applied" | "stale" | "cancelled" | "failed"> {
  const state = params.getState();
  const frame = state.snapshot.deck?.activeFrame;
  const documentId = state.activeDocumentId;
  if (!frame || state.snapshot.source !== state.source || state.documents[documentId]?.assistantLockReason) return "stale";
  const source = state.source;

  // Where it goes on the slide, read before anything waits: the caret closes its session.
  const caret = takeDeckCaret();
  let placement: BeamerGraphicsPlacement = { kind: "end" };
  let offset = scanBeamerDocument(source).frames.find((candidate) => candidate.id === frame.frameId)?.bodySpan.to ?? 0;
  const selection = state.deckObjectSelection;
  if (caret?.documentId === documentId && caret.frameId === frame.frameId) {
    placement = { kind: "caret", offset: caret.offset };
    offset = caret.offset;
  } else if (selection?.frameId === frame.frameId && selection.objectId) {
    const node = buildBeamerObjectIndex({ items: frame.layout.items, paragraphs: frame.layout.paragraphs, source }).byId.get(selection.objectId);
    if (node) {
      placement = { kind: "after", span: node.sourceSpan };
      offset = node.sourceSpan.to;
    }
  }

  const session = beginDocumentEdit(state);
  const platform = getActiveEditorPlatform();
  const fail = (message: string) => { showError(documentId, message); return "failed" as const; };
  try {
    const input = await params.load();
    if (!input) return "cancelled";
    const prepared = await prepareGraphics(input.bytes, input.mimeType);
    const name = graphicsFileName(input, source, frame.frameId);

    const placed = await placeGraphicsFile({ source, offset, documentId, documentRef: state.documents[documentId]?.fileRef ?? null, input, prepared, name });
    if ("error" in placed) return fail(placed.error);
    const { texPath, notice } = placed;

    const current = params.getState();
    if (!canContinueDocumentEdit(session, current) || current.snapshot.deck?.activeFrame?.frameId !== frame.frameId || getActiveEditorPlatform() !== platform) {
      await undoWrite(notice);
      return "stale";
    }
    const action = { kind: "deckInsertGraphics", frameId: frame.frameId, path: texPath, widthFraction: insertionWidth(prepared, frame.layout.page.textArea), placement } as const;
    const result = applyDeckEditAction(session.latestSource, frame.layout, action);
    if (result.kind !== "success") {
      await undoWrite(notice);
      return fail(result.kind === "unsupported" ? result.reason : "The image could not be inserted.");
    }
    const patch = result.patches[0];
    if (patch) requestDeckReselect({ frameId: frame.frameId, kind: "graphics", span: patch.newSpan, source: result.newSource });
    params.dispatch({ type: "APPLY_EDIT_ACTION", documentId, action, precomputedSource: session.latestSource,
      precomputedResult: result, expectedDocumentRevision: { documentId, sourceRevision: session.latestRevision } });
    showGraphicsNotice({ texPath, notice }, result.newSource);
    return "applied";
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The image could not be inserted.");
  }
}

export function showGraphicsNotice(placed: PlacedGraphics, sourceAfter: string): void {
  useGraphicsNoticeStore.getState().show({ ...placed.notice, id: nextNoticeId++, texPath: placed.texPath, sourceAfter });
}

/** Remove what placing wrote, when the edit it was for did not happen. */
export async function discardPlacedGraphics(notice: PlacedGraphics["notice"]): Promise<void> {
  await undoWrite(notice);
}

async function undoWrite(notice: Pick<GraphicsNotice, "kind" | "absolutePath" | "size" | "createdDirectories">): Promise<void> {
  if (notice.kind !== "saved" || !notice.absolutePath) return;
  await getActiveEditorPlatform().files?.removeGraphicsFile?.(notice.absolutePath, notice.size, notice.createdDirectories);
}

function currentSource(getState: () => EditorState, documentId: string): string | null {
  return getState().documents[documentId]?.source ?? null;
}

/** Undo the source edit; its image must remain available to Redo. */
export function undoGraphicsInsertion(notice: GraphicsNotice, getState: () => EditorState, dispatch: (action: EditorAction) => void): void {
  const store = useGraphicsNoticeStore.getState();
  if (currentSource(getState, notice.documentId) !== notice.sourceAfter || getState().activeDocumentId !== notice.documentId) { store.dismiss(notice.id); return; }
  dispatch({ type: "UNDO" });
  store.dismiss(notice.id);
}

/** Save at the chosen location and rename the reference, retaining the old file for Undo. */
export async function changeGraphicsLocation(notice: GraphicsNotice, getState: () => EditorState, dispatch: (action: EditorAction) => void): Promise<void> {
  const platform = getActiveEditorPlatform();
  const files = platform.files;
  const state = getState();
  const document = state.documents[notice.documentId];
  if (notice.kind !== "saved" || !notice.absolutePath || !notice.compileDirectory || !files?.chooseGraphicsLocation || !files.readLocalAsset || !files.writeGraphicsFile ||
    state.activeDocumentId !== notice.documentId || document?.source !== notice.sourceAfter || document.assistantLockReason) return;
  const session = beginDocumentEdit(state);
  const stale = () => {
    const latest = getState();
    const latestDocument = latest.documents[notice.documentId];
    return !canContinueDocumentEdit(session, latest) || getActiveEditorPlatform() !== platform ||
      latestDocument?.fileRef?.path !== document.fileRef?.path || latestDocument?.assistantLockReason != null;
  };
  try {
    const extension = notice.fileName.slice(notice.fileName.lastIndexOf(".") + 1);
    const chosen = await files.chooseGraphicsLocation(dirname(notice.absolutePath), notice.fileName, extension);
    if (!chosen || chosen === notice.absolutePath || stale()) return;
    const target = chosen.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? chosen : `${chosen}.${extension}`;
    const source = session.latestSource;
    // The reference this insertion wrote, by its text.
    const reference = analyzeSimpleTexResources(source).graphics.find((graphic) => graphic.filename === notice.texPath);
    if (!reference) return;
    const relative = replacementGraphicPath({ kind: "file", name: basename(target), path: target, provider: "desktop-fs" }, document.fileRef ?? null);
    if (!relative || /[\\{}%#$^&~]/u.test(relative.replace(/\\/gu, "/"))) { showError(notice.documentId, "That name cannot be written in TeX."); return; }
    const read = await files.readLocalAsset(notice.absolutePath);
    if (stale()) return;
    if (read.status !== "ok") { showError(notice.documentId, "The image file could not be read."); return; }
    const bytes = graphicBytesFromBase64(read.bytesBase64);
    const listing = files.listGraphicsFiles ? await files.listGraphicsFiles(notice.compileDirectory) : { files: [] };
    const relativeFolder = dirname(relative);
    // Name it as the document names images, reusing the planner's rules.
    const plan = isInside(relative)
      ? planGraphicsFileName(source, { folder: relativeFolder, reason: "nearest" }, basename(relative), basename(relative).slice(basename(relative).lastIndexOf(".")),
        { files: [...listing.files, { path: relative }] }, new Set([relative]))
      : null;
    const texPath = plan?.reuse ? plan.texPath : relative;
    if (stale()) return;
    // Both paths can appear in source history. A destructive move would make
    // Undo restore a missing image; keep each committed location available.
    const written = await files.writeGraphicsFile(target, bytes);
    if (written.status === "exists") { showError(notice.documentId, `${basename(target)} already exists.`); return; }
    if (stale()) {
      await files.removeGraphicsFile?.(target, bytes.byteLength, written.createdDirectories);
      return;
    }
    const span = { from: reference.filenameStart, to: reference.filenameEnd };
    dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: notice.documentId, baseRevision: session.latestRevision, changedSourceIds: [],
      patches: [{ oldSpan: span, newSpan: { from: span.from, to: span.from + texPath.length }, replacement: userText(texPath, "inspector-value") }] });
    const sourceAfter = source.slice(0, span.from) + texPath + source.slice(span.to);
    useGraphicsNoticeStore.getState().show({ ...notice, id: nextNoticeId++, texPath, sourceAfter, absolutePath: target, fileName: basename(target),
      folderLabel: isInside(relative) ? (relativeFolder === "" ? `${basename(notice.compileDirectory)}/` : `${relativeFolder}/`) : `${basename(dirname(target))}/`,
      size: bytes.byteLength, createdFolder: null, createdDirectories: written.createdDirectories });
  } catch (error) {
    showError(notice.documentId, error instanceof Error ? error.message : "The image could not be saved at the new location.");
  }
}

function isInside(relative: string): boolean {
  return !relative.startsWith("../") && !relative.startsWith("/") && !/^[A-Za-z]:/u.test(relative);
}
