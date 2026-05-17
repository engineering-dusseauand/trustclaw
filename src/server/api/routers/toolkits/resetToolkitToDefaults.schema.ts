import { z } from "zod";

export const resetToolkitToDefaultsInput = z.object({
  toolkit: z.string().min(1).toLowerCase(),
});

export type ResetToolkitToDefaultsInput = z.infer<typeof resetToolkitToDefaultsInput>;
