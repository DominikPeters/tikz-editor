import { requireArrayValue } from "../utils/collections.js";
export function upsertPartOrder(
  currentOrder: readonly string[],
  partId: string,
  afterPartId: string | null
): string[] {
  const withoutPart = currentOrder.filter((id) => id !== partId);
  const insertionIndex =
    afterPartId == null
      ? 0
      : (() => {
          const anchorIndex = withoutPart.indexOf(afterPartId);
          return anchorIndex >= 0 ? anchorIndex + 1 : withoutPart.length;
        })();
  const nextOrder = [...withoutPart];
  nextOrder.splice(insertionIndex, 0, partId);
  return nextOrder;
}

export function removePartOrder(
  currentOrder: readonly string[],
  partId: string
): string[] {
  return currentOrder.filter((id) => id !== partId);
}

export function nextPartIdInOrder(
  order: readonly string[],
  partId: string
): string | null {
  const index = order.indexOf(partId);
  if (index < 0 || index + 1 >= order.length) {
    return null;
  }
  return requireArrayValue(order, index + 1);
}
