import { describe, it, expect } from "vitest";
import * as github from "../allowlists/github";

describe("github allowlist", () => {
  it("exports non-empty DEFAULT_SLUGS", () => {
    expect(github.DEFAULT_SLUGS).toBeDefined();
    expect(github.DEFAULT_SLUGS.length).toBeGreaterThan(0);
  });

  it("every slug is uppercase and starts with GITHUB_", () => {
    for (const slug of github.DEFAULT_SLUGS) {
      expect(slug).toBe(slug.toUpperCase());
      expect(slug.startsWith("GITHUB_")).toBe(true);
    }
  });

  it("CATEGORIES covers every slug in DEFAULT_SLUGS exactly once", () => {
    const flat = github.CATEGORIES.flatMap((c) => c.slugs);
    expect(flat.sort()).toEqual([...github.DEFAULT_SLUGS].sort());
  });

  it("no slug appears in more than one category", () => {
    const seen = new Map<string, string>();
    for (const cat of github.CATEGORIES) {
      for (const slug of cat.slugs) {
        const prev = seen.get(slug);
        expect(prev, `${slug} duplicated in ${prev} and ${cat.label}`).toBeUndefined();
        seen.set(slug, cat.label);
      }
    }
  });

  it("excludes destructive slug patterns from defaults", () => {
    for (const slug of github.DEFAULT_SLUGS) {
      expect(slug, `${slug} looks destructive`).not.toMatch(/_DELETE_|_REMOVE_A_REPOSITORY|_MERGE_A_PULL_REQUEST/);
    }
  });

  it("excludes cross-scope enumeration patterns from defaults", () => {
    const forbiddenPatterns = [
      "LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
      "LIST_REPOSITORIES_FOR_A_USER",
      "LIST_PUBLIC_",
      "LIST_ORGANIZATIONS_",
      "GET_THE_AUTHENTICATED_USER",
      "SEARCH_",
    ];
    for (const slug of github.DEFAULT_SLUGS) {
      for (const pattern of forbiddenPatterns) {
        expect(slug, `${slug} matches forbidden pattern ${pattern}`).not.toContain(pattern);
      }
    }
  });

  it("excludes MERGE_PULL_REQUEST (out per spec Open Question #2)", () => {
    expect(github.DEFAULT_SLUGS).not.toContain("GITHUB_MERGE_A_PULL_REQUEST");
    expect(github.DEFAULT_SLUGS).not.toContain("GITHUB_MERGE_PULL_REQUEST");
  });
});
