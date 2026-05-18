import { z } from "zod";

import {
  MAX_MCP_TOOLS_PER_SERVER,
  mcpAuthHeader,
  mcpServerName,
  mcpServerUrl,
  mcpToolName,
  mcpTransport,
} from "./shared.schema";

export const addMcpServerInput = z.object({
  name: mcpServerName,
  url: mcpServerUrl,
  transport: mcpTransport,
  authHeader: mcpAuthHeader.nullable(),
  /**
   * Tools to enable for this server. Typically seeded from the
   * test-connection preview (all discovered tools pre-checked). Server
   * tools added later are off by default — explicit opt-in.
   */
  allowedToolNames: z
    .array(mcpToolName)
    .max(MAX_MCP_TOOLS_PER_SERVER, `At most ${MAX_MCP_TOOLS_PER_SERVER} tools per server.`),
});

export type AddMcpServerInput = z.infer<typeof addMcpServerInput>;
