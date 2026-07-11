import { renderTikzToSvg } from "@tikz-editor/core/render/index";
import { serializeSvgModel, serializeSvgModelAsync } from "@tikz-editor/core/svg/index";

// Chromium custom clipboard formats require the "web " prefix.
export const TIKZ_CLIPBOARD_MIME = "web application/x-tikz-editor+json";
export const PLAIN_TEXT_CLIPBOARD_MIME = "text/plain";
export const SVG_CLIPBOARD_MIME = "image/svg+xml";

export type ClipboardPasteBehavior = "offset" | "preserve";

export type TikzClipboardPayload = {
  version: 1;
  snippets: string[];
  plainText: string;
  pasteBehavior: ClipboardPasteBehavior;
  pasteCount: number;
};

export type ClipboardReadFailureReason = "unavailable" | "blocked" | "empty" | "invalid";

function logClipboardDebug(message: string, detail?: Record<string, unknown>): void {
  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }
  if (detail) {
    console.info(`[tikz-editor] ${message}`, detail);
    return;
  }
  console.info(`[tikz-editor] ${message}`);
}

export function snippetsToPlainText(snippets: readonly string[]): string {
  return snippets.join("\n");
}

export function parseTikzSnippetsFromPlainText(plainText: string): string[] {
  const normalized = plainText.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const snippets: string[] = [];
  let current = "";
  for (const line of lines) {
    const trimmedRight = line.trimEnd();
    if (current.length > 0) {
      current += "\n";
    }
    current += trimmedRight;

    if (trimmedRight.trim().endsWith(";")) {
      const snippet = current.trim();
      if (snippet.length > 0) {
        snippets.push(snippet);
      }
      current = "";
    }
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    snippets.push(trailing);
  }

  return snippets;
}

export function createClipboardPayload(
  snippets: readonly string[],
  pasteBehavior: ClipboardPasteBehavior,
  pasteCount = 0
): TikzClipboardPayload | null {
  const normalizedSnippets = snippets
    .map((snippet) => snippet.replace(/\r\n?/g, "\n").trim())
    .filter((snippet) => snippet.length > 0);
  if (normalizedSnippets.length === 0) {
    return null;
  }
  return {
    version: 1,
    snippets: normalizedSnippets,
    plainText: snippetsToPlainText(normalizedSnippets),
    pasteBehavior,
    pasteCount: Math.max(0, Math.floor(pasteCount))
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseClipboardPayloadJson(raw: string): TikzClipboardPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TikzClipboardPayload> | null;
    if (parsed?.version !== 1 || !Array.isArray(parsed.snippets)) {
      return null;
    }
    const snippets = parsed.snippets
      .filter((snippet): snippet is string => typeof snippet === "string")
      .map((snippet) => snippet.replace(/\r\n?/g, "\n").trim())
      .filter((snippet) => snippet.length > 0);
    if (snippets.length === 0) {
      return null;
    }
    const pasteBehavior: ClipboardPasteBehavior = parsed.pasteBehavior === "preserve" ? "preserve" : "offset";
    const pasteCount = typeof parsed.pasteCount === "number" && Number.isFinite(parsed.pasteCount)
      ? Math.max(0, Math.floor(parsed.pasteCount))
      : 0;
    const plainText = typeof parsed.plainText === "string" && parsed.plainText.trim().length > 0
      ? parsed.plainText.replace(/\r\n?/g, "\n")
      : snippetsToPlainText(snippets);
    return {
      version: 1,
      snippets,
      plainText,
      pasteBehavior,
      pasteCount
    };
  } catch (error) {
    logClipboardDebug("Clipboard payload JSON parse failed.", { error: describeError(error) });
    return null;
  }
}

export function parseClipboardPayloadFromPlainText(plainText: string): TikzClipboardPayload | null {
  const snippets = parseTikzSnippetsFromPlainText(plainText);
  return createClipboardPayload(snippets, "offset", 0);
}

export function readClipboardPayloadFromDataTransfer(
  dataTransfer: DataTransfer | null
): { kind: "success"; payload: TikzClipboardPayload } | { kind: "failure"; reason: "empty" | "invalid" } {
  if (!dataTransfer) {
    return { kind: "failure", reason: "empty" };
  }

  const customRaw = dataTransfer.getData(TIKZ_CLIPBOARD_MIME);
  if (customRaw) {
    const customPayload = parseClipboardPayloadJson(customRaw);
    if (customPayload) {
      return { kind: "success", payload: customPayload };
    }
    return { kind: "failure", reason: "invalid" };
  }

  const plainText = dataTransfer.getData(PLAIN_TEXT_CLIPBOARD_MIME);
  if (!plainText) {
    return { kind: "failure", reason: "empty" };
  }
  const plainPayload = parseClipboardPayloadFromPlainText(plainText);
  if (!plainPayload) {
    return { kind: "failure", reason: "invalid" };
  }
  return { kind: "success", payload: plainPayload };
}

