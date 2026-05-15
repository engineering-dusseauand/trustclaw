import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";

export const getRecentGithubBlocks = protectedProcedure
  .input(
    z.object({
      limit: z.number().int().min(1).max(100).optional().default(20),
    }),
  )
  .query(async ({ ctx, input }) => {
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

    const items = await db.githubBlockedAction.findMany({
      where: { instanceId: instance.id },
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: {
        id: true,
        toolSlug: true,
        attemptedRepo: true,
        reason: true,
        createdAt: true,
      },
    });

    return { items };
  });
