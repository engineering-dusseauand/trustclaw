import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { clearStreamingMessage } from "~/server/clients/redis";

/**
 * Deletes all chat messages for the current user's instance and resets
 * the compaction state, leaving everything else (memories, cron jobs,
 * pinned Supabase project, onboarding state, telegram link) intact.
 *
 * Use this when the user wants a clean conversation context — e.g. the
 * agent's prior turns reference data they no longer want in the prompt
 * (project enumeration leaks, embarrassing exchanges, stale state).
 */
export const clearConversation = protectedProcedure.mutation(async ({ ctx }) => {
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

  const result = await db.$transaction(async (tx) => {
    const deleted = await tx.message.deleteMany({
      where: { instanceId: instance.id },
    });

    await tx.composioClawInstance.update({
      where: { id: instance.id },
      data: {
        lastCompactionSummary: null,
        lastCompactionAt: null,
        tokensAtCompaction: null,
        compactionCount: 0,
        memoryFlushCount: 0,
      },
    });

    return { deletedMessageCount: deleted.count };
  });

  // Drop any in-flight streaming state so a stale stream can't dump tokens
  // into a now-empty conversation. Best-effort — Redis may be unconfigured
  // in self-host setups.
  await clearStreamingMessage(instance.id).catch(() => undefined);

  return result;
});
