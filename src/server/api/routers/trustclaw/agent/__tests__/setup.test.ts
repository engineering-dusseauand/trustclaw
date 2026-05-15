import { describe, it, expect } from "vitest";
import {
  rewriteMultiExecInput,
  patchMultiExecResult,
  scrubSearchToolsResult,
  isSupabaseSlug,
  isSupabaseToolkit,
} from "../setup";

/**
 * Synthesized error messages we expect rewriteMultiExecInput to attach.
 * Mirrors the constants in setup.ts. Kept here so a test failure points at
 * the divergence rather than asserting against the live import.
 */
const NO_PIN_ERROR =
  "No Supabase project is pinned for this instance. Open " +
  "/dashboard/toolkits, click the Supabase card, and pick a project " +
  "before calling Supabase tools.";

const ORG_LEVEL_BLOCKED_ERROR =
  "This Supabase action operates at the organization level and is " +
  "blocked while a project is pinned. Only the pinned project can be " +
  "operated on.";

describe("isSupabaseSlug", () => {
  it("returns true for SUPABASE_-prefixed strings", () => {
    expect(isSupabaseSlug("SUPABASE_LIST_TABLES")).toBe(true);
  });

  it("returns true regardless of case", () => {
    expect(isSupabaseSlug("supabase_list_tables")).toBe(true);
  });

  it("returns false for non-Supabase slugs", () => {
    expect(isSupabaseSlug("GMAIL_SEND_EMAIL")).toBe(false);
  });

  it("returns false for non-strings", () => {
    expect(isSupabaseSlug(42)).toBe(false);
    expect(isSupabaseSlug(null)).toBe(false);
    expect(isSupabaseSlug(undefined)).toBe(false);
  });
});

describe("isSupabaseToolkit", () => {
  it("matches 'supabase' case-insensitively", () => {
    expect(isSupabaseToolkit("supabase")).toBe(true);
    expect(isSupabaseToolkit("Supabase")).toBe(true);
    expect(isSupabaseToolkit("SUPABASE")).toBe(true);
  });

  it("returns false for other toolkit names", () => {
    expect(isSupabaseToolkit("gmail")).toBe(false);
    expect(isSupabaseToolkit("slack")).toBe(false);
  });

  it("returns false for non-strings", () => {
    expect(isSupabaseToolkit(null)).toBe(false);
    expect(isSupabaseToolkit({ name: "supabase" })).toBe(false);
  });
});

