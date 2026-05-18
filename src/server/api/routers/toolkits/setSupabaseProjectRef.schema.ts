import { z } from "zod";

export const setSupabaseProjectRefInput = z.object({
  // Pass `null` to unpin and re-allow all projects (not recommended).
  // Otherwise the project ref shown in Supabase dashboard URLs, e.g.
  // "ylgtqgrajhyhjgydvyfb".
  projectRef: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+$/, "Project ref must be lowercase alphanumeric")
    .nullable(),
});

export type SetSupabaseProjectRefInput = z.infer<typeof setSupabaseProjectRefInput>;
