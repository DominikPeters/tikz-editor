export type UiNotification = {
  id: number;
  kind: "error";
  message: string;
};

type Listener = () => void;

let nextNotificationId = 1;
let currentNotification: UiNotification | null = null;
const listeners = new Set<Listener>();

export function publishUiError(message: string): number {
  const id = nextNotificationId;
  nextNotificationId += 1;
  currentNotification = { id, kind: "error", message };
  for (const listener of listeners) {
    listener();
  }
  return id;
}

export function dismissUiNotification(id?: number): void {
  if (!currentNotification || (id != null && currentNotification.id !== id)) {
    return;
  }
  currentNotification = null;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeUiNotifications(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getUiNotificationSnapshot(): UiNotification | null {
  return currentNotification;
}
