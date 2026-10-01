import { cleanupIdiomaticPropertyWrites } from "@tikz-editor/core/edit/property-write-planner";
import type { EditActionResult } from "@tikz-editor/core/edit/actions";

export type PropertyCleanupRequest = { requestId: number; source: string; elementIds: string[]; activeFigureId?: string | null };
export type PropertyCleanupResponse = { requestId: number; result: EditActionResult | null };

const workerContext = self as unknown as {
  onmessage: ((event: MessageEvent<PropertyCleanupRequest>) => void) | null;
  postMessage: (result: PropertyCleanupResponse) => void;
};
workerContext.onmessage = ({ data }) => {
  try {
    workerContext.postMessage({ requestId: data.requestId, result: cleanupIdiomaticPropertyWrites(data.source,
      { activeFigureId: data.activeFigureId, propertyWriteMode: "drag-end" }, data.elementIds) });
  } catch {
    // Cleanup is optional; the source written during the gesture is valid.
    workerContext.postMessage({ requestId: data.requestId, result: null });
  }
};
