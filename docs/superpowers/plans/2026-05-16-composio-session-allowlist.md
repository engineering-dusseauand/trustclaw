# Composio Session-Level Tool Allowlist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TrustClaw's denylist-based Composio tool scoping (~705 LOC of `pin-github-repos.ts` plumbing) with a server-side allowlist enforced via Composio's `ToolRouterCreateSessionConfig`. Adds a curated PM-flavored default allowlist across 6 toolkits + an admin UI for per-tool toggles. Net diff ~-500 LOC.

**Architecture:** Two-layer scoping. **Layer 1** (new): `composio.create({ toolkits, tools, workbench })` config-side allowlist enforced server-side by Composio — tools outside the allowlist do not exist for the agent. **Layer 2** (existing, trimmed): AI SDK tool wrapper validates `owner/repo` and `project_ref` args against pinned resources. `workbench.enableProxyExecution: false` closes the raw-REST bypass discovered during the prior denylist iterations.

**Tech Stack:** Next.js 15 (App Router), TypeScript 5, tRPC v11, Prisma 7 on Neon Postgres + pgvector, Vercel AI SDK 6, Composio SDK 0.6.3 (`@composio/core`), Tailwind + shadcn/ui, Vitest. Package manager: **pnpm 10.28.2** (lockfile is `pnpm-lock.yaml`).

**Spec reference:** `docs/superpowers/specs/2026-05-16-composio-session-allowlist-design.md`. Read this first if anything in the plan is unclear.

---

## File Structure

### New files

```
src/server/api/routers/trustclaw/agent/allowlists/
├── index.ts                     # exports DEFAULT_TOOL_ALLOWLIST: Record<string, readonly string[]>
├── build-config.ts              # buildAllowlistConfig() helper
├── github.ts                    # DEFAULT_SLUGS + CATEGORIES (PM preset)
├── supabase.ts                  # DEFAULT_SLUGS + CATEGORIES
├── gmail.ts                     # DEFAULT_SLUGS + CATEGORIES
├── slack.ts                     # DEFAULT_SLUGS + CATEGORIES
├── notion.ts                    # DEFAULT_SLUGS + CATEGORIES
└── google_calendar.ts           # DEFAULT_SLUGS + CATEGORIES

src/server/api/routers/trustclaw/agent/__tests__/
├── build-config.test.ts         # NEW
└── allowlists.test.ts           # NEW — sanity tests across all toolkit files

src/server/api/routers/toolkits/
├── getToolkitTools.ts           # NEW + .schema.ts
├── setAllowedToolSlugs.ts       # NEW + .schema.ts
└── resetToolkitToDefaults.ts    # NEW + .schema.ts

src/app/(authenticated)/dashboard/toolkits/_components/
└── tools-allowlist-dialog.tsx   # NEW — per-toolkit slug picker
```

### Modified files

- `prisma/schema.prisma` — add `allowedToolSlugs`, drop `allowDestructiveGithubActions`
- `src/server/api/routers/trustclaw/agent/setup.ts` — new session config + lazy seeding
- `src/server/api/routers/trustclaw/agent/pin-github-repos.ts` — trim to ~200 LOC
- `src/server/api/routers/trustclaw/agent/__tests__/pin-github-repos.test.ts` — delete denylist tests
- `src/app/(authenticated)/dashboard/toolkits/_components/toolkit-card.tsx` — add Tools row + Manage button
- `src/server/api/routers/toolkits/index.ts` — register 3 new procedures

### Working directory & commands

All work happens in `/Users/dusseau/conductor/workspaces/trustclaw/fredericton`. The current branch is `dusseau-dev/install-and-run-local` (already isolated; not main).

Standard commands:
- Run tests: `pnpm test`
- Typecheck: `pnpm exec tsc --noEmit 2>&1 | grep "error TS" | grep -v "scripts/create-user" | head -20` (filters out pre-existing unrelated errors)
- Lint: `pnpm lint`
- Push schema: `pnpm exec dotenv -e .env.local -- pnpm exec prisma db push`
- Regen Prisma client: `pnpm exec dotenv -e .env.local -- pnpm exec prisma generate`
- Dev server: `pnpm dev` (background it for HMR testing)

**Pre-existing test count baseline**: 104 tests. New count after this plan: ~89 (net −15 due to denylist test deletions vs new additions).

---

## Task 1: Schema changes

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `allowedToolSlugs`, drop `allowDestructiveGithubActions`**

Open `prisma/schema.prisma`. Inside `model ComposioClawInstance`:

```prisma
  /// Effective list of Composio tool slugs the agent is allowed to call,
  /// per-instance. Seeded with curated per-toolkit defaults on first agent
  /// run; mutated by the admin UI. Compared case-insensitively.
  allowedToolSlugs String[] @default([])
```

Add it directly under `pinnedGithubRepos`.

In the same model, **delete** the line:

```prisma
  allowDestructiveGithubActions Boolean @default(false)
```

- [ ] **Step 2: Push schema to Neon**

Run:
```bash
pnpm exec dotenv -e .env.local -- pnpm exec prisma db push
```

