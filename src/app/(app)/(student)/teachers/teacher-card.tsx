"use client";

import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  GraduationCap,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SESSION_DURATION_MINUTES } from "@/lib/session";
import { youTubeVideoId } from "@/lib/validation";

export interface TeacherCardData {
  id: string;
  full_name: string;
  qualification: string | null;
  specialization: string | null;
  experience_years: number | null;
  hourly_rate: number | null;
  bio: string | null;
  demo_video_url: string | null;
  subject: string;
  curriculum: string;
  grade: string;
}

// Longer than this and the bio is clamped with a toggle. Chosen to be a bit
// past two rendered lines at the card's width: shorter bios show whole, so a
// teacher who wrote one sentence never gets a "Show more" that reveals
// nothing. jsdom has no layout, so a character count is also the only measure
// the tests can assert against.
const BIO_CLAMP_CHARS = 140;

/** How long a lesson is, in the words a parent would use. */
function sessionLength(): string {
  const m = SESSION_DURATION_MINUTES;
  if (m % 60 === 0) {
    const h = m / 60;
    return h === 1 ? "1-hour" : `${h}-hour`;
  }
  return `${m}-minute`;
}

/**
 * The demo lesson, led with rather than linked to.
 *
 * Until 2026-09-10 this was a text link at the bottom of the card, and before
 * that it was not rendered at all — teachers are told on their profile form
 * that an unlisted YouTube link "is what students watch when choosing a
 * tutor", and for most of this product's life nobody but an admin could.
 * profile-claims.test.ts fails if that promise and this rendering ever come
 * apart again.
 *
 * The thumbnail is served from ytimg and the player is inserted only once a
 * parent presses it, so opening the teachers list does not announce itself to
 * youtube.com for every teacher on screen. The embed host is
 * youtube-nocookie.com for the same reason.
 */
function DemoVideo({ id, name }: { id: string; name: string }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="relative size-16 bg-stage sm:aspect-auto sm:size-auto sm:h-full sm:w-full">
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title={`${name}'s demo lesson`}
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Play ${name}'s demo lesson`}
      className="group relative block size-16 overflow-hidden bg-stage sm:aspect-auto sm:size-auto sm:h-full sm:w-full"
    >
      {/* mqdefault (320x180), not hqdefault (480x360): hqdefault bakes black
          letterbox bars into a 4:3 frame for every 16:9 video, and object-cover
          then crops those bars into the card as two dead bands. Caught by
          looking at it — the bars are invisible to jsdom. mqdefault is a true
          16:9 and YouTube generates it for every video, unlike maxresdefault.

          Not next/image: routing one 320px third-party thumbnail through the
          optimiser would mean a remotePatterns entry in next.config plus a
          billed optimisation pass for a file we never resize. The LCP argument
          the lint rule makes does not apply — these sit below the fold in a
          list and are lazy-loaded. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`}
        alt={`${name}'s demo lesson`}
        loading="lazy"
        className="h-full w-full object-cover"
      />
      {/* A scrim in --stage, not a themed surface. This sits on top of an
          arbitrary video frame, and globals.css is explicit that a
          theme-flipping token on that kind of ground resolves against the
          wrong palette and can land at 1-2:1. --stage is the one colour the
          product deliberately holds fixed in both themes, which is exactly
          what a wash over imagery needs. */}
      <span className="absolute inset-0 bg-stage/35 transition-colors group-hover:bg-stage/20" />
      <span className="absolute inset-0 grid place-content-center">
        {/* Gold, not white-on-dark: primary reads against any frame a teacher
            uploads, in either theme, and says "this is the thing to press". */}
        <span className="grid size-7 place-content-center rounded-full bg-primary shadow-lg transition-transform group-hover:scale-110 sm:size-12">
          <span className="ml-0.5 border-y-[5px] border-l-[8px] border-y-transparent border-l-primary-foreground sm:ml-1 sm:border-y-[9px] sm:border-l-[15px]" />
        </span>
      </span>
    </button>
  );
}

