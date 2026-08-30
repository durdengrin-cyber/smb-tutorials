// The whole transport surface this cycle needs. Anything a push service does
// beyond this is not our concern; anything we need beyond this is a change to
// the port, deliberately, in one place — the same rule payments/port.ts sets.
//
// This interface is the App Store seam (spec §8.1, §10): an APNs or FCM
// adapter slots in here with no caller change.

export interface DeviceSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  // A fixed tag per notification kind, so a second request replaces the first
  // instead of stacking. There is no dismissal push available to us —
  // userVisibleOnly is mandatory — so replacement is the only tidying we get.
  tag: string;
}

// `gone` is the ONLY reason a device row is ever deleted. Everything else is
// transient: a 500 from a push service must not cost a teacher their
// reachability.
export type SendResult =
  | { ok: true }
  | { ok: false; gone: boolean; status?: number; error: string };

export interface NotificationPort {
  readonly transport: "webpush";
  send(sub: DeviceSubscription, payload: NotificationPayload): Promise<SendResult>;
}
