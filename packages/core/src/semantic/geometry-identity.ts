import type { SceneElement } from "./types.js";

// A token owns geometry-only caches without retaining an older source revision.
// Source rebinding explicitly carries it forward; newly evaluated geometry gets
// a new token, even when it happens to have the same source or scene ID.
const identities = new WeakMap<SceneElement, object>();

export function sceneGeometryIdentity(element: SceneElement): object {
  let identity = identities.get(element);
  if (!identity) {
    identity = {};
    identities.set(element, identity);
  }
  return identity;
}

export function inheritSceneGeometry<T extends SceneElement>(previous: SceneElement, next: T): T {
  identities.set(next, sceneGeometryIdentity(previous));
  return next;
}
