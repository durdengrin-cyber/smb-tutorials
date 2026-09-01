import { describe, it, expect } from "vitest";
import { deriveRoster } from "./roster";

const t = (id: string) => ({ id, full_name: id });
const present = (id: string) => ({ teacher_id: id, full_name: id, hourly_rate: 500 });

describe("deriveRoster", () => {
  it("keeps a teacher with a live connection", () => {
    expect(
      deriveRoster([t("a")], [{ teacher_id: "a", has_device: false }], [present("a")]).map((x) => x.id)
    ).toEqual(["a"]);
  });

  // The push-only tier — the entire point of the cycle. A teacher with a
  // locked phone and a registered device is still startable.
  it("keeps a teacher with no connection but a working device", () => {
    expect(
      deriveRoster([t("a")], [{ teacher_id: "a", has_device: true }], []).map((x) => x.id)
    ).toEqual(["a"]);
  });

  // "Can't reach you" — hidden, not greyed. M2's rule: every visible card is
  // genuinely startable.
  it("hides a declared teacher with neither", () => {
    expect(deriveRoster([t("a")], [{ teacher_id: "a", has_device: false }], [])).toEqual([]);
  });

  it("hides a teacher the RPC did not return at all", () => {
    // Not declared, lease lapsed, or already in a session.
    expect(deriveRoster([t("a")], [], [present("a")])).toEqual([]);
  });

  // RANK, DON'T LABEL (spec §6.2). Badging push-only teachers would punish
  // exactly the teachers who did what we asked, and would land hardest on
  // iPhone users — a marketplace quietly discriminating by handset. Sorting
  // gets the same outcome with none of that.
  it("ranks live-connection teachers above push-only ones", () => {
    const out = deriveRoster(
      [t("push"), t("live")],
      [{ teacher_id: "push", has_device: true }, { teacher_id: "live", has_device: false }],
      [present("live")]
    );
    expect(out.map((x) => x.id)).toEqual(["live", "push"]);
  });

  it("preserves the incoming order within each tier", () => {
    const out = deriveRoster(
      [t("p1"), t("l1"), t("p2"), t("l2")],
      ["p1", "l1", "p2", "l2"].map((id) => ({ teacher_id: id, has_device: true })),
      [present("l1"), present("l2")]
    );
    expect(out.map((x) => x.id)).toEqual(["l1", "l2", "p1", "p2"]);
  });
});
