import { describe, it, expect } from "vitest";
import { buildAllowlistConfig } from "../allowlists/build-config";

describe("buildAllowlistConfig", () => {
  it("returns empty object for empty input", () => {
    expect(buildAllowlistConfig([])).toEqual({});
  });

  it("groups single-word toolkit slugs", () => {
    const out = buildAllowlistConfig([
      "GITHUB_GET_A_REPOSITORY",
      "GITHUB_LIST_BRANCHES",
      "GMAIL_SEND_EMAIL",
    ]);
    expect(out).toEqual({
      github: { enable: ["GITHUB_GET_A_REPOSITORY", "GITHUB_LIST_BRANCHES"] },
      gmail: { enable: ["GMAIL_SEND_EMAIL"] },
    });
  });

  it("handles multi-word toolkits via KNOWN_MULTI_WORD_TOOLKITS", () => {
    const out = buildAllowlistConfig([
      "GOOGLE_CALENDAR_LIST_EVENTS",
      "GOOGLE_CALENDAR_CREATE_EVENT",
    ]);
    expect(out).toEqual({
      google_calendar: {
        enable: ["GOOGLE_CALENDAR_LIST_EVENTS", "GOOGLE_CALENDAR_CREATE_EVENT"],
      },
    });
  });

  it("is case-insensitive on input and lowercases the toolkit key", () => {
    const out = buildAllowlistConfig(["github_get_a_repository"]);
    expect(Object.keys(out)).toEqual(["github"]);
    expect(out.github!.enable[0]).toBe("GITHUB_GET_A_REPOSITORY");
  });

  it("skips empty strings and non-string entries gracefully", () => {
    const out = buildAllowlistConfig(["", "GITHUB_GET_A_REPOSITORY"]);
    expect(out).toEqual({
      github: { enable: ["GITHUB_GET_A_REPOSITORY"] },
    });
  });

  it("does not collapse google_drive into google", () => {
    const out = buildAllowlistConfig([
      "GOOGLE_CALENDAR_LIST_EVENTS",
      "GOOGLE_DRIVE_LIST_FILES",
    ]);
    expect(Object.keys(out).sort()).toEqual(["google_calendar", "google_drive"]);
  });
});
