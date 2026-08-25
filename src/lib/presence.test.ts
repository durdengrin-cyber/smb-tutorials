import { describe, it, expect } from "vitest";
import { PRESENCE_CHANNEL, rosterFromPresenceState, intersectOnline } from "./presence";

const a = { teacher_id: "t1", full_name: "Dr. Rao", hourly_rate: 500 };
const b = { teacher_id: "t2", full_name: "Ms. Iyer", hourly_rate: 400 };

describe("presence", () => {
  it("names the shared channel", () => {
    expect(PRESENCE_CHANNEL).toBe("teachers-online");
  });

  it("flattens Supabase's keyed presence state", () => {
    expect(rosterFromPresenceState({ t1: [a], t2: [b] })).toEqual([a, b]);
  });

  it("dedupes a teacher present from two tabs", () => {
    expect(rosterFromPresenceState({ t1: [a, a] })).toEqual([a]);
  });

  it("ignores malformed entries rather than crashing the list", () => {
    const state = { t1: [a], bad: [{ full_name: "no id" }] } as never;
    expect(rosterFromPresenceState(state)).toEqual([a]);
  });

  it("keeps only eligible teachers who are online, preserving eligible order", () => {
    const eligible = [{ id: "t2" }, { id: "t1" }, { id: "t3" }];
    expect(intersectOnline(eligible, [a, b])).toEqual([{ id: "t2" }, { id: "t1" }]);
  });

  it("returns nothing when nobody is online", () => {
    expect(intersectOnline([{ id: "t1" }], [])).toEqual([]);
  });
});