export async function readClipboardPayloadFromSystemClipboard(): Promise<
  { kind: "success"; payload: TikzClipboardPayload } | { kind: "failure"; reason: ClipboardReadFailureReason }
> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return { kind: "failure", reason: "unavailable" };
  }

  if (typeof navigator.clipboard.read === "function") {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes(TIKZ_CLIPBOARD_MIME)) {
          const blob = await item.getType(TIKZ_CLIPBOARD_MIME);
          const raw = await blob.text();
          const payload = parseClipboardPayloadJson(raw);
          if (payload) {
            return { kind: "success", payload };
          }
          return { kind: "failure", reason: "invalid" };
        }
      }

      for (const item of items) {
        if (item.types.includes(PLAIN_TEXT_CLIPBOARD_MIME)) {
          const blob = await item.getType(PLAIN_TEXT_CLIPBOARD_MIME);
          const plainText = await blob.text();
          const payload = parseClipboardPayloadFromPlainText(plainText);
          if (payload) {
            return { kind: "success", payload };
          }
          return { kind: "failure", reason: "invalid" };
        }
      }

      return { kind: "failure", reason: "empty" };
    } catch (error) {
      logClipboardDebug("Clipboard read failed or was blocked.", { error: describeError(error) });
      return { kind: "failure", reason: "blocked" };
    }
  }

  if (typeof navigator.clipboard.readText === "function") {
    try {
      const plainText = await navigator.clipboard.readText();
      const payload = parseClipboardPayloadFromPlainText(plainText);
      if (payload) {
        return { kind: "success", payload };
      }
      return { kind: "failure", reason: "invalid" };
    } catch (error) {
      logClipboardDebug("Clipboard readText failed or was blocked.", { error: describeError(error) });
      return { kind: "failure", reason: "blocked" };
    }
  }

  return { kind: "failure", reason: "unavailable" };
}

export async function buildSelectionSvg(snippets: readonly string[]): Promise<string | null> {
  const normalized = snippets
    .map((snippet) => snippet.replace(/\r\n?/g, "\n").trim())
    .filter((snippet) => snippet.length > 0);
  if (normalized.length === 0) {
    return null;
  }

  const source = `\\begin{tikzpicture}\n${normalized.join("\n")}\n\\end{tikzpicture}`;
  try {
    const rendered = renderTikzToSvg(source);
    return await serializeSvgModelAsync(rendered.svg.model, {
      includeXmlns: true,
      pretty: true
    });
  } catch (error) {
    logClipboardDebug("Failed to render selection SVG for clipboard payload.", { error: describeError(error) });
    return null;
  }
}

export function buildSelectionSvgSync(snippets: readonly string[]): string | null {
  const normalized = snippets
    .map((snippet) => snippet.replace(/\r\n?/g, "\n").trim())
    .filter((snippet) => snippet.length > 0);
  if (normalized.length === 0) {
    return null;
  }

  const source = `\\begin{tikzpicture}\n${normalized.join("\n")}\n\\end{tikzpicture}`;
  try {
    const rendered = renderTikzToSvg(source);
    return serializeSvgModel(rendered.svg.model, true);
  } catch (error) {
    logClipboardDebug("Failed to render selection SVG synchronously for clipboard payload.", { error: describeError(error) });
    return null;
  }
}

