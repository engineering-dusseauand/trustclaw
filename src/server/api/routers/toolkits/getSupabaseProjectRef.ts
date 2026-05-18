import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";

export const getSupabaseProjectRef = protectedProcedure.query(async ({ ctx }) => {
  const userId = ctx.user.id;

  const instance = await db.composioClawInstance.findUnique({
    where: { userId },
    select: { supabaseProjectRef: true },
  });

  return { projectRef: instance?.supabaseProjectRef ?? null };
});
