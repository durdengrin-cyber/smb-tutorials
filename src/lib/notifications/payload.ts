import type { NotificationPayload } from "./port";

export const REQUEST_TAG = "session-request";

// What a teacher reads on a lock screen. Short, names the student and the
// subject, and says nothing that would be wrong by the time they look —
// deliberately no countdown, because a notification cannot tick.
export function requestPayload(
  studentName: string,
  subject: string
): NotificationPayload {
  return {
    title: "New session request",
    body: `${studentName} · ${subject}`,
    url: "/dashboard",
    tag: REQUEST_TAG,
  };
}
