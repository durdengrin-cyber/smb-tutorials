import { describe, it, expect } from "vitest";
import {
  parseSignIn,
  parseStudentSignUp,
  parseTutorSignUp,
  parseTutorUpgrade,
  parseTeacherProfile,
  parseNewPassword,
  youTubeVideoId,
  inspectDemoVideoUrl,
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


// The demo video is the only thing a vetting operator can judge a stranger by
// before that stranger is put in front of a child, so it has to actually
// resolve. The old rule was /^https?:\/\//, which accepted any URL on the
// internet — including a Google Drive link that can be un-shared after
// approval, which is why Drive is no longer offered.
describe("youTubeVideoId", () => {
  const ID = "dQw4w9WgXcQ"; // 11 chars, the only length YouTube has ever used

  it("accepts a standard watch link", () => {
    expect(youTubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("accepts a youtu.be short link", () => {
    expect(youTubeVideoId(`https://youtu.be/${ID}`)).toBe(ID);
  });

  // YouTube's own Share -> Copy link appends a tracking parameter. Rejecting
  // it would fail every teacher who follows our instructions exactly, which
  // is the single most likely way this validator could break signup.
  it("accepts the share link YouTube actually produces, with ?si=", () => {
    expect(youTubeVideoId(`https://youtu.be/${ID}?si=AbCdEfGhIjKlMnOp`)).toBe(ID);
  });

  it("accepts a timestamped link", () => {
    expect(youTubeVideoId(`https://www.youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
  });

  it("accepts the mobile host, which is what a phone pastes", () => {
    expect(youTubeVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("accepts a link with no www", () => {
    expect(youTubeVideoId(`https://youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("accepts shorts and embed forms", () => {
    expect(youTubeVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(youTubeVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
  });

  it("accepts http as well as https", () => {
    expect(youTubeVideoId(`http://youtu.be/${ID}`)).toBe(ID);
  });

  it("rejects Google Drive, the path this change removes", () => {
    expect(youTubeVideoId("https://drive.google.com/file/d/1a2b3c/view")).toBeNull();
  });

  it("rejects an arbitrary URL the old rule accepted", () => {
    expect(youTubeVideoId("https://example.com/my-demo.mp4")).toBeNull();
  });

  it("rejects a non-http scheme", () => {
    expect(youTubeVideoId("ftp://example.com/x")).toBeNull();
  });

  it("rejects a YouTube URL carrying no video id", () => {
    expect(youTubeVideoId("https://www.youtube.com/watch?v=")).toBeNull();
    expect(youTubeVideoId("https://www.youtube.com/")).toBeNull();
  });

  it("rejects an id of the wrong length", () => {
    expect(youTubeVideoId("https://youtu.be/abc")).toBeNull();
    expect(youTubeVideoId(`https://youtu.be/${ID}XX`)).toBeNull();
  });

  // A host that merely ends in something youtube-ish must not pass:
  // notyoutube.com and youtube.com.evil.tld are both attacker-controlled.
  it("rejects lookalike hosts", () => {
    expect(youTubeVideoId(`https://notyoutube.com/watch?v=${ID}`)).toBeNull();
    expect(youTubeVideoId(`https://youtube.com.evil.tld/watch?v=${ID}`)).toBeNull();
  });

  it("tolerates surrounding whitespace from a paste", () => {
    expect(youTubeVideoId(`  https://youtu.be/${ID}  `)).toBe(ID);
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
    demoVideoUrl: "https://youtu.be/dQw4w9WgXcQ",
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


// /tutor-signup is reachable while already signed in — the header offers
// "Go to your dashboard" on the same screen as "Sign up with Google" — and
// signUpTutor's existing-user branch upgrades that account instead of
// creating one. It never reads the email or password in that branch.
//
// parseTutorSignUp demanded both anyway, so a signed-in student converting to
// a teacher had to invent an 8-character password that was then thrown away.
// A reasonable person would believe they had just set their password.

// The two rejections are different problems and need different words.
// Production held "https://www.youtube.com/watch?v=abc123" — a genuine
// YouTube host with a six-character id where every real one is eleven. Both
// existing teachers had a link of this shape, so both would have been blocked
// from saving ANY profile change, and the message they'd have seen told them
// to enter a YouTube link they had already entered.
describe("inspectDemoVideoUrl — why a link was refused", () => {
  it("calls a non-YouTube host not-youtube", () => {
    expect(inspectDemoVideoUrl("https://drive.google.com/file/d/1a2b/view")).toEqual({
      ok: false,
      reason: "not-youtube",
    });
    expect(inspectDemoVideoUrl("ftp://example.com/x").ok).toBe(false);
  });

  // The exact values found in production on 2026-09-09.
  it("calls a real YouTube host with a fake id bad-id", () => {
    expect(inspectDemoVideoUrl("https://www.youtube.com/watch?v=abc123")).toEqual({
      ok: false,
      reason: "bad-id",
    });
    expect(inspectDemoVideoUrl("https://youtu.be/abc")).toEqual({
      ok: false,
      reason: "bad-id",
    });
  });

  it("tells the teacher to copy the link again when the host was right", () => {
    const base = {
      fullName: "Dr. Rao",
      phone: "9876543210",
      experience: "8",
      qualification: "PhD Physics",
      hourlyRate: "500",
      hoursPerWeek: "10-20",
      curricula: ["CBSE"],
      grades: ["11th"],
      subjects: ["Science|Physics"],
      bio: "",
    };
    const badId = parseTeacherProfile(
      fd({ ...base, demoVideoUrl: "https://www.youtube.com/watch?v=abc123" })
    );
    expect(!badId.ok && badId.error).toMatch(/11-character video id/);
    // and must NOT tell them to enter a YouTube link they already entered
    expect(!badId.ok && badId.error).not.toMatch(/Other hosts/);

    const notYt = parseTeacherProfile(
      fd({ ...base, demoVideoUrl: "https://vimeo.com/12345678" })
    );
    expect(!notYt.ok && notYt.error).toMatch(/Other hosts/);
  });
});

describe("parseTutorUpgrade — the signed-in path", () => {
  const base = {
    fullName: "Dr. Rao",
    phone: "9876543210",
    experience: "8",
    qualification: "PhD Physics",
    specialization: "Mechanics",
    teachingLevel: "school",
    hourlyRate: "500",
    hoursPerWeek: "10-20",
    demoVideoUrl: "https://youtu.be/dQw4w9WgXcQ",
    curricula: ["CBSE"],
    grades: ["11th"],
    subjects: ["Science|Physics"],
    consent: "yes",
  };

  it("accepts a form carrying no email and no password", () => {
    const r = parseTutorUpgrade(fd(base));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.fullName).toBe("Dr. Rao");
  });

  it("still requires consent, which is recorded either way", () => {
    const withoutConsent = { ...base, consent: "" };
    expect(parseTutorUpgrade(fd(withoutConsent)).ok).toBe(false);
  });

  it("still validates the profile fields", () => {
    expect(parseTutorUpgrade(fd({ ...base, hourlyRate: "0" })).ok).toBe(false);
    expect(parseTutorUpgrade(fd({ ...base, demoVideoUrl: "https://example.com/x" })).ok).toBe(
      false
    );
  });

  // The signed-out form is unchanged: it must still refuse to create an
  // account with no credentials.
  it("does not weaken the signed-out path", () => {
    const { consent, ...rest } = base;
    expect(parseTutorSignUp(fd({ ...rest, consent })).ok).toBe(false);
    expect(
      parseTutorSignUp(fd({ ...base, email: "rao@x.com", password: "secret123" })).ok
    ).toBe(true);
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
    demoVideoUrl: "https://youtu.be/dQw4w9WgXcQ",
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

  it("rejects a demo video link that is not a YouTube video", () => {
    expect(parseTeacherProfile(fd({ ...base, demoVideoUrl: "ftp://example.com/x" })).ok).toBe(
      false
    );
    expect(
      parseTeacherProfile(fd({ ...base, demoVideoUrl: "https://drive.google.com/file/d/1a2b/view" }))
        .ok
    ).toBe(false);
  });

  // Stored canonical, so /admin always links the same shape and the share
  // tracking parameter never reaches the database.
  it("normalises an accepted demo video link to its canonical form", () => {
    const r = parseTeacherProfile(
      fd({ ...base, demoVideoUrl: "https://youtu.be/dQw4w9WgXcQ?si=TRACKING" })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.demoVideoUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }
  });

  it("rejects an invalid curriculum", () => {
    expect(parseTeacherProfile(fd({ ...base, curricula: ["IB"] })).ok).toBe(false);
  });

  it("rejects empty grades", () => {
    expect(parseTeacherProfile(fd({ ...base, grades: [] })).ok).toBe(false);
  });

  // Since 0027 the profile editor does not collect subjects at all — changing
  // what you claim to teach goes through a request an admin approves, carrying
  // a new demo video — so this form submits none and must still save.
  it("accepts a profile save carrying no subjects", () => {
    const r = parseTeacherProfile(fd({ ...base, subjects: [] }));
    expect(r.ok).toBe(true);
  });

  // Signup is unchanged and still insists: a teacher who finishes signing up
  // with zero subjects is invisible in search with no way to find out why.
  it("still rejects zero subjects at SIGNUP, where they are collected", () => {
    const signup = {
      fullName: "Dr. Rao",
      email: "rao@x.com",
      password: "secret123",
      phone: "9876543210",
      experience: "8",
      qualification: "PhD Physics",
      hourlyRate: "500",
      hoursPerWeek: "10-20",
      demoVideoUrl: "https://youtu.be/dQw4w9WgXcQ",
      curricula: ["CBSE"],
      grades: ["11th"],
      subjects: [] as string[],
      consent: "yes",
    };
    const r = parseTutorSignUp(fd(signup));
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
    demoVideoUrl: "https://youtu.be/dQw4w9WgXcQ",
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
    demoVideoUrl: "https://youtu.be/dQw4w9WgXcQ",
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
