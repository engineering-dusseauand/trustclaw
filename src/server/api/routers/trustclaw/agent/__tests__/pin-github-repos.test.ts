import { describe, it, expect, vi } from "vitest";
import {
  rewriteGithubBatch,
  patchGithubBatchResult,
  scrubSearchToolsResultForGithub,
  classifyGithubEntry,
  classifySearchSlug,
  isDestructiveGithubSlug,
  rewriteSearchQuery,
  type RecordGithubBlock,
} from "../pin-github-repos";

const noopRecord: RecordGithubBlock = () => undefined;

describe("isDestructiveGithubSlug", () => {
  it("flags DELETE_*", () => {
    expect(isDestructiveGithubSlug("GITHUB_DELETE_REPO")).toBe(true);
    expect(isDestructiveGithubSlug("GITHUB_DELETE_A_BRANCH")).toBe(true);
  });

  it("flags merges and transfers", () => {
    expect(isDestructiveGithubSlug("GITHUB_MERGE_PULL_REQUEST")).toBe(true);
    expect(isDestructiveGithubSlug("GITHUB_TRANSFER_REPOSITORY")).toBe(true);
    expect(isDestructiveGithubSlug("GITHUB_DISMISS_REVIEW_FOR_PULL_REQUEST")).toBe(true);
  });

  it("does not flag reads", () => {
    expect(isDestructiveGithubSlug("GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER")).toBe(false);
    expect(isDestructiveGithubSlug("GITHUB_GET_A_REPOSITORY")).toBe(false);
  });

  it("does not flag non-GitHub slugs", () => {
    expect(isDestructiveGithubSlug("SUPABASE_DELETE_PROJECT")).toBe(false);
  });
});

describe("classifySearchSlug", () => {
  it("classifies SEARCH_ISSUES as rewrite", () => {
    expect(classifySearchSlug("GITHUB_SEARCH_ISSUES")).toBe("rewrite");
    expect(classifySearchSlug("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS")).toBe("rewrite");
  });

  it("classifies SEARCH_CODE and SEARCH_REPOSITORIES as block", () => {
    expect(classifySearchSlug("GITHUB_SEARCH_CODE")).toBe("block");
    expect(classifySearchSlug("GITHUB_SEARCH_REPOSITORIES")).toBe("block");
  });

  it("returns null for non-search slugs", () => {
    expect(classifySearchSlug("GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER")).toBeNull();
    expect(classifySearchSlug("SUPABASE_LIST_TABLES")).toBeNull();
  });
});

describe("classifyGithubEntry", () => {
  it("returns user_level for slugs without owner/repo", () => {
    expect(classifyGithubEntry("GITHUB_GET_THE_AUTHENTICATED_USER", {})).toEqual({
      kind: "user_level",
    });
  });

  it("returns repo_scoped (lowercased) when owner+repo present", () => {
    expect(
      classifyGithubEntry("GITHUB_GET_A_REPOSITORY", { owner: "Acme", repo: "Widget" }),
    ).toEqual({ kind: "repo_scoped", repo: "acme/widget" });
  });

  it("returns org_level when only owner/org is present", () => {
    expect(
      classifyGithubEntry("GITHUB_LIST_ORGANIZATION_REPOSITORIES", { org: "acme" }),
    ).toEqual({ kind: "org_level" });
    expect(
      classifyGithubEntry("GITHUB_LIST_REPOSITORIES_FOR_A_USER", { username: "octocat" }),
    ).toEqual({ kind: "user_level" }); // username alone is not org
  });

  it("returns url_refused when any URL-shaped arg is present", () => {
    expect(
      classifyGithubEntry("GITHUB_GET_REPO_FROM_URL", { url: "https://github.com/foo/bar" }),
    ).toEqual({ kind: "url_refused" });
  });

  it("returns search_block for SEARCH_CODE", () => {
    expect(classifyGithubEntry("GITHUB_SEARCH_CODE", { q: "foo" })).toEqual({
      kind: "search_block",
    });
  });

  it("returns search_rewrite for SEARCH_ISSUES", () => {
    expect(classifyGithubEntry("GITHUB_SEARCH_ISSUES", { q: "foo" })).toEqual({
      kind: "search_rewrite",
    });
  });
});

