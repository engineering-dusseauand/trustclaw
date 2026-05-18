import { z } from "zod";

export const deleteMcpServerInput = z.object({
  id: z.string().cuid(),
});

export type DeleteMcpServerInput = z.infer<typeof deleteMcpServerInput>;
