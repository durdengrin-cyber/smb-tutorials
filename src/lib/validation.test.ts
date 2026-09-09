import { describe, it, expect } from "vitest";
import {
  parseSignIn,
  parseStudentSignUp,
  parseTutorSignUp,
  parseTeacherProfile,
  parseNewPassword,
}  from "./validation";

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o))
    (Array.isArray(v) ? v : [v]).forEach((x) => f.append(k, x));
  return f;
};

describe("parseSignIn", () => {
  it("accepts email+password", () => {
    const r = parseSignIn(fd({ email: "a@b.com", password: "secret123" }));
    expect(r).toEqual({
      ok: true,
      value: { email: "a@b.com", password: "secret123" },
    });
  });

  it("rejects missing fields", () => {
    expect(parseSignIn(fd({ email: "a@b.com" })).ok).toBe(false);
  });
});

describe("parseStudentSignUp", () => {
  it("accepts valid input and trims name", () => {
    const r = parseStudentSignUp(
      fd({
        fullName: " Asha ",
        email: "a@b.com",
        password: "secret123",
        confirmPassword: "secret123",
        consent: "yes",
        learnerFirstName: "Ravi",
        learnerGrade: "9th",
      })
    );
    expect(r.ok && r.value.fullName).toBe("Asha");
  });

  it("requires the learner's first name", () => {
    const r = parseStudentSignUp(
      fd({
        fullName: "Asha",
        email: "a@b.com",
        password: "secret123",
        confirmPassword: "secret123",
        consent: "yes",
        learnerGrade: "9th",
      })
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/student/i);
  });

  it("rejects a grade outside 6th-12th", () => {
    const r = parseStudentSignUp(
      fd({
        fullName: "Asha",
        email: "a@b.com",
        password: "secret123",
        confirmPassword: "secret123",
        consent: "yes",
        learnerFirstName: "Ravi",
        learnerGrade: "1st",
      })
    );
    expect(r.ok).toBe(false);
  });

  it("returns the learner fields on success", () => {
    const r = parseStudentSignUp(
      fd({
        fullName: "Asha",
        email: "a@b.com",
        password: "secret123",
        confirmPassword: "secret123",
        consent: "yes",
        learnerFirstName: " Ravi ",
        learnerGrade: "9th",
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.learnerFirstName).toBe("Ravi");
      expect(r.value.learnerGrade).toBe("9th");
    }
  });

  // The consent box carried no `name` before 2026-09-04, so it never left the
  // browser: `required` stopped a human and stopped nothing else. A consent
  // record any non-browser client can skip is not a record, and this is the
  // agreement that has to hold up if a session is ever recorded.
  it("refuses a signup with no consent, however valid the rest is", () => {
    const r = parseStudentSignUp(
      fd({
        fullName: "Asha",
        email: "a@b.com",
        password: "secret123",
        confirmPassword: "secret123",
        learnerFirstName: "Ravi",
        learnerGrade: "9th",
      })
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/parent or guardian/i);
  });

  it("rejects password mismatch", () => {
    const r = parseStudentSignUp(
      fd({
        fullName: "A",
        email: "a@b.com",
        password: "secret123",
        confirmPassword: "nope",
      })
    );
    expect(!r.ok && r.error).toMatch(/match/i);
  });

  it("rejects short password", () => {
    expect(
      parseStudentSignUp(
        fd({
          fullName: "A",
          email: "a@b.com",
          password: "abc",
          confirmPassword: "abc",
        })
      ).ok
    ).toBe(false);
  });
});

describe("parseTutorSignUp", () => {
  const base = {
    fullName: "Dr. Rao",
    email: "rao@x.com",
    password: "secret123",
    phone: "9876543210",
    experience: "8",
    qualification: "PhD Physics",
    specialization: "Mechanics",
    teachingLevel: "school",
    hourlyRate: "500",
    hoursPerWeek: "10-20",
    demoVideoUrl: "https://youtu.be/abc",
    curricula: ["CBSE"],
    grades: ["11th", "12th"],
    subjects: ["Science|Physics", "Science|Chemistry"],
    consent: "yes",
  };

  it("expands curricula × grades × subjects into rows", () => {
    const r = parseTutorSignUp(fd(base));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subjects).toHaveLength(4); // 1 curriculum × 2 grades × 2 subjects
      expect(r.value.subjects).toContainEqual({
        curriculum: "CBSE",
        grade: "12th",
        stream: "Science",
        subject: "Physics",
      });
      expect(r.value.experienceYears).toBe(8);
      expect(r.value.hourlyRate).toBe(500);
    }
  });

  it("rejects a subject not in its stream", () => {
    expect(
      parseTutorSignUp(fd({ ...base, subjects: ["Science|History"] })).ok
    ).toBe(false);
  });

  it("rejects invalid curriculum, empty grades, empty subjects, bad rate", () => {
    expect(parseTutorSignUp(fd({ ...base, curricula: ["IB"] })).ok).toBe(false);
    expect(parseTutorSignUp(fd({ ...base, grades: [] })).ok).toBe(false);
    expect(parseTutorSignUp(fd({ ...base, subjects: [] })).ok).toBe(false);
    expect(parseTutorSignUp(fd({ ...base, hourlyRate: "0" })).ok).toBe(false);
  });

  it("rejects a blank experience field rather than reading it as zero", () => {
    expect(parseTutorSignUp(fd({ ...base, experience: "" })).ok).toBe(false);
  });

  it("rejects a phone number that is not 10 digits", () => {
    expect(parseTutorSignUp(fd({ ...base, phone: "12345" })).ok).toBe(false);
  });

  it("treats optional specialization and teaching level as null", () => {
    const r = parseTutorSignUp(
      fd({ ...base, specialization: "", teachingLevel: "" })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.specialization).toBeNull();
      expect(r.value.teachingLevel).toBeNull();
    }
  });

  // The same defect 0014 closed on the student form, still open on this one:
  // the tutor checkbox carried `required` and no `name`, so it never left the
  // browser, and this parser never asked for it. A teacher agreeing to how a
  // child's data is handled is not a lesser agreement than a parent doing so —
  // and the trial teachers are real people signing a real document.
  it("refuses a tutor signup with no consent, however valid the rest is", () => {
    const withoutConsent: Record<string, string | string[]> = { ...base };
    delete withoutConsent.consent;
    const r = parseTutorSignUp(fd(withoutConsent));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/terms/i);
  });

  // Pins the order this function checks things in: fullName, then consent,
  // email and password, all before any profile field (phone onward) gets a
  // chance to fail — the order it used before parseTeacherProfileFields
  // existed. Each case below is invalid on an account field AND on `phone`;
  // the account-field error must win every time.
  describe("checks account fields before profile fields", () => {
    it("reports missing consent over a bad phone number", () => {
      const withoutConsent: Record<string, string | string[]> = {
        ...base,
        phone: "12345",
      };
      delete withoutConsent.consent;
      const r = parseTutorSignUp(fd(withoutConsent));
      expect(!r.ok && r.error).toMatch(/terms/i);
    });

    it("reports a bad email over a bad phone number", () => {
      const r = parseTutorSignUp(
        fd({ ...base, email: "not-an-email", phone: "12345" })
      );
      expect(!r.ok && r.error).toMatch(/email/i);
    });

    it("reports a short password over a bad phone number", () => {
      const r = parseTutorSignUp(
        fd({ ...base, password: "short", phone: "12345" })
      );
      expect(!r.ok && r.error).toMatch(/password/i);
    });
  });

  it("dedupes repeated subject selections", () => {
    const r = parseTutorSignUp(
      fd({
        ...base,
        grades: ["11th"],
        subjects: ["Science|Physics", "Science|Physics"],
      })
    );
    expect(r.ok && r.value.subjects).toHaveLength(1);
  });
});

