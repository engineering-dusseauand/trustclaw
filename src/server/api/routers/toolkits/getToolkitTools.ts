import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { env } from "~/env";
import * as allowlistsModule from "~/server/api/routers/trustclaw/agent/allowlists";
import { DEFAULT_TOOL_ALLOWLIST } from "~/server/api/routers/trustclaw/agent/allowlists";
import { getToolkitToolsInput } from "./getToolkitTools.schema";

/**
 * Cross-toolkit destructive pattern. Matches the same shape the
 * allowlist tests enforce (DELETE_*, REMOVE_*, ARCHIVE_*, etc.). Used
 * to flag slugs in the admin UI so the user gets a visible warning
 * before opting them in.
 */
const DESTRUCTIVE_PATTERN =
  /(_DELETE_|_REMOVE_|_ARCHIVE_|_MOVE_TO_TRASH|_CLEAR_|_DROP_|_MERGE_A_PULL_REQUEST)/;

const composioToolShape = z.object({
  slug: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
});

/**
 * Paginates through Composio's REST catalog for one toolkit. The
 * SDK doesn't expose this surface in 0.6.3 (no `composio.tools.list`),
 * so we hit the public v3 endpoint directly with the apiKey.
 */
async function fetchToolkitCatalog(toolkit: string): Promise<Array<z.infer<typeof composioToolShape>>> {
  const all: Array<z.infer<typeof composioToolShape>> = [];
  let cursor: string | undefined;
  // Safety cap — biggest toolkit we've seen is github at ~823 slugs / 2 pages.
  for (let page = 0; page < 10; page++) {
    const url = new URL("https://backend.composio.dev/api/v3/tools");
    url.searchParams.set("toolkit_slug", toolkit);
    url.searchParams.set("limit", "500");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, {
      headers: { "x-api-key": env.COMPOSIO_API_KEY ?? "" },
    });
    if (!res.ok) {
      throw new Error(`Composio catalog HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const json = (await res.json()) as { items?: unknown[]; next_cursor?: string };
    for (const raw of json.items ?? []) {
      const parsed = composioToolShape.safeParse(raw);
      if (parsed.success) all.push(parsed.data);
    }
    cursor = json.next_cursor;
    if (!cursor || (json.items ?? []).length === 0) break;
  }
  return all;
}

interface ToolkitMeta {
  CATEGORIES?: readonly { label: string; slugs: readonly string[] }[];
}

/**
 * Look up the per-toolkit metadata namespace exported from the
 * allowlists barrel (e.g. `githubAllowlist`, `googlecalendarAllowlist`).
 * Composio uses single-word toolkit slugs even for compound names
 * (`googlecalendar`, not `google_calendar`), so this is a flat lookup.
 */
function findToolkitMeta(toolkit: string): ToolkitMeta | undefined {
  const key = `${toolkit}Allowlist`;
  const candidate = (allowlistsModule as Record<string, unknown>)[key];
  if (candidate && typeof candidate === "object") return candidate as ToolkitMeta;
  return undefined;
}

export const getToolkitTools = protectedProcedure
  .input(getToolkitToolsInput)
  .query(async ({ ctx, input }) => {
    const userId = ctx.user.id;

    const instance = await db.composioClawInstance.findUnique({
      where: { userId },
      select: { allowedToolSlugs: true },
    });
    if (!instance) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "TrustClaw instance not found",
      });
    }

    const enabled = new Set(instance.allowedToolSlugs.map((s) => s.toUpperCase()));
    const defaultSlugs = new Set(
      (DEFAULT_TOOL_ALLOWLIST[input.toolkit] ?? []).map((s) => s.toUpperCase()),
    );

    const meta = findToolkitMeta(input.toolkit);
    const categoryBySlug = new Map<string, string>();
    if (meta?.CATEGORIES) {
      for (const cat of meta.CATEGORIES) {
        for (const slug of cat.slugs) categoryBySlug.set(slug.toUpperCase(), cat.label);
      }
    }

    let catalog: Array<z.infer<typeof composioToolShape>>;
    try {
      catalog = await fetchToolkitCatalog(input.toolkit);
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          err instanceof Error
            ? `Composio catalog fetch failed: ${err.message}`
            : "Composio catalog fetch failed",
      });
    }

    const items = catalog.map((tool) => {
      const slug = tool.slug.toUpperCase();
      return {
        slug,
        label: tool.name ?? slug,
        description: tool.description,
        category: categoryBySlug.get(slug) ?? "Advanced",
        isDestructive: DESTRUCTIVE_PATTERN.test(slug),
        isInDefault: defaultSlugs.has(slug),
        isEnabled: enabled.has(slug),
      };
    });

    return { items };
  });
