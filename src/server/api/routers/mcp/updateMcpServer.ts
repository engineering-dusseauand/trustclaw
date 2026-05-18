import { TRPCError } from "@trpc/server";

import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { encryptSecret } from "~/server/lib/crypto";

import { updateMcpServerInput } from "./updateMcpServer.schema";

/**
 * Patches selected fields on an MCP server row.
 *
 * Intentionally NOT editable: `url` and `slug`. URL changes go via
 * delete+recreate (protects the immutable slug from being repointed at
 * an attacker host). Auth header semantics:
 *   - "preserve": leave existing ciphertext untouched
 *   - null: clear it
 *   - string: re-encrypt with the new value
 */
export const updateMcpServer = protectedProcedure
  .input(updateMcpServerInput)
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

    // Scope check — make sure the server belongs to this user's instance.
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

    type PatchData = {
      name?: string;
      transport?: string;
      enabled?: boolean;
      authHeaderEncrypted?: string | null;
    };
    const data: PatchData = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.transport !== undefined) data.transport = input.transport;
    if (input.enabled !== undefined) data.enabled = input.enabled;

    if (input.authHeader !== undefined && input.authHeader !== "preserve") {
      data.authHeaderEncrypted =
        input.authHeader === null ? null : encryptSecret(input.authHeader);
    }

    if (Object.keys(data).length === 0) {
      return { id: existing.id };
    }

    await db.composioClawMcpServer.update({
      where: { id: input.id },
      data,
    });

    return { id: input.id };
  });
