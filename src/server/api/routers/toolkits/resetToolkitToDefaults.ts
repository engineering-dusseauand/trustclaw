import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { DEFAULT_TOOL_ALLOWLIST } from "~/server/api/routers/trustclaw/agent/allowlists";
import { resetToolkitToDefaultsInput } from "./resetToolkitToDefaults.schema";

function toolkitOfSlug(slug: string): string {
  return slug.toUpperCase().split("_")[0]?.toLowerCase() ?? "";
}

/**
 * Replaces the slice of `allowedToolSlugs` belonging to the given
 * toolkit with the curated `DEFAULT_TOOL_ALLOWLIST[toolkit]`. Other
 * toolkits' slugs are preserved. If the toolkit has no curated default
 * (i.e. not in the v1 set), the slice is cleared — matching the
 * "falls closed for unfamiliar toolkits" property.
 */
export const resetToolkitToDefaults = protectedProcedure
  .input(resetToolkitToDefaultsInput)
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.user.id;
    const targetToolkit = input.toolkit;

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

    const defaults = (DEFAULT_TOOL_ALLOWLIST[targetToolkit] ?? []).map((s) =>
      s.toUpperCase(),
    );
    const preserved = instance.allowedToolSlugs.filter(
      (s) => toolkitOfSlug(s) !== targetToolkit,
    );
    const nextList = Array.from(new Set([...preserved, ...defaults]));

    const updated = await db.composioClawInstance.update({
      where: { id: instance.id },
      data: { allowedToolSlugs: nextList },
      select: { allowedToolSlugs: true },
    });

    return { allowedToolSlugs: updated.allowedToolSlugs };
  });
