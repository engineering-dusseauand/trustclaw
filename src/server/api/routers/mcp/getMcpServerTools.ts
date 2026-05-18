import { TRPCError } from "@trpc/server";

import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { decryptSecret } from "~/server/lib/crypto";
import { createMcpClient } from "~/server/api/routers/trustclaw/agent/mcp/mcp-client-factory";

import { getMcpServerToolsInput } from "./getMcpServerTools.schema";
import { MAX_MCP_TOOLS_PER_SERVER } from "./shared.schema";

/**
 * Live-fetches the tool catalog for one user-configured MCP server,
 * merged with the per-server allowlist to flag which are currently
 * enabled. Powers the per-server Manage Tools dialog.
 *
 * Hits the MCP server over the network on every call. The dialog only
 * opens on user intent, so this is fine — no caching needed yet.
 */
export const getMcpServerTools = protectedProcedure
  .input(getMcpServerToolsInput)
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

    const server = await db.composioClawMcpServer.findFirst({
      where: { id: input.id, instanceId: instance.id },
      select: {
        id: true,
        url: true,
        transport: true,
        authHeaderEncrypted: true,
        allowedToolNames: true,
        name: true,
      },
    });
    if (!server) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "MCP server not found",
      });
    }

    const authHeader = server.authHeaderEncrypted
      ? decryptSecret(server.authHeaderEncrypted)
      : null;

    let handle: Awaited<ReturnType<typeof createMcpClient>> | null = null;
    try {
      handle = await createMcpClient({
        url: server.url,
        transport: server.transport === "sse" ? "sse" : "http",
        authHeader,
        toolPrefix: `mcp__${server.id}__`, // not persisted; only for in-process Tool keys
        allowedToolNames: null,
        signal: AbortSignal.timeout(5000),
      });

      const allowedSet = new Set(server.allowedToolNames);
      const items = handle.toolMetadata.slice(0, MAX_MCP_TOOLS_PER_SERVER).map((t) => ({
        name: t.name,
        description: t.description ?? "",
        isEnabled: allowedSet.has(t.name),
      }));
      const truncated = handle.toolMetadata.length > MAX_MCP_TOOLS_PER_SERVER;

      return {
        items,
        truncated,
        serverName: server.name,
      };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not fetch tools from MCP server.";
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message,
      });
    } finally {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
    }
  });
