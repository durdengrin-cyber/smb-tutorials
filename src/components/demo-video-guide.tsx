"use client";

import { useCallback, useId, useRef, useState } from "react";

// Replaces a wall of blue instruction text with four drawn steps a teacher can
// swipe. The illustrations are SVG built from tokens and currentColor — never
// a screenshot, which would go stale the next time YouTube moves a button, and
// never a raw hex, which the surface guards reject on sight.

interface Slide {
  title: string;
  body: string;
  art: React.ReactNode;
}

// Shared frame so every panel sits on the same baseline and the carousel does
// not jump height between steps.
function Art({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 160 100"
      role="presentation"
      focusable="false"
      className="h-28 w-full text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const SLIDES: Slide[] = [
  {
    title: "Record 2–5 minutes",
    body: "Explain one concept, step by step. Good light, clear audio, whiteboard or screen share.",
    art: (
      <Art>
        <rect x="26" y="24" width="86" height="54" rx="6" />
        <path d="M70 42v18l16-9z" fill="currentColor" stroke="none" />
        <circle cx="126" cy="34" r="7" />
        <path d="M126 30v4l3 2" />
        <path d="M40 88h58" className="opacity-40" />
      </Art>
    ),
  },
  {
    title: "Upload it to YouTube",
    body: "Sign in to YouTube, choose Create, then Upload video. Any account works — you don't need a channel audience.",
    art: (
      <Art>
        <rect x="30" y="46" width="100" height="34" rx="6" />
        <path d="M80 62V22" />
        <path d="M66 36l14-14 14 14" />
        <path d="M52 64h12" className="opacity-40" />
      </Art>
    ),
  },
  {
    title: "Set visibility to Unlisted",
    body: "Unlisted keeps it off search and off your channel. Only someone with the link can watch — that's us, and the students who pick you.",
    art: (
      <Art>
        <rect x="34" y="30" width="92" height="44" rx="6" />
        <path d="M48 44h34" className="opacity-40" />
        <path d="M48 58h22" className="opacity-40" />
        <circle cx="104" cy="52" r="10" />
        <path d="M100 52l3 3 6-6" />
      </Art>
    ),
  },
  {
    title: "Copy the link, paste it below",
    body: "Press Share, then Copy. The link looks like youtu.be/… — paste it exactly as YouTube gives it to you.",
    art: (
      <Art>
        <rect x="24" y="34" width="66" height="26" rx="13" />
        <path d="M40 47h34" className="opacity-40" />
        <rect x="70" y="52" width="66" height="26" rx="13" />
        <path d="M86 65h34" className="opacity-40" />
      </Art>
    ),
  },
];

export function DemoVideoGuide() {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const headingId = useId();
  const last = SLIDES.length - 1;

  const go = useCallback(
    (next: number) => setIndex(Math.max(0, Math.min(last, next))),
    [last]
  );

  // Arrow keys only while the carousel itself holds focus, so they never steal
  // caret movement from the URL field directly beneath it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(index + 1);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    const end = e.changedTouches[0]?.clientX;
    touchStartX.current = null;
    if (start === null || end === undefined) return;
    const dx = end - start;
    // 40px, so a vertical scroll that drifts sideways does not flip the card.
    if (Math.abs(dx) < 40) return;
    go(dx < 0 ? index + 1 : index - 1);
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-labelledby={headingId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="rounded-lg border border-border bg-muted p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 id={headingId} className="text-sm font-semibold text-foreground">
          How to upload your demo video
        </h4>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {index + 1}/{SLIDES.length}
        </span>
      </div>

      <div className="mt-3 overflow-hidden">
        <div
          className="flex motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {SLIDES.map((slide, i) => (
            <div
              key={slide.title}
              // Off-screen slides are hidden from assistive tech and from tab
              // order; without this a screen reader reads all four at once and
              // the sequence the carousel exists to convey is lost.
              aria-hidden={i !== index}
              inert={i !== index ? true : undefined}
              className="w-full shrink-0 px-1"
            >
              <div className="rounded-md bg-card p-3">{slide.art}</div>
              <p className="mt-3 text-sm font-semibold text-foreground">
                {i + 1}. {slide.title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{slide.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Announces the step change to a screen reader without moving focus. */}
      <p aria-live="polite" className="sr-only">
        Step {index + 1} of {SLIDES.length}: {SLIDES[index]?.title}
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
        >
          Back
        </button>

        <div className="flex gap-1.5">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.title}
              type="button"
              onClick={() => go(i)}
              aria-label={`Step ${i + 1}: ${slide.title}`}
              aria-current={i === index}
              className={
                i === index
                  ? "h-2 w-5 rounded-full bg-primary"
                  : "h-2 w-2 rounded-full bg-border hover:bg-muted-foreground"
              }
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => go(index + 1)}
          disabled={index === last}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </section>
  );
}
