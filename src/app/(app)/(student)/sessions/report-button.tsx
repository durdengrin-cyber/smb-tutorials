"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { reportSession } from "./actions";
import { REPORT_REASONS } from "./reasons";

// Order matters. 'conduct' is what this feature exists for, and it is
// deliberately NOT first: a parent should reach it without being primed, and
// the ordinary reasons need to exist so the button gets used at all. A
// reporting path only touched in emergencies is one nobody has practised.
const LABELS: Record<string, string> = {
  no_show: "The teacher didn't turn up",
  left_early: "The lesson ended early",
  technical: "Audio, video or connection problems",
  teaching_quality: "The teaching wasn't what we expected",
  conduct: "Something the teacher said or did concerned me",
  other: "Something else",
};

export function ReportButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [detail, setDetail] = useState("");

  if (sent) {
    return (
      <p className="text-sm text-muted-foreground">
        Thank you — we&apos;ve got this and someone will look at it.
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Report a problem
      </Button>
    );
  }

  async function send() {
    setBusy(true);
    setError(null);
    const result = await reportSession({ sessionId, reason, detail });
    setBusy(false);
    if ("error" in result) {
      // Leave the form open and usable: someone reporting a concern must not
      // have to start again, and must never be left unsure whether it sent.
      setError(result.error);
      return;
    }
    setSent(true);
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border p-3">
      <label className="block text-sm font-medium" htmlFor={`reason-${sessionId}`}>
        What went wrong?
      </label>
      <select
        id={`reason-${sessionId}`}
        className="w-full rounded-md border px-3 py-2 text-sm"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      >
        {REPORT_REASONS.map((r) => (
          <option key={r} value={r}>{LABELS[r]}</option>
        ))}
      </select>
      <textarea
        className="w-full rounded-md border px-3 py-2 text-sm"
        rows={3}
        placeholder="Anything you want to add (optional)"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
      />
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <Button size="sm" onClick={send} disabled={busy}>
          {busy ? "Sending…" : "Send report"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
