import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { setAllowDestructiveGithubActionsInput } from "./setGithubPinnedRepos.schema";

export const setAllowDestructiveGithubActions = protectedProcedure
  .input(setAllowDestructiveGithubActionsInput)
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

    const updated = await db.composioClawInstance.update({
      where: { userId },
      data: { allowDestructiveGithubActions: input.allow },
      select: { allowDestructiveGithubActions: true },
    });

    return { allowDestructive: updated.allowDestructiveGithubActions };
  });
