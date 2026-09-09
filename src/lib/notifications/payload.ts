import type { NotificationPayload } from "./port";

export const REQUEST_TAG = "session-request";

// A fixed tag per kind, so a second application replaces the first rather than
// stacking — the same rule REQUEST_TAG follows.
export const APPLICATION_TAG = "teacher-application";

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

export function applicationPayload(
  name: string,
  subjectCount: number
): NotificationPayload {
  return {
    title: "New teacher application",
    body: `${name} applied to teach ${subjectCount} subject${subjectCount === 1 ? "" : "s"}.`,
    url: "/admin",
    tag: APPLICATION_TAG,
  };
}
