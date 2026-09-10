import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { echoConsentForm } from "@/lib/form-state";

// The consent gate was built for accounts that had NEVER consented — the
// Google interstitial path, where there is nothing stored to lose. That is why
// AuthState was defined with `values?: never` and the learner fields render
// blank.
//
// CONSENT_VERSION 2026-09-10-recording changes who arrives here. Every existing
// family is now sent back to this form, and for them the fields are not empty
// prompts: they are the child's name the tutor sees and the grade that drives
// matching, already stored, about to be overwritten by whatever this blank form
// submits (consent/actions.ts updates unconditionally).
//
// Two separate losses, both pinned below:
//   1. The form must arrive carrying the stored values, or a returning guardian
//      retypes them from memory and a typo silently replaces them.
//   2. A rejected submit must hand back what was TYPED, or correcting the name
//      and forgetting the checkbox restores the old one.
const SRC = (...p: string[]) =>
  readFileSync(join("src", "app", "(gate)", "consent", ...p), "utf8").replace(/\s+/g, " ");

const PAGE = SRC("page.tsx");
const FORM = SRC("consent-form.tsx");
const ACTIONS = SRC("actions.ts");

describe("the consent gate arrives carrying what is already stored", () => {
  it("the page reads the learner's stored name and grade", () => {
    expect(PAGE, "page.tsx never selects the learner columns").toMatch(
      /learner_first_name/
    );
    expect(PAGE).toMatch(/learner_grade/);
  });

  it("the page hands them to the form", () => {
    expect(PAGE).toMatch(/learner=\{/);
  });

  it("the form defaults both fields rather than rendering them blank", () => {
    expect(FORM, "learnerFirstName has no defaultValue").toMatch(
      /name="learnerFirstName"[\s\S]{0,200}?defaultValue|defaultValue[\s\S]{0,200}?name="learnerFirstName"/
    );
    // A <select> ignores a changed defaultValue unless it remounts — the bug
    // this repo already paid for once across every select in the app.
    expect(FORM, "the grade select has no remount key").toMatch(/useResubmitKey/);
  });
});

describe("a rejected submit hands back what was typed", () => {
  it("the action echoes values on every failure path", () => {
    expect(ACTIONS).toMatch(/echoConsentForm/);
    // Each early return must carry values, not just an error string.
    const bareErrors = ACTIONS.match(/return \{ error: "[^"]*" \};/g) ?? [];
    expect(
      bareErrors,
      `these returns drop the guardian's input: ${bareErrors.join(" | ")}`
    ).toHaveLength(0);
  });

  it("echoConsentForm reads back what was submitted, including a rejected grade", () => {
    const fd = new FormData();
    fd.set("learnerFirstName", "  Zainab  ");
    fd.set("learnerGrade", "13th"); // not a real grade; must still come back
    fd.set("consent", "yes");
    expect(echoConsentForm(fd)).toEqual({
      learnerFirstName: "  Zainab  ",
      learnerGrade: "13th",
      consent: true,
    });
  });

  it("echoes an unticked checkbox as false rather than dropping the field", () => {
    const fd = new FormData();
    fd.set("learnerFirstName", "Zainab");
    fd.set("learnerGrade", "8th");
    expect(echoConsentForm(fd).consent).toBe(false);
  });

  // The guardrail from form-state.ts: no echo type may carry a password.
  it("carries no password", () => {
    const fd = new FormData();
    fd.set("password", "hunter2");
    expect(JSON.stringify(echoConsentForm(fd))).not.toMatch(/hunter2/);
  });
});

// A CONSENT_VERSION bump interrupts people mid-task. requireUser() now carries
// the attempted path into /consent?next=..., and this is the other half: the
// form has to hand it back to the action, because a Server Action receives
// FormData and never the URL it was posted from.
describe("the gate returns you to what it interrupted", () => {
  it("the page reads next off the query string", () => {
    expect(PAGE).toMatch(/searchParams/);
    expect(PAGE).toMatch(/next=\{next\}/);
  });

  it("the form carries it in a hidden field", () => {
    expect(FORM).toMatch(/type="hidden" name="next"/);
  });

  it("the action redirects through safeNext, never the raw value", () => {
    expect(ACTIONS).toMatch(/redirect\(safeNext\(formData\.get\("next"\)/);
    // An open redirect is the failure mode here: `next` arrives from a query
    // string. resolveHome stays as the fallback.
    expect(ACTIONS).toMatch(/safeNext\([\s\S]*?resolveHome\(identity\.role\)\)/);
    expect(ACTIONS, "a raw redirect to next would be an open redirect").not.toMatch(
      /redirect\(\s*formData\.get\("next"\)/
    );
  });
});