Expected output ends with `🚀  Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Regenerate Prisma client**

Run:
```bash
pnpm exec dotenv -e .env.local -- pnpm exec prisma generate
```

Expected: `✔ Generated Prisma Client`

- [ ] **Step 4: Verify the schema change compiles**

Run:
```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS" | grep -v "scripts/create-user"
```

Expected: errors about `allowDestructiveGithubActions` being missing from various files (pin-github-repos.ts, setup.ts, github-settings.tsx, github-toolkit-card-extras.tsx, etc.). These are **expected** — subsequent tasks fix them.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add allowedToolSlugs, drop allowDestructiveGithubActions

Foundation for the allowlist-at-session-config rewrite. The destructive
flag was a duplicative second layer once we have per-slug allowlist
control; destructive ops are now just opt-in slugs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: `buildAllowlistConfig` helper with tests

**Files:**
- Create: `src/server/api/routers/trustclaw/agent/allowlists/build-config.ts`
- Create: `src/server/api/routers/trustclaw/agent/__tests__/build-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/api/routers/trustclaw/agent/__tests__/build-config.test.ts`:

```ts
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

  it("is case-insensitive on input but lowercases the toolkit key", () => {
    const out = buildAllowlistConfig(["github_get_a_repository"]);
    expect(Object.keys(out)).toEqual(["github"]);
  });

  it("skips malformed input gracefully", () => {
    const out = buildAllowlistConfig(["", "NO_UNDERSCORE", "_LEADING"]);
    // "NO_UNDERSCORE" parses as toolkit "no", which is valid even if absurd.
    // The function's job is to group; the curated defaults vet the slug list.
    expect(typeof out).toBe("object");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test build-config 2>&1 | tail -10
```

Expected: FAIL with module-not-found or import error for `buildAllowlistConfig`.

- [ ] **Step 3: Write the implementation**

Create `src/server/api/routers/trustclaw/agent/allowlists/build-config.ts`:

```ts
/**
 * Multi-word toolkit prefixes that must be detected before the
 * single-word `split("_")[0]` heuristic. Update when a new toolkit
 * with a compound name (e.g. MICROSOFT_TEAMS, ZOOM_VIDEO) is added.
 */
const KNOWN_MULTI_WORD_TOOLKITS = ["GOOGLE_CALENDAR", "GOOGLE_DRIVE"];

export function buildAllowlistConfig(
  effective: string[],
): Record<string, { enable: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const raw of effective) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    const slug = raw.toUpperCase();
    const multi = KNOWN_MULTI_WORD_TOOLKITS.find((p) => slug.startsWith(`${p}_`));
    const toolkit = (multi ?? slug.split("_")[0]).toLowerCase();
    if (!toolkit) continue;
    if (!grouped.has(toolkit)) grouped.set(toolkit, []);
    grouped.get(toolkit)!.push(slug);
  }
  const out: Record<string, { enable: string[] }> = {};
  for (const [toolkit, slugs] of grouped) {
    out[toolkit] = { enable: slugs };
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test build-config 2>&1 | tail -10
```

Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/api/routers/trustclaw/agent/allowlists/build-config.ts \
  src/server/api/routers/trustclaw/agent/__tests__/build-config.test.ts
git commit -m "feat(allowlist): add buildAllowlistConfig helper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: GitHub default allowlist + test

**Files:**
- Create: `src/server/api/routers/trustclaw/agent/allowlists/github.ts`
- Create: `src/server/api/routers/trustclaw/agent/__tests__/allowlists.test.ts` (covers ALL toolkit files; first test added in this task)

**Critical**: Before writing the slug list, **verify Composio's actual GitHub slug names**. Subagent should run:

```bash
pnpm exec dotenv -e .env.local -- node -e "
import('@composio/core').then(async (mod) => {
  const composio = new mod.Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  const list = await composio.tools.list({ toolkits: ['github'] });
  console.log(JSON.stringify(list.items.map(t => t.slug), null, 2));
});
"
```

Output is the authoritative slug source. The plan lists the **conceptual** slugs from the spec; the implementation file uses the **verified** slug names from Composio.

- [ ] **Step 1: Verify slugs from Composio's live catalog**

Run the snippet above. Capture the GitHub slug list. Reconcile against the spec's "GitHub (~30 slugs)" table. Any discrepancy (slug name slightly different) → use Composio's actual name.

- [ ] **Step 2: Write the failing test**

Create `src/server/api/routers/trustclaw/agent/__tests__/allowlists.test.ts`:

```ts
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

  it("excludes destructive slugs from defaults", () => {
    for (const slug of github.DEFAULT_SLUGS) {
      expect(slug).not.toMatch(/_DELETE_|_REMOVE_/);
    }
  });

  it("excludes cross-scope enumeration from defaults", () => {
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
        expect(slug, `${slug} should not match ${pattern}`).not.toContain(pattern);
      }
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm test allowlists 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write `github.ts`**

Create `src/server/api/routers/trustclaw/agent/allowlists/github.ts`. Replace the example slug names below with the verified names from Step 1:

```ts
/**
 * GitHub default allowlist — project-manager preset.
 *
 * Scope: read repo info, manage issues / PRs / releases / CI status
 * for pinned repositories. Excluded from defaults (user opts in via
 * admin UI): merges, deletions, forks, repo creation, cross-user
 * or org-wide enumeration, authenticated-user identity probes.
 */

const REPO_INFO = [
  "GITHUB_GET_A_REPOSITORY",
  "GITHUB_LIST_BRANCHES",
  "GITHUB_GET_A_BRANCH",
  "GITHUB_LIST_REPOSITORY_TAGS",
  "GITHUB_LIST_COMMITS",
  "GITHUB_GET_A_COMMIT",
  "GITHUB_GET_REPOSITORY_CONTENT",
] as const;

const ISSUES = [
  "GITHUB_LIST_REPOSITORY_ISSUES",
  "GITHUB_GET_AN_ISSUE",
  "GITHUB_CREATE_AN_ISSUE",
  "GITHUB_UPDATE_AN_ISSUE",
  "GITHUB_LIST_ISSUE_COMMENTS",
  "GITHUB_CREATE_AN_ISSUE_COMMENT",
  "GITHUB_LIST_LABELS_FOR_REPOSITORY",
  "GITHUB_ADD_LABELS_TO_AN_ISSUE",
  "GITHUB_REMOVE_LABEL_FROM_AN_ISSUE",
] as const;

const MILESTONES = [
  "GITHUB_LIST_MILESTONES",
  "GITHUB_GET_MILESTONE",
  "GITHUB_CREATE_MILESTONE",
  "GITHUB_UPDATE_MILESTONE",
] as const;

const PULL_REQUESTS = [
  "GITHUB_LIST_PULL_REQUESTS",
  "GITHUB_GET_PULL_REQUEST",
  "GITHUB_LIST_PULL_REQUEST_FILES",
  "GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST",
  "GITHUB_LIST_PULL_REQUEST_REVIEW_COMMENTS",
  // MERGE_PULL_REQUEST excluded from default; opt-in via admin UI.
] as const;

const RELEASES = [
  "GITHUB_LIST_RELEASES",
  "GITHUB_GET_A_RELEASE",
  "GITHUB_GET_LATEST_RELEASE",
  "GITHUB_CREATE_A_RELEASE",
  "GITHUB_UPDATE_A_RELEASE",
] as const;

const WORKFLOWS = [
  "GITHUB_LIST_WORKFLOWS",
  "GITHUB_GET_A_WORKFLOW",
  "GITHUB_LIST_WORKFLOW_RUNS",
  "GITHUB_GET_A_WORKFLOW_RUN",
] as const;

export const DEFAULT_SLUGS: readonly string[] = [
  ...REPO_INFO,
  ...ISSUES,
  ...MILESTONES,
  ...PULL_REQUESTS,
  ...RELEASES,
  ...WORKFLOWS,
];

export const CATEGORIES: readonly {
  label: string;
  slugs: readonly string[];
}[] = [
  { label: "Repo info", slugs: REPO_INFO },
  { label: "Issues", slugs: ISSUES },
  { label: "Milestones", slugs: MILESTONES },
  { label: "Pull requests", slugs: PULL_REQUESTS },
  { label: "Releases", slugs: RELEASES },
  { label: "Workflows / CI", slugs: WORKFLOWS },
];
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test allowlists 2>&1 | tail -10
```

Expected: 5 passing tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/api/routers/trustclaw/agent/allowlists/github.ts \
  src/server/api/routers/trustclaw/agent/__tests__/allowlists.test.ts
git commit -m "feat(allowlist): add github default allowlist (PM preset)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Supabase default allowlist + test

**Files:**
- Create: `src/server/api/routers/trustclaw/agent/allowlists/supabase.ts`
- Modify: `src/server/api/routers/trustclaw/agent/__tests__/allowlists.test.ts` (add supabase block)

- [ ] **Step 1: Verify Supabase slugs from Composio's live catalog**

```bash
pnpm exec dotenv -e .env.local -- node -e "
import('@composio/core').then(async (mod) => {
  const composio = new mod.Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  const list = await composio.tools.list({ toolkits: ['supabase'] });
  console.log(JSON.stringify(list.items.map(t => t.slug), null, 2));
});
"
```

- [ ] **Step 2: Append test block**

Append to `allowlists.test.ts`:

```ts
import * as supabase from "../allowlists/supabase";

describe("supabase allowlist", () => {
  it("exports non-empty DEFAULT_SLUGS", () => {
    expect(supabase.DEFAULT_SLUGS.length).toBeGreaterThan(0);
  });

  it("every slug starts with SUPABASE_", () => {
    for (const slug of supabase.DEFAULT_SLUGS) {
      expect(slug.startsWith("SUPABASE_")).toBe(true);
    }
  });

  it("CATEGORIES covers DEFAULT_SLUGS exactly once", () => {
    const flat = supabase.CATEGORIES.flatMap((c) => c.slugs);
    expect(flat.sort()).toEqual([...supabase.DEFAULT_SLUGS].sort());
  });

  it("excludes RUN_SQL_QUERY and CREATE_PROJECT from defaults", () => {
    const forbidden = ["RUN_SQL_QUERY", "CREATE_PROJECT", "DELETE_PROJECT", "LIST_ALL_PROJECTS"];
    for (const slug of supabase.DEFAULT_SLUGS) {
      for (const pattern of forbidden) {
        expect(slug).not.toContain(pattern);
      }
    }
  });
});
```

- [ ] **Step 3: Run to verify fail**

```bash
pnpm test allowlists 2>&1 | tail -10
```

Expected: FAIL — supabase module not found.

- [ ] **Step 4: Write `supabase.ts`**

Same shape as `github.ts`. Categories: Project info, Schema, Read. ~12 slugs total.

- [ ] **Step 5: Run to verify pass**

```bash
pnpm test allowlists 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/server/api/routers/trustclaw/agent/allowlists/supabase.ts \
  src/server/api/routers/trustclaw/agent/__tests__/allowlists.test.ts
git commit -m "feat(allowlist): add supabase default allowlist (pinned-project preset)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Gmail default allowlist + test

Same shape as Task 4. Categories: Inbox, Send, Drafts, Labels. ~12 slugs. Test block appended to `allowlists.test.ts`. Single commit.

---

## Task 6: Slack default allowlist + test

Same shape. Categories: Channels, Messages, Search, Users. ~12 slugs.

---

## Task 7: Notion default allowlist + test

Same shape. Categories: Pages, Databases, Blocks, Search. ~12 slugs.

---

## Task 8: Google Calendar default allowlist + test

Same shape. Multi-word toolkit prefix. Categories: Events, Calendars, Free-busy. ~10 slugs. **Crucial**: subagent should verify all slugs start with `GOOGLE_CALENDAR_` (the multi-word prefix).

---

## Task 9: `allowlists/index.ts` aggregator + integration test

**Files:**
- Create: `src/server/api/routers/trustclaw/agent/allowlists/index.ts`
- Modify: `src/server/api/routers/trustclaw/agent/__tests__/allowlists.test.ts`

- [ ] **Step 1: Write the failing test (append to allowlists.test.ts)**

```ts
import { DEFAULT_TOOL_ALLOWLIST } from "../allowlists";

describe("DEFAULT_TOOL_ALLOWLIST aggregator", () => {
  it("includes all 6 v1 toolkits", () => {
    expect(Object.keys(DEFAULT_TOOL_ALLOWLIST).sort()).toEqual([
      "github", "gmail", "google_calendar", "notion", "slack", "supabase",
    ]);
  });

  it("every entry is a non-empty readonly array", () => {
    for (const [toolkit, slugs] of Object.entries(DEFAULT_TOOL_ALLOWLIST)) {
      expect(slugs.length, `${toolkit} should not be empty`).toBeGreaterThan(0);
    }
  });

  it("no slug appears in more than one toolkit's defaults", () => {
    const seen = new Map<string, string>();
    for (const [toolkit, slugs] of Object.entries(DEFAULT_TOOL_ALLOWLIST)) {
      for (const slug of slugs) {
        const prev = seen.get(slug);
        expect(prev, `${slug} duplicated in ${prev} and ${toolkit}`).toBeUndefined();
        seen.set(slug, toolkit);
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Write `index.ts`**

```ts
import { DEFAULT_SLUGS as GITHUB_DEFAULT_SLUGS } from "./github";
import { DEFAULT_SLUGS as SUPABASE_DEFAULT_SLUGS } from "./supabase";
import { DEFAULT_SLUGS as GMAIL_DEFAULT_SLUGS } from "./gmail";
import { DEFAULT_SLUGS as SLACK_DEFAULT_SLUGS } from "./slack";
import { DEFAULT_SLUGS as NOTION_DEFAULT_SLUGS } from "./notion";
import { DEFAULT_SLUGS as GOOGLE_CALENDAR_DEFAULT_SLUGS } from "./google_calendar";

export const DEFAULT_TOOL_ALLOWLIST: Record<string, readonly string[]> = {
  github: GITHUB_DEFAULT_SLUGS,
  supabase: SUPABASE_DEFAULT_SLUGS,
  gmail: GMAIL_DEFAULT_SLUGS,
  slack: SLACK_DEFAULT_SLUGS,
  notion: NOTION_DEFAULT_SLUGS,
  google_calendar: GOOGLE_CALENDAR_DEFAULT_SLUGS,
};

export { buildAllowlistConfig } from "./build-config";

// Re-export individual toolkit metadata for the admin UI.
export * as githubAllowlist from "./github";
export * as supabaseAllowlist from "./supabase";
export * as gmailAllowlist from "./gmail";
export * as slackAllowlist from "./slack";
export * as notionAllowlist from "./notion";
export * as googleCalendarAllowlist from "./google_calendar";
```

- [ ] **Step 4: Run to verify pass**

- [ ] **Step 5: Commit**

---

## Task 10: tRPC `getToolkitTools` procedure + test

**Files:**
- Create: `src/server/api/routers/toolkits/getToolkitTools.ts`
- Create: `src/server/api/routers/toolkits/getToolkitTools.schema.ts`
- Modify: `src/server/api/routers/toolkits/index.ts`

This procedure merges curated defaults with Composio's live catalog and returns the full picker-dialog data.

- [ ] **Step 1: Write the schema**

`getToolkitTools.schema.ts`:

```ts
import { z } from "zod";

export const getToolkitToolsInput = z.object({
  toolkit: z.string().min(1).toLowerCase(),
});

export const toolkitToolItem = z.object({
  slug: z.string(),
  label: z.string(),
  description: z.string().optional(),
  category: z.string(),
  isDestructive: z.boolean(),
  isInDefault: z.boolean(),
  isEnabled: z.boolean(),
});

export const getToolkitToolsOutput = z.object({
  items: z.array(toolkitToolItem),
});
```

- [ ] **Step 2: Write the procedure**

`getToolkitTools.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { createComposioClient } from "~/server/clients/composio";
import { DEFAULT_TOOL_ALLOWLIST } from "~/server/api/routers/trustclaw/agent/allowlists";
import { isDestructiveGithubSlug } from "~/server/api/routers/trustclaw/agent/pin-github-repos";
import * as allowlistsModule from "~/server/api/routers/trustclaw/agent/allowlists";
import { getToolkitToolsInput } from "./getToolkitTools.schema";

export const getToolkitTools = protectedProcedure
  .input(getToolkitToolsInput)
  .query(async ({ ctx, input }) => {
    const userId = ctx.user.id;
    const instance = await db.composioClawInstance.findUnique({
      where: { userId },
      select: { allowedToolSlugs: true },
    });
    if (!instance) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
    }

    const enabled = new Set(instance.allowedToolSlugs.map((s) => s.toUpperCase()));
    const defaultSlugs = new Set(
      (DEFAULT_TOOL_ALLOWLIST[input.toolkit] ?? []).map((s) => s.toUpperCase()),
    );

    // Build slug → category map from the toolkit's CATEGORIES export.
    const toolkitMeta = (allowlistsModule as Record<string, unknown>)[
      `${input.toolkit.replace(/_./g, (m) => m[1]!.toUpperCase())}Allowlist`
    ] as { CATEGORIES?: readonly { label: string; slugs: readonly string[] }[] } | undefined;
    const slugToCategory = new Map<string, string>();
    if (toolkitMeta?.CATEGORIES) {
      for (const cat of toolkitMeta.CATEGORIES) {
        for (const slug of cat.slugs) slugToCategory.set(slug.toUpperCase(), cat.label);
      }
    }

    const composio = createComposioClient();
    const composioCatalog = await composio.tools.list({ toolkits: [input.toolkit] });
    const items = (composioCatalog.items ?? []).map((tool) => {
      const slug = (tool.slug ?? "").toUpperCase();
      const isInDefault = defaultSlugs.has(slug);
      const isDestructive =
        input.toolkit === "github"
          ? isDestructiveGithubSlug(slug)
          : /_DELETE_|_REMOVE_/.test(slug);
      return {
        slug,
        label: (tool.name ?? tool.slug ?? slug) as string,
        description: typeof tool.description === "string" ? tool.description : undefined,
        category: slugToCategory.get(slug) ?? "Advanced",
        isDestructive,
        isInDefault,
        isEnabled: enabled.has(slug),
      };
    });

    return { items };
  });
```

- [ ] **Step 3: Register in index.ts**

Add import + register in `toolkitsRouter`.

- [ ] **Step 4: Quick smoke test by calling via cURL with auth cookie**

Manual verification (no unit test for this query; the integration is the test). Subagent should verify the schema and procedure typecheck, run `pnpm exec tsc --noEmit`, confirm no new errors.

- [ ] **Step 5: Commit**

---

## Task 11: tRPC `setAllowedToolSlugs` procedure

**Files:**
- Create: `src/server/api/routers/toolkits/setAllowedToolSlugs.ts` + `.schema.ts`
- Create: `src/server/api/routers/toolkits/__tests__/setAllowedToolSlugs.test.ts` (mocked Prisma)
- Modify: `src/server/api/routers/toolkits/index.ts`

The procedure replaces one toolkit's slice of `allowedToolSlugs`, preserving other toolkits' slugs.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/clients/db", () => ({
  db: {
    composioClawInstance: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// ... rest of test setup similar to clearConversation.test.ts pattern
```

Test cases:
- Replaces only the toolkit's slugs; other toolkits' slugs preserved
- Validates each slug starts with the toolkit prefix (uppercase)
- Throws NOT_FOUND when no instance

- [ ] **Step 2-5: Standard TDD cycle**

Implementation should:
1. Read current `allowedToolSlugs` from DB.
2. Filter out slugs belonging to the specified toolkit (using same prefix logic as `buildAllowlistConfig`).
3. Append the new enabled slugs (validated to all start with toolkit prefix).
4. Update DB with the union.
5. Return `{ allowedToolSlugs }` (the full new list).

---

## Task 12: tRPC `resetToolkitToDefaults` procedure

Same shape as Task 11. Replaces toolkit slice with `DEFAULT_TOOL_ALLOWLIST[toolkit]`. Standard TDD cycle.

---

## Task 13: Composio session config rewrite + lazy seeding in `setup.ts`

**Files:**
- Modify: `src/server/api/routers/trustclaw/agent/setup.ts`

This is the core architectural change. The subagent must understand the existing flow before editing.

- [ ] **Step 1: Read the relevant file regions**

```bash
sed -n '410,495p' src/server/api/routers/trustclaw/agent/setup.ts
```

Find `composio.create(instance.userId, { manageConnections: ... })` at line ~482.

- [ ] **Step 2: Add lazy seeding (right after instance load)**

After the instance load (`db.composioClawInstance.findUnique...`) and before any other use of `instance`, add:

```ts
if (instance.allowedToolSlugs.length === 0) {
  try {
    const seedComposio = createComposioClient();
    const connected = await seedComposio.connectedAccounts.list({ userIds: [instance.userId] });
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
  } catch (err) {
    console.error("[prepareAgentRun] lazy-seed allowedToolSlugs failed:", err);
    // Continue; the empty allowlist means agent has no Composio tools this turn.
    // User will fix by configuring tools in /dashboard/toolkits.
  }
}
```

Import `DEFAULT_TOOL_ALLOWLIST` and `buildAllowlistConfig` from `./allowlists`.

- [ ] **Step 3: Rewrite `composio.create()` call**

Replace:

```ts
const session = await composio.create(instance.userId, {
  manageConnections: { waitForConnections: true },
});
```

with:

```ts
const toolsConfig = buildAllowlistConfig(instance.allowedToolSlugs);
const toolkitsToEnable = Object.keys(toolsConfig);
const session = await composio.create(instance.userId, {
  manageConnections: { waitForConnections: true },
  toolkits: { enable: toolkitsToEnable },
  tools: toolsConfig,
  workbench: {
    enable: true,
    enableProxyExecution: false,
  },
});
```

- [ ] **Step 4: Remove `allowDestructive` from the `pinGithubRepos` callsite**

Find the `pinGithubRepos(composioTools, instance.pinnedGithubRepos, instance.allowDestructiveGithubActions, ...)` call.

Change to: `pinGithubRepos(composioTools, instance.pinnedGithubRepos, ...)`. (The argument removal is wired in Task 14.)

- [ ] **Step 5: Verify typecheck**

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS" | grep -v "scripts/create-user" | head -10
```

Errors should now be limited to pin-github-repos.ts (signature mismatch — fixed in Task 14) and any UI file still referencing `allowDestructiveGithubActions` (fixed later).

- [ ] **Step 6: Commit**

```bash
git add src/server/api/routers/trustclaw/agent/setup.ts
git commit -m "feat(agent): switch to Composio session-level allowlist + workbench proxy off

Replaces the open-tool-surface model with a server-side allowlist
enforced by Composio's ToolRouterCreateSessionConfig. Adds lazy
seeding of allowedToolSlugs from curated per-toolkit defaults on
first agent run.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: Trim `pin-github-repos.ts` to ~200 LOC

**Files:**
- Modify: `src/server/api/routers/trustclaw/agent/pin-github-repos.ts`

The denylist plumbing is now dead code (Composio enforces at session config). Strip everything except the `owner/repo` arg-check wrapper.

- [ ] **Step 1: Delete from the file**

Remove these symbols and any code that references only them:

- `GITHUB_FOREIGN_LISTING_TOOLS`
- `GITHUB_AUTH_USER_LISTING_TOOLS`
- `GITHUB_LISTING_TOOLS_TO_FILTER`
- `GITHUB_HIDDEN_SLUGS`
- `FOREIGN_LISTING_BLOCKED_ERROR`
- `SEARCH_BLOCKED_ERROR`
- `URL_REFUSED_ERROR`
- `NO_PINS_ERROR` (kept — still used in surviving block path)
- `NOT_IN_PIN_SET_ERROR` (kept)
- `DESTRUCTIVE_BLOCKED_ERROR` — delete (no more destructive check)
- `authUserListingBlockedError`
- `mentionsHiddenGithubSlug`
- `filterReposInResult`
- `scrubSearchToolsResultForGithub`
- `classifySearchSlug`
- `rewriteSearchQuery`
- `repoFilterIndices` parameter on `rewriteGithubBatch` and `patchGithubBatchResult`
- All search-tools wrap branch in `pinGithubRepos`

`isDestructiveGithubSlug` stays — used by `getToolkitTools` to flag destructive slugs in the admin UI.

`classifyGithubEntry` stays — used by surviving `rewriteGithubBatch`.

- [ ] **Step 2: Update `pinGithubRepos` signature**

Change:

```ts
export function pinGithubRepos(
  tools: ToolSet,
  pinnedRepos: string[],
  allowDestructive: boolean,    // ← remove
  recordBlock: RecordGithubBlock,
): ToolSet
```

to:

```ts
export function pinGithubRepos(
  tools: ToolSet,
  pinnedRepos: string[],
  recordBlock: RecordGithubBlock,
): ToolSet
```

Remove the SEARCH_TOOLS branch in the function entirely. Remove destructive-gate logic in `rewriteGithubBatch`.

- [ ] **Step 3: Trim `GithubBlockReasonValue` type**

```ts
export type GithubBlockReasonValue = "not_pinned";
```

(All other reasons no longer emitted from this file.)

- [ ] **Step 4: Verify typecheck**

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS" | grep -v "scripts/create-user" | head -10
```

Expected: clean for pin-github-repos.ts; possibly errors in `getToolkitTools.ts` if the destructive-detection import path changed. Fix as needed.

- [ ] **Step 5: Commit**

```bash
git add src/server/api/routers/trustclaw/agent/pin-github-repos.ts
git commit -m "refactor(agent): trim pin-github-repos to ~200 LOC (denylist plumbing → allowlist)

The Composio session-level allowlist (added in prior commit) replaces:
- GITHUB_FOREIGN_LISTING_TOOLS handling
- GITHUB_AUTH_USER_LISTING_TOOLS handling
- GITHUB_HIDDEN_SLUGS + SEARCH_TOOLS scrub
- filterReposInResult + repoFilterIndices machinery
- rewriteSearchQuery / classifySearchSlug
- All destructive-flag gating (destructive ops are now opt-in slugs)

Surviving: owner/repo arg validation against pinned set, structured
block-error synthesis in the MULTI_EXECUTE_TOOL response.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: Update `pin-github-repos.test.ts` (delete denylist tests)

**Files:**
- Modify: `src/server/api/routers/trustclaw/agent/__tests__/pin-github-repos.test.ts`

- [ ] **Step 1: Delete test blocks for deleted symbols**

Delete:
- `describe("scrubSearchToolsResultForGithub", ...)` — entire block
- `describe("filterReposInResult", ...)` — entire block
- `describe("rewriteSearchQuery", ...)` — entire block
- `describe("classifySearchSlug", ...)` — entire block
- `describe("patchGithubBatchResult repo-filter mode", ...)` — entire block
- All tests inside `describe("rewriteGithubBatch", ...)` for: foreign listing blocks, auth-user enumeration blocks, plan-text scrub, destructive gate

Keep:
- `describe("isDestructiveGithubSlug", ...)` — still useful (used by UI)
- `describe("classifyGithubEntry", ...)` — still used by surviving wrapper
- `describe("rewriteGithubBatch", ...)` — keep tests for pin-set validation (owner/repo arg checks). Update the destructive-blocked test to expect different behavior (destructive now allowed if in allowlist; not tested here).
- `describe("patchGithubBatchResult", ...)` — keep blocked-slot patching tests

- [ ] **Step 2: Update remaining `rewriteGithubBatch` tests**

The signature changed (no `allowDestructive` arg). Update each call:

```ts
// Before:
const { blockedIndices } = rewriteGithubBatch(input, pins, false, noopRecord);
// After:
const { blockedIndices } = rewriteGithubBatch(input, pins, noopRecord);
```

- [ ] **Step 3: Run tests**

```bash
pnpm test pin-github-repos 2>&1 | tail -10
```

Expected: green. Net test count for this file: ~30 (was ~80).

- [ ] **Step 4: Run full suite**

```bash
pnpm test 2>&1 | tail -6
```

Expected: all suites green. Total tests roughly ~89 (down from 104, accounting for new build-config and allowlists tests).

- [ ] **Step 5: Commit**

---

## Task 16: Admin UI — `tools-allowlist-dialog.tsx`

**Files:**
- Create: `src/app/(authenticated)/dashboard/toolkits/_components/tools-allowlist-dialog.tsx`

The dialog opens from the toolkit card, lists every tool returned by `getToolkitTools`, grouped by category, with switches for each. "Show advanced" collapsible for non-default slugs.

- [ ] **Step 1: Scaffold the component**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Search, AlertCircle } from "lucide-react";
import { trpc } from "~/clients/trpc";
import {
  showSuccessToast,
  trpcToastOnError,
} from "~/components/core/toast-notifications";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Skeleton } from "~/components/ui/skeleton";

interface Props {
  toolkit: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ToolsAllowlistDialog({ toolkit, open, onOpenChange }: Props) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());

  const query = trpc.toolkits.getToolkitTools.useQuery(
    { toolkit },
    { enabled: open, refetchOnMount: "always" },
  );

  // Seed local enabled set from query result.
  useEffect(() => {
    if (open && query.data) {
      setEnabled(
        new Set(query.data.items.filter((t) => t.isEnabled).map((t) => t.slug)),
      );
    }
  }, [open, query.data]);

  const setMutation = trpc.toolkits.setAllowedToolSlugs.useMutation({
    onSuccess: () => {
      showSuccessToast("Tools updated");
      void utils.toolkits.getToolkitTools.invalidate({ toolkit });
      void utils.toolkits.getToolkits.invalidate();
      onOpenChange(false);
    },
    onError: trpcToastOnError,
  });

  const resetMutation = trpc.toolkits.resetToolkitToDefaults.useMutation({
    onSuccess: () => {
      showSuccessToast("Reset to defaults");
      void utils.toolkits.getToolkitTools.invalidate({ toolkit });
    },
    onError: trpcToastOnError,
  });

  // Group + filter logic
  const items = query.data?.items ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (t) =>
        !q ||
        t.label.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q),
    );
  }, [items, search]);

  const inDefault = filtered.filter((t) => t.isInDefault);
  const advanced = filtered.filter((t) => !t.isInDefault);
  const byCategory = useMemo(() => {
    const groups = new Map<string, typeof inDefault>();
    for (const t of inDefault) {
      const list = groups.get(t.category) ?? [];
      list.push(t);
      groups.set(t.category, list);
    }
    return Array.from(groups.entries());
  }, [inDefault]);

  const handleToggle = (slug: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      await setMutation.mutateAsync({
        toolkit,
        enabled: Array.from(enabled),
      });
    } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[600px]">
        <DialogHeader className="space-y-1 border-b px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-base capitalize">
              {toolkit.replace(/_/g, " ")} tools
            </DialogTitle>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              {enabled.size} of {items.length}
            </span>
          </div>
          <DialogDescription>
            Toggle which actions the agent can perform.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b px-6 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void resetMutation.mutateAsync({ toolkit })}
            disabled={resetMutation.isPending}
          >
            Reset to defaults
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {query.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : query.error ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {query.error.message}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {byCategory.map(([category, tools]) => (
                <section key={category}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {category}
                  </h3>
                  <div className="space-y-1.5">
                    {tools.map((t) => (
                      <ToolRow
                        key={t.slug}
                        tool={t}
                        enabled={enabled.has(t.slug)}
                        onToggle={() => handleToggle(t.slug)}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {advanced.length > 0 && (
                <section>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="mb-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown
                      className={
                        "h-3 w-3 transition-transform " +
                        (showAdvanced ? "rotate-0" : "-rotate-90")
                      }
                    />
                    Show advanced (not in defaults)
                  </button>
                  {showAdvanced && (
                    <div className="space-y-1.5">
                      {advanced.map((t) => (
                        <ToolRow
                          key={t.slug}
                          tool={t}
                          enabled={enabled.has(t.slug)}
                          onToggle={() => handleToggle(t.slug)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t px-6 py-3 sm:gap-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={setMutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={setMutation.isPending}>
            {setMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ToolRowProps {
  tool: {
    slug: string;
    label: string;
    description?: string;
    isDestructive: boolean;
  };
  enabled: boolean;
  onToggle: () => void;
}

function ToolRow({ tool, enabled, onToggle }: ToolRowProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-2.5 transition-colors hover:bg-accent/50">
      <Switch checked={enabled} onCheckedChange={onToggle} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{tool.label}</span>
          {tool.isDestructive && (
            <span className="rounded-sm bg-destructive/15 px-1 py-0.5 text-[10px] font-medium uppercase text-destructive">
              destructive
            </span>
          )}
        </div>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {tool.slug}
        </span>
      </div>
    </label>
  );
}
```

- [ ] **Step 2: Verify typecheck**

- [ ] **Step 3: Commit**

---

## Task 17: Wire the dialog into `toolkit-card.tsx`

**Files:**
- Modify: `src/app/(authenticated)/dashboard/toolkits/_components/toolkit-card.tsx`

- [ ] **Step 1: Add "Tools" line + "Manage tools" button to the card**

Find the card body. After the existing pinning pill (Supabase project or GitHub repos), add:

```tsx
{isConnected && (
  <ToolsLine toolkit={toolkit.slug} />
)}
```

Where `ToolsLine` is a small sub-component:

```tsx
function ToolsLine({ toolkit }: { toolkit: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = trpc.toolkits.getToolkitTools.useQuery({
    toolkit: toolkit.toLowerCase(),
  });
  const enabled = data?.items.filter((t) => t.isEnabled).length ?? 0;
  const total = data?.items.length ?? 0;

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Tools: {isLoading ? "..." : `${enabled} of ${total}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          Manage
        </Button>
      </div>
      <ToolsAllowlistDialog toolkit={toolkit.toLowerCase()} open={open} onOpenChange={setOpen} />
    </>
  );
}
```

- [ ] **Step 2: Drop any references to `allowDestructiveGithubActions` in this file**

If the card references it (it may from earlier work), remove.

- [ ] **Step 3: Manual UI verification**

Start dev server (`pnpm dev`), log in, visit `/dashboard/toolkits`. The Supabase and GitHub cards should each show a "Tools: N of M" line and a Manage button. Clicking Manage opens the dialog.

- [ ] **Step 4: Commit**

---

## Task 18: Drop other references to `allowDestructiveGithubActions`

**Files:**
- Search for and modify any UI / settings code still referencing the removed field.

- [ ] **Step 1: Find references**

```bash
grep -rn "allowDestructiveGithubActions" src/ scripts/ --include="*.ts" --include="*.tsx"
```

- [ ] **Step 2: Remove each reference**

For each hit:
- Settings UI components (e.g., GitHub toolkit card extras): remove the toggle row.
- tRPC procedures that update the field: delete.
- Any tests that exercise the field: delete.

Typecheck after each file.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: remove allowDestructiveGithubActions references

Field was dropped from schema in an earlier commit. Cleaning up
the dependent UI/tRPC code now.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 19: End-to-end verification

- [ ] **Step 1: Typecheck**

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS" | grep -v "scripts/create-user"
```

Expected: empty (no new errors).

- [ ] **Step 2: Tests**

```bash
pnpm test 2>&1 | tail -8
```

Expected: all suites green. Approximately 89 tests.

- [ ] **Step 3: Lint**

```bash
pnpm lint 2>&1 | tail -20
```

Expected: only pre-existing errors in `getAuthLink.ts` and other files we didn't touch.

- [ ] **Step 4: Dev server smoke test**

```bash
pnpm dev &
sleep 6
curl -s -o /dev/null -w "/: %{http_code}\n" http://localhost:3000/
```

Visit in browser: `/dashboard/toolkits`. Confirm:
- Each connected toolkit card shows "Tools: N of M" + Manage button.
- Clicking Manage on GitHub opens dialog with categories visible.
- Toggling a switch and clicking Save persists (re-open shows the change).
- "Reset to defaults" works.
- "Show advanced" reveals non-default slugs (if any).

Mobile viewport (Chrome DevTools): dialog renders as Sheet, content scrolls inside.

- [ ] **Step 5: Send an end-to-end chat message and verify the agent's repo answer**

In the chat, ask: "What github repos do you have access to?"

Expected: agent uses only allowlisted GitHub tools. If the agent tries `LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER`, Composio rejects (tool not in allowlist). The agent should answer from its understanding of pinned repos (or honestly say it cannot enumerate).

If the agent answers correctly: ✅ architecture works as intended.

If the agent enumerates anyway: capture the tool call from terminal pane → debug which path leaked.

- [ ] **Step 6: Commit any final smoke-test-driven fixes**

---

## Final commit + handoff

If all 19 tasks complete cleanly, the branch is ready for the parallel code review phase (full-flow Phase 6).

Net diff at completion:

- **Added**: ~1500 lines across 14 new files (6 toolkit allowlists, index, build-config, 3 tRPC procedures + schemas, dialog component, tests).
- **Deleted**: ~2000 lines (denylist plumbing in pin-github-repos.ts + ~30 tests + UI references).
- **Net**: ~−500 LOC.

---

## Notes for the executing subagent

- **Composio slug names**: every toolkit allowlist file requires verification against the live Composio catalog at implementation time. Use the verification snippet from Task 3, Step 1.
- **`isDestructiveGithubSlug`**: this helper survives the trim because `getToolkitTools` uses it to flag destructive slugs in the admin UI. Don't accidentally delete it.
- **`waitForConnections: true` + new config**: the new session config keeps `manageConnections: { waitForConnections: true }` unchanged. The hang issue we ran into earlier was due to a different cause; don't drop this option.
- **Existing instance migration**: lazy seeding runs once per instance. If you're testing with the user's instance (`b5bf6b8b-c034-4343-80b3-b211f609f19c`), they may want their `allowedToolSlugs` pre-populated with current settings rather than the curated default. Confirm with the user before the first run that wipes their custom state — or seed manually via the diagnostic script pattern.
- **`MERGE_PULL_REQUEST` and `RUN_SQL_QUERY`**: explicitly excluded from defaults per spec Open Question #2 and #3. Easy to flip during code review if the user changes their mind.
