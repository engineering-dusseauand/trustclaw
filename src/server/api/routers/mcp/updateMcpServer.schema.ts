import { z } from "zod";

import {
  mcpAuthHeader,
  mcpServerName,
  mcpTransport,
} from "./shared.schema";

/**
 * Auth header semantics:
 *  - `"preserve"`: do not touch the existing ciphertext.
 *  - `null`: clear it.
 *  - string: re-encrypt with this new value.
 */
export const updateMcpServerInput = z.object({
  id: z.string().cuid(),
  name: mcpServerName.optional(),
  transport: mcpTransport.optional(),
  authHeader: z.union([mcpAuthHeader, z.null(), z.literal("preserve")]).optional(),
  enabled: z.boolean().optional(),
});

export type UpdateMcpServerInput = z.infer<typeof updateMcpServerInput>;