describe("rewriteMultiExecInput", () => {
  describe("with a pinned project ref", () => {
    const pin = "abc123";

    it("blocks org-level SUPABASE_LIST_ALL_PROJECTS with ORG_LEVEL_BLOCKED_ERROR", () => {
      const { input, blockedIndices } = rewriteMultiExecInput(
        {
          tools: [
            { tool_slug: "SUPABASE_LIST_ALL_PROJECTS", arguments: {} },
          ],
        },
        pin,
      );

      const tools = (input as { tools: Array<Record<string, unknown>> }).tools;
      expect(tools[0]?.tool_slug).toBe("__BLOCKED_SUPABASE_LIST_ALL_PROJECTS");
      expect(blockedIndices.size).toBe(1);
      expect(blockedIndices.get(0)).toBe(ORG_LEVEL_BLOCKED_ERROR);
    });

    it("injects project_id and project_ref into project-scoped slugs with empty arguments", () => {
      const { input, blockedIndices } = rewriteMultiExecInput(
        {
          tools: [{ tool_slug: "SUPABASE_LIST_TABLES", arguments: {} }],
        },
        pin,
      );

      const tools = (input as {
        tools: Array<{
          tool_slug: string;
          arguments: Record<string, unknown>;
        }>;
      }).tools;
      expect(tools[0]?.arguments.project_id).toBe(pin);
      expect(tools[0]?.arguments.project_ref).toBe(pin);
      expect(blockedIndices.size).toBe(0);
    });

    it("overrides agent-supplied project_ref with the pinned ref (escape attempt)", () => {
      // This is the critical "agent can't escape its pin" property. If the
      // model passes a different project_ref hoping to read another project,
      // we MUST overwrite it - never merge or trust the model's value.
      const { input } = rewriteMultiExecInput(
        {
          tools: [
            {
              tool_slug: "SUPABASE_LIST_TABLES",
              arguments: { project_ref: "other", other_arg: "kept" },
            },
          ],
        },
        pin,
      );

      const tools = (input as {
        tools: Array<{ arguments: Record<string, unknown> }>;
      }).tools;
      expect(tools[0]?.arguments.project_ref).toBe(pin);
      expect(tools[0]?.arguments.project_id).toBe(pin);
      // Non-conflicting args survive the merge.
      expect(tools[0]?.arguments.other_arg).toBe("kept");
    });

    it("leaves non-Supabase entries untouched", () => {
      const original = {
        tools: [
          {
            tool_slug: "GMAIL_SEND_EMAIL",
            arguments: { to: "a@b.com", body: "hi" },
          },
        ],
      };
      const { input, blockedIndices } = rewriteMultiExecInput(original, pin);

      const tools = (input as {
        tools: Array<{ tool_slug: string; arguments: Record<string, unknown> }>;
      }).tools;
      expect(tools[0]?.tool_slug).toBe("GMAIL_SEND_EMAIL");
      expect(tools[0]?.arguments).toEqual({ to: "a@b.com", body: "hi" });
      expect(blockedIndices.size).toBe(0);
    });

    it("handles a mixed batch correctly", () => {
      const { input, blockedIndices } = rewriteMultiExecInput(
        {
          tools: [
            { tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "a@b.com" } },
            { tool_slug: "SUPABASE_LIST_TABLES", arguments: {} },
            { tool_slug: "SUPABASE_LIST_ALL_PROJECTS", arguments: {} },
          ],
        },
        pin,
      );

      const tools = (input as {
        tools: Array<{
          tool_slug: string;
          arguments?: Record<string, unknown>;
        }>;
      }).tools;
      // 0: gmail untouched
      expect(tools[0]?.tool_slug).toBe("GMAIL_SEND_EMAIL");
      // 1: project-scoped pinned
      expect(tools[1]?.tool_slug).toBe("SUPABASE_LIST_TABLES");
      expect(tools[1]?.arguments?.project_ref).toBe(pin);
      // 2: org-level blocked
      expect(tools[2]?.tool_slug).toBe("__BLOCKED_SUPABASE_LIST_ALL_PROJECTS");

      // Only the org-level call should be recorded as blocked.
      expect(blockedIndices.size).toBe(1);
      expect(blockedIndices.has(2)).toBe(true);
      expect(blockedIndices.has(0)).toBe(false);
      expect(blockedIndices.has(1)).toBe(false);
    });
  });

  describe("without a pinned project (null ref)", () => {
    it("blocks every SUPABASE_* slug with NO_PIN_ERROR", () => {
      const { input, blockedIndices } = rewriteMultiExecInput(
        {
          tools: [
            { tool_slug: "SUPABASE_LIST_TABLES", arguments: {} },
            { tool_slug: "SUPABASE_LIST_ALL_PROJECTS", arguments: {} },
          ],
        },
        null,
      );

      const tools = (input as { tools: Array<{ tool_slug: string }> }).tools;
      expect(tools[0]?.tool_slug).toBe("__BLOCKED_SUPABASE_LIST_TABLES");
      expect(tools[1]?.tool_slug).toBe("__BLOCKED_SUPABASE_LIST_ALL_PROJECTS");
      expect(blockedIndices.get(0)).toBe(NO_PIN_ERROR);
      expect(blockedIndices.get(1)).toBe(NO_PIN_ERROR);
    });
  });

  describe("with malformed input", () => {
    it("returns input unchanged when not an object", () => {
      const { input, blockedIndices } = rewriteMultiExecInput("oops", "abc");
      expect(input).toBe("oops");
      expect(blockedIndices.size).toBe(0);
    });

    it("returns input unchanged when tools is missing", () => {
      const { blockedIndices } = rewriteMultiExecInput({}, "abc");
      expect(blockedIndices.size).toBe(0);
    });

    it("returns input unchanged when tools is not an array", () => {
      const { blockedIndices } = rewriteMultiExecInput(
        { tools: "not-an-array" },
        "abc",
      );
      expect(blockedIndices.size).toBe(0);
    });
  });
});

describe("patchMultiExecResult", () => {
  it("returns result unchanged when blockedIndices is empty", () => {
    const blocked = new Map<number, string>();
    const result = { foo: "bar", response_data: [{ successful: true }] };
    expect(patchMultiExecResult(result, blocked)).toBe(result);
  });

  it("returns non-object results unchanged", () => {
    const blocked = new Map<number, string>([[0, "blocked"]]);
    expect(patchMultiExecResult(null, blocked)).toBeNull();
    expect(patchMultiExecResult("oops", blocked)).toBe("oops");
    expect(patchMultiExecResult(42, blocked)).toBe(42);
  });

  it("rewrites blocked slots in response_data shape (Shape A)", () => {
    const blocked = new Map<number, string>([[1, "blocked-msg"]]);
    const patched = patchMultiExecResult(
      {
        response_data: [
          { successful: true, data: { a: 1 } },
          { successful: true, data: { b: 2 } },
        ],
      },
      blocked,
    );

    const arr = (patched as {
      response_data: Array<Record<string, unknown>>;
    }).response_data;
    // index 0 untouched
    expect(arr[0]).toEqual({ successful: true, data: { a: 1 } });
    // index 1 rewritten with the synthesized error
    expect(arr[1]).toMatchObject({
      successful: false,
      error: "blocked-msg",
      data: {},
    });
  });

  it("rewrites blocked slots in data.results[].response shape (Shape B)", () => {
    const blocked = new Map<number, string>([[1, "blocked-msg"]]);
    const patched = patchMultiExecResult(
      {
        data: {
          results: [
            { response: { successful: true, data: { a: 1 } } },
            { response: { successful: true, data: { b: 2 } } },
          ],
        },
      },
      blocked,
    );

    const results = (patched as {
      data: { results: Array<{ response: Record<string, unknown> }> };
    }).data.results;
    expect(results[0]?.response).toEqual({ successful: true, data: { a: 1 } });
    expect(results[1]?.response).toEqual({
      successful: false,
      error: "blocked-msg",
      data: {},
    });
  });
});

