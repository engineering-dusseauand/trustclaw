import { TRPCError } from "@trpc/server";

import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";

import { setMcpServerAllowedToolsInput } from "./setMcpServerAllowedTools.schema";

export const setMcpServerAllowedTools = protectedProcedure
  .input(setMcpServerAllowedToolsInput)
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

    // Dedupe + cap was already enforced by Zod (max 200). Persist as-is.
    const deduped = Array.from(new Set(input.allowedToolNames));
    await db.composioClawMcpServer.update({
      where: { id: input.id },
      data: { allowedToolNames: deduped },
    });

    return { id: input.id, count: deduped.length };
  });
