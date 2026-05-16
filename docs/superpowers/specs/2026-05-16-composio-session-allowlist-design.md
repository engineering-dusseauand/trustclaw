# Design — Composio session-level tool allowlist

**Status**: Draft, pending spec review.
**Author**: Claude Opus 4.7 (composing user decisions and Distinguished Engineer review).
**Date**: 2026-05-16.
**Replaces**: portions of `src/server/api/routers/trustclaw/agent/pin-github-repos.ts` (the denylist plumbing — see Section 6).

## Context

TrustClaw is a self-hostable personal AI agent that orchestrates Anthropic Claude with Composio tools. Users connect external services (GitHub, Supabase, Gmail, etc.) via Composio OAuth and the agent gains access to those services' actions through Composio's tool router (`COMPOSIO_SEARCH_TOOLS` + `COMPOSIO_MULTI_EXECUTE_TOOL`).

The user's goal: **scope the agent to a known surface** — for GitHub specifically, to a small set of pinned repositories and a curated set of project-manager actions (read repo info, manage issues/PRs, cut releases, check CI status). They do not want the agent to enumerate, search, or act on resources they did not explicitly authorize.

### What we tried first (four iterations of whack-a-mole)

1. **AI SDK tool-layer prefix filter** (commit `9019a69`, `39aefb0`). Wrapped `composioTools` filtering by `SUPABASE_` / `GITHUB_` prefix. Never matched anything — TrustClaw uses Composio's tool router, where the agent's tool surface is just two meta-tools (`SEARCH_TOOLS`, `MULTI_EXECUTE_TOOL`). The prefix filter was a no-op.
2. **Meta-tool layer enforcement** (commit `82b44df`). Inspected the inner `tools[].tool_slug` of `MULTI_EXECUTE_TOOL` batches, post-filtered `LIST_REPOSITORIES` results, scrubbed `SEARCH_TOOLS` responses. Worked. Then the agent called `LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER` and returned 100 repos.
3. **Outright block of `LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER`** (commit `46efdd8`). Discovered Composio truncates large responses to a `data_preview` field and stashes the full payload in the `COMPOSIO_REMOTE_WORKBENCH` session. The agent then called the workbench, loaded the unfiltered full list via Python, and counted 100. Wrapper-level response filtering is fundamentally bypassable by the workbench.
4. **Block more enumeration paths + scrub plan-text** (commit `5f87087`). Added `GET_THE_AUTHENTICATED_USER` (leaked `owned_private_repos: 43`, `total_private_repos: 44`, `public_repos: 11`) and `LIST_ORGANIZATIONS_FOR_THE_AUTHENTICATED_USER` to the block set. Extended `scrubSearchToolsResultForGithub` to filter plan-step text mentioning hidden slug names. Agent kept finding new paths.

The pattern: every fix surfaces a new bypass. The architecture is structurally fail-open — anything not personally enumerated and blocked is exposed by default. With a 200K-token context, a recursive `SEARCH_TOOLS` discovery tool, and a Python sandbox, the agent's discovery surface is unbounded against our enumeration speed.

### Distinguished Engineer verdict

> "Stop patching, switch to a session-level allowlist. Composio's SDK supports the right architecture, and it's one config object away."

Verified: `ToolRouterCreateSessionConfig` in `@composio/core@0.6.3` accepts `{ toolkits: { enable: [...] }, tools: { <toolkit>: { enable: [...] } }, workbench: { enable: true, enableProxyExecution: false } }`. Enforced server-side by Composio before any slug reaches our wrapper, before any tool surfaces to the agent. A tool that ships next week is not in our allowlist, therefore it does not exist for the agent.

This spec captures the rewrite to that architecture.

## Goals

- **Switch enforcement model from denylist to allowlist** at the Composio session config layer.
- **Reduce the denylist plumbing** (~500 LOC) that exists to plug holes in an open surface.
- **Close the workbench raw-REST bypass** via `enableProxyExecution: false` in the same config.
- **Curate a per-toolkit "project-manager preset"** that ships enabled by default — read + common writes, destructive opt-in.
- **Per-tool admin UI** so the user toggles any slug on or off, with an "advanced" section exposing every Composio slug for a connected toolkit.
- **Compose with existing resource pinning** (`pinnedGithubRepos`, `supabaseProjectRef`). The allowlist controls *which slugs* the agent can call; the arg-validation wrapper controls *which resources* those slugs operate on.

## Non-goals