/**
 * One fact line: a glyph, then what it means for the child.
 *
 * lucide, not a unicode symbol — app-surface.test.ts bans emoji as
 * iconography across the whole product surface, and a decorative geometric
 * glyph is exactly the class of thing it exists to catch (the guard reads the
 * whole file, so one in a comment fails it too). The icon is aria-hidden because the
 * sentence beside it already says everything; announcing "graduation cap" to
 * a screen reader would only add noise.
 */
function Fact({
  icon: Icon,
  className = "",
  children,
}: {
  icon: LucideIcon;
  // Applied to the <li> itself. A caller must NOT wrap this in its own <li> to
  // hide it: an <li> inside an <li> is invalid, the browser silently closes
  // the outer one, and the class goes nowhere — which is exactly how the
  // specialization line stayed visible on a collapsed phone card.
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className={`grid grid-cols-[1rem_1fr] items-start gap-2.5 text-sm ${className}`}
    >
      <Icon aria-hidden className="mt-0.5 size-3.5 text-muted-foreground" />
      <span className="leading-relaxed text-foreground">{children}</span>
    </li>
  );
}

export function TeacherCard({
  teacher,
  onStart,
  starting,
}: {
  teacher: TeacherCardData;
  onStart?: () => void;
  starting?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Separate from `expanded`, which is the desktop bio clamp. This one is the
  // phone card opening: below lg the card is a summary, and this reveals what
  // the summary left out.
  const [open, setOpen] = useState(false);

  // Resolved here, not inside DemoVideo, because the CARD's column template
  // depends on it. A teacher with no video (or a stored link that will not
  // parse) must not leave an 11rem media column standing empty with the facts
  // squeezed into it — and jsdom has no layout, so no test in this file can
  // see that happen. A stored link that will not parse is treated exactly
  // like no link: an empty frame or a broken image on the card a parent is
  // judging a stranger by is worse than showing nothing.
  const videoId = teacher.demo_video_url
    ? youTubeVideoId(teacher.demo_video_url)
    : null;

  const bio = teacher.bio?.trim() ?? "";
  const clamped = bio.length > BIO_CLAMP_CHARS;

  const taughtFor = [teacher.grade, teacher.curriculum].filter(Boolean).join(" · ");
  const credential = [
    teacher.qualification,
    teacher.experience_years !== null
      ? `${teacher.experience_years} years teaching`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const firstName = teacher.full_name.trim().split(/\s+/)[0] || teacher.full_name;

  // Only offer to open the card when there is something behind it. A teacher
  // with no bio and no specialization has nothing more to show, and a control
  // that reveals nothing is worse than no control.
  const hasDetail = Boolean(bio) || Boolean(teacher.specialization);

  // Hidden on a closed phone card, always present from lg up — where the
  // three-column layout has room for all of it and no toggle is rendered.
  const detailCls = open ? "block" : "hidden lg:block";

  return (
    <Card
      data-media={videoId ? "video" : "none"}
      data-open={open ? "yes" : "no"}
      // Three templates, not two. Below sm the media is a 4rem thumbnail
      // sitting BESIDE the name rather than a full-width banner above it: at
      // 500x763 the banner alone was 255px and the whole card 659px — 86% of
      // the screen for one teacher, so a parent comparing four of them saw
      // less than one at a time. Measured, not guessed.
      className={`grid gap-0 overflow-hidden p-0 transition-shadow duration-300 hover:shadow-lg ${
        videoId
          ? "grid-cols-[4rem_1fr] sm:grid-cols-[11rem_1fr] lg:grid-cols-[11rem_1fr_11rem]"
          : "grid-cols-1 lg:grid-cols-[1fr_11rem]"
      }`}
    >
      {videoId ? <DemoVideo id={videoId} name={teacher.full_name} /> : null}

      <div className="p-3 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1">
          <h3 className="text-base font-bold tracking-tight text-foreground sm:text-lg">
            {teacher.full_name}
          </h3>
          {/* The price is promoted next to the name below lg, where the
              decision column does not exist. It is the second thing a parent
              reads after the name, and stacking it in its own block cost a
              flat 165px in every card. */}
          <span className="text-lg font-bold tracking-tight text-foreground lg:hidden">
            ₹{teacher.hourly_rate ?? "—"}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2.5 gap-y-1">
          {/* Said for every teacher in the list, never conditionally. Everyone
              deriveRoster returns is reachable — it ranks the live-presence
              tier above the push-only tier but deliberately does not label
              them (spec §6.2), because a visible second tier would stop
              push-only teachers being picked at all. Saying "available" for
              all of them is the reassurance without the tier. */}
          <span className="rounded-sm border border-success/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-success">
            Available now
          </span>
          <span className="text-[11px] text-muted-foreground lg:hidden">
            for a {sessionLength()} session
          </span>
        </div>

        <ul className="mt-2.5 grid gap-1.5 sm:mt-3">
          <Fact icon={BookOpen}>
            {teacher.subject}
            {taughtFor ? (
              <span className="text-muted-foreground"> · {taughtFor}</span>
            ) : null}
          </Fact>
          {credential ? <Fact icon={GraduationCap}>{credential}</Fact> : null}
          {/* Specialization and the bio are the two things that leave the
              phone card. They are the longest and the least decisive when
              every teacher on screen is online right now — you choose on
              subject, board, price and face. Both come back on tap, so this
              is a summary rather than a truncation. */}
          {teacher.specialization ? (
            <Fact icon={Sparkles} className={detailCls}>
              {teacher.specialization}
              <span className="text-muted-foreground">
                {" "}
                — what they are strongest at
              </span>
            </Fact>
          ) : null}
        </ul>

        {bio ? (
          <div className={`mt-3 ${detailCls}`}>
            <p
              className={`text-sm leading-relaxed text-muted-foreground ${
                clamped && !expanded ? "line-clamp-2" : ""
              }`}
            >
              {bio}
            </p>
            {/* Desktop keeps its own clamp toggle. On a phone the bio only
                exists once the card is open, so clamping it again there would
                be a second disclosure inside the first. */}
            {clamped ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 hidden text-xs font-medium text-primary underline underline-offset-4 lg:inline"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* The tap target, below lg only. Deliberately an explicit control
          rather than a click handler on the card: "Start now" is a button
          inside this card, and nesting interactive elements is invalid and
          breaks keyboard and screen-reader navigation. lg:hidden rather than
          opacity or visibility so it leaves the accessibility tree and the
          tab order entirely on desktop, where everything it reveals is
          already on screen. */}
      {hasDetail ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex items-center justify-center gap-1.5 border-t border-hair py-2 text-xs font-medium text-primary lg:hidden ${
            videoId ? "col-span-2" : ""
          }`}
        >
          {open ? "Less" : `More about ${firstName}`}
          <ChevronDown
            aria-hidden
            className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      ) : null}

      <div
        className={`flex flex-col justify-start border-border px-3 pb-3 sm:px-5 sm:pb-5 lg:border-l lg:p-5 ${
          videoId ? "col-span-2 lg:col-span-1" : ""
        }`}
      >
        {/* Price and unit live up beside the name below lg — see the header.
            They reappear here only where the decision column exists. */}
        <p className="hidden text-2xl font-bold tracking-tight text-foreground lg:block">
          ₹{teacher.hourly_rate ?? "—"}
        </p>
        {/* Derived from the constant that actually governs the charge, so the
            sentence cannot drift from the product: amountPaiseFor() prorates
            hourly_rate over duration_minutes, and every session today is
            SESSION_DURATION_MINUTES long. */}
        <p className="mt-1 hidden text-xs text-muted-foreground lg:block">
          for a {sessionLength()} session
        </p>

        <Button
          type="button"
          className="w-full lg:mt-4"
          onClick={onStart}
          disabled={!onStart || starting}
        >
          {starting ? "Asking…" : "Start now →"}
        </Button>
        {/* The promise belongs where the money is about to be committed, not
            only on the landing page the parent left ten minutes ago. */}
        <p className="mt-2.5 text-[11px] leading-snug text-muted-foreground">
          Nothing is charged until {teacher.full_name.split(" ")[0]} accepts.
        </p>
      </div>
    </Card>
  );
}
