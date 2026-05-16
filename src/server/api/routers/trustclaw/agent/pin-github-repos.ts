import type { ToolSet } from "ai";

/**
 * GitHub repo pinning enforcement for the Composio tool router.
 *
 * GitHub's OAuth tokens (and the PATs Composio uses behind the scenes)
 * are user-account-scoped, not repo-scoped. To keep the agent inside a
 * specific set of repos this wrapper does four things:
 *
 *  1. Classifies every entry of a COMPOSIO_MULTI_EXECUTE_TOOL batch by
 *     looking at the slug + the args it carries:
 *       - user-level (no owner/repo)          → allowed if any pin exists
 *       - repo-scoped (owner + repo in args)  → allowed iff owner/repo
 *         normalised lowercase is in the pin set
 *       - org-level (owner/org/username only) → blocked
 *       - search-* slugs                      → SEARCH_ISSUES /
 *         SEARCH_PULL_REQUESTS get their `q` rewritten to scope to pinned
 *         repos; SEARCH_CODE / SEARCH_REPOSITORIES are blocked outright
 *  2. Refuses URL-shaped args (e.g. `repository_url`) — agent must use
 *     the structured owner/repo variant. Parsing URLs invites bypasses.
 *  3. Blocks destructive slugs (DELETE_*, MERGE_PULL_REQUEST, etc.) when
 *     `allowDestructive` is false, regardless of pin status.
 *  4. Scrubs COMPOSIO_SEARCH_TOOLS responses so the agent can't enumerate
 *     blocked tool slugs and so connection-status entries for github
 *     don't leak repo lists in passthrough fields.
 *
 * When no pins are configured at all, every GITHUB_* call returns an
 * instructive error directing the user to the toolkit settings.
 *
 * Block telemetry: each block calls `recordBlock` (fire-and-forget DB
 * write owned by the caller in setup.ts).
 */

export type GithubBlockReasonValue =
  | "not_pinned"
  | "destructive_blocked"
  | "org_level_blocked"
  | "search_blocked"
  | "url_arg_refused"
  | "no_pins_configured"
  | "auth_user_enumeration_blocked";

export type RecordGithubBlock = (params: {
  toolSlug: string;
  attemptedRepo: string | null;
  reason: GithubBlockReasonValue;
}) => void;

const NO_PINS_ERROR =
  "No GitHub repos are pinned for this instance. Open " +
  "/dashboard/toolkits, click the GitHub card, and pin at least one " +
  "repo before calling GitHub tools.";

const NOT_IN_PIN_SET_ERROR = (repo: string, pinned: string[]) =>
  `GitHub repo "${repo}" is not pinned for this instance. Pinned ` +
  `repos: ${pinned.length ? pinned.join(", ") : "(none)"}. Operate on ` +
  `a pinned repo or pin this one in /dashboard/toolkits.`;

const ORG_LEVEL_BLOCKED_ERROR =
  "GitHub org/user-level actions are blocked. Pinning operates at the " +
  "owner/repo level; use a repo-scoped variant of this tool instead.";

const DESTRUCTIVE_BLOCKED_ERROR =
  "This GitHub action is destructive (delete / merge / transfer / " +
  "overwrite) and is blocked. Enable 'Allow destructive GitHub actions' " +
  "in Settings to permit these calls.";

const SEARCH_BLOCKED_ERROR =
  "This GitHub search action operates across all repos the token can " +
  "read and is blocked. Use SEARCH_ISSUES with a `repo:` qualifier " +
  "instead, or look up data via a repo-scoped tool.";

const URL_REFUSED_ERROR =
  "This GitHub tool accepts a URL-shaped argument that this wrapper " +
  "refuses to parse. Call the structured `owner` + `repo` variant of " +
  "this action instead.";

const FOREIGN_LISTING_BLOCKED_ERROR =
  "This GitHub action enumerates repos that belong to another user, " +
  "an organization, or all of GitHub. It's blocked because pinning " +
  "operates per repo. Use a repo-scoped tool against a pinned repo " +
  "instead.";

