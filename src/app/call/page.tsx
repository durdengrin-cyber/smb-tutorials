"use client";

import { useEffect, useRef, useState } from "react";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import { buildShareUrl } from "@/lib/share";

export default function CallPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let frame: DailyCall | null = null;

    (async () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("room") ?? undefined;

      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requested ? { name: requested } : {}),
      });
      const room = await res.json();
      if (!res.ok) {
        setError(room.error ?? "Failed to create room");
        return;
      }

      setShareUrl(buildShareUrl(window.location.origin, room.name));

      // React strict mode double-invokes effects in dev; guard against a duplicate frame.
      if (DailyIframe.getCallInstance() || !wrapRef.current) return;

      try {
        frame = DailyIframe.createFrame(wrapRef.current, {
          showLeaveButton: true,
          iframeStyle: { width: "100%", height: "100%", border: "0" },
        });
        await frame.join({ url: room.url });
      } catch (e) {
        setError((e as Error)?.message ?? "Could not start the call");
      }
    })();

    return () => {
      frame?.destroy();
    };
  }, []);

  return (
    <main className="flex h-screen flex-col">
      <div className="flex items-center gap-3 p-3 text-sm">
        <span className="font-medium">SMB Tutorials — Call spike</span>
        {shareUrl && (
          <button
            className="rounded bg-black px-3 py-1 text-white"
            onClick={() => navigator.clipboard.writeText(shareUrl)}
          >
            Copy invite link
          </button>
        )}
        {error && <span className="text-red-600">{error}</span>}
      </div>
      <div ref={wrapRef} className="flex-1" />
    </main>
  );
}