describe("scrubSearchToolsResult", () => {
  it("returns result unchanged when no pin is set", () => {
    const result = { data: { tool_schemas: { SUPABASE_LIST_ALL_PROJECTS: {} } } };
    expect(scrubSearchToolsResult(result, null)).toBe(result);
  });

  it("returns non-object results unchanged", () => {
    expect(scrubSearchToolsResult(null, "abc")).toBeNull();
    expect(scrubSearchToolsResult("hi", "abc")).toBe("hi");
  });

  it("strips org-level Supabase tool_schemas but keeps others", () => {
    const result = {
      data: {
        tool_schemas: {
          SUPABASE_LIST_ALL_PROJECTS: { foo: 1 },
          SUPABASE_LIST_TABLES: { foo: 2 },
          GMAIL_SEND_EMAIL: { foo: 3 },
        },
      },
    };

    const scrubbed = scrubSearchToolsResult(result, "abc123");
    const schemas = (scrubbed as {
      data: { tool_schemas: Record<string, unknown> };
    }).data.tool_schemas;

    expect(schemas.SUPABASE_LIST_ALL_PROJECTS).toBeUndefined();
    // Project-scoped slug survives - the agent still needs to be able to
    // call SUPABASE_LIST_TABLES on the pinned project.
    expect(schemas.SUPABASE_LIST_TABLES).toEqual({ foo: 2 });
    expect(schemas.GMAIL_SEND_EMAIL).toEqual({ foo: 3 });
  });

  it("replaces the Supabase toolkit_connection_statuses entry with a minimal stub", () => {
    const pin = "abc123";
    const result = {
      data: {
        toolkit_connection_statuses: [
          {
            toolkit: "gmail",
            has_active_connection: true,
            current_user_info: { email: "user@example.com" },
          },
          {
            toolkit: "supabase",
            has_active_connection: true,
            current_user_info: {
              email: "leaked@example.com",
              projects: [{ ref: "leaked-ref-1" }, { ref: "leaked-ref-2" }],
              organization: "leaked-org",
            },
          },
          {
            toolkit: "slack",
            has_active_connection: false,
          },
        ],
      },
    };

    const scrubbed = scrubSearchToolsResult(result, pin);
    const statuses = (scrubbed as {
      data: { toolkit_connection_statuses: Array<Record<string, unknown>> };
    }).data.toolkit_connection_statuses;

    // gmail and slack pass through untouched
    expect(statuses[0]?.current_user_info).toEqual({
      email: "user@example.com",
    });
    expect(statuses[2]?.has_active_connection).toBe(false);

    // supabase: minimal stub mentioning only the pinned ref. No emails,
    // no project lists, no org names.
    expect(statuses[1]).toEqual({
      toolkit: "supabase",
      has_active_connection: true,
      current_user_info: { pinned_project_ref: pin },
    });
  });

  it("filters org-level slugs from results[].primary_tool_slugs and related_tool_slugs", () => {
    const result = {
      data: {
        results: [
          {
            primary_tool_slugs: [
              "SUPABASE_LIST_ALL_PROJECTS",
              "SUPABASE_LIST_TABLES",
              "GMAIL_SEND_EMAIL",
            ],
            related_tool_slugs: [
              "SUPABASE_LIST_ORGANIZATIONS",
              "SLACK_POST_MESSAGE",
            ],
          },
        ],
      },
    };

    const scrubbed = scrubSearchToolsResult(result, "abc123");
    const results = (scrubbed as {
      data: {
        results: Array<{
          primary_tool_slugs: string[];
          related_tool_slugs: string[];
        }>;
      };
    }).data.results;

    expect(results[0]?.primary_tool_slugs).toEqual([
      "SUPABASE_LIST_TABLES",
      "GMAIL_SEND_EMAIL",
    ]);
    expect(results[0]?.related_tool_slugs).toEqual(["SLACK_POST_MESSAGE"]);
  });
});
