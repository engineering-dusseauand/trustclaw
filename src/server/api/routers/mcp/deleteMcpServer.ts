import { TRPCError } from "@trpc/server";

import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";

import { deleteMcpServerInput } from "./deleteMcpServer.schema";

export const deleteMcpServer = protectedProcedure
  .input(deleteMcpServerInput)
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

    // Scope check — delete only when the row belongs to this user.
    const existing = await db.composioClawMcpServer.findFirst({
      where: { id: input.id, instanceId: instance.id },
      select: { id: true },
    });
    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "MCP server not found",
      });
    }

    await db.composioClawMcpServer.delete({ where: { id: input.id } });

    return { id: input.id };
  });
