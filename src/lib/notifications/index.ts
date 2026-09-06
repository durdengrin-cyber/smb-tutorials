// Enforces what this module's placement only implies: importing it from a
// client component is now a BUILD failure, not a secret inlined into a
// browser bundle. See src/lib/server-secrets.test.ts.
import "server-only";

import type { NotificationPort } from "./port";
import { webPushPort } from "./webpush";

export * from "./port";
export * from "./payload";

// The single place any caller obtains a port, mirroring payments/index.ts.
// Adding APNs or FCM means one branch here and one adapter file.
export function getNotificationPort(): NotificationPort {
  return webPushPort(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
    process.env.VAPID_PRIVATE_KEY ?? "",
    process.env.VAPID_SUBJECT ?? ""
  );
}