/**
 * Tools that enumerate repos outside the user's personal repo list.
 * Blocked entirely — pinning operates at owner/repo granularity, so
 * org-wide and cross-user enumeration is always out of scope.
 */
const GITHUB_FOREIGN_LISTING_TOOLS = new Set([
  "GITHUB_LIST_REPOSITORIES_FOR_A_USER",
  "GITHUB_LIST_REPOSITORIES_OF_AN_ORG",
  "GITHUB_LIST_ORGANIZATION_REPOSITORIES",
  "GITHUB_LIST_PUBLIC_REPOSITORIES",
]);

/**
 * Tools that enumerate the authenticated user's own repos. Blocked
 * entirely (not post-filtered) because Composio truncates large
 * responses to a `data_preview` and stashes the full payload in the
 * COMPOSIO_REMOTE_WORKBENCH session — the workbench can then load and
 * count the full unfiltered list via Python, bypassing any response
 * filtering we'd apply at this layer. Blocking the call means Composio
 * never stores the data and the workbench-bypass channel stays empty.
 *
 * The block message includes the pinned list so the agent can answer
 * "what repos do you have?" directly from the error response without
 * needing another tool call.
 *
 * Workbench-bypass note: an agent could still write raw Python in
 * COMPOSIO_REMOTE_WORKBENCH that hits GitHub's REST API directly with
 * the connected token. Closing that requires either blocking the
 * workbench entirely (kills a generally-useful tool) or inspecting
 * Python code for GitHub API calls (brittle). Documented as a known
 * limitation; not addressed here.
 */
const GITHUB_AUTH_USER_LISTING_TOOLS = new Set([
  // Direct repo enumeration.
  "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
  "GITHUB_LIST_REPOSITORIES_STARRED_BY_THE_AUTHENTICATED_USER",
  "GITHUB_LIST_REPOSITORIES_WATCHED_BY_THE_AUTHENTICATED_USER",
  // Indirect — leak repo counts / org membership / identity that the
  // agent uses to confabulate or pivot to another enumeration path.
  // GET_THE_AUTHENTICATED_USER returns owned_private_repos /
  // total_private_repos / public_repos; LIST_ORGANIZATIONS reveals
  // which orgs the agent could pivot through to find more repos.
  "GITHUB_GET_THE_AUTHENTICATED_USER",
  "GITHUB_LIST_ORGANIZATIONS_FOR_THE_AUTHENTICATED_USER",
]);

/**
 * Kept for future use — currently empty. The post-filter machinery
 * (filterReposInResult, repoFilterIndices) still exists and works for
 * any tool we DO want to allow + filter. Right now everything that
 * could enumerate goes through GITHUB_AUTH_USER_LISTING_TOOLS instead
 * because of the workbench bypass.
 */
const GITHUB_LISTING_TOOLS_TO_FILTER = new Set<string>([]);

function authUserListingBlockedError(pinnedRepos: string[]): string {
  if (pinnedRepos.length === 0) return NO_PINS_ERROR;
  const list = pinnedRepos.join(", ");
  return (
    `GitHub repo enumeration is blocked. The agent can only operate on ` +
    `these ${pinnedRepos.length} pinned repo${pinnedRepos.length === 1 ? "" : "s"}: ` +
    `${list}. Use GITHUB_GET_REPO with structured {owner, repo} args for ` +
    `details on a specific one.`
  );
}

/**
 * Destructive slug detection. Conservative — when in doubt, deny.
 * Anything matching this is blocked unless `allowDestructive` is true.
 */
export function isDestructiveGithubSlug(slug: string): boolean {
  const upper = slug.toUpperCase();
  if (!upper.startsWith("GITHUB_")) return false;
  if (upper.startsWith("GITHUB_DELETE_")) return true;
  if (upper.includes("_MERGE_PULL_REQUEST")) return true;
  if (upper.includes("_MERGE_BRANCH")) return true;
  if (upper.includes("_TRANSFER_")) return true;
  if (upper.includes("_DISMISS_REVIEW")) return true;
  if (upper === "GITHUB_UPDATE_A_REPOSITORY") return true;
  return false;
}

