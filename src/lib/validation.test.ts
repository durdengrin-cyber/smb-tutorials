import { describe, it, expect } from "vitest";
import { parseSignIn, parseStudentSignUp, parseTutorSignUp } from "./validation";

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
      })
    );
    expect(r.ok && r.value.fullName).toBe("Asha");
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
