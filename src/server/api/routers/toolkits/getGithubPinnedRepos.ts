import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";

export const getGithubPinnedRepos = protectedProcedure.query(async ({ ctx }) => {
  const userId = ctx.user.id;
  const instance = await db.composioClawInstance.findUnique({
    where: { userId },
    select: {
      pinnedGithubRepos: true,
      allowDestructiveGithubActions: true,
    },
  });

  return {
    pinnedRepos: instance?.pinnedGithubRepos ?? [],
    allowDestructive: instance?.allowDestructiveGithubActions ?? false,
  };
});