/**
 * Search slug classification. Returns one of:
 *  - "rewrite"  → SEARCH_ISSUES / SEARCH_PULL_REQUESTS; query gets a
 *    `repo:owner/repo` qualifier injected/validated.
 *  - "block"    → SEARCH_CODE / SEARCH_REPOSITORIES; cross-repo and
 *    structurally unscopable.
 *  - null       → not a search tool.
 */
export function classifySearchSlug(slug: string): "rewrite" | "block" | null {
  const upper = slug.toUpperCase();
  if (!upper.startsWith("GITHUB_")) return null;
  if (upper.includes("SEARCH_ISSUES")) return "rewrite";
  if (upper.includes("SEARCH_PULL_REQUESTS") || upper.includes("SEARCH_ISSUES_AND_PULL_REQUESTS"))
    return "rewrite";
  if (upper.includes("SEARCH_")) return "block";
  return null;
}

function getStringField(args: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!args) return null;
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function extractArgs(entry: Record<string, unknown>): Record<string, unknown> {
  // Composio canonical: args under `arguments`. Some shapes flatten.
  const args =
    entry.arguments && typeof entry.arguments === "object"
      ? (entry.arguments as Record<string, unknown>)
      : entry;
  return args;
}

const URL_ARG_KEYS = ["url", "repository_url", "html_url", "git_url", "ssh_url"];

/**
 * Classify a GITHUB_* tool entry based on the args it carries. Returns
 * what the wrapper should do with this entry.
 */
export type GithubEntryClassification =
  | { kind: "user_level" }
  | { kind: "repo_scoped"; repo: string }
  | { kind: "org_level" }
  | { kind: "search_rewrite" }
  | { kind: "search_block" }
  | { kind: "url_refused" };

export function classifyGithubEntry(
  slug: string,
  args: Record<string, unknown>,
): GithubEntryClassification {
  const searchKind = classifySearchSlug(slug);
  if (searchKind === "block") return { kind: "search_block" };
  if (searchKind === "rewrite") return { kind: "search_rewrite" };

  // Refuse URL-shaped args before anything else — the args may carry an
  // owner/repo we'd otherwise accept, but a URL arg means there's no way
  // to be sure they're consistent.
  for (const key of URL_ARG_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) {
      return { kind: "url_refused" };
    }
  }

  const owner = getStringField(args, "owner") ?? getStringField(args, "org") ?? getStringField(args, "organization");
  const repo = getStringField(args, "repo") ?? getStringField(args, "repository");

  if (owner && repo) {
    return { kind: "repo_scoped", repo: `${owner.toLowerCase()}/${repo.toLowerCase()}` };
  }
  if (owner && !repo) {
    return { kind: "org_level" };
  }
  return { kind: "user_level" };
}

/**
 * Rewrites a SEARCH_ISSUES / SEARCH_PULL_REQUESTS query to scope to
 * pinned repos. Returns either { rewritten: newQuery } or { blocked:
 * reason }.
 *
 * Rules:
 *  - If the query has no `repo:` qualifier, append `(repo:a/b OR repo:c/d ...)`.
 *  - If the query has `repo:` qualifier(s), every one of them must be
 *    in the pinned set. If any aren't, block.
 *  - GitHub's search query length max is ~256 chars. We assume the cap
 *    on pins (20) keeps us under.
 */
