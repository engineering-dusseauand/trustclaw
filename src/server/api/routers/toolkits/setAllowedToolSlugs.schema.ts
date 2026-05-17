import { z } from "zod";

/**
 * Hard cap matches the design memo's reviewable-list principle.
 * 500 slugs per toolkit is more than any real curated set; mostly
 * a defense against accidental "select-all in Composio's catalog" UX
 * blowing up the DB row.
 */
const MAX_SLUGS_PER_TOOLKIT = 500;

export const setAllowedToolSlugsInput = z.object({
  toolkit: z.string().min(1).toLowerCase(),
  enabled: z
    .array(z.string().min(1))
    .max(MAX_SLUGS_PER_TOOLKIT, `At most ${MAX_SLUGS_PER_TOOLKIT} slugs per toolkit.`),
});

export type SetAllowedToolSlugsInput = z.infer<typeof setAllowedToolSlugsInput>;
