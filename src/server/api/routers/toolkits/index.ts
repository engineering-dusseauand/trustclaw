import { router } from "~/server/api/trpc";
import { getToolkits } from "./getToolkits";
import { getAuthLink } from "./getAuthLink";
import { listSupabaseProjects } from "./listSupabaseProjects";
import { getSupabaseProjectRef } from "./getSupabaseProjectRef";
import { setSupabaseProjectRef } from "./setSupabaseProjectRef";

export const toolkitsRouter = router({
  getToolkits,
  getAuthLink,
  listSupabaseProjects,
  getSupabaseProjectRef,
  setSupabaseProjectRef,
});
