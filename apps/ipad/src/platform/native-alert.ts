import { invoke } from "@tauri-apps/api/core";

export type NativeAlertButton = {
  title: string;
  style?: "default" | "cancel" | "destructive";
  /** Bold, and triggered by Return on a hardware keyboard. */
  preferred?: boolean;
};

/** A UIAlertController; resolves to the index of the tapped button. */
export function nativeAlert(title: string, message: string | null, buttons: NativeAlertButton[]): Promise<number> {
  return invoke<number>("ipad_alert", { title, message, buttons });
}
