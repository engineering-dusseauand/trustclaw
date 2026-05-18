import { z } from "zod";

export const getMcpServerToolsInput = z.object({
  id: z.string().cuid(),
});

export type GetMcpServerToolsInput = z.infer<typeof getMcpServerToolsInput>;
