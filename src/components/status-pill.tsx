// The four states a teacher can be in, fixed here so the frame and the
// reachability work (step 2) agree. "unreachable" has no mechanism behind it
// yet — it is rendered by nothing until availability becomes server-known —
// but the vocabulary is settled now so step 2 changes mechanism, not markup.
// Spec §7.
export type TeacherStatus = "offline" | "available" | "in_session" | "unreachable";

export const STATUS_COPY: Record<
  TeacherStatus,
  { label: string; description: string; tone: string }
> = {
  offline: {
    label: "Offline",
    description: "You are not visible to students.",
    tone: "bg-muted text-muted-foreground",
  },
  available: {
    label: "Available now",
    description: "Students can see you and start a session.",
    tone: "bg-success/12 text-success",
  },
  in_session: {
    label: "In a session",
    description:
      "Hidden from students while you finish this session. You'll be visible again automatically.",
    // --primary, not a warning colour: the brand accent IS gold, so an amber
    // "warning" token would be the same swatch as the identity in dark theme.
    // This state is engagement, not alarm.
    tone: "bg-primary/12 text-primary",
  },
  unreachable: {
    label: "Can't reach you",
    description:
      "You're marked available, but we can't reach your device, so students aren't being shown to you.",
    tone: "bg-destructive/12 text-destructive",
  },
};

export function StatusPill({ status }: { status: TeacherStatus }) {
  const { label, tone } = STATUS_COPY[status];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${tone}`}
    >
      <span className="h-2 w-2 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