describe("parseTeacherProfile", () => {
  const base = {
    fullName: "Dr. Rao",
    phone: "9876543210",
    experience: "8",
    qualification: "PhD Physics",
    specialization: "Mechanics",
    teachingLevel: "school",
    hourlyRate: "500",
    hoursPerWeek: "10-20",
    demoVideoUrl: "https://youtu.be/abc",
    bio: "I teach physics with a focus on problem solving.",
    curricula: ["CBSE"],
    grades: ["11th", "12th"],
    subjects: ["Science|Physics", "Science|Chemistry"],
  };

  it("accepts a full edit and expands subjects the same way signup does", () => {
    const r = parseTeacherProfile(fd(base));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subjects).toHaveLength(4); // 1 curriculum × 2 grades × 2 subjects
      expect(r.value.hourlyRate).toBe(500);
      expect(r.value.bio).toBe("I teach physics with a focus on problem solving.");
    }
  });

  // parseTeacherProfile must not be able to smuggle account fields through —
  // email is auth-managed and role is immutable by design (migration 0013).
  it("carries no email, password, consent or role even when the form sends them", () => {
    const r = parseTeacherProfile(
      fd({ ...base, email: "x@y.com", password: "whatever8", consent: "yes", role: "admin" })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const value = r.value as unknown as Record<string, unknown>;
      expect(value).not.toHaveProperty("email");
      expect(value).not.toHaveProperty("password");
      expect(value).not.toHaveProperty("consent");
      expect(value).not.toHaveProperty("role");
    }
  });

  it("rejects a blank full name", () => {
    expect(parseTeacherProfile(fd({ ...base, fullName: "" })).ok).toBe(false);
  });

  it("rejects a phone number that is not 10 digits", () => {
    expect(parseTeacherProfile(fd({ ...base, phone: "12345" })).ok).toBe(false);
  });

  it("rejects a blank experience field rather than reading it as zero", () => {
    expect(parseTeacherProfile(fd({ ...base, experience: "" })).ok).toBe(false);
  });

  it("rejects a blank qualification", () => {
    expect(parseTeacherProfile(fd({ ...base, qualification: "" })).ok).toBe(false);
  });

  it("treats optional specialization and teaching level as null", () => {
    const r = parseTeacherProfile(
      fd({ ...base, specialization: "", teachingLevel: "" })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.specialization).toBeNull();
      expect(r.value.teachingLevel).toBeNull();
    }
  });

  it("rejects a non-positive hourly rate", () => {
    expect(parseTeacherProfile(fd({ ...base, hourlyRate: "0" })).ok).toBe(false);
  });

  it("rejects an hours-per-week value outside the allowed set", () => {
    expect(parseTeacherProfile(fd({ ...base, hoursPerWeek: "100+" })).ok).toBe(false);
  });

  it("rejects a demo video link that is not http(s)", () => {
    expect(parseTeacherProfile(fd({ ...base, demoVideoUrl: "ftp://example.com/x" })).ok).toBe(
      false
    );
  });

  it("rejects an invalid curriculum", () => {
    expect(parseTeacherProfile(fd({ ...base, curricula: ["IB"] })).ok).toBe(false);
  });

  it("rejects empty grades", () => {
    expect(parseTeacherProfile(fd({ ...base, grades: [] })).ok).toBe(false);
  });

  // A teacher with zero subjects is invisible in search and has no other way
  // to find out why — the rejection has to say so, not just fail silently.
  it("rejects zero subjects with a message explaining why that matters", () => {
    const r = parseTeacherProfile(fd({ ...base, subjects: [] }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/subject/i);
    expect(!r.ok && r.error).toMatch(/search/i);
  });

  it("rejects a bio over the 1000 character cap", () => {
    const tooLong = "a".repeat(1001);
    expect(parseTeacherProfile(fd({ ...base, bio: tooLong })).ok).toBe(false);
  });

  it("accepts a bio at exactly the 1000 character cap", () => {
    const exact = "a".repeat(1000);
    const r = parseTeacherProfile(fd({ ...base, bio: exact }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.bio).toBe(exact);
  });

  it("treats a blank bio as null", () => {
    const r = parseTeacherProfile(fd({ ...base, bio: "   " }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.bio).toBeNull();
  });

  it("trims bio whitespace", () => {
    const r = parseTeacherProfile(fd({ ...base, bio: "  hello there  " }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.bio).toBe("hello there");
  });
});

// parseTeacherProfileFields exists so a rate, qualification or hours-per-week
// rule can't drift between signup and editing by being re-typed in two
// places. Nothing above fails if someone re-duplicates those rules instead of
// reusing the shared helper — both suites stay green either way. These tests
// are what would: they pin that the two public parsers reject the SAME
// invalid input with the SAME message, so a divergent copy (a different
// threshold, a different message) breaks one side without the other.
describe("parseTutorSignUp and parseTeacherProfile validate profile fields identically", () => {
  const tutorBase = {
    fullName: "Dr. Rao",
    email: "rao@x.com",
    password: "secret123",
    phone: "9876543210",
    experience: "8",
    qualification: "PhD Physics",
    specialization: "Mechanics",
    teachingLevel: "school",
    hourlyRate: "500",
    hoursPerWeek: "10-20",
    demoVideoUrl: "https://youtu.be/abc",
    curricula: ["CBSE"],
    grades: ["11th", "12th"],
    subjects: ["Science|Physics"],
    consent: "yes",
  };
  const profileBase = {
    fullName: "Dr. Rao",
    phone: "9876543210",
    experience: "8",
    qualification: "PhD Physics",
    specialization: "Mechanics",
    teachingLevel: "school",
    hourlyRate: "500",
    hoursPerWeek: "10-20",
    demoVideoUrl: "https://youtu.be/abc",
    bio: "",
    curricula: ["CBSE"],
    grades: ["11th", "12th"],
    subjects: ["Science|Physics"],
  };

  it("reject the same invalid hourly rate with the same message", () => {
    const a = parseTutorSignUp(fd({ ...tutorBase, hourlyRate: "0" }));
    const b = parseTeacherProfile(fd({ ...profileBase, hourlyRate: "0" }));
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(!a.ok && a.error).toBe(!b.ok && b.error);
  });

  it("reject the same missing qualification with the same message", () => {
    const a = parseTutorSignUp(fd({ ...tutorBase, qualification: "" }));
    const b = parseTeacherProfile(fd({ ...profileBase, qualification: "" }));
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(!a.ok && a.error).toBe(!b.ok && b.error);
  });

  it("reject the same invalid hours-per-week with the same message", () => {
    const a = parseTutorSignUp(fd({ ...tutorBase, hoursPerWeek: "100+" }));
    const b = parseTeacherProfile(fd({ ...profileBase, hoursPerWeek: "100+" }));
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(!a.ok && a.error).toBe(!b.ok && b.error);
  });
});

describe("parseNewPassword", () => {
  const fd = (password: string, confirmPassword: string) => {
    const f = new FormData();
    f.set("password", password);
    f.set("confirmPassword", confirmPassword);
    return f;
  };

  // Same floor as signup. A reset that accepted a weaker password than signup
  // would be the cheapest way to downgrade an account's security.
  it("rejects a password shorter than 8 characters", () => {
    const r = parseNewPassword(fd("short", "short"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/8 characters/);
  });

  it("rejects a mismatched confirmation", () => {
    const r = parseNewPassword(fd("longenough1", "longenough2"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/do not match/i);
  });

  // Not trimmed: leading and trailing spaces are legitimate password
  // characters, and silently stripping them means the password someone typed
  // is not the password that was stored.
  it("preserves surrounding whitespace rather than trimming it", () => {
    const r = parseNewPassword(fd("  spaced8  ", "  spaced8  "));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.password).toBe("  spaced8  ");
  });

  it("accepts a valid matching pair", () => {
    const r = parseNewPassword(fd("goodpassword", "goodpassword"));
    expect(r.ok).toBe(true);
  });
});
