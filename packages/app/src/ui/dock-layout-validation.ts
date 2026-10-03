import type { IJsonModel } from "flexlayout-react";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasOptionalString(node: Record<string, unknown>, key: string): boolean {
  return node[key] === undefined || typeof node[key] === "string";
}

function isTab(value: unknown): boolean {
  return isRecord(value) &&
    (value.type === undefined || value.type === "tab") &&
    value.children === undefined &&
    hasOptionalString(value, "id") && hasOptionalString(value, "name") &&
    hasOptionalString(value, "component");
}

function isRow(value: unknown): boolean {
  if (!isRecord(value) || (value.type !== undefined && value.type !== "row") ||
    !hasOptionalString(value, "id") || !Array.isArray(value.children)) return false;
  return value.children.every((child: unknown) => {
    if (!isRecord(child)) return false;
    if (child.type === "tabset") {
      return hasOptionalString(child, "id") && hasOptionalString(child, "name") &&
        Array.isArray(child.children) && child.children.every(isTab);
    }
    return isRow(child);
  });
}

/** Validate the recursive structure consumed by FlexLayout, allowing unknown panel names. */
export function isDockLayoutJson(value: unknown): value is IJsonModel {
  if (!isRecord(value) || !isRow(value.layout)) return false;
  if (value.global !== undefined && !isRecord(value.global)) return false;
  if (value.borders !== undefined && (!Array.isArray(value.borders) ||
    !value.borders.every((border: unknown) => isRecord(border) &&
      (border.type === undefined || border.type === "border") &&
      typeof border.location === "string" && ["top", "bottom", "left", "right"].includes(border.location) &&
      Array.isArray(border.children) && border.children.every(isTab)))) return false;
  if (value.popouts !== undefined && (!isRecord(value.popouts) ||
    !Object.values(value.popouts).every((popout: unknown) => {
      if (!isRecord(popout) || !isRow(popout.layout) || !isRecord(popout.rect)) return false;
      const rect = popout.rect;
      return ["x", "y", "width", "height"].every((key) =>
        typeof rect[key] === "number" && Number.isFinite(rect[key]));
    }))) return false;
  return true;
}
