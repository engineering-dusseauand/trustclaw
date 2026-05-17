/**
 * GitHub default allowlist — project-manager preset.
 *
 * Scope: read repo info, manage issues / PRs / releases / CI status
 * for pinned repositories. Excluded from defaults (user opts in via
 * the admin UI): merges, deletions, forks, repo creation, cross-user
 * or org-wide enumeration, authenticated-user identity probes.
 *
 * Slug names verified against Composio's live catalog
 * (https://backend.composio.dev/api/v3/tools?toolkit_slug=github) on
 * 2026-05-17. The catalog has 823 total github slugs; this curates 31.
 *
 * Resource scoping (owner/repo enforcement against `pinnedGithubRepos`)
 * is handled separately by the arg-validation wrapper in
 * `pin-github-repos.ts`. This list controls the slug surface; that
 * wrapper controls which repos a slug can operate on.
 */

const REPO_INFO = [
  "GITHUB_GET_A_REPOSITORY",
  "GITHUB_LIST_BRANCHES",
  "GITHUB_GET_A_BRANCH",
  "GITHUB_LIST_REPOSITORY_TAGS",
  "GITHUB_LIST_COMMITS",
  "GITHUB_GET_A_COMMIT",
  "GITHUB_GET_REPOSITORY_CONTENT",
] as const;

const ISSUES = [
  "GITHUB_LIST_REPOSITORY_ISSUES",
  "GITHUB_GET_AN_ISSUE",
  "GITHUB_CREATE_AN_ISSUE",
  "GITHUB_UPDATE_AN_ISSUE",
  "GITHUB_LIST_ISSUE_COMMENTS",
  "GITHUB_CREATE_AN_ISSUE_COMMENT",
  "GITHUB_LIST_LABELS_FOR_A_REPOSITORY",
  "GITHUB_ADD_LABELS_TO_AN_ISSUE",
  "GITHUB_REMOVE_A_LABEL_FROM_AN_ISSUE",
] as const;

const MILESTONES = [
  "GITHUB_LIST_MILESTONES",
  "GITHUB_GET_A_MILESTONE",
  "GITHUB_CREATE_A_MILESTONE",
  "GITHUB_UPDATE_A_MILESTONE",
] as const;

const PULL_REQUESTS = [
  // Read-only PR access. MERGE_A_PULL_REQUEST is intentionally excluded
  // from defaults — opt-in via admin UI (see spec Open Question #2).
  "GITHUB_LIST_PULL_REQUESTS",
  "GITHUB_GET_A_PULL_REQUEST",
  "GITHUB_LIST_PULL_REQUESTS_FILES",
  "GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST",
  "GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST",
] as const;

const RELEASES = [
  // Create/update yes. Delete is destructive and excluded.
  "GITHUB_LIST_RELEASES",
  "GITHUB_GET_A_RELEASE",
  "GITHUB_GET_THE_LATEST_RELEASE",
  "GITHUB_CREATE_A_RELEASE",
  "GITHUB_UPDATE_A_RELEASE",
] as const;

const WORKFLOWS = [
  // Read-only CI status. Triggering runs and modifying workflows is
  // out of scope for the PM preset.
  "GITHUB_LIST_REPOSITORY_WORKFLOWS",
  "GITHUB_GET_A_WORKFLOW",
  "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
  "GITHUB_GET_A_WORKFLOW_RUN",
] as const;

export const DEFAULT_SLUGS: readonly string[] = [
  ...REPO_INFO,
  ...ISSUES,
  ...MILESTONES,
  ...PULL_REQUESTS,
  ...RELEASES,
  ...WORKFLOWS,
];

export const CATEGORIES: readonly {
  label: string;
  slugs: readonly string[];
}[] = [
  { label: "Repo info", slugs: REPO_INFO },
  { label: "Issues", slugs: ISSUES },
  { label: "Milestones", slugs: MILESTONES },
  { label: "Pull requests", slugs: PULL_REQUESTS },
  { label: "Releases", slugs: RELEASES },
  { label: "Workflows / CI", slugs: WORKFLOWS },
];
