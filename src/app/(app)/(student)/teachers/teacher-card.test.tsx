// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
// fireEvent, not user-event: @testing-library/user-event is not a dependency
// of this project and a card that only needs clicks does not justify adding
// one.
import { render, screen, fireEvent } from "@testing-library/react";

import { TeacherCard, type TeacherCardData } from "./teacher-card";
import { SESSION_DURATION_MINUTES } from "@/lib/session";

const BASE: TeacherCardData = {
  id: "t1",
  full_name: "Priya Nair",
  qualification: "M.Sc Mathematics, Pune University",
  specialization: "Board exam preparation",
  experience_years: 9,
  hourly_rate: 500,
  bio: "I teach Class 9-12 Mathematics for CBSE and ICSE.",
  demo_video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  subject: "Mathematics",
  curriculum: "CBSE",
  grade: "10th",
};

const card = (over: Partial<TeacherCardData> = {}) =>
  render(<TeacherCard teacher={{ ...BASE, ...over }} onStart={() => {}} />);

describe("the demo video", () => {
  // Item 1. The link existed but was buried at the bottom of the card as
  // text; a parent choosing a stranger for their child should see that a
  // video exists before they see anything else.
  it("shows the thumbnail for the video id, not a bare link", () => {
    card();
    const thumb = screen.getByRole("img", { name: /demo lesson/i });
    expect(thumb).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"
    );
  });

  // Nothing from youtube.com is fetched until a parent asks for it: the
  // thumbnail comes from ytimg and the player is only inserted on click.
  it("does not embed a player until the thumbnail is clicked", () => {
    const { container } = card();
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toContain(
      "youtube-nocookie.com/embed/dQw4w9WgXcQ"
    );
  });

  // A teacher with no video, or one whose stored link cannot be parsed, must
  // not produce an empty frame or a broken image in front of a student.
  it.each([
    ["no video at all", null],
    ["a link that is not parseable", "https://vimeo.com/12345"],
  ])("renders no media for %s", (_label, url) => {
    const { container } = card({ demo_video_url: url });
    expect(screen.queryByRole("img", { name: /demo lesson/i })).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
  });

  // Pinned on the class string, which is normally a brittle thing to assert —
  // but jsdom has no layout engine, so the alternative is no coverage at all
  // for a defect that is invisible in tests and obvious on screen: with the
  // media column still declared, a teacher who never uploaded a video gets
  // their facts squeezed into an empty 11rem track.
  it.each([
    ["reserves a media column when there is a video", BASE.demo_video_url, "video"],
    ["reserves none when there is not", null, "none"],
  ])("%s", (_label, url, expected) => {
    const { container } = card({ demo_video_url: url });
    const root = container.querySelector("[data-media]");
    expect(root).toHaveAttribute("data-media", expected);
    expect(root?.className.includes("lg:grid-cols-[11rem_1fr_11rem]")).toBe(
      expected === "video"
    );
  });
});

describe("availability", () => {
  // Item 3, as amended. deriveRoster ranks live-presence teachers above
  // push-only ones but deliberately does NOT label them (spec 6.2) -- a
  // visible second tier would stop push-only teachers being picked at all.
  // Every teacher the roster returns IS reachable, so the card says so for
  // all of them and exposes no tier. This test is the guard: the day someone
  // makes this conditional, it fails.
  it("says a teacher is available without taking any prop to vary it", () => {
    card();
    expect(screen.getByText(/available now/i)).toBeInTheDocument();
  });

  it("says it for a teacher with no video either", () => {
    card({ demo_video_url: null });
    expect(screen.getByText(/available now/i)).toBeInTheDocument();
  });
});

describe("the price", () => {
  // Item 4. The rate was always correct -- a session is exactly
  // SESSION_DURATION_MINUTES long, so amountPaiseFor returns hourly_rate.
  // What the card never said is how long the lesson lasts, which is the
  // thing the parent is actually buying.
  it("states the session length alongside the rate", () => {
    card();
    expect(screen.getByText("₹500")).toBeInTheDocument();
    expect(screen.getByText(/for a 1-hour session/i)).toBeInTheDocument();
  });

  // Derived, not typed. If the session length ever changes, this copy moves
  // with it rather than quietly becoming a lie.
  it("derives the length from the session constant", () => {
    expect(SESSION_DURATION_MINUTES).toBe(60);
  });

  it("shows a dash rather than a broken price when no rate is set", () => {
    card({ hourly_rate: null });
    expect(screen.getByText("₹—")).toBeInTheDocument();
  });
});

describe("the bio", () => {
  const LONG =
    "I teach Class 9-12 Mathematics for CBSE and ICSE boards. " +
    "My focus is on making sure a student can explain why a method works, " +
    "rather than only reproducing it under exam conditions. Most of the " +
    "students who come to me are preparing for their board examinations.";

  // Item 9. The old card clamped to three lines with no way to expand, so a
  // teacher who wrote a good bio had most of it silently discarded.
  it("expands a clamped bio in place", () => {
    card({ bio: LONG });
    const toggle = screen.getByRole("button", { name: /show more/i });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /show less/i })).toBeInTheDocument();
  });

  it("offers no toggle for a bio short enough to read whole", () => {
    card({ bio: "Short." });
    expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
  });

  it("renders nothing for an empty bio", () => {
    card({ bio: "   " });
    expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
  });
});

describe("the fact lines", () => {
  // Item 8. "Education" / "Specialization" were bare labels that each cost a
  // line and told a parent nothing. profile-claims.test.ts separately pins
  // that these fields reach the card at all; this pins that they say
  // something useful when they get here.
  // Asserted on the fact list as one string rather than three lookups:
  // "Mathematics" legitimately appears twice on the card (the subject, and
  // inside "M.Sc Mathematics"), and what matters is that subject, class and
  // board read as a single line rather than three labelled rows.
  it("puts the subject with the class and board it is taught for", () => {
    const { container } = card();
    expect(container.querySelector("ul")?.textContent).toMatch(
      /Mathematics\s*·\s*10th\s*·\s*CBSE/
    );
  });

  it("pairs the qualification with the years of experience", () => {
    card();
    expect(screen.getByText(/M\.Sc Mathematics/)).toBeInTheDocument();
    expect(screen.getByText(/9 years teaching/i)).toBeInTheDocument();
  });

  it("omits a fact line entirely rather than printing an empty label", () => {
    card({ qualification: null, experience_years: null, specialization: null });
    expect(screen.queryByText(/years teaching/i)).toBeNull();
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
  });
});

describe("the action", () => {
  it("disables the button while a request is in flight", () => {
    render(<TeacherCard teacher={BASE} onStart={() => {}} starting />);
    expect(screen.getByRole("button", { name: /asking/i })).toBeDisabled();
  });

  it("disables the button when the card is not startable", () => {
    render(<TeacherCard teacher={BASE} />);
    expect(screen.getByRole("button", { name: /start now/i })).toBeDisabled();
  });

  // Item 7, the smallest half of it: the promise that matters is the one
  // shown where the money is about to be committed, not only on the landing
  // page the parent left ten minutes ago.
  it("states that nothing is charged until the teacher accepts", () => {
    card();
    expect(screen.getByText(/nothing is charged until/i)).toBeInTheDocument();
  });
});
