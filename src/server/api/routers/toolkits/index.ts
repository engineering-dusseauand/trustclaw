import { router } from "~/server/api/trpc";
import { getToolkits } from "./getToolkits";
import { getAuthLink } from "./getAuthLink";
import { listSupabaseProjects } from "./listSupabaseProjects";
import { getSupabaseProjectRef } from "./getSupabaseProjectRef";
import { setSupabaseProjectRef } from "./setSupabaseProjectRef";
import { listGithubRepos } from "./listGithubRepos";
import { getGithubPinnedRepos } from "./getGithubPinnedRepos";
import { setGithubPinnedRepos } from "./setGithubPinnedRepos";
import { getRecentGithubBlocks } from "./getRecentGithubBlocks";
import { getToolkitTools } from "./getToolkitTools";

export const toolkitsRouter = router({
  getToolkits,
  getAuthLink,
  listSupabaseProjects,
  getSupabaseProjectRef,
  setSupabaseProjectRef,
  listGithubRepos,
  getGithubPinnedRepos,
  setGithubPinnedRepos,
  getRecentGithubBlocks,
  getToolkitTools,
});
