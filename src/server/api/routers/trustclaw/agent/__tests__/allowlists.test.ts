import { describe, it, expect } from "vitest";
import * as github from "../allowlists/github";
import * as supabase from "../allowlists/supabase";
import * as gmail from "../allowlists/gmail";
import * as slack from "../allowlists/slack";
import * as notion from "../allowlists/notion";
import * as googlecalendar from "../allowlists/googlecalendar";

interface AllowlistModule {
  DEFAULT_SLUGS: readonly string[];
  CATEGORIES: readonly { label: string; slugs: readonly string[] }[];
}

const TOOLKITS: ReadonlyArray<{
  name: string;
  prefix: string;
  mod: AllowlistModule;
}> = [
  { name: "github", prefix: "GITHUB_", mod: github },
  { name: "supabase", prefix: "SUPABASE_", mod: supabase },
  { name: "gmail", prefix: "GMAIL_", mod: gmail },
  { name: "slack", prefix: "SLACK_", mod: slack },
  { name: "notion", prefix: "NOTION_", mod: notion },
  { name: "googlecalendar", prefix: "GOOGLECALENDAR_", mod: googlecalendar },
];

/**
 * Patterns that should never appear in any toolkit's default allowlist.
 * Anything matching here is opt-in territory: destructive ops, cross-scope
 * enumeration, or top-level resource creation outside the pinned set.
 */
const FORBIDDEN_PATTERNS = [
  // Destructive
  /^[A-Z]+_DELETE_/,
  /_DELETE_(REPOSITORY|PROJECT|RELEASE|EVENT|BLOCK|MESSAGE|DRAFT|FUNCTION|BUCKET|CALENDAR)/,
  /_REMOVE_A_REPOSITORY/,
  /_MERGE_A_PULL_REQUEST/,
  /_MOVE_TO_TRASH/,
  /_ARCHIVE_/,
  /_CLEAR_CALENDAR/,
  // Cross-scope enumeration
  /LIST_REPOSITORIES_FOR_(THE_AUTHENTICATED_USER|A_USER)/,
  /LIST_PUBLIC_/,
  /GET_THE_AUTHENTICATED_USER$/,
  /LIST_ORGANIZATIONS_FOR/,
  // Search at toolkit-wide scope (not in defaults; SEARCH_ISSUES etc.
  // can be opted-in but are off by default)
  /^GITHUB_SEARCH_/,
  // Top-level resource creation that creates new sandboxes outside the
  // user's pin set
  /SUPABASE_CREATE_A_PROJECT/,
  /SUPABASE_CREATES_A_NEW_/,
];

describe("toolkit default allowlists", () => {
  for (const { name, prefix, mod } of TOOLKITS) {
    describe(name, () => {
      it("exports non-empty DEFAULT_SLUGS", () => {
        expect(mod.DEFAULT_SLUGS.length).toBeGreaterThan(0);
      });

      it("every slug is uppercase and starts with the toolkit prefix", () => {
        for (const slug of mod.DEFAULT_SLUGS) {
          expect(slug, `${slug} should be uppercase`).toBe(slug.toUpperCase());
          expect(slug.startsWith(prefix), `${slug} should start with ${prefix}`).toBe(true);
        }
      });

      it("CATEGORIES covers every DEFAULT_SLUGS slug exactly once", () => {
        const flat = mod.CATEGORIES.flatMap((c) => c.slugs);
        expect(flat.sort()).toEqual([...mod.DEFAULT_SLUGS].sort());
      });

      it("no slug appears in more than one category", () => {
        const seen = new Map<string, string>();
        for (const cat of mod.CATEGORIES) {
          for (const slug of cat.slugs) {
            const prev = seen.get(slug);
            expect(prev, `${slug} duplicated in ${prev} and ${cat.label}`).toBeUndefined();
            seen.set(slug, cat.label);
          }
        }
      });

      it("excludes forbidden patterns from defaults", () => {
        for (const slug of mod.DEFAULT_SLUGS) {
          for (const pattern of FORBIDDEN_PATTERNS) {
            expect(
              pattern.test(slug),
              `${slug} should not match forbidden pattern ${pattern}`,
            ).toBe(false);
          }
        }
      });
    });
  }
});

// Spec Open Question #2: MERGE_PULL_REQUEST is out of defaults; opt-in.
describe("github allowlist specifics", () => {
  it("excludes MERGE_PULL_REQUEST (spec Open Question #2)", () => {
    expect(github.DEFAULT_SLUGS).not.toContain("GITHUB_MERGE_A_PULL_REQUEST");
    expect(github.DEFAULT_SLUGS).not.toContain("GITHUB_MERGE_PULL_REQUEST");
  });
});

// Spec Open Question #3: RUN_SQL_QUERY (Supabase write SQL) is out of defaults.
describe("supabase allowlist specifics", () => {
  it("excludes write SQL execution (spec Open Question #3)", () => {
    expect(supabase.DEFAULT_SLUGS).not.toContain("SUPABASE_BETA_RUN_SQL_QUERY");
    expect(supabase.DEFAULT_SLUGS).not.toContain("SUPABASE_RUN_SQL_QUERY");
  });

  it("excludes cross-project enumeration", () => {
    expect(supabase.DEFAULT_SLUGS).not.toContain("SUPABASE_LIST_ALL_PROJECTS");
    expect(supabase.DEFAULT_SLUGS).not.toContain("SUPABASE_LIST_ALL_ORGANIZATIONS");
  });
});
