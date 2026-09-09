import { describe, it, expect } from "vitest";
import { echoTutorForm } from "./form-state";

// React 19 resets an uncontrolled form when its action completes, so a
// rejected tutor application came back completely blank. Measured in a real
// browser on 2026-09-09: fullName, email, phone, experience, qualification,
// specialization, teachingLevel, hourlyRate, hoursPerWeek, demoVideoUrl all
// empty, and every curriculum, grade and subject chip cleared — fifteen fields
// lost to one mistyped character in a YouTube link.
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o))
    (Array.isArray(v) ? v : [v]).forEach((x) => f.append(k, x));
  return f;
};

const filled = {
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
  curricula: ["CBSE", "ICSE"],
  grades: ["11th", "12th"],
  subjects: ["Science|Physics"],
  consent: "yes",
};

describe("echoTutorForm", () => {
  it("carries every text field back", () => {
    const v = echoTutorForm(fd(filled));
    expect(v.fullName).toBe("Dr. Rao");
    expect(v.email).toBe("rao@x.com");
    expect(v.phone).toBe("9876543210");
    expect(v.experience).toBe("8");
    expect(v.qualification).toBe("PhD Physics");
    expect(v.specialization).toBe("Mechanics");
    expect(v.teachingLevel).toBe("school");
    expect(v.hourlyRate).toBe("500");
    expect(v.hoursPerWeek).toBe("10-20");
    expect(v.demoVideoUrl).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  it("carries every multi-select back, not just the first", () => {
    const v = echoTutorForm(fd(filled));
    expect(v.curricula).toEqual(["CBSE", "ICSE"]);
    expect(v.grades).toEqual(["11th", "12th"]);
    expect(v.subjects).toEqual(["Science|Physics"]);
    expect(v.consent).toBe(true);
  });

  // The one field that must NEVER come back. Echoing it would write the
  // password into the server-rendered HTML of the retry, which is a worse
  // problem than retyping it.
  it("never carries the password", () => {
    const v = echoTutorForm(fd(filled));
    expect(Object.keys(v)).not.toContain("password");
    expect(JSON.stringify(v)).not.toContain("secret123");
  });

  it("keeps the value that was REJECTED, so the teacher can see and fix it", () => {
    const v = echoTutorForm(fd({ ...filled, demoVideoUrl: "https://vimeo.com/123" }));
    expect(v.demoVideoUrl).toBe("https://vimeo.com/123");
  });

  it("survives a form with nothing in it", () => {
    const v = echoTutorForm(new FormData());
    expect(v.fullName).toBe("");
    expect(v.curricula).toEqual([]);
    expect(v.consent).toBe(false);
  });
});
