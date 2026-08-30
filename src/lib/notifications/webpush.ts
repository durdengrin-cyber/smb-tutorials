import webpush from "web-push";
import type {
  DeviceSubscription,
  NotificationPayload,
  NotificationPort,
  SendResult,
} from "./port";

// We do NOT hand-roll the crypto. RFC 8291 payload encryption and RFC 8292
// VAPID signing are exactly the code nobody should write themselves, and the
// port means swapping this file later is one branch in index.ts.
//
// Consequently the tests here cover what WE wrote — the status mapping, the
// payload, the config wiring — and not the library's ciphertext. Asserting
// someone else's RFC vectors and calling it our coverage would be theatre
// (spec §9.3).
export function webPushPort(
  publicKey: string,
  privateKey: string,
  subject: string
): NotificationPort {
  // Fail at construction, not at the first send. A missing key discovered
  // when a student is already waiting is a silent outage on the road that
  // exists to survive outages.
  if (!publicKey) throw new Error("VAPID public key is missing");
  if (!privateKey) throw new Error("VAPID private key is missing");
  if (!subject) throw new Error("VAPID subject is missing");

  webpush.setVapidDetails(subject, publicKey, privateKey);

  return {
    transport: "webpush",
    async send(
      sub: DeviceSubscription,
      payload: NotificationPayload
    ): Promise<SendResult> {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload)
        );
        return { ok: true };
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410 mean the push service has forgotten this subscription — the
        // only death signal there is. Anything else, including a network
        // throw with no status at all, is transient by default: deleting a
        // device on a 500 would quietly un-reach a teacher who did nothing
        // wrong.
        const gone = status === 404 || status === 410;
        return {
          ok: false,
          gone,
          status,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}
