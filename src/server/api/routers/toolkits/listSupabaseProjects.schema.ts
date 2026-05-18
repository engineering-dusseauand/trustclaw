import { z } from "zod";

/**
 * Schema for a single Supabase project returned by Composio's
 * SUPABASE_LIST_ALL_PROJECTS tool. We extract only the fields we need;
 * the upstream payload includes more.
 *
 * Supabase's Management API returns both `id` (UUID) and `ref` (the
 * short string shown in dashboard URLs). `ref` is the value the rest
 * of Supabase's API uses as `{project_ref}`, so that's what we pin.
 */
export const supabaseProject = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string().optional(),
  status: z.string().optional(),
});

export type SupabaseProject = z.infer<typeof supabaseProject>;

export const listSupabaseProjectsOutput = z.object({
  items: z.array(supabaseProject),
});

export type ListSupabaseProjectsOutput = z.infer<typeof listSupabaseProjectsOutput>;
