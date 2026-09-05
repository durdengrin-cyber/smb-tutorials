"use client";

import DailyIframe, { type DailyCall } from "@daily-co/daily-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { completeSession } from "@/app/session/actions";

function mmss(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const secondsUntil = (endsAt: number) =>
  Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));

export function CallFrame({
  sessionId,
  roomUrl,
  token,
  otherName,
  subject,
  startedAt,
  durationMinutes,
  returnTo,
}: {
  sessionId: string;
  roomUrl: string;
  token: string;
  otherName: string;
  subject: string;
  startedAt: string;
  durationMinutes: number;
  returnTo: string;
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const endsAt = new Date(startedAt).getTime() + durationMinutes * 60_000;
  // Seeded so the bar never paints 00:00 for a frame before the first tick —
  // on a 60-minute call that reads as "already over".
  const [left, setLeft] = useState(() => secondsUntil(endsAt));
  const [error, setError] = useState("");
  // The call can end from two places (the leave button, the countdown). Only
  // the first one should complete the session and navigate.
  const endingRef = useRef(false);

  useEffect(() => {
    let frame: DailyCall | null = null;
    let cancelled = false;

    (async () => {
      // A previous instance can outlive its component (StrictMode's
      // mount -> cleanup -> remount, or a back-navigation). The spike simply
      // bailed here, which left a blank pane and no error; tear the old one
      // down instead so this mount actually gets a call.
      try {
        const stale = DailyIframe.getCallInstance();
        if (stale) await stale.destroy();
        if (cancelled || !wrapRef.current) return;
        frame = DailyIframe.createFrame(wrapRef.current, {
          showLeaveButton: true,
          iframeStyle: { width: "100%", height: "100%", border: "0" },
        });
        frame.on("left-meeting", () => void endCall());
        await frame.join({ url: roomUrl, token });
      } catch (e) {
        if (cancelled) return;
        setError((e as Error)?.message ?? "Could not join the call");
      }
    })();

    return () => {
      cancelled = true;
      void frame?.destroy();
    };
    // endCall only reads refs and props that are stable for this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomUrl, token]);

  async function endCall() {
    if (endingRef.current) return;
    endingRef.current = true;
    // A failure here is survivable: effectiveStatus() reports an active row
    // past its hour as completed whatever the column says.
    await completeSession(sessionId);
    router.push(returnTo);
  }

  useEffect(() => {
    const tick = () => {
      const remaining = secondsUntil(endsAt);
      setLeft(remaining);
      if (remaining === 0) void endCall();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);

  return (
    // bg-stage, not bg-background: the call stage is the backdrop a video
    // tile sits on, and video stages are conventionally dark in BOTH themes.
    // --stage carries the same fixed value in :root and .dark (globals.css)
    // rather than flipping pale in light theme.
    <main className="flex h-screen flex-col bg-stage">
      <div className="flex items-center justify-between gap-4 px-6 py-3 bg-card border-b border-border">
        <div>
          <p className="font-bold text-foreground">{otherName}</p>
          <p className="text-sm text-primary font-medium">{subject}</p>
        </div>
        <div className="text-right">
          <p
            className={`text-2xl font-bold tabular-nums ${
              left < 300 ? "text-primary" : "text-foreground"
            }`}
          >
            {mmss(left)}
          </p>
          <p className="text-xs text-muted-foreground">remaining</p>
        </div>
      </div>
      {error && (
        <p className="bg-destructive/12 text-destructive px-6 py-2 text-sm">{error}</p>
      )}
      <div ref={wrapRef} className="flex-1" />
    </main>
  );
}
