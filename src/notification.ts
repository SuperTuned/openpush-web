/** A website button of a push. */
export interface NotificationButton {
  id: string;
  title: string;
  /** Where a click on this button goes, after URL resolution. */
  url: string;
  icon?: string;
}

/** The notification object page listeners receive. Read-only, built from the payload. */
export interface OpenPushNotification {
  /** The message id. */
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly icon: string | null;
  readonly image: string | null;
  readonly badge: string | null;
  /** The deep link after URL resolution. */
  readonly url: string;
  /** At most 2. */
  readonly buttons: readonly NotificationButton[];
  readonly topic: string | null;
  /** The message's custom data. */
  readonly data: Readonly<Record<string, unknown>>;
  /** Worker time, milliseconds since the epoch. */
  readonly receivedAt: number;
}

/** Payload of a click listener. `actionId` is "" for a click on the body. */
export interface NotificationClickEvent {
  notification: OpenPushNotification;
  result: { actionId: string; url: string };
}

/** Payload of a foreground lifecycle listener. */
export interface NotificationWillDisplayEvent {
  notification: OpenPushNotification;
  /** Asks the browser not to show it. Chromium and Firefox only; Safari always shows it. */
  preventDefault(): void;
  /** Shows it after all (after `preventDefault`). */
  display(): void;
}

/** Payload of a dismiss listener. */
export interface NotificationDismissEvent {
  notification: OpenPushNotification;
}
