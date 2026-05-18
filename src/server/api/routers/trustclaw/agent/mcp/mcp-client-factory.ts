import { dynamicTool, jsonSchema, type Tool } from "ai";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Thin wrapper around `@modelcontextprotocol/sdk` 1.x.
 *
 * The only file in TrustClaw that imports the MCP SDK directly. If the
 * SDK shape ever changes (or we swap to `@ai-sdk/mcp` once it ships in
 * the Vercel AI SDK), this is the single point of replacement.
 *
 * Responsibilities:
 *  1. Connect to a remote MCP server via HTTP or SSE transport.
 *  2. List tools and convert them into AI-SDK-compatible `Tool`s via
 *     `dynamicTool()` (server-supplied JSON schemas, not Zod).
 *  3. Apply per-server allowlist + name prefix so MCP tools cannot
 *     collide with Composio or custom tools.
 *  4. Return a `close()` handle for cleanup.
 */

export type McpToolMeta = {
  /** Raw MCP tool name (no prefix applied). */
  name: string;
  description?: string;
  /** JSON Schema describing the tool's input. */
  inputSchema: Record<string, unknown>;
};

export type McpClientHandle = {
  /** Prefixed AI SDK tool dict, ready to merge into the agent's tool set. */
  tools: Record<string, Tool>;
  /** Raw metadata for the discovered tools — useful for UI + caching. */
  toolMetadata: McpToolMeta[];
  /** Server's reported protocol version (if any). */
  protocolVersion?: string;
  /** Closes the underlying connection. Idempotent. */
  close: () => Promise<void>;
};

export type CreateMcpClientOptions = {
  url: string;
  transport: "http" | "sse";
  /** Plaintext auth header value (e.g. "Bearer sk_..."). Null = no auth. */
  authHeader: string | null;
  /**
   * Prefix to apply to every tool name (e.g. `mcp__deepwiki_a3f2__`).
   * Required so MCP tools never collide with Composio or custom tools.
   */
  toolPrefix: string;
  /**
   * If set, only tools in this set will be exposed (case-sensitive raw names).
   * If null/undefined, every discovered tool is exposed (used by the
   * test-connection flow which inspects the full catalog).
   */
  allowedToolNames?: string[] | null;
  /** Caller-supplied abort signal for the connect + listTools roundtrip. */
  signal?: AbortSignal;
};

const CLIENT_INFO = {
  name: "trustclaw",
  version: "1.0.0",
};

export async function createMcpClient(
  opts: CreateMcpClientOptions,
): Promise<McpClientHandle> {
  const url = new URL(opts.url);
  const requestInit: RequestInit = {};
  if (opts.authHeader) {
    requestInit.headers = { Authorization: opts.authHeader };
  }

  const transport =
    opts.transport === "sse"
      ? new SSEClientTransport(url, { requestInit })
      : new StreamableHTTPClientTransport(url, { requestInit });

  const client = new Client(CLIENT_INFO);
  await client.connect(transport, { signal: opts.signal });

  const listed = await client.listTools(undefined, { signal: opts.signal });

  const allowed =
    opts.allowedToolNames === undefined || opts.allowedToolNames === null
      ? null
      : new Set(opts.allowedToolNames);

  const toolMetadata: McpToolMeta[] = [];
  const tools: Record<string, Tool> = {};

  for (const mcpTool of listed.tools) {
    if (allowed !== null && !allowed.has(mcpTool.name)) continue;

    toolMetadata.push({
      name: mcpTool.name,
      description: mcpTool.description,
      inputSchema: mcpTool.inputSchema as Record<string, unknown>,
    });

    const prefixedName = `${opts.toolPrefix}${mcpTool.name}`;
    tools[prefixedName] = dynamicTool({
      description: mcpTool.description ?? `MCP tool ${mcpTool.name}`,
      inputSchema: jsonSchema(
        mcpTool.inputSchema as Parameters<typeof jsonSchema>[0],
      ),
      execute: async (input) => {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: (input as Record<string, unknown>) ?? {},
        });
        // The MCP `CallToolResult` shape: `{ content: ContentBlock[], isError?: boolean }`.
        // Return it as-is so the agent can see content + isError; AI SDK
        // will JSON.stringify it for the assistant turn.
        return result;
      },
    });
  }

  const versionInfo = client.getServerVersion();
  const protocolVersion =
    typeof versionInfo === "object" && versionInfo !== null
      ? versionInfo.version
      : undefined;

  let closed = false;
  return {
    tools,
    toolMetadata,
    protocolVersion,
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await client.close();
      } catch {
        // Transport may already be torn down; cleanup is best-effort.
      }
    },
  };
}