export function rewriteSearchQuery(
  query: string,
  pinnedRepos: string[],
): { rewritten: string } | { blocked: string } {
  const repoQualifiers = Array.from(query.matchAll(/\brepo:([^\s]+)/gi)).map(
    (m) => m[1]?.toLowerCase() ?? "",
  );

  if (repoQualifiers.length === 0) {
    const scopeClause = pinnedRepos
      .map((r) => `repo:${r}`)
      .join(" ");
    return { rewritten: `${query} ${scopeClause}`.trim() };
  }

  const pinnedSet = new Set(pinnedRepos.map((r) => r.toLowerCase()));
  for (const r of repoQualifiers) {
    if (!pinnedSet.has(r)) {
      return {
        blocked:
          `Search query specifies repo:${r}, which is not in the pinned ` +
          `set. Allowed: ${pinnedRepos.join(", ")}.`,
      };
    }
  }
  return { rewritten: query };
}

/**
 * For each entry in a MULTI_EXECUTE_TOOL batch that targets GitHub,
 * decide whether to allow / rewrite / block. Returns the mutated batch
 * plus a map of index → synthesized-error-message.
 */
export function rewriteGithubBatch(
  input: unknown,
  pinnedRepos: string[],
  allowDestructive: boolean,
  recordBlock: RecordGithubBlock,
): {
  input: unknown;
  blockedIndices: Map<number, string>;
  /** Indices whose result must be post-filtered to only include pinned repos. */
  repoFilterIndices: Set<number>;
} {
  const blockedIndices = new Map<number, string>();
  const repoFilterIndices = new Set<number>();
  if (!input || typeof input !== "object") return { input, blockedIndices, repoFilterIndices };

  const obj = { ...(input as Record<string, unknown>) };
  if (!Array.isArray(obj.tools)) return { input: obj, blockedIndices, repoFilterIndices };

  obj.tools = (obj.tools as unknown[]).map((entry: unknown, idx: number) => {
    if (!entry || typeof entry !== "object") return entry;
    const rec = { ...(entry as Record<string, unknown>) };
    const slug = rec.tool_slug;
    if (typeof slug !== "string" || !slug.toUpperCase().startsWith("GITHUB_")) {
      return rec;
    }
    const upper = slug.toUpperCase();
    const args = { ...extractArgs(rec) };

    const block = (reason: GithubBlockReasonValue, message: string, attemptedRepo: string | null = null) => {
      blockedIndices.set(idx, message);
      rec.tool_slug = `__BLOCKED_${upper}`;
      try {
        recordBlock({ toolSlug: upper, attemptedRepo, reason });
      } catch {
        // never let telemetry break the agent
      }
    };

    // No pins → everything blocked.
    if (pinnedRepos.length === 0) {
      block("no_pins_configured", NO_PINS_ERROR);
      return rec;
    }

    // Foreign-listing tools enumerate outside the user's own repos —
    // blocked even when pins exist, since pinning is per-repo.
    if (GITHUB_FOREIGN_LISTING_TOOLS.has(upper)) {
      const owner =
        getStringField(args, "owner") ??
        getStringField(args, "org") ??
        getStringField(args, "organization") ??
        getStringField(args, "username");
      block("org_level_blocked", FOREIGN_LISTING_BLOCKED_ERROR, owner);
      return rec;
    }

    // Authenticated-user enumeration is blocked entirely. Composio's
    // workbench can otherwise bypass a response-level filter; see the
    // comment on GITHUB_AUTH_USER_LISTING_TOOLS for the full rationale.
    // The block message includes the pinned list so the agent can answer
    // questions like "what repos do you have?" from the error itself.
    if (GITHUB_AUTH_USER_LISTING_TOOLS.has(upper)) {
      block(
        "auth_user_enumeration_blocked",
        authUserListingBlockedError(pinnedRepos),
      );
      return rec;
    }

    // Listing tools to allow + post-filter (currently empty).
    if (GITHUB_LISTING_TOOLS_TO_FILTER.has(upper)) {
      repoFilterIndices.add(idx);
      return rec;
    }

    // Destructive guard runs after blocklist checks but before classification.
    if (!allowDestructive && isDestructiveGithubSlug(slug)) {
      const owner = getStringField(args, "owner");
      const repo = getStringField(args, "repo");
      const repoStr = owner && repo ? `${owner}/${repo}` : null;
      block("destructive_blocked", DESTRUCTIVE_BLOCKED_ERROR, repoStr);
      return rec;
    }

    const classification = classifyGithubEntry(slug, args);
    switch (classification.kind) {
      case "url_refused":
        block("url_arg_refused", URL_REFUSED_ERROR);
        return rec;
      case "org_level":
        block("org_level_blocked", ORG_LEVEL_BLOCKED_ERROR, getStringField(args, "owner"));
        return rec;
      case "search_block":
        block("search_blocked", SEARCH_BLOCKED_ERROR);
        return rec;
      case "search_rewrite": {
        const q = getStringField(args, "q") ?? getStringField(args, "query") ?? "";
        const result = rewriteSearchQuery(q, pinnedRepos);
        if ("blocked" in result) {
          block("not_pinned", result.blocked);
          return rec;
        }
        // Inject rewritten query. Composio APIs vary on the field name —
        // some take `q` (GitHub's REST search uses this), others `query`.
        // Set both when present.
        const newArgs: Record<string, unknown> = { ...args, q: result.rewritten };
        if (typeof args.query === "string") {
          newArgs.query = result.rewritten;
        }
        rec.arguments = newArgs;
        return rec;
      }
      case "repo_scoped": {
        const pinnedSet = new Set(pinnedRepos.map((r) => r.toLowerCase()));
        if (!pinnedSet.has(classification.repo)) {
          block("not_pinned", NOT_IN_PIN_SET_ERROR(classification.repo, pinnedRepos), classification.repo);
          return rec;
        }
        return rec;
      }
      case "user_level":
        // Allowed when at least one pin exists (we already checked).
        return rec;
    }
  });

  return { input: obj, blockedIndices, repoFilterIndices };
}

