import { describe, it, expect } from "vitest";
import { buildShareUrl } from "@/lib/share";

describe("buildShareUrl", () => {
  it("builds a /call url carrying the room name, url-encoded", () => {
    expect(buildShareUrl("https://app.com", "smb 1")).toBe(
      "https://app.com/call?room=smb%201"
    );
  });
});
