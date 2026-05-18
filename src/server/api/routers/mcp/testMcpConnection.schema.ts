import { z } from "zod";

import {
  mcpAuthHeader,
  mcpServerUrl,
  mcpTransport,
} from "./shared.schema";

export const testMcpConnectionInput = z.object({
  url: mcpServerUrl,
  transport: mcpTransport,
  authHeader: mcpAuthHeader.nullable(),
});

export type TestMcpConnectionInput = z.infer<typeof testMcpConnectionInput>;
