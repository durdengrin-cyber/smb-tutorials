import { describe, it, expect } from "vitest";
import {
  VETTING_STATES,
  isVettingState,
  canBePicked,
  vettingMessage,
} from "./vetting";

describe("VETTING_STATES", () => {
  // Spec §13 fixes these four. The DB CHECK constraint carries the same list —
  // if this test and 0020 disagree, one of them is wrong.
  it("is exactly the four states the migration allows", () => {
    expect([...VETTING_STATES]).toEqual(["unvetted", "cleared", "suspended", "removed"]);
  });
});

describe("isVettingState", () => {
  it("accepts every legal state", () => {
    for (const s of VETTING_STATES) expect(isVettingState(s)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isVettingState("approved")).toBe(false);
    expect(isVettingState("")).toBe(false);
    expect(isVettingState("CLEARED")).toBe(false);
  });
});

describe("canBePicked", () => {
  // The whole safety property in one line: only a cleared teacher meets a child.
  it("is true only for cleared", () => {
    expect(canBePicked("cleared")).toBe(true);
    expect(canBePicked("unvetted")).toBe(false);
    expect(canBePicked("suspended")).toBe(false);
    expect(canBePicked("removed")).toBe(false);
  });
});

describe("vettingMessage", () => {
  // A teacher who declared availability and sees no requests must be told why,
  // or they conclude the product is broken and leave.
  it("explains the wait to an unvetted teacher", () => {
    expect(vettingMessage("unvetted")).toMatchObject({
      title: expect.stringMatching(/review/i),
    });
  });

  it("tells a suspended teacher to expect contact", () => {
    expect(vettingMessage("suspended")?.body).toMatch(/contact/i);
  });

  it("says nothing to a cleared teacher", () => {
    expect(vettingMessage("cleared")).toBeNull();
  });

  it("has a message for every non-cleared state", () => {
    for (const s of VETTING_STATES) {
      if (s === "cleared") continue;
      expect(vettingMessage(s), s).not.toBeNull();
    }
  });
});
