import { describe, it, expect } from "vitest";
import { firstName } from "@/lib/names";

describe("firstName", () => {
  // The case that sent this into existence: a teacher registered as
  // "Mr. Azad", and all four sentences that address a teacher by first name
  // rendered "Mr." — beside the price, on the booking button, in the phone
  // card's disclosure and in the unavailable banner.
  it("drops a leading honorific", () => {
    expect(firstName("Mr. Azad")).toBe("Azad");
  });

  it.each([
    ["Mr. Azad", "Azad"],
    ["Mr Azad", "Azad"],
    ["mr. azad", "azad"],
    ["MR. AZAD", "AZAD"],
    ["Mrs. Priya Nair", "Priya"],
    ["Ms Priya", "Priya"],
    ["Miss Priya", "Priya"],
    ["Mx. Alex", "Alex"],
    ["Dr. Rao", "Rao"],
    ["Prof. Rao", "Rao"],
    ["Professor Rao", "Rao"],
    ["Shri Kumar", "Kumar"],
    ["Smt. Lakshmi", "Lakshmi"],
    ["Sri Kumar", "Kumar"],
  ])("%s -> %s", (input, expected) => {
    expect(firstName(input)).toBe(expected);
  });

  it("strips more than one where a name carries both", () => {
    expect(firstName("Prof. Dr. Rao")).toBe("Rao");
  });

  it("leaves an ordinary name alone", () => {
    expect(firstName("Priya Nair")).toBe("Priya");
    expect(firstName("Azad")).toBe("Azad");
  });

  // A two-letter first name is a real name. Any "short token is a title"
  // shortcut would eat these, which is why the rule is an explicit list.
  it("does not mistake a short first name for a title", () => {
    expect(firstName("Jo Smith")).toBe("Jo");
    expect(firstName("Li Wei")).toBe("Li");
  });

  // "Mr" is a title; "Mrs" is a title; a name that merely STARTS with those
  // letters is not.
  it("matches whole tokens, not prefixes", () => {
    expect(firstName("Mridula Sharma")).toBe("Mridula");
    expect(firstName("Drew Barry")).toBe("Drew");
    expect(firstName("Misha Patel")).toBe("Misha");
    expect(firstName("Sriram Iyer")).toBe("Sriram");
  });

  it("tidies whitespace", () => {
    expect(firstName("  Mr.   Azad  ")).toBe("Azad");
    expect(firstName("Priya\tNair")).toBe("Priya");
  });

  // These render inside sentences about money — "Nothing is charged until X
  // accepts." An empty X there is worse than an odd-looking one, so a name
  // that is nothing but a title keeps what was stored.
  it("never renders nothing", () => {
    expect(firstName("Dr.")).toBe("Dr.");
    expect(firstName("Prof. Dr.")).toBe("Prof. Dr.");
  });

  it("handles an empty name", () => {
    expect(firstName("")).toBe("");
    expect(firstName("   ")).toBe("");
  });
});