/**
 * Walks a value tree and trims any array whose elements look like
 * GitHub repo objects (have `full_name: string`) down to those whose
 * full_name is in the pinned set (case-insensitive). All other
 * structure is preserved. Used to scope LIST_REPOSITORIES results
 * to the pinned subset without changing the shape Composio returned.
 */
export function filterReposInResult(value: unknown, pinnedRepos: string[]): unknown {
  const pinnedSet = new Set(pinnedRepos.map((r) => r.toLowerCase()));
  function walk(v: unknown): unknown {
    if (Array.isArray(v)) {
      const looksLikeRepoArray =
        v.length > 0 &&
        v.every(
          (item) =>
            item != null &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>).full_name === "string",
        );
      if (looksLikeRepoArray) {
        return v.filter((item) => {
          const fullName = ((item as Record<string, unknown>).full_name as string).toLowerCase();
          return pinnedSet.has(fullName);
        });
      }
      return v.map(walk);
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(vv);
      }
      return out;
    }
    return v;
  }
  return walk(value);
}

/**
 * Patches MULTI_EXECUTE_TOOL's result. Two transforms:
 *  1. Blocked slots have their response replaced with a synthesized
 *     error so the agent sees a structured failure (rather than
 *     Composio's "unknown tool slug" surface from the renamed slug).
 *  2. Repo-filter slots have any repo arrays in their response trimmed
 *     to the pinned set, so the agent's view of "your repos" matches
 *     what it can actually operate on.
 */