- **Not** changing Composio's OAuth flow. Connect/disconnect via the existing toolkit cards on `/dashboard/toolkits` stays as-is.
- **Not** moving any toolkit to fine-grained PAT-based scoping (engineer evaluated; rejected for UX cost and that it doesn't solve workbench leakage for other services).
- **Not** disabling the Composio workbench entirely. Python sandbox is generally useful for formatting and analyzing tool output; only its outbound proxy execution gets disabled.
- **Not** curating allowlists for toolkits beyond the v1 set (GitHub, Supabase, Gmail, Slack, Notion, Google Calendar). Other toolkits the user might connect default to empty; the user opts in per slug via the admin UI.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: Composio session config (server-side, this rewrite)      │
│  composio.create({                                                  │
│    toolkits: { enable: ["github", "supabase", ...] },               │
│    tools:    { github: { enable: [<curated slugs>] }, ... },        │
│    workbench: { enable: true, enableProxyExecution: false }         │
│  })                                                                 │
│  ↳ Composio rejects anything not in allowlist BEFORE the agent      │
│    sees it. Discovery surface = the curated list.                   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 2: AI SDK tool execute() wrapper (client-side, surviving)   │
│  pinGithubRepos / pinSupabaseProjectRef                             │
│  ↳ For slugs that take owner/repo or project_ref args, validate     │
│    against pinned set. Synthesize error response if not pinned.     │
└─────────────────────────────────────────────────────────────────────┘
```

Layer 1 is the new defense — broad coverage, server-side, scales with Composio's catalog. Layer 2 is the existing per-instance pin enforcement; trimmed to ~150 LOC of arg checks (everything else in `pin-github-repos.ts` is being deleted).

## Schema changes

### `ComposioClawInstance`

```prisma
model ComposioClawInstance {
  ...
  /// Effective list of Composio tool slugs the agent is allowed to call.
  /// Seeded with the curated per-toolkit defaults on first agent run;
  /// mutated by the admin UI toggles. Compared lowercase.
  allowedToolSlugs String[] @default([])

  /// Resource pinning for GitHub. Wrapper rejects any allowlisted slug
  /// whose owner/repo arg is not in this set.
  pinnedGithubRepos String[] @default([])

  /// Resource pinning for Supabase. Wrapper rewrites project_ref/project_id
  /// on any allowlisted SUPABASE_* slug to this value.
  pinnedSupabaseProjectRef String?
  ...
}
```

**Removed**: `allowDestructiveGithubActions Boolean`. The two-layer destructive system (allowlist + flag) was duplicative once we have the allowlist. Destructive ops are simply opt-in slugs via the admin UI. One-time UX cost: any user who had the flag on loses the implicit destructive opt-in and has to enable destructive slugs explicitly.

### `GithubBlockedAction` enum reasons

Surviving:
- `not_pinned` — slug allowlisted but `owner/repo` arg not in pinned set.
- `not_in_allowlist` — emitted by an optional response post-processor that rewrites Composio's "tool not found" errors into something useful. May or may not ship in v1.

Deprecated (no new rows, existing rows preserved): `org_level_blocked`, `search_blocked`, `url_arg_refused`, `auth_user_enumeration_blocked`, `no_pins_configured`, `destructive_blocked`.

## Default allowlist definitions

Lives in `src/server/api/routers/trustclaw/agent/allowlists/`. Each toolkit gets a file exporting:

```ts
export const DEFAULT_SLUGS: readonly string[] = [...];
export const CATEGORIES: readonly { label: string; slugs: readonly string[] }[] = [...];
```

The `index.ts` aggregates into:

```ts
export const DEFAULT_TOOL_ALLOWLIST: Record<string, readonly string[]> = {
  github: GITHUB_DEFAULT_SLUGS,
  supabase: SUPABASE_DEFAULT_SLUGS,
  gmail: GMAIL_DEFAULT_SLUGS,
  slack: SLACK_DEFAULT_SLUGS,
  notion: NOTION_DEFAULT_SLUGS,
  google_calendar: GOOGLE_CALENDAR_DEFAULT_SLUGS,
};
```

### v1 curated toolkits and category shape

**Universal exclusions** (never in defaults): destructive ops (`DELETE_*`, `REMOVE_*`, force-merge); cross-scope enumeration (`LIST_*_FOR_A_USER`, `LIST_PUBLIC_*`, org listings); top-level resource creation (`CREATE_PROJECT`, `CREATE_REPOSITORY`).

**GitHub** (~30 slugs):

| Category | Examples |
|---|---|
| Repo info | `GET_A_REPOSITORY`, `LIST_BRANCHES`, `GET_A_BRANCH`, `LIST_REPOSITORY_TAGS`, `LIST_COMMITS`, `GET_A_COMMIT`, `GET_REPOSITORY_CONTENT` |
| Issues | `LIST_REPOSITORY_ISSUES`, `GET_AN_ISSUE`, `CREATE_AN_ISSUE`, `UPDATE_AN_ISSUE`, `LIST_ISSUE_COMMENTS`, `CREATE_AN_ISSUE_COMMENT`, `LIST_LABELS_FOR_REPOSITORY`, `ADD_LABELS_TO_AN_ISSUE`, `REMOVE_LABEL_FROM_AN_ISSUE` |
| Milestones | `LIST_MILESTONES`, `GET_MILESTONE`, `CREATE_MILESTONE`, `UPDATE_MILESTONE` |
| Pull requests | `LIST_PULL_REQUESTS`, `GET_PULL_REQUEST`, `LIST_PULL_REQUEST_FILES`, `LIST_REVIEWS_FOR_A_PULL_REQUEST`, `LIST_PULL_REQUEST_REVIEW_COMMENTS` (excludes `MERGE_PULL_REQUEST` — opt-in) |
| Releases | `LIST_RELEASES`, `GET_A_RELEASE`, `GET_LATEST_RELEASE`, `CREATE_A_RELEASE`, `UPDATE_A_RELEASE` |
| Workflows / CI status | `LIST_WORKFLOWS`, `GET_A_WORKFLOW`, `LIST_WORKFLOW_RUNS`, `GET_A_WORKFLOW_RUN` |

**Supabase** (~12 slugs):

| Category | Examples |
|---|---|
| Project info | `GET_PROJECT`, `GET_PROJECT_API_KEYS`, `LIST_PROJECT_FUNCTIONS`, `LIST_PROJECT_BRANCHES` |
| Schema | `LIST_PROJECT_TABLES`, `GET_TABLE_SCHEMA`, `GENERATE_TYPESCRIPT_TYPES` |
| Read | `GET_LOGS` (excludes `RUN_SQL_QUERY` — writes opt-in) |

**Gmail, Slack, Notion, Google Calendar** (~10-15 slugs each):

Same shape — list/get/send/create reads and common writes; destructive deletes opt-in.

### Other toolkits

Anything the user connects that is **not** in the v1 curated set (Trello, Asana, Jira, HubSpot, Discord, etc.) gets default `[]`. The admin UI shows the "Show advanced" panel where the user opts in per slug. Falls closed by construction.

### Slug verification

Composio slug names drift across SDK versions. Each `allowlists/<toolkit>.ts` file is verified against the live Composio catalog at implementation time via:

```ts
const tools = await composio.tools.list({ toolkits: ['github'] });
```

The implementation PR includes the verified slug-by-slug list. Reviewing that PR is reviewing the threat model.

## Composio session config rewrite

The single biggest delta is at `src/server/api/routers/trustclaw/agent/setup.ts:142-148`.

```ts
// Build per-toolkit allow config from the instance's allowedToolSlugs.
const toolsConfig = buildAllowlistConfig(instance.allowedToolSlugs);
//   → { github: { enable: ["GITHUB_GET_A_REPOSITORY", ...] }, ... }
const toolkitsToEnable = Object.keys(toolsConfig);

const session = await composio.create(instance.userId, {
  manageConnections: { waitForConnections: true },
  toolkits: { enable: toolkitsToEnable },
  tools: toolsConfig,
  workbench: {
    enable: true,
    enableProxyExecution: false, // closes raw-REST bypass
  },
});
```

### `buildAllowlistConfig`

New helper at `src/server/api/routers/trustclaw/agent/allowlists/build-config.ts`:

```ts
const KNOWN_MULTI_WORD_TOOLKITS = ["GOOGLE_CALENDAR", "GOOGLE_DRIVE"];

export function buildAllowlistConfig(
  effective: string[],
): Record<string, { enable: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const slug of effective) {
    const upper = slug.toUpperCase();
    const multi = KNOWN_MULTI_WORD_TOOLKITS.find((p) => upper.startsWith(`${p}_`));
    const toolkit = (multi ?? upper.split("_")[0]).toLowerCase();
    if (!grouped.has(toolkit)) grouped.set(toolkit, []);
    grouped.get(toolkit)!.push(slug);
  }
  const out: Record<string, { enable: string[] }> = {};
  for (const [toolkit, slugs] of grouped) out[toolkit] = { enable: slugs };
  return out;
}
```

### Lazy seeding

Inside `prepareAgentRun`, before the session config:

```ts
if (instance.allowedToolSlugs.length === 0) {
  const connected = await composio.connectedAccounts.list({ userIds: [instance.userId] });
  const seed: string[] = [];
  for (const acc of connected.items) {
    const toolkit = acc.toolkit?.slug?.toLowerCase();
    if (!toolkit) continue;
    const defaults = DEFAULT_TOOL_ALLOWLIST[toolkit];
    if (defaults) seed.push(...defaults);
  }
  if (seed.length > 0) {
    await db.composioClawInstance.update({
      where: { id: instance.id },
      data: { allowedToolSlugs: seed },
    });
    instance.allowedToolSlugs = seed;
  }
}
```

`connectedAccounts.list` is the verified path from the existing diagnostic script (`scripts/diagnose-composio-connections.mjs`). No SDK risk.

### Race safety

Two concurrent agent runs that both find `allowedToolSlugs = []` will both write the same seeded value. Prisma's row-level update is atomic; last write wins; idempotent. No lock required.

## Argument validation wrapper (survives)

`src/server/api/routers/trustclaw/agent/pin-github-repos.ts` trims from ~705 LOC to ~200 LOC.

**Surviving function**: `pinGithubRepos` wraps `MULTI_EXECUTE_TOOL`. For each inner `tools[].tool_slug` starting with `GITHUB_` that takes `owner`/`repo` args:

1. Extract `owner` + `repo` from `arguments`.
2. If `${owner}/${repo}` is not in `pinnedGithubRepos` (case-insensitive), rename slug to `__BLOCKED_*` and synthesize an error response pointing the agent at the pinned set.
3. Otherwise pass through unchanged.

The destructive-flag check is removed (destructive slugs are simply not in defaults; user opts in via allowlist).

`pinSupabaseProjectRef` is unchanged.

### Deletions

From `pin-github-repos.ts`:

- `GITHUB_FOREIGN_LISTING_TOOLS` set + handling
- `GITHUB_AUTH_USER_LISTING_TOOLS` set + handling
- `GITHUB_LISTING_TOOLS_TO_FILTER` set + handling
- `GITHUB_HIDDEN_SLUGS` set
- `scrubSearchToolsResultForGithub` function (and its wrap in `pinGithubRepos`)
- `mentionsHiddenGithubSlug`
- `filterReposInResult`
- `authUserListingBlockedError`
- All foreign-listing / auth-user-enumeration block reason constants
- `repoFilterIndices` plumbing in `rewriteGithubBatch` / `patchGithubBatchResult`
- All `*_BLOCKED_ERROR` constants for paths that no longer exist
- `rewriteSearchQuery` + `classifySearchSlug`

From `pin-github-repos.test.ts`: ~30 tests covering the above deletions.

## Admin UI

### Toolkit card extension

On `/dashboard/toolkits`, each connected toolkit card gains:

```
┌──────────────────────────────────────┐
│  [logo]   GitHub                     │
│           Connected                  │
│           Repos: foo/bar +1   [edit] │  ← existing repo picker
│           Tools: 24 of 30 enabled   │  ← NEW summary line
│           [Manage tools]             │  ← NEW button
└──────────────────────────────────────┘
```

The existing repo picker / Supabase project picker stay; they're the resource-pinning UI for Layer 2.

### `tools-allowlist-dialog.tsx`

Dialog on desktop, Sheet on mobile.

```
┌────────────────────────────────────────────────┐
│ GitHub tools                          24 of 30 │
│ Toggle which actions the agent can perform.    │
├────────────────────────────────────────────────┤
│ [Search...]    [Reset to defaults]             │
├────────────────────────────────────────────────┤
│ Repo info                          [toggle all]│
│  ☑ Get a repository                            │
│  ☑ List branches                               │
│  ...                                           │
│                                                │
│ Issues                             [toggle all]│
│  ☑ Create an issue                             │
│  ...                                           │
│                                                │
│ ▾ Show advanced (not in defaults)              │
│  ☐ Merge pull request                          │
│  ☐ Delete a release         destructive        │
│  ...                                           │
├────────────────────────────────────────────────┤
│             [Cancel]    [Save changes]         │
└────────────────────────────────────────────────┘
```

Behavior:

- Grouped by `CATEGORIES` defined in `allowlists/<toolkit>.ts`. Default categories collapsed open; "Show advanced" collapsed.
- Each row: Switch + human label + slug as muted subtitle.
- Search filters by label OR slug.
- "Reset to defaults" replaces the toolkit's slice of `allowedToolSlugs` with the curated default. Confirmation toast (discards opt-ins).
- "Toggle all" at a category header sets every slug in that category on/off.
- Header counter updates live as toggles change.
- Save fires `setAllowedToolSlugs.mutateAsync({ toolkit, enabled })`. Atomic per toolkit — only that toolkit's slugs are replaced; others untouched.

### Backend procedures

New under `toolkitsRouter`:

- **`getToolkitTools(toolkit: string)`**: query Composio for the full toolkit catalog via `composio.tools.list({ toolkits: [toolkit] })`. Merge with the curated default. Return:
  ```ts
  Array<{
    slug: string;
    label: string;
    description?: string;
    category?: string;  // from CATEGORIES, or "Advanced" if not in default
    isDestructive: boolean;
    isInDefault: boolean;
    isEnabled: boolean;  // current state per allowedToolSlugs
  }>
  ```
- **`setAllowedToolSlugs({ toolkit: string, enabled: string[] })`**: replace the slice for one toolkit. Other toolkits' slugs preserved.
- **`resetToolkitToDefaults({ toolkit: string })`**: convenience — set toolkit slice to the curated default.

### Mobile responsiveness

- `Dialog` → `Sheet` at `sm:` and below.
- Inner scroll: same flex-column pattern as the GitHub repo picker fix from earlier — sticky header, sticky footer, list scrolls.
- "Show advanced" defaults collapsed on mobile.

## Error handling

### Composio rejects an allowlist-violating call

If the agent somehow constructs a tool call to a slug Composio rejects (shouldn't happen with our config, but a defense check): the Composio response slot has `successful: false` and some error message. The existing `sanitizeToolResults` wrapper passes this through to the agent as-is.

Optional v1.1: an `allowlistViolationResponsePostProcessor` that rewrites Composio's tool-not-found responses into "this tool isn't enabled for this instance — ask the user to enable it in /dashboard/toolkits." Decision: ship without this initially; revisit if Composio's error UX is poor.

### Lazy seeding fails

`composio.connectedAccounts.list(...)` failure leaves `allowedToolSlugs = []`. Result: agent has zero Composio tools that run. Custom tools (`memory_save`, `memory_search`, `schedule`) still work. The user gets a chat response like "I don't have any Composio toolkits configured — set them up at /dashboard/toolkits." Acceptable degradation.

### Workbench attempts proxy execution

With `enableProxyExecution: false`, Composio's workbench rejects the proxy call. The Python sandbox can still format/analyze data the agent already received; it just can't authenticate against arbitrary endpoints. The agent reads the workbench error and adapts.

## Testing strategy

### Deletions (~30 tests)

All denylist-plumbing tests in `pin-github-repos.test.ts`: foreign listings, auth-user enumeration, plan-step scrubbing, hidden slug filtering, repo array filtering, search query rewriting.

### Kept (~15 tests)

- `classifyGithubEntry` (owner/repo classifier)
- `isDestructiveGithubSlug` (used in curating defaults but not at runtime gate; kept for the destructive-detection unit test)
- `rewriteGithubBatch` owner/repo arg checks against pinned set
- `patchGithubBatchResult` blocked-slot patching

### New (~10 tests)

- `buildAllowlistConfig` groups slugs by toolkit correctly.
- `buildAllowlistConfig` handles multi-word toolkits via `KNOWN_MULTI_WORD_TOOLKITS`.
- `buildAllowlistConfig` returns `{}` for empty input.
- Each `allowlists/<toolkit>.ts` exports a non-empty `DEFAULT_SLUGS`.
- Each `allowlists/<toolkit>.ts` exports `CATEGORIES` whose union of slugs equals `DEFAULT_SLUGS`.
- Lazy seeding: given `allowedToolSlugs = []` + 3 connected toolkits, the seeded list is the union of the 3 toolkits' defaults.
- Lazy seeding: does not fire when `allowedToolSlugs` already has values.
- `setAllowedToolSlugs` is atomic per toolkit (other toolkits' slugs preserved).
- `resetToolkitToDefaults` replaces the toolkit slice correctly.
- `getToolkitTools` merges curated defaults + Composio catalog correctly.

Net test count: roughly **−5** (more deletions than additions). Suite stays sub-second.

## File changes

### Added

- `src/server/api/routers/trustclaw/agent/allowlists/index.ts`
- `src/server/api/routers/trustclaw/agent/allowlists/build-config.ts`
- `src/server/api/routers/trustclaw/agent/allowlists/github.ts`
- `src/server/api/routers/trustclaw/agent/allowlists/supabase.ts`
- `src/server/api/routers/trustclaw/agent/allowlists/gmail.ts`
- `src/server/api/routers/trustclaw/agent/allowlists/slack.ts`
- `src/server/api/routers/trustclaw/agent/allowlists/notion.ts`
- `src/server/api/routers/trustclaw/agent/allowlists/google_calendar.ts`
- `src/server/api/routers/toolkits/getToolkitTools.ts` (+ `.schema.ts`)
- `src/server/api/routers/toolkits/setAllowedToolSlugs.ts` (+ `.schema.ts`)
- `src/server/api/routers/toolkits/resetToolkitToDefaults.ts` (+ `.schema.ts`)
- `src/app/(authenticated)/dashboard/toolkits/_components/tools-allowlist-dialog.tsx`
- Test files for: `build-config`, allowlist defaults, lazy-seeding integration, new procedures.

### Modified

- `prisma/schema.prisma` (+ `allowedToolSlugs`, − `allowDestructiveGithubActions`).
- `src/server/api/routers/trustclaw/agent/setup.ts` (new session config + lazy seed).
- `src/server/api/routers/trustclaw/agent/pin-github-repos.ts` (trimmed to ~200 LOC).
- `src/server/api/routers/trustclaw/agent/__tests__/pin-github-repos.test.ts` (deletions).
- `src/app/(authenticated)/dashboard/toolkits/_components/toolkit-card.tsx` (Tools line + Manage button).
- `src/server/api/routers/toolkits/index.ts` (register new procedures).

### Net diff estimate

- `+1500` insertions
- `−2000` deletions
- **Net ~−500 LOC** (engineer's estimate confirmed).

## Open questions for implementation review

1. **Exact Composio slug names** — verify each curated default against `composio.tools.list({ toolkits: [...] })` at implementation time. The PR diff is the slug-by-slug record.
2. **`MERGE_PULL_REQUEST` in default?** Currently out (opt-in). Easy to flip if you want it on for the PM workflow.
3. **`RUN_SQL_QUERY` (Supabase) in default?** Currently out. Composio may have read-only / read-write variants; verify and choose.
4. **`getToolkitTools` caching** — Composio's catalog is stable enough not to need persistent cache, but TanStack Query's request-time cache should kick in naturally via the tRPC client.
5. **Composio "tool not found" error UX** — defer the response post-processor to v1.1 unless first-run testing shows the agent gets confused.

## Migration plan

1. Code change shipped → `prisma db push` adds `allowedToolSlugs` column, drops `allowDestructiveGithubActions`.
2. Existing instances (anyone with `allowedToolSlugs = []`) get seeded lazily on their next agent run. No migration script needed.
3. Existing pinned repos and pinned Supabase project carry over untouched.
4. Anyone who had `allowDestructiveGithubActions = true` loses that opt-in (column is gone). They re-enable destructive slugs explicitly via the new admin UI. Acceptable since no production users.

## Rollback plan

If the rewrite causes regressions in production-like usage:

1. Revert the PR — restores the v1.0 denylist plumbing.
2. `prisma db push` against the prior schema — `allowedToolSlugs` is dropped (additive column, safe to drop); `allowDestructiveGithubActions` is re-added with default `false` (existing rows get the default).
3. Telemetry preserved across revert (`GithubBlockedAction` table untouched).

Total revert time: ~10 minutes.

## Future work (out of scope for v1)

- Allowlist curation for other toolkits (Linear, Jira, Trello, HubSpot, etc.) — driven by user signal.
- Allowlist suggestions: "the agent attempted `GITHUB_MERGE_PULL_REQUEST` 3 times this week — want to enable it?"
- Per-conversation overrides: temporarily allow a slug for one chat without permanently mutating `allowedToolSlugs`.
- Curated "preset bundles" beyond PM (developer, ops, content, etc.) selectable from the admin UI.
