/**
 * The notification object compat listeners receive: built from
 * `OpenPushNotification` with the reference's field names.
 */
import type { OpenPushNotification } from "../notification";

export interface CompatActionButton {
  actionId: string;
  text: string;
  icon?: string;
  launchURL: string;
}

export interface CompatNotification {
  notificationId: string;
  title: string;
  body: string;
  icon?: string;
  image?: string;
  launchURL: string;
  additionalData: Record<string, unknown>;
  actionButtons: CompatActionButton[];
  /** Foreground listeners only: shows a notification held back with `preventDefault()`. */
  display?: () => void;
}

export function toCompatNotification(n: OpenPushNotification, display?: () => void): CompatNotification {
  const out: CompatNotification = {
    notificationId: n.id,
    title: n.title,
    body: n.body,
    launchURL: n.url,
    additionalData: { ...n.data },
    actionButtons: n.buttons.map((b) => {
      const button: CompatActionButton = { actionId: b.id, text: b.title, launchURL: b.url };
      if (b.icon) button.icon = b.icon;
      return button;
    }),
  };
  if (n.icon) out.icon = n.icon;
  if (n.image) out.image = n.image;
  if (display) out.display = display;
  return out;
}
