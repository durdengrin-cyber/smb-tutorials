"use client";

import { useState } from "react";
import { BookOpen, GraduationCap, Sparkles, type LucideIcon } from "lucide-react";
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
      <div className="relative aspect-video w-full bg-stage sm:aspect-auto sm:h-full">
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
      className="group relative block aspect-video w-full overflow-hidden bg-stage sm:aspect-auto sm:h-full"
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
        <span className="grid h-12 w-12 place-content-center rounded-full bg-primary shadow-lg transition-transform group-hover:scale-110">
          <span className="ml-1 border-y-[9px] border-l-[15px] border-y-transparent border-l-primary-foreground" />
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
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1rem_1fr] items-start gap-2.5 text-sm">
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

  return (
    <Card
      data-media={videoId ? "video" : "none"}
      className={`grid gap-0 overflow-hidden p-0 transition-shadow duration-300 hover:shadow-lg ${
        videoId
          ? "sm:grid-cols-[11rem_1fr] lg:grid-cols-[11rem_1fr_11rem]"
          : "lg:grid-cols-[1fr_11rem]"
      }`}
    >
      {videoId ? <DemoVideo id={videoId} name={teacher.full_name} /> : null}

      <div className="p-5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-lg font-bold tracking-tight text-foreground">
            {teacher.full_name}
          </h3>
          {/* Said for every teacher in the list, never conditionally. Everyone
              deriveRoster returns is reachable — it ranks the live-presence
              tier above the push-only tier but deliberately does not label
              them (spec §6.2), because a visible second tier would stop
              push-only teachers being picked at all. Saying "available" for
              all of them is the reassurance without the tier. */}
          <span className="rounded-sm border border-success/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-success">
            Available now
          </span>
        </div>

        <ul className="mt-3 grid gap-1.5">
          <Fact icon={BookOpen}>
            {teacher.subject}
            {taughtFor ? (
              <span className="text-muted-foreground"> · {taughtFor}</span>
            ) : null}
          </Fact>
          {credential ? <Fact icon={GraduationCap}>{credential}</Fact> : null}
          {teacher.specialization ? (
            <Fact icon={Sparkles}>
              {teacher.specialization}
              <span className="text-muted-foreground">
                {" "}
                — what they are strongest at
              </span>
            </Fact>
          ) : null}
        </ul>

        {bio ? (
          <div className="mt-3">
            <p
              className={`text-sm leading-relaxed text-muted-foreground ${
                clamped && !expanded ? "line-clamp-2" : ""
              }`}
            >
              {bio}
            </p>
            {clamped ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-xs font-medium text-primary underline underline-offset-4"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col justify-start border-border p-5 lg:border-l">
        <p className="text-2xl font-bold tracking-tight text-foreground">
          ₹{teacher.hourly_rate ?? "—"}
        </p>
        {/* Derived from the constant that actually governs the charge, so the
            sentence cannot drift from the product: amountPaiseFor() prorates
            hourly_rate over duration_minutes, and every session today is
            SESSION_DURATION_MINUTES long. */}
        <p className="mt-1 text-xs text-muted-foreground">
          for a {sessionLength()} session
        </p>

        <Button
          type="button"
          className="mt-4 w-full"
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
