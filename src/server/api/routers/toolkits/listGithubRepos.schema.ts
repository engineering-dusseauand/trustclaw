import { z } from "zod";

/**
 * Permissive shape for a GitHub repo as returned by Composio's
 * GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER action. The
 * upstream payload mirrors GitHub's REST API and includes many more
 * fields; we only keep what the picker UI needs.
 */
export const githubRepo = z.object({
  id: z.union([z.number(), z.string()]),
  fullName: z.string(),
  description: z.string().nullable().optional(),
  private: z.boolean().optional(),
  archived: z.boolean().optional(),
  pushedAt: z.string().nullable().optional(),
});

export type GithubRepo = z.infer<typeof githubRepo>;

export const listGithubReposInput = z.object({
  page: z.number().int().min(1).max(50).optional().default(1),
  // GitHub's per_page max is 100; we keep it tighter for picker UX.
  perPage: z.number().int().min(1).max(50).optional().default(30),
});

export type ListGithubReposInput = z.infer<typeof listGithubReposInput>;
