import { z } from "zod";

export const MAX_MCP_SERVERS_PER_INSTANCE = 10;
export const MAX_MCP_TOOLS_PER_SERVER = 200;
export const MAX_MCP_SERVER_NAME_LENGTH = 80;
export const MAX_MCP_TOOL_NAME_LENGTH = 128;

/**
 * Bearer / auth header values get encrypted at rest with AES-256-GCM
 * (see `src/server/lib/crypto.ts`). Cap matches a reasonable JWT bound.
 */
export const MAX_MCP_AUTH_HEADER_LENGTH = 4096;

/** MCP transport. Use HTTP unless the user has a specific reason for SSE. */
export const mcpTransport = z.enum(["http", "sse"]);
export type McpTransport = z.infer<typeof mcpTransport>;

export const mcpServerName = z
  .string()
  .min(1, "Name is required.")
  .max(MAX_MCP_SERVER_NAME_LENGTH, `Name must be ≤ ${MAX_MCP_SERVER_NAME_LENGTH} characters.`)
  .trim();

export const mcpServerUrl = z
  .string()
  .url("URL is malformed.")
  .max(2048, "URL must be ≤ 2048 characters.");

export const mcpAuthHeader = z
  .string()
  .min(1)
  .max(MAX_MCP_AUTH_HEADER_LENGTH, `Auth header must be ≤ ${MAX_MCP_AUTH_HEADER_LENGTH} characters.`);

/**
 * Raw MCP tool name (no `mcp__<slug>__` prefix). Lenient on charset
 * since MCP servers may use varied conventions, but bounded for safety.
 */
export const mcpToolName = z
  .string()
  .min(1)
  .max(MAX_MCP_TOOL_NAME_LENGTH);
