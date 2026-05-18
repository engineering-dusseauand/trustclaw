import { z } from "zod";

import {
  MAX_MCP_TOOLS_PER_SERVER,
  mcpToolName,
} from "./shared.schema";

export const setMcpServerAllowedToolsInput = z.object({
  id: z.string().cuid(),
  allowedToolNames: z
    .array(mcpToolName)
    .max(MAX_MCP_TOOLS_PER_SERVER, `At most ${MAX_MCP_TOOLS_PER_SERVER} tools per server.`),
});

export type SetMcpServerAllowedToolsInput = z.infer<typeof setMcpServerAllowedToolsInput>;