describe("rewriteSearchQuery", () => {
  it("appends repo: qualifiers when query has none", () => {
    const result = rewriteSearchQuery("bug is:open", ["acme/widget", "acme/foo"]);
    expect("rewritten" in result).toBe(true);
    if ("rewritten" in result) {
      expect(result.rewritten).toBe("bug is:open repo:acme/widget repo:acme/foo");
    }
  });

  it("validates existing repo: qualifiers against the pin set", () => {
    const ok = rewriteSearchQuery("bug repo:acme/widget", ["acme/widget"]);
    expect("rewritten" in ok).toBe(true);

    const bad = rewriteSearchQuery("bug repo:other/repo", ["acme/widget"]);
    expect("blocked" in bad).toBe(true);
    if ("blocked" in bad) {
      expect(bad.blocked).toMatch(/other\/repo.*not in the pinned set/);
    }
  });

  it("rejects a query that mixes pinned and unpinned repo: qualifiers", () => {
    const mixed = rewriteSearchQuery("repo:acme/widget repo:rogue/bad", ["acme/widget"]);
    expect("blocked" in mixed).toBe(true);
  });

  it("is case-insensitive on repo: qualifier match", () => {
    const result = rewriteSearchQuery("repo:Acme/Widget", ["acme/widget"]);
    expect("rewritten" in result).toBe(true);
  });
});

