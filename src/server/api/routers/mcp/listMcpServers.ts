import { TRPCError } from "@trpc/server";

import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";

/**
 * Lists the current user's MCP servers. Sanitizes ciphertext out;
 * surfaces a `hasAuth` boolean and `allowedToolNamesCount` so the UI
 * can render without exposing secrets.
 */
export const listMcpServers = protectedProcedure.query(async ({ ctx }) => {
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

  const rows = await db.composioClawMcpServer.findMany({
    where: { instanceId: instance.id },
    select: {
      id: true,
      slug: true,
      name: true,
      url: true,
      transport: true,
      enabled: true,
      allowedToolNames: true,
      authHeaderEncrypted: true,
      lastConnectedAt: true,
      lastConnectionError: true,
      protocolVersion: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    items: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      url: row.url,
      transport: row.transport,
      enabled: row.enabled,
      hasAuth: row.authHeaderEncrypted !== null,
      allowedToolNamesCount: row.allowedToolNames.length,
      lastConnectedAt: row.lastConnectedAt,
      lastConnectionError: row.lastConnectionError,
      protocolVersion: row.protocolVersion,
      createdAt: row.createdAt,
    })),
  };
});
