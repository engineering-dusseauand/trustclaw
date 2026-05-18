import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { setGithubPinnedReposInput } from "./setGithubPinnedRepos.schema";

export const setGithubPinnedRepos = protectedProcedure
  .input(setGithubPinnedReposInput)
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.user.id;
    const instance = await db.composioClawInstance.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!instance) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "TrustClaw instance not found",
      });
    }

    // Dedupe while preserving order and normalise to lowercase. The Zod
    // schema already enforced lowercase but defense-in-depth is cheap.
    const deduped = Array.from(
      new Set(input.pinnedRepos.map((r) => r.toLowerCase())),
    );

    const updated = await db.composioClawInstance.update({
      where: { userId },
      data: { pinnedGithubRepos: deduped },
      select: { pinnedGithubRepos: true },
    });

    return { pinnedRepos: updated.pinnedGithubRepos };
  });
