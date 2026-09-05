"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// The signature motion of the identity (spec §5.4). One device frame walks the
// real flow — browse, ask, wait, connected — while the step track beside it
// advances, so the page PERFORMS "three steps, about a minute" rather than
// claiming it.
//
// The rule that makes it bearable rather than infuriating: scroll POSITION
// drives the stops, scroll SPEED is never touched. The page always moves at
// the rate the person scrolls.

// Four scroll STOPS, but only three rendered PANELS. Stops 0 and 1 are the
// same screen — the online list, before and after a row is chosen — so they
// must not be two panels that cross-fade into each other. Doing that faded the
// whole list out and back in at the boundary, which read as the screen
// glitching rather than as a row being picked. One panel, one row highlight.
const STOPS = 5;
const VH_PER_STOP = 60;

// stop -> panel. Two pairs of stops share a panel, for different reasons:
//   1 and 2 are the online list before and after a row is chosen — choosing a
//   teacher is a highlight, not a new screen, and cross-fading between two
//   near-identical lists reads as a glitch.
//   3 and 4 are genuinely different screens (waiting, then connected).
const PANEL_FOR_STOP = [0, 1, 1, 2, 3];

// stop -> which step in the track is lit. Every step now has a screen of its
// own: step 1 is the subject picker, which the card was previously missing
// entirely, so steps 1 and 2 both showed the teacher list.
const STEP_FOR_STOP = [0, 1, 1, 2, 2];

// Real routes: /find is the picker, /teachers is the online list.
const URL_FOR_STOP = [
  "smbtutorials.com/find",
  "smbtutorials.com/teachers",
  "smbtutorials.com/teachers",
  "smbtutorials.com/waiting",
  "smbtutorials.com/call",
];

// What the picker shows, matching src/lib/taxonomy.ts so the mock cannot drift
// from the real screen.
const PICKER = [
  { label: "Curriculum", options: ["CBSE", "State Board", "ICSE"], chosen: "CBSE" },
  { label: "Class", options: ["8th", "9th", "10th", "11th"], chosen: "10th" },
  { label: "Core field", options: ["Science", "Commerce", "Arts"], chosen: "Science" },
  { label: "Subject", options: ["Mathematics", "Physics", "Chemistry"], chosen: "Mathematics" },
];

const STEPS = [
  { n: "01", title: "Pick the subject", body: "Board, grade, and what they are stuck on." },
  { n: "02", title: "Ask a teacher who is online", body: "Rate shown before you choose." },
  { n: "03", title: "They accept, the lesson starts", body: "Sixty seconds to answer. You pay only then." },
];

const TEACHERS = [
  { initials: "RA", name: "R. Azad", detail: "M.Sc Mathematics · 8 yrs", rate: "₹450/hr" },
  { initials: "SK", name: "S. Kulkarni", detail: "B.Ed · 5 yrs", rate: "₹380/hr" },
  { initials: "FN", name: "F. Nasir", detail: "M.Sc Mathematics · 12 yrs", rate: "₹600/hr" },
];

