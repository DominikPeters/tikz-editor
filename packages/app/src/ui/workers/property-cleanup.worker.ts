import type { EditActionResult } from "@tikz-editor/core/edit/actions";
import type { PropertyCleanupTask } from "../../property-cleanup-request";
import { certifyPropertyCleanup } from "../../property-cleanup";

export type PropertyCleanupRequest = PropertyCleanupTask & { requestId: number };
export type PropertyCleanupResponse = { requestId: number; result: EditActionResult | null };

const workerContext = self as unknown as {
  onmessage: ((event: MessageEvent<PropertyCleanupRequest>) => void) | null;
  postMessage: (result: PropertyCleanupResponse) => void;
};
workerContext.onmessage = ({ data }) => {
  try {
    workerContext.postMessage({ requestId: data.requestId, result: certifyPropertyCleanup(data) });
  } catch {
    // Cleanup is optional; the source written during the edit is valid.
    workerContext.postMessage({ requestId: data.requestId, result: null });
  }
};
