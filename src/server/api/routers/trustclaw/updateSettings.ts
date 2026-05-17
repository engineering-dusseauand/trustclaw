import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { updateSettingsInput } from "./updateSettings.schema";

export const updateSettings = protectedProcedure
  .input(updateSettingsInput)
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.user.id;

    const instance = await db.composioClawInstance.findUnique({
      where: { userId },
    });

    if (!instance) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "TrustClaw by Composio instance not found",
      });
    }

    // Prompts use `null` as "clear back to default behaviour", so we
    // treat `=== undefined` as "no change" and any explicit value (even
    // empty string or null) as a write.
    const updateData: Record<string, unknown> = {};
    if (input.anthropicModel) updateData.anthropicModel = input.anthropicModel;
    if (input.soulPrompt !== undefined) updateData.soulPrompt = input.soulPrompt;
    if (input.identityPrompt !== undefined)
      updateData.identityPrompt = input.identityPrompt;
    if (input.userPrompt !== undefined) updateData.userPrompt = input.userPrompt;

    const [updated] = await db.$transaction([
      db.composioClawInstance.update({
        where: { userId },
        data: updateData,
        select: {
          id: true,
          anthropicModel: true,
          soulPrompt: true,
          identityPrompt: true,
          userPrompt: true,
          updatedAt: true,
        },
      }),
      ...(input.timezone
        ? [db.user.update({ where: { id: userId }, data: { timezone: input.timezone } })]
        : []),
    ]);

    return updated;
  });
