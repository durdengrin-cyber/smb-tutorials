// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";

import { TeacherCard, type TeacherCardData } from "./teacher-card";

// Two defects found on 2026-09-14 by opening /teachers with a teacher
// actually online. Both had been live for three days, both were invisible to
// the 721 tests that were passing, and they share one cause: the card and the
// things around it disagreed about how wide the card is.
//
//   1. online-list.tsx wrapped the card in `md:grid-cols-2 lg:grid-cols-3`,
//      giving it a 299-368px cell. The card's lg template is a full-width ROW
//      — 11rem media, the facts, 11rem decision column = 471px — and Card
//      sets overflow-hidden, so 103-172px of the decision column was clipped
//      at EVERY desktop width from 1024px up. The clipped part contained the
//      price and "Start now", the product's primary call to action.
//
//   2. The specialization line was hidden with `hidden lg:block`. Fact is a
//      GRID (a 1rem icon column beside the text), and Tailwind emits `block`
//      after the base `grid` utility, so at lg the row's display flipped to
//      block and its icon dropped onto its own line above the words.
//
// Neither is assertable by rendering alone: jsdom has no layout engine, so it
// computes no overflow and no grid tracks. teacher-card.test.tsx already
// pins class strings for exactly this reason and says so. These tests pin the
// two class decisions that the layout depends on, which is the most a test in
// this project can do — the rest is someone opening the page and looking.

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

describe("the list gives the card a full-width row", () => {
  // Read from source rather than rendered, because online-list.tsx is a
  // client component behind presence subscriptions and realtime; standing all
  // of that up to assert one className would test the mocks, not the layout.
  const source = readFileSync(
    resolve(process.cwd(), "src/app/(app)/(student)/teachers/online-list.tsx"),
    "utf8"
  );

  it("wraps the cards in a container that declares no column count", () => {
    const at = source.indexOf("{online.map(");
    expect(at, "the map over teachers moved; this test needs rewriting").toBeGreaterThan(0);

    // The last className opened before the map is the wrapper's.
    const before = source.slice(0, at);
    const className = before.match(/className="([^"]*)"(?![\s\S]*className=")/)?.[1];
    expect(className, "no className found on the cards' wrapper").toBeTruthy();

    // `grid-cols-2`, `lg:grid-cols-3`, `sm:grid-cols-[...]` — any of them puts
    // the card in a fraction of the row and re-clips the decision column.
    expect(className).not.toMatch(/grid-cols-/);
  });
});

describe("a hidden fact keeps its icon beside its text", () => {
  const renderCard = () =>
    render(<TeacherCard teacher={BASE} onStart={() => {}} />);

  /** The <li> carrying the specialization, whatever it is wrapped in. */
  const specLi = (container: HTMLElement) =>
    [...container.querySelectorAll("li")].find((li) =>
      (li.textContent ?? "").includes(BASE.specialization!)
    );

  // `hidden` is fine — that is the hiding mechanism, and display:none leaves
  // nothing to misalign. `block` is the bug: it overrides Fact's own `grid`
  // and the icon column stops existing.
  const DISPLAY_OVERRIDE = /(^|\s|:)block(\s|$)/;

  it("hides it without flattening the grid, on desktop", () => {
    const { container } = renderCard();
    const li = specLi(container);
    expect(li, "specialization row not rendered").toBeTruthy();
    expect(li!.className).toContain("lg:grid");
    expect(li!.className).not.toMatch(DISPLAY_OVERRIDE);
  });

  it("shows it without flattening the grid, on an opened phone card", () => {
    const { container } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /More about/i }));

    const li = specLi(container);
    expect(li!.className).toContain("grid");
    expect(li!.className).not.toMatch(DISPLAY_OVERRIDE);
  });
});