export function patchGithubBatchResult(
  result: unknown,
  blockedIndices: Map<number, string>,
  repoFilterIndices: Set<number> = new Set<number>(),
  pinnedRepos: string[] = [],
): unknown {
  if (blockedIndices.size === 0 && repoFilterIndices.size === 0) return result;
  if (!result || typeof result !== "object") return result;

  const out = { ...(result as Record<string, unknown>) };

  if (Array.isArray(out.response_data)) {
    out.response_data = (out.response_data as unknown[]).map((item: unknown, i: number) => {
      if (blockedIndices.has(i)) {
        return {
          ...(typeof item === "object" && item ? item : {}),
          successful: false,
          error: blockedIndices.get(i),
          data: {},
        };
      }
      if (repoFilterIndices.has(i)) {
        return filterReposInResult(item, pinnedRepos);
      }
      return item;
    });
  }

  if (out.data && typeof out.data === "object") {
    const dataObj = { ...(out.data as Record<string, unknown>) };
    if (Array.isArray(dataObj.results)) {
      dataObj.results = (dataObj.results as unknown[]).map((item: unknown, i: number) => {
        if (blockedIndices.has(i)) {
          const errResponse = {
            successful: false,
            error: blockedIndices.get(i),
            data: {},
          };
          if (!item || typeof item !== "object") return { response: errResponse };
          return { ...(item as Record<string, unknown>), response: errResponse };
        }
        if (repoFilterIndices.has(i)) {
          return filterReposInResult(item, pinnedRepos);
        }
        return item;
      });
      out.data = dataObj;
    }
  }

  return out;
}

/** Tool slugs we don't want SEARCH_TOOLS to even surface to the agent. */
const GITHUB_HIDDEN_SLUGS = new Set<string>([
  "GITHUB_SEARCH_CODE",
  "GITHUB_SEARCH_REPOSITORIES",
  // Discovery-only tools that surface other users' or org-wide repo lists.
  "GITHUB_LIST_REPOSITORIES_FOR_A_USER",
  "GITHUB_LIST_REPOSITORIES_OF_AN_ORG",
  "GITHUB_LIST_ORGANIZATION_REPOSITORIES",
  "GITHUB_LIST_PUBLIC_REPOSITORIES",
  // Authenticated-user enumeration — blocked at MULTI_EXECUTE_TOOL because
  // of the workbench-bypass risk; also hidden here so the agent doesn't
  // discover them via SEARCH_TOOLS and try to call them in the first place.
  "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
  "GITHUB_LIST_REPOSITORIES_STARRED_BY_THE_AUTHENTICATED_USER",
  "GITHUB_LIST_REPOSITORIES_WATCHED_BY_THE_AUTHENTICATED_USER",
  "GITHUB_GET_THE_AUTHENTICATED_USER",
  "GITHUB_LIST_ORGANIZATIONS_FOR_THE_AUTHENTICATED_USER",
]);

/**
 * Strips hidden github tool schemas and discovery slugs from a
 * SEARCH_TOOLS response. Also stubs out the github connection's
 * `current_user_info` so passthrough fields can't leak data.
 */
export function scrubSearchToolsResultForGithub(
  result: unknown,
  pinnedRepos: string[],
): unknown {
  if (!result || typeof result !== "object") return result;
  if (pinnedRepos.length === 0) return result; // wrapper inert without pins

  const out = { ...(result as Record<string, unknown>) };
  const innerRaw = out.data;
  if (!innerRaw || typeof innerRaw !== "object") return out;
  const inner = { ...(innerRaw as Record<string, unknown>) };

  if (Array.isArray(inner.toolkit_connection_statuses)) {
    inner.toolkit_connection_statuses = (inner.toolkit_connection_statuses as unknown[]).map((entry: unknown) => {
      if (!entry || typeof entry !== "object") return entry;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.toolkit !== "string" || rec.toolkit.toLowerCase() !== "github") {
        return entry;
      }
      return {
        toolkit: rec.toolkit,
        has_active_connection: rec.has_active_connection,
        current_user_info: { pinned_repo_count: pinnedRepos.length },
      };
    });
  }

  if (inner.tool_schemas && typeof inner.tool_schemas === "object") {
    const schemas = inner.tool_schemas as Record<string, unknown>;
    const filtered: Record<string, unknown> = {};
    for (const [slug, schema] of Object.entries(schemas)) {
      if (GITHUB_HIDDEN_SLUGS.has(slug.toUpperCase())) continue;
      filtered[slug] = schema;
    }
    inner.tool_schemas = filtered;
  }

  if (Array.isArray(inner.results)) {
    inner.results = (inner.results as unknown[]).map((r: unknown) => {
      if (!r || typeof r !== "object") return r;
      const rec = { ...(r as Record<string, unknown>) };
      for (const key of ["primary_tool_slugs", "related_tool_slugs"]) {
        const arr = rec[key];
        if (Array.isArray(arr)) {
          rec[key] = arr.filter(
            (s) => typeof s !== "string" || !GITHUB_HIDDEN_SLUGS.has(s.toUpperCase()),
          );
        }
      }
      // Drop plan steps and pitfalls that name a hidden slug — Composio's
      // SEARCH_TOOLS embeds full slug names in the human-readable plan
      // text, which the agent reads and uses to bypass the schema-level
      // hiding. Stripping the text closes that path.
      for (const key of ["recommended_plan_steps", "known_pitfalls"]) {
        const arr = rec[key];
        if (Array.isArray(arr)) {
          rec[key] = arr.filter(
            (s) =>
              typeof s !== "string" ||
              !mentionsHiddenGithubSlug(s, GITHUB_HIDDEN_SLUGS),
          );
        }
      }
      return rec;
    });
  }

  out.data = inner;
  return out;
}

