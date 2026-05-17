/**
 * Per-toolkit default allowlist aggregator.
 *
 * Each toolkit lives in its own file with verified-against-Composio
 * `DEFAULT_SLUGS` and `CATEGORIES` exports. This module re-exports
 * them as:
 *
 *  - `DEFAULT_TOOL_ALLOWLIST` — `Record<toolkitSlug, readonly string[]>`,
 *    keyed by Composio's lowercase toolkit slug. Used by the lazy
 *    seeding logic in `setup.ts` to populate `allowedToolSlugs` for
 *    new instances.
 *  - One namespace per toolkit (e.g. `githubAllowlist`) exposing both
 *    `DEFAULT_SLUGS` and `CATEGORIES`. Used by `getToolkitTools` (the
 *    admin UI procedure) to label slugs by their default category and
 *    surface human-readable category headers.
 *
 * The keys in `DEFAULT_TOOL_ALLOWLIST` MUST match Composio's actual
 * toolkit slugs (lowercase, single-word for compound names — verified
 * via https://backend.composio.dev/api/v3/tools?toolkit_slug=<name>).
 * Mismatches mean Composio silently drops the slugs from the session
 * config and the agent can't see them.
 */

import { DEFAULT_SLUGS as GITHUB_DEFAULT_SLUGS } from "./github";
import { DEFAULT_SLUGS as SUPABASE_DEFAULT_SLUGS } from "./supabase";
import { DEFAULT_SLUGS as GMAIL_DEFAULT_SLUGS } from "./gmail";
import { DEFAULT_SLUGS as SLACK_DEFAULT_SLUGS } from "./slack";
import { DEFAULT_SLUGS as NOTION_DEFAULT_SLUGS } from "./notion";
import { DEFAULT_SLUGS as GOOGLECALENDAR_DEFAULT_SLUGS } from "./googlecalendar";

export const DEFAULT_TOOL_ALLOWLIST: Record<string, readonly string[]> = {
  github: GITHUB_DEFAULT_SLUGS,
  supabase: SUPABASE_DEFAULT_SLUGS,
  gmail: GMAIL_DEFAULT_SLUGS,
  slack: SLACK_DEFAULT_SLUGS,
  notion: NOTION_DEFAULT_SLUGS,
  googlecalendar: GOOGLECALENDAR_DEFAULT_SLUGS,
};

export { buildAllowlistConfig } from "./build-config";

// Re-export each toolkit's metadata for the admin UI to query CATEGORIES.
export * as githubAllowlist from "./github";
export * as supabaseAllowlist from "./supabase";
export * as gmailAllowlist from "./gmail";
export * as slackAllowlist from "./slack";
export * as notionAllowlist from "./notion";
export * as googlecalendarAllowlist from "./googlecalendar";
