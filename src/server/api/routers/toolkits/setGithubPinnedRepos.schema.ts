import { z } from "zod";

/**
 * owner/repo format: lowercased GitHub login + slash + lowercased repo
 * name. GitHub allows alphanumerics + `-`, `.`, `_` in both.
 */
export const ownerRepoString = z
  .string()
  .min(3)
  .max(140)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9_.-]+$/,
    "Must be lowercase owner/repo (e.g. acme/widget)",
  );

/** Hard cap from the design memo. Keeps SEARCH_ISSUES query rewrites
 * under GitHub's ~256-char query limit and bounds the picker UI. */
export const MAX_PINNED_GITHUB_REPOS = 20;

export const setGithubPinnedReposInput = z.object({
  // Replace the full pin set. Empty array clears all pins.
  pinnedRepos: z
    .array(ownerRepoString)
    .max(MAX_PINNED_GITHUB_REPOS, `At most ${MAX_PINNED_GITHUB_REPOS} repos can be pinned.`),
});

export type SetGithubPinnedReposInput = z.infer<typeof setGithubPinnedReposInput>;

export const setAllowDestructiveGithubActionsInput = z.object({
  allow: z.boolean(),
});

export type SetAllowDestructiveGithubActionsInput = z.infer<
  typeof setAllowDestructiveGithubActionsInput
>;