function TeacherRow({ t, hot }: { t: (typeof TEACHERS)[number]; hot?: boolean }) {
  return (
    <div
      // The highlight IS the transition between the first two scroll stops, so
      // it animates. Everything else on this screen stays put — that is the
      // point: only the chosen row should change, not the whole list.
      className={`grid grid-cols-[1fr_auto] items-center gap-3 border-b border-hair px-4 py-3 transition-colors duration-300 ${
        hot ? "bg-muted" : ""
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span className="grid size-7 flex-none place-items-center rounded-full bg-primary/20 text-[10px] font-black">
          {t.initials}
        </span>
        <span>
          <span className="block text-[13px] font-semibold tracking-tight">
            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" />
            {t.name}
          </span>
          <span className="block text-[11px] text-muted-foreground">{t.detail}</span>
        </span>
      </span>
      <span className="flex items-center gap-2.5">
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{t.rate}</span>
        <span className="rounded-sm bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground">
          Ask
        </span>
      </span>
    </div>
  );
}

// Whether this viewer gets the scroll behaviour at all. Subscribed rather than
// read once, so a resize across the breakpoint or a change to the OS motion
// preference takes effect immediately instead of at the next full load.
//
// useSyncExternalStore, not setState-in-an-effect: that pattern causes a
// cascading render and this repo's lint rejects it outright
// (react-hooks/set-state-in-effect). The server snapshot is false, so the
// stacked fallback is what renders before any JS runs.
function useScrollDriven() {
  return useSyncExternalStore(
    (onChange) => {
      const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const narrow = window.matchMedia("(max-width: 1023px)");
      motion.addEventListener("change", onChange);
      narrow.addEventListener("change", onChange);
      return () => {
        motion.removeEventListener("change", onChange);
        narrow.removeEventListener("change", onChange);
      };
    },
    () =>
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !window.matchMedia("(max-width: 1023px)").matches,
    () => false
  );
}

export function FlowDemo() {
  const wrap = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState(0);
  const ready = useScrollDriven();

  useEffect(() => {
    if (!ready) return; // stacked fallback stays; nothing to listen to

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const el = wrap.current;
        if (!el) return;
        const total = el.offsetHeight - window.innerHeight;
        const p = total > 0 ? Math.min(1, Math.max(0, -el.getBoundingClientRect().top / total)) : 0;
        setStop(Math.min(STOPS - 1, Math.floor(p * STOPS)));
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ready]);

  const litStep = STEP_FOR_STOP[stop];
  const panel = PANEL_FOR_STOP[stop];
  // The row highlight IS the transition between the first two stops.
  const rowChosen = stop >= 2;

  return (
    <div
      ref={wrap}
      data-flow
      data-ready={String(ready)}
      // Layout is decided in CSS, never by a state flip after hydration.
      // The server cannot know the viewport or the motion preference, so any
      // JS-driven layout choice reflows the page a beat after first paint —
      // which read as a glitch in the first second of scrolling. lg + motion-safe
      // resolve identically on the server and the client, so nothing moves.
      //
      // The tall track exists only where the scroll behaviour does. Height is
      // derived from the stop count so adding a stop needs no new number.
      // The height is computed, so it goes through a custom property: Tailwind's
      // JIT only emits CSS for class strings it can find literally in source,
      // and an interpolated arbitrary value is invisible to it.
      style={{ "--track-h": `${STOPS * VH_PER_STOP}vh` } as React.CSSProperties}
      className="relative lg:motion-safe:h-[var(--track-h)]"
    >
      <div className="flex items-center py-12 lg:motion-safe:sticky lg:motion-safe:top-[var(--header-h)] lg:motion-safe:min-h-[calc(100vh-var(--header-h))] lg:motion-safe:py-0">
        <div className="grid w-full items-center gap-14 lg:grid-cols-[1.02fr_.98fr]">
          <div>
            <h1 className="mb-5 text-balance text-[clamp(2rem,4.6vw,3.6rem)] font-black leading-[0.94] tracking-[-0.05em]">
              Your child is stuck. A teacher is{" "}
              <span className="text-primary">already online</span>.
            </h1>
            <p className="mb-7 max-w-[44ch] text-base leading-relaxed text-muted-foreground">
              Qualified teachers, one to one on video, usually within a minute of asking.
              Grades 6–12 across CBSE, ICSE and State Boards.
            </p>

            <div className="mt-8 border-t border-hair">
              {STEPS.map((s, i) => (
                <div
                  key={s.n}
                  className={`grid grid-cols-[44px_1fr] items-baseline gap-3.5 border-b border-hair py-3 transition-opacity duration-500 ${
                    litStep === i ? "" : "lg:motion-safe:opacity-35"
                  }`}
                >
                  <span className="font-mono text-[11px] text-primary">{s.n}</span>
                  <span>
                    <span className="block text-sm font-semibold tracking-tight">{s.title}</span>
                    <span className="text-[13px] text-muted-foreground">{s.body}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-card shadow-2xl">
            <div className="flex items-center gap-1.5 border-b border-hair px-3 py-2.5">
              <i className="block size-2 rounded-full bg-border" />
              <i className="block size-2 rounded-full bg-border" />
              <i className="block size-2 rounded-full bg-border" />
              <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                {URL_FOR_STOP[stop]}
              </span>
            </div>

            {/* Three panels. The fallback stacks them; the scroll build
                absolutely positions them and cross-fades between them. Without
                JS the stop stays 0, so panel 0 shows and the rest sit hidden —
                a valid hero screenshot, not a pile. */}
            <div className="grid gap-0.5 lg:motion-safe:relative lg:motion-safe:block lg:motion-safe:min-h-[292px]">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`border-t border-hair lg:motion-safe:absolute lg:motion-safe:inset-0 lg:motion-safe:border-t-0 lg:motion-safe:transition-all lg:motion-safe:duration-500 ${
                    panel === i
                      ? ""
                      : "lg:motion-safe:pointer-events-none lg:motion-safe:translate-y-2.5 lg:motion-safe:opacity-0"
                  }`}
                >
                  {i === 0 && (
                    <div className="px-4 py-4">
                      <h2 className="mb-3.5 text-base font-black tracking-tight">
                        What is your child stuck on?
                      </h2>
                      <div className="grid gap-3">
                        {PICKER.map((row) => (
                          <div key={row.label}>
                            <p className="mb-1.5 font-mono text-[10px] tracking-wider text-muted-foreground">
                              {row.label.toUpperCase()}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {row.options.map((o) => (
                                <span
                                  key={o}
                                  className={`rounded-sm border px-2.5 py-1 text-[11.5px] ${
                                    o === row.chosen
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border text-muted-foreground"
                                  }`}
                                >
                                  {o}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {i === 1 && (
                    <>
                      <div className="border-b border-hair px-4 py-3.5">
                        <p className="mb-1.5 font-mono text-[10px] tracking-wider text-primary">
                          CBSE · CLASS 10 · MATHEMATICS
                        </p>
                        <h2 className="text-base font-black tracking-tight">Online right now</h2>
                      </div>
                      {TEACHERS.map((t, n) => (
                        <TeacherRow key={t.initials} t={t} hot={rowChosen && n === 0} />
                      ))}
                    </>
                  )}

                  {i === 2 && (
                    <div className="px-5 py-11 text-center">
                      <p className="mb-3 font-mono text-[11px] tabular-nums tracking-wider text-primary">
                        ASKING · 47s LEFT
                      </p>
                      <h2 className="mb-1.5 text-lg font-black tracking-tight">Waiting for R. Azad</h2>
                      <p className="mb-4 text-[12.5px] text-muted-foreground">
                        Mathematics · Class 10 · ₹450/hr · notified on 2 devices
                      </p>
                      <div className="mx-auto h-0.5 max-w-[230px] overflow-hidden rounded-sm bg-hair">
                        <i className="block h-full w-2/3 bg-primary" />
                      </div>
                    </div>
                  )}

                  {i === 3 && (
                    <div className="grid grid-rows-[1fr_auto] bg-foreground/95">
                      <div className="grid grid-cols-2 gap-0.5 p-0.5">
                        {[
                          { i: "RA", n: "R. Azad" },
                          { i: "RV", n: "Ravi" },
                        ].map((p) => (
                          <div
                            key={p.i}
                            className="relative grid min-h-[140px] place-items-center bg-card"
                          >
                            <b className="text-2xl font-black tracking-tighter opacity-40">{p.i}</b>
                            <span className="absolute bottom-2 left-2 font-mono text-[10px] text-muted-foreground">
                              {p.n}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-center gap-2 bg-card p-2.5">
                        <i className="block size-7 rounded-full bg-muted" />
                        <i className="block size-7 rounded-full bg-muted" />
                        <i className="block size-7 rounded-full bg-destructive" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