export async function buildSelectionPngBase64(svgText: string | null): Promise<string | null> {
  if (
    typeof svgText !== "string" ||
    svgText.trim().length === 0 ||
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof Image === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function" ||
    typeof btoa !== "function"
  ) {
    return null;
  }

  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadSvgImage(svgUrl);
    const dimensions = parseSvgDimensions(svgText);
    const width = Math.max(1, Math.ceil((dimensions?.width ?? image.naturalWidth ?? image.width) * 4));
    const height = Math.max(1, Math.ceil((dimensions?.height ?? image.naturalHeight ?? image.height) * 4));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const pngBlob = await canvasToPngBlob(canvas);
    return await blobToBase64(pngBlob);
  } catch (error) {
    logClipboardDebug("Failed to render selection PNG for clipboard payload.", { error: describeError(error) });
    return null;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function parseSvgDimensions(svgText: string): { width: number; height: number } | null {
  if (typeof DOMParser === "undefined") {
    return null;
  }
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = parsed.documentElement;
  if (root?.nodeName.toLowerCase() !== "svg") {
    return null;
  }

  const viewBox = root.getAttribute("viewBox")?.trim();
  if (viewBox) {
    const values = viewBox.split(/[\s,]+/).map((value) => Number(value));
    const width = values[2];
    const height = values[3];
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }

  const width = parseSvgLength(root.getAttribute("width"));
  const height = parseSvgLength(root.getAttribute("height"));
  if (width != null && height != null) {
    return { width, height };
  }
  return null;
}

function parseSvgLength(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => { resolve(image); };
    image.onerror = () => { reject(new Error("Failed to decode SVG for clipboard PNG.")); };
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas PNG export returned no blob."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function writePayloadToDataTransfer(
  payload: TikzClipboardPayload,
  dataTransfer: DataTransfer | null,
  options: { svgText?: string | null } = {}
): boolean {
  if (!dataTransfer) {
    return false;
  }
  try {
    const customText = JSON.stringify(payload);
    dataTransfer.setData(TIKZ_CLIPBOARD_MIME, customText);
    dataTransfer.setData(PLAIN_TEXT_CLIPBOARD_MIME, payload.plainText);
    if (typeof options.svgText === "string" && options.svgText.trim().length > 0) {
      dataTransfer.setData(SVG_CLIPBOARD_MIME, options.svgText);
    }
    return true;
  } catch (error) {
    logClipboardDebug("Failed to write clipboard payload to DataTransfer.", { error: describeError(error) });
    return false;
  }
}

export async function writeClipboardPayload(
  payload: TikzClipboardPayload,
  options: { svgText?: string | null } = {}
): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    logClipboardDebug("Clipboard write unavailable: navigator.clipboard missing.");
    return false;
  }

  const customText = JSON.stringify(payload);
  const plainText = payload.plainText;
  const wantsSvg = typeof options.svgText === "string" && options.svgText.trim().length > 0;

  if (typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
    const writeMultiFormat = async (includeSvg: boolean): Promise<boolean> => {
      const itemEntries: Record<string, Blob> = {
        [TIKZ_CLIPBOARD_MIME]: new Blob([customText], { type: TIKZ_CLIPBOARD_MIME }),
        [PLAIN_TEXT_CLIPBOARD_MIME]: new Blob([plainText], { type: PLAIN_TEXT_CLIPBOARD_MIME })
      };
      if (includeSvg && typeof options.svgText === "string" && options.svgText.trim().length > 0) {
        itemEntries[SVG_CLIPBOARD_MIME] = new Blob([options.svgText], { type: SVG_CLIPBOARD_MIME });
      }
      await navigator.clipboard.write([new ClipboardItem(itemEntries)]);
      return true;
    };

    try {
      if (wantsSvg) {
        try {
          const didWrite = await writeMultiFormat(true);
          if (didWrite) {
            logClipboardDebug("Clipboard write succeeded with custom+text+svg payloads.", {
              snippets: payload.snippets.length,
              pasteBehavior: payload.pasteBehavior,
              pasteCount: payload.pasteCount
            });
          }
          return didWrite;
        } catch (error) {
          // Some browsers reject image/svg+xml in ClipboardItem; retry without SVG.
          logClipboardDebug("Clipboard write with SVG failed; retrying without SVG payload.", { error: describeError(error) });
          const didWriteWithoutSvg = await writeMultiFormat(false);
          if (didWriteWithoutSvg) {
            logClipboardDebug("Clipboard write succeeded after downgrading to custom+text payloads.", {
              snippets: payload.snippets.length,
              pasteBehavior: payload.pasteBehavior,
              pasteCount: payload.pasteCount
            });
          }
          return didWriteWithoutSvg;
        }
      }
      const didWrite = await writeMultiFormat(false);
      if (didWrite) {
        logClipboardDebug("Clipboard write succeeded with custom+text payloads.", {
          snippets: payload.snippets.length,
          pasteBehavior: payload.pasteBehavior,
          pasteCount: payload.pasteCount
        });
      }
      return didWrite;
    } catch (error) {
      // Fall through to writeText fallback.
      logClipboardDebug("ClipboardItem write failed; falling back to writeText.", { wantsSvg, error: describeError(error) });
    }
  }

  if (typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(plainText);
      logClipboardDebug("Clipboard writeText fallback succeeded.", {
        snippets: payload.snippets.length,
        wantsSvg
      });
      return true;
    } catch (error) {
      logClipboardDebug("Clipboard writeText fallback failed.", { error: describeError(error) });
      return false;
    }
  }

  logClipboardDebug("Clipboard write failed: no supported write method.");
  return false;
}