/**
 * Returns true when the given free-text string mentions any of the
 * hidden GitHub tool slugs. Case-insensitive whole-token match — won't
 * fire on substrings that happen to overlap a tool name.
 */
function mentionsHiddenGithubSlug(text: string, hidden: Set<string>): boolean {
  // Slugs are uppercase A-Z0-9_; isolate uppercase tokens and check each.
  const tokens = text.match(/[A-Z][A-Z0-9_]+/g);
  if (!tokens) return false;
  for (const token of tokens) {
    if (hidden.has(token)) return true;
  }
  return false;
}

/**
 * Wraps COMPOSIO_MULTI_EXECUTE_TOOL and COMPOSIO_SEARCH_TOOLS to enforce
 * GitHub repo pinning. Non-meta tools and non-GitHub entries pass
 * through unchanged.
 */
export function pinGithubRepos(
  tools: ToolSet,
  pinnedRepos: string[],
  allowDestructive: boolean,
  recordBlock: RecordGithubBlock,
): ToolSet {
  const wrapped: ToolSet = {};
  // Normalise pins to lowercase for comparison; preserve original casing
  // for user-facing error messages.
  const normalisedPins = pinnedRepos.map((r) => r.toLowerCase());

  for (const [name, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      wrapped[name] = tool;
      continue;
    }

    if (name.endsWith("MULTI_EXECUTE_TOOL")) {
      const originalExecute = tool.execute;
      wrapped[name] = {
        ...tool,
        execute: async (input: unknown, options) => {
          let rewritten: unknown = input;
          let blockedIndices = new Map<number, string>();
          let repoFilterIndices = new Set<number>();
          try {
            const r = rewriteGithubBatch(input, normalisedPins, allowDestructive, recordBlock);
            rewritten = r.input;
            blockedIndices = r.blockedIndices;
            repoFilterIndices = r.repoFilterIndices;
          } catch (err) {
            console.error("[pinGithubRepos] rewriteGithubBatch failed:", err);
            rewritten = input;
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const result = await originalExecute(rewritten, options);
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return patchGithubBatchResult(result, blockedIndices, repoFilterIndices, normalisedPins);
          } catch (err) {
            console.error("[pinGithubRepos] patchGithubBatchResult failed:", err);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return result;
          }
        },
      };
      continue;
    }

    if (name.endsWith("SEARCH_TOOLS")) {
      const originalExecute = tool.execute;
      wrapped[name] = {
        ...tool,
        execute: async (input: unknown, options) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const result = await originalExecute(input, options);
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return scrubSearchToolsResultForGithub(result, normalisedPins);
          } catch (err) {
            console.error("[pinGithubRepos] scrubSearchToolsResultForGithub failed:", err);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return result;
          }
        },
      };
      continue;
    }

    wrapped[name] = tool;
  }
  return wrapped;
}
