import { protectedProcedure } from "~/server/api/trpc";
import { validateMcpUrl } from "~/server/lib/url-safety";
import { createMcpClient } from "~/server/api/routers/trustclaw/agent/mcp/mcp-client-factory";

import {
  MAX_MCP_TOOLS_PER_SERVER,
} from "./shared.schema";
import { testMcpConnectionInput } from "./testMcpConnection.schema";

/**
 * Tests an MCP server URL + auth header without persisting anything.
 *
 * Used by:
 *  - The Add Server dialog before save (shows the discovered tool list
 *    so the user can decide what to allow before committing).
 *  - The per-card Test button to refresh the cached tool catalog.
 *
 * The 5-second AbortSignal.timeout enforces a hard upper bound so a
 * dead server can't hang the dialog.
 */
export const testMcpConnection = protectedProcedure
  .input(testMcpConnectionInput)
  .mutation(async ({ input }) => {
    const urlCheck = await validateMcpUrl(input.url);
    if (!urlCheck.ok) {
      return { ok: false as const, error: urlCheck.reason };
    }

    let handle: Awaited<ReturnType<typeof createMcpClient>> | null = null;
    try {
      handle = await createMcpClient({
        url: input.url,
        transport: input.transport,
        authHeader: input.authHeader,
        toolPrefix: "mcp__probe__", // never persisted; only used during this call
        allowedToolNames: null, // discovery: surface every tool
        signal: AbortSignal.timeout(5000),
      });

      const tools = handle.toolMetadata.slice(0, MAX_MCP_TOOLS_PER_SERVER).map((t) => ({
        name: t.name,
        description: t.description ?? "",
      }));
      const truncated = handle.toolMetadata.length > MAX_MCP_TOOLS_PER_SERVER;

      return {
        ok: true as const,
        tools,
        truncated,
        protocolVersion: handle.protocolVersion,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error connecting to MCP server.";
      return { ok: false as const, error: message };
    } finally {
      if (handle) {
        await handle.close().catch(() => {
          // Best-effort cleanup; transport may already be torn down.
        });
      }
    }
  });
