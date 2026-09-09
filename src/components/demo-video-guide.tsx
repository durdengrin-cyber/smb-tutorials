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

// Every panel draws the screen the teacher is about to be looking at, not an
// abstract icon. The first version of this used generic boxes and arrows,
// which decorated the step without explaining it — a teacher who does not
// already know where YouTube keeps "Unlisted" learned nothing from a
// rectangle. These mirror the real controls: the Create menu, the visibility
// radio list, the Share panel's Copy button.
//
// Drawn, not screenshotted: a screenshot goes stale the next time YouTube
// moves a button, and cannot be themed. Tokens and currentColor only — the
// surface guards reject a raw hex on sight.

const VB = { width: 200, height: 120 };

function Art({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg
      viewBox={`0 0 ${VB.width} ${VB.height}`}
      role="img"
      aria-label={label}
      className="h-32 w-full text-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// The parent sets stroke; text must opt back out of it or every glyph is
// outlined and turns to mud at this size.
function T({
  x,
  y,
  children,
  size = 9,
  dim = false,
  bold = false,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  size?: number;
  dim?: boolean;
  bold?: boolean;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fill="currentColor"
      stroke="none"
      opacity={dim ? 0.55 : 1}
      fontWeight={bold ? 600 : 400}
    >
      {children}
    </text>
  );
}

/** A filled panel behind a highlighted row, at token opacity. */
function Fill(props: React.SVGProps<SVGRectElement>) {
  return <rect {...props} fill="currentColor" stroke="none" opacity={0.12} />;
}

const SLIDES: Slide[] = [
  {
    title: "Record 2–5 minutes of you teaching",
    body: "Pick one concept and explain it start to finish, the way you would to a student. Face visible, clear audio, whiteboard or screen share.",
    art: (
      <Art label="A video frame showing a tutor beside a whiteboard, marked 2 to 5 minutes">
        <rect x="6" y="8" width="188" height="86" rx="6" />
        {/* whiteboard */}
        <rect x="18" y="20" width="94" height="60" rx="3" />
        <path d="M28 36h56M28 48h40M28 60h64" opacity="0.35" />
        {/* tutor */}
        <circle cx="152" cy="42" r="12" />
        <path d="M130 80c0-12 10-22 22-22s22 10 22 22" />
        {/* record state */}
        <circle cx="16" cy="105" r="4" fill="currentColor" stroke="none" />
        <T x={26} y={108} size={9} bold>
          REC
        </T>
        <T x={54} y={108} size={9} dim>
          2–5 min · one concept, explained
        </T>
      </Art>
    ),
  },
  {
    title: "Upload it to YouTube",
    body: "On youtube.com, press Create in the top bar, then Upload video. A personal account is fine — you do not need a channel or an audience.",
    art: (
      <Art label="The YouTube top bar with the Create menu open on Upload video">
        {/* top bar */}
        <rect x="6" y="8" width="188" height="24" rx="5" />
        <path d="M18 20h8M18 16h14M18 24h11" opacity="0.35" />
        <rect x="120" y="12" width="44" height="16" rx="8" />
        <path d="M130 20h8M134 16v8" />
        <T x={142} y={23} size={8}>
          Create
        </T>
        {/* dropdown */}
        <rect x="104" y="40" width="90" height="52" rx="5" />
        <Fill x={108} y={44} width={82} height={20} rx={3} />
        <path d="M120 58v-9M116 53l4-4 4 4" />
        <T x={132} y={57} size={9} bold>
          Upload video
        </T>
        <T x={132} y={80} size={9} dim>
          Go live
        </T>
        <T x={6} y={110} size={9} dim>
          Top bar → Create → Upload video
        </T>
      </Art>
    ),
  },
  {
    title: "Set visibility to Unlisted",
    body: "Unlisted keeps the video off YouTube search and off your channel. Only someone holding the link can watch it — us while we check, and students choosing a tutor.",
    art: (
      <Art label="YouTube's visibility options with Unlisted selected">
        <rect x="18" y="6" width="164" height="90" rx="6" />
        <T x={30} y={24} size={10} bold>
          Visibility
        </T>
        {/* Private */}
        <circle cx="36" cy="42" r="5.5" />
        <T x={50} y={45}>
          Private
        </T>
        <T x={104} y={45} dim size={8}>
          only you
        </T>
        {/* Unlisted — selected */}
        <Fill x={24} y={52} width={152} height={20} rx={4} />
        <circle cx="36" cy="62" r="5.5" />
        <circle cx="36" cy="62" r="2.6" fill="currentColor" stroke="none" />
        <T x={50} y={65} bold>
          Unlisted
        </T>
        <T x={104} y={65} dim size={8}>
          anyone with the link
        </T>
        {/* Public */}
        <circle cx="36" cy="82" r="5.5" />
        <T x={50} y={85}>
          Public
        </T>
        <T x={104} y={85} dim size={8}>
          shown in search
        </T>
        <T x={18} y={112} size={9} dim>
          Choose the middle one
        </T>
      </Art>
    ),
  },
  {
    title: "Copy the link and paste it below",
    body: "Press Share, then Copy. You will get a link starting youtu.be/ — paste it exactly as YouTube gives it to you, extra characters and all.",
    art: (
      <Art label="The Share panel's copy button, and the link being pasted into the form field">
        <rect x="6" y="6" width="188" height="34" rx="6" />
        <T x={16} y={20} size={8} dim>
          Share
        </T>
        <T x={16} y={33} size={9}>
          youtu.be/dQw4w9WgXcQ
        </T>
        <Fill x={140} y={14} width={44} height={20} rx={5} />
        <path d="M150 24h-4v-6h10v4" opacity="0.6" />
        <T x={158} y={28} size={9} bold>
          Copy
        </T>
        {/* arrow down */}
        <path d="M100 46v16M93 55l7 7 7-7" />
        {/* the form field on this very page */}
        <rect
          x="6"
          y="70"
          width="188"
          height="30"
          rx="6"
          strokeDasharray="5 4"
          opacity="0.7"
        />
        <T x={18} y={89} size={9} dim>
          Demo Video Link — paste here
        </T>
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