describe("rewriteGithubBatch", () => {
  const pins = ["acme/widget", "acme/foo"];

  function single(slug: string, args: Record<string, unknown> = {}) {
    return { tools: [{ tool_slug: slug, arguments: args }] };
  }

  it("blocks everything when no pins are configured", () => {
    const record = vi.fn();
    const input = single("GITHUB_GET_A_REPOSITORY", { owner: "acme", repo: "widget" });
    const { blockedIndices } = rewriteGithubBatch(input, [], false, record);
    expect(blockedIndices.size).toBe(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "no_pins_configured" }),
    );
  });

  it("allows a repo-scoped call to a pinned repo", () => {
    const input = single("GITHUB_GET_A_REPOSITORY", { owner: "acme", repo: "widget" });
    const { input: out, blockedIndices } = rewriteGithubBatch(input, pins, false, noopRecord);
    expect(blockedIndices.size).toBe(0);
    expect((out as { tools: Array<{ tool_slug: string }> }).tools[0]?.tool_slug).toBe(
      "GITHUB_GET_A_REPOSITORY",
    );
  });

  it("blocks a repo-scoped call to a non-pinned repo", () => {
    const record = vi.fn();
    const input = single("GITHUB_GET_A_REPOSITORY", { owner: "rogue", repo: "bad" });
    const { blockedIndices } = rewriteGithubBatch(input, pins, false, record);
    expect(blockedIndices.size).toBe(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "not_pinned",
        attemptedRepo: "rogue/bad",
      }),
    );
  });

  it("treats owner/repo case-insensitively", () => {
    const input = single("GITHUB_GET_A_REPOSITORY", { owner: "ACME", repo: "Widget" });
    const { blockedIndices } = rewriteGithubBatch(input, pins, false, noopRecord);
    expect(blockedIndices.size).toBe(0);
  });

  it("blocks destructive actions when allowDestructive is false", () => {
    const record = vi.fn();
    const input = single("GITHUB_DELETE_A_REPOSITORY", { owner: "acme", repo: "widget" });
    const { blockedIndices } = rewriteGithubBatch(input, pins, false, record);
    expect(blockedIndices.size).toBe(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "destructive_blocked" }),
    );
  });

  it("allows destructive actions on pinned repos when allowDestructive is true", () => {
    const input = single("GITHUB_DELETE_A_REPOSITORY", { owner: "acme", repo: "widget" });
    const { blockedIndices } = rewriteGithubBatch(input, pins, true, noopRecord);
    expect(blockedIndices.size).toBe(0);
  });

  it("still blocks destructive actions on non-pinned repos when allowDestructive is true", () => {
    const input = single("GITHUB_DELETE_A_REPOSITORY", { owner: "rogue", repo: "bad" });
    const { blockedIndices } = rewriteGithubBatch(input, pins, true, noopRecord);
    expect(blockedIndices.size).toBe(1);
  });

  it("blocks org-level calls", () => {
    const record = vi.fn();
    const input = single("GITHUB_GET_AN_ORGANIZATION", { org: "acme" });
    const { blockedIndices } = rewriteGithubBatch(input, pins, false, record);
    expect(blockedIndices.size).toBe(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "org_level_blocked" }),
    );
  });

  it("refuses URL-shaped args", () => {
    const record = vi.fn();
    const input = single("GITHUB_GET_REPO_FROM_URL", { url: "https://github.com/acme/widget" });
    const { blockedIndices } = rewriteGithubBatch(input, pins, false, record);
    expect(blockedIndices.size).toBe(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "url_arg_refused" }),
    );
  });

  it("blocks SEARCH_CODE", () => {
    const record = vi.fn();
    const input = single("GITHUB_SEARCH_CODE", { q: "anything" });
    const { blockedIndices } = rewriteGithubBatch(input, pins, false, record);
    expect(blockedIndices.size).toBe(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "search_blocked" }),
    );
  });

  it("injects repo: qualifiers into SEARCH_ISSUES when missing", () => {
    const input = single("GITHUB_SEARCH_ISSUES", { q: "bug" });
    const { input: out, blockedIndices } = rewriteGithubBatch(input, pins, false, noopRecord);
    expect(blockedIndices.size).toBe(0);
    const entry = (out as { tools: Array<{ arguments: { q: string } }> }).tools[0]!;
    expect(entry.arguments.q).toBe("bug repo:acme/widget repo:acme/foo");
  });

  it("validates existing repo: qualifiers in SEARCH_ISSUES", () => {
    const input = single("GITHUB_SEARCH_ISSUES", { q: "bug repo:rogue/bad" });
    const { blockedIndices } = rewriteGithubBatch(input, pins, false, noopRecord);
    expect(blockedIndices.size).toBe(1);
  });

  it("passes non-GitHub slugs through untouched", () => {
    const input = single("GMAIL_SEND_EMAIL", { to: "foo@bar.com" });
    const { input: out, blockedIndices } = rewriteGithubBatch(input, pins, false, noopRecord);
    expect(blockedIndices.size).toBe(0);
    expect((out as { tools: Array<{ tool_slug: string }> }).tools[0]?.tool_slug).toBe(
      "GMAIL_SEND_EMAIL",
    );
  });

  it("handles a mixed batch: pinned + unpinned + non-GitHub", () => {
    const record = vi.fn();
    const input = {
      tools: [
        { tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: { owner: "acme", repo: "widget" } },
        { tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: { owner: "rogue", repo: "bad" } },
        { tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "x@y.com" } },
      ],
    };
    const { blockedIndices } = rewriteGithubBatch(input, pins, false, record);
    expect(blockedIndices.size).toBe(1);
    expect(blockedIndices.has(1)).toBe(true);
    expect(blockedIndices.has(0)).toBe(false);
    expect(blockedIndices.has(2)).toBe(false);
  });

  it("returns gracefully on malformed input", () => {
    expect(rewriteGithubBatch(null, pins, false, noopRecord).blockedIndices.size).toBe(0);
    expect(rewriteGithubBatch({ tools: "not-array" }, pins, false, noopRecord).blockedIndices.size).toBe(0);
  });

  it("swallows telemetry errors without breaking the batch", () => {
    const throwing: RecordGithubBlock = () => {
      throw new Error("DB down");
    };
    const input = single("GITHUB_DELETE_A_REPOSITORY", { owner: "acme", repo: "widget" });
    // Should not throw.
    expect(() => rewriteGithubBatch(input, pins, false, throwing)).not.toThrow();
  });
});

