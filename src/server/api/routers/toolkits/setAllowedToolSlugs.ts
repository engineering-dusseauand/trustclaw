import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { setAllowedToolSlugsInput } from "./setAllowedToolSlugs.schema";

/**
 * Returns the toolkit slug for a given uppercase Composio tool slug.
 * Composio's actual catalog uses single-word toolkit slugs even for
 * compound names (GOOGLECALENDAR_*, GOOGLEDRIVE_*), so a plain
 * `split("_")[0]` always wins. Mirror of the logic in
 * `agent/allowlists/build-config.ts` — kept inline here to avoid a
 * cross-module import for a one-liner.
 */
function toolkitOfSlug(slug: string): string {
  return slug.toUpperCase().split("_")[0]?.toLowerCase() ?? "";
}

/**
 * Replaces the slice of `allowedToolSlugs` belonging to the given
 * toolkit with `input.enabled`. Other toolkits' slugs are preserved
 * (atomic per toolkit). Inputs are normalised to uppercase before
 * write so case-insensitive lookups downstream are consistent.
 *
 * Validates that every slug in `enabled` belongs to the specified
 * toolkit — silently dropping mismatches would be confusing UX
 * ("I clicked save and nothing changed").
 */
export const setAllowedToolSlugs = protectedProcedure
  .input(setAllowedToolSlugsInput)
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.user.id;
    const targetToolkit = input.toolkit;

    // Validate inputs all belong to the target toolkit.
    const normalisedEnabled = input.enabled.map((s) => s.toUpperCase());
    for (const slug of normalisedEnabled) {
      const tk = toolkitOfSlug(slug);
      if (tk !== targetToolkit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Slug ${slug} belongs to toolkit "${tk}", not "${targetToolkit}". Refusing to save mismatched slugs.`,
        });
      }
    }

    const instance = await db.composioClawInstance.findUnique({
      where: { userId },
      select: { id: true, allowedToolSlugs: true },
    });
    if (!instance) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "TrustClaw instance not found",
      });
    }

    // Drop existing slugs for this toolkit; keep all other toolkits' slugs.
    const preserved = instance.allowedToolSlugs.filter(
      (s) => toolkitOfSlug(s) !== targetToolkit,
    );
    const nextList = Array.from(
      new Set([...preserved, ...normalisedEnabled]),
    );

    const updated = await db.composioClawInstance.update({
      where: { id: instance.id },
      data: { allowedToolSlugs: nextList },
      select: { allowedToolSlugs: true },
    });

    return { allowedToolSlugs: updated.allowedToolSlugs };
  });
