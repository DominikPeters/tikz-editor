export type AssistantComposerImageAttachment = {
  id: string;
  blob: Blob;
  mimeType: string;
  fileName: string;
  previewUrl: string;
};

export type PreparedAssistantImageAttachment = {
  blob: Blob;
  mimeType: string;
  fileName: string;
};

const DEFAULT_MAX_EDGE_PX = 2048;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export type NormalizeAssistantImageOptions = {
  maxEdgePx?: number;
  maxBytes?: number;
};

export function fitImageSize(width: number, height: number, maxEdgePx = DEFAULT_MAX_EDGE_PX): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const edge = Math.max(safeWidth, safeHeight);
  if (edge <= maxEdgePx) {
    return { width: safeWidth, height: safeHeight };
  }
  const scale = maxEdgePx / edge;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  };
}

export function chooseAttachmentMimeType(): "image/png" {
  return "image/png";
}

export function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === "image/png") {
    return "png";
  }
  if (normalized === "image/jpeg" || normalized === "image/jpg") {
    return "jpg";
  }
  if (normalized === "image/webp") {
    return "webp";
  }
  if (normalized === "image/gif") {
    return "gif";
  }
  return "img";
}

export function attachmentFileNameFor(sourceName: string | undefined, mimeType: string, index: number): string {
  const ext = extensionForMimeType(mimeType);
  const rawStem = (sourceName ?? "pasted-image").trim().replace(/\.[A-Za-z0-9]+$/, "");
  const stem = rawStem
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || `pasted-image-${index + 1}`;
  return `${stem}.${ext}`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function normalizePastedImageForAssistant(
  file: File,
  index: number,
  options: NormalizeAssistantImageOptions = {}
): Promise<PreparedAssistantImageAttachment> {
  const maxEdgePx = options.maxEdgePx ?? DEFAULT_MAX_EDGE_PX;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  if (typeof document === "undefined") {
    const mimeType = "image/png";
    return {
      blob: file,
      mimeType,
      fileName: attachmentFileNameFor(file.name, mimeType, index)
    };
  }

  const image = await loadImageElement(file);
  const mimeType = chooseAttachmentMimeType();
  let nextSize = fitImageSize(image.naturalWidth || image.width || 1, image.naturalHeight || image.height || 1, maxEdgePx);

  let bestBlob = await renderImageBlob(image, nextSize.width, nextSize.height, mimeType);

  if (bestBlob.size > maxBytes) {
    let scale = 0.85;
    for (let attempt = 0; attempt < 6 && bestBlob.size > maxBytes; attempt += 1) {
      nextSize = {
        width: Math.max(256, Math.round(nextSize.width * scale)),
        height: Math.max(256, Math.round(nextSize.height * scale))
      };
      bestBlob = await renderImageBlob(image, nextSize.width, nextSize.height, mimeType);
      scale = Math.max(0.7, scale - 0.03);
    }
  }

  return {
    blob: bestBlob,
    mimeType,
    fileName: attachmentFileNameFor(file.name, mimeType, index)
  };
}

function loadImageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode pasted image."));
    };
    image.src = url;
  });
}

function renderImageBlob(
  image: CanvasImageSource,
  width: number,
  height: number,
  mimeType: "image/png"
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas 2D context unavailable."));
      return;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to serialize pasted image."));
        return;
      }
      resolve(blob);
    }, mimeType);
  });
}