describe("patchGithubBatchResult", () => {
  it("returns the result unchanged when blockedIndices is empty", () => {
    const result = { response_data: [{ data: 1 }, { data: 2 }] };
    expect(patchGithubBatchResult(result, new Map())).toBe(result);
  });

  it("rewrites response_data[i] for blocked indices (shape A)", () => {
    const result = {
      response_data: [
        { successful: true, data: { ok: 1 } },
        { successful: true, data: { ok: 2 } },
      ],
    };
    const blocked = new Map([[1, "blocked by test"]]);
    const out = patchGithubBatchResult(result, blocked) as { response_data: Array<Record<string, unknown>> };
    expect(out.response_data[0]).toEqual({ successful: true, data: { ok: 1 } });
    expect(out.response_data[1]).toMatchObject({
      successful: false,
      error: "blocked by test",
      data: {},
    });
  });

  it("rewrites data.results[i].response for blocked indices (shape B)", () => {
    const result = {
      data: {
        results: [
          { response: { successful: true, data: { ok: 1 } } },
          { response: { successful: true, data: { ok: 2 } } },
        ],
      },
    };
    const blocked = new Map([[0, "blocked by test"]]);
    const out = patchGithubBatchResult(result, blocked) as {
      data: { results: Array<{ response: Record<string, unknown> }> };
    };
    expect(out.data.results[0]!.response).toMatchObject({
      successful: false,
      error: "blocked by test",
    });
    expect(out.data.results[1]!.response).toEqual({ successful: true, data: { ok: 2 } });
  });
});

describe("scrubSearchToolsResultForGithub", () => {
  const pins = ["acme/widget"];

  it("returns the result unchanged when no pins are configured", () => {
    const result = { data: { toolkit_connection_statuses: [{ toolkit: "github", x: 1 }] } };
    expect(scrubSearchToolsResultForGithub(result, [])).toBe(result);
  });

  it("stubs out the github connection_status entry", () => {
    const result = {
      data: {
        toolkit_connection_statuses: [
          { toolkit: "gmail", has_active_connection: true, current_user_info: { email: "x@y.com" } },
          {
            toolkit: "github",
            has_active_connection: true,
            current_user_info: { login: "leak-me", repos: ["a/b", "c/d"] },
          },
        ],
      },
    };
    const out = scrubSearchToolsResultForGithub(result, pins) as {
      data: { toolkit_connection_statuses: Array<Record<string, unknown>> };
    };
    expect(out.data.toolkit_connection_statuses[0]).toEqual({
      toolkit: "gmail",
      has_active_connection: true,
      current_user_info: { email: "x@y.com" },
    });
    expect(out.data.toolkit_connection_statuses[1]).toEqual({
      toolkit: "github",
      has_active_connection: true,
      current_user_info: { pinned_repo_count: 1 },
    });
  });

  it("strips hidden github tool schemas", () => {
    const result = {
      data: {
        tool_schemas: {
          GITHUB_SEARCH_CODE: { description: "leaky" },
          GITHUB_SEARCH_REPOSITORIES: { description: "leaky" },
          GITHUB_LIST_REPOSITORIES_FOR_A_USER: { description: "leaky" },
          GITHUB_GET_A_REPOSITORY: { description: "fine" },
          GMAIL_SEND_EMAIL: { description: "fine" },
        },
      },
    };
    const out = scrubSearchToolsResultForGithub(result, pins) as {
      data: { tool_schemas: Record<string, unknown> };
    };
    expect(Object.keys(out.data.tool_schemas).sort()).toEqual([
      "GITHUB_GET_A_REPOSITORY",
      "GMAIL_SEND_EMAIL",
    ]);
  });

  it("filters hidden slugs out of results[].primary_tool_slugs", () => {
    const result = {
      data: {
        results: [
          {
            primary_tool_slugs: ["GITHUB_SEARCH_CODE", "GITHUB_GET_A_REPOSITORY"],
            related_tool_slugs: ["GITHUB_LIST_REPOSITORIES_FOR_A_USER"],
          },
        ],
      },
    };
    const out = scrubSearchToolsResultForGithub(result, pins) as {
      data: { results: Array<{ primary_tool_slugs: string[]; related_tool_slugs: string[] }> };
    };
    expect(out.data.results[0]!.primary_tool_slugs).toEqual(["GITHUB_GET_A_REPOSITORY"]);
    expect(out.data.results[0]!.related_tool_slugs).toEqual([]);
  });
});
