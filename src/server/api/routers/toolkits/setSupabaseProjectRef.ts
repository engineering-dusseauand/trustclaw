import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { setSupabaseProjectRefInput } from "./setSupabaseProjectRef.schema";

export const setSupabaseProjectRef = protectedProcedure
  .input(setSupabaseProjectRefInput)
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
      data: { supabaseProjectRef: input.projectRef },
      select: { supabaseProjectRef: true },
    });

    return { projectRef: updated.supabaseProjectRef };
  });
