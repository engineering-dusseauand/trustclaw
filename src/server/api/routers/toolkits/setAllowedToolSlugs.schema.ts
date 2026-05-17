import { z } from "zod";

/**
 * Hard cap matches the design memo's reviewable-list principle.
 * 500 slugs per toolkit is more than any real curated set; mostly
 * a defense against accidental "select-all in Composio's catalog" UX
 * blowing up the DB row.
 */
const MAX_SLUGS_PER_TOOLKIT = 500;

// Lowercase alphanumeric — matches Composio's actual toolkit slug shape.
const composioToolkitSlug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+$/i, "toolkit must be lowercase alphanumeric")
  .toLowerCase();

// Composio action slugs are `TOOLKIT_VERB_OBJECT` (uppercase, underscore-
// separated, at least one underscore). The shape check stops bare-word
// strings from being stored in `allowedToolSlugs` and confusing the
// `split("_")[0]` toolkit-prefix logic in `buildAllowlistConfig`.
const composioActionSlug = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9]*_[A-Z][A-Z0-9_]*$/i, "slug must be UPPER_SNAKE_CASE with at least one underscore");

export const setAllowedToolSlugsInput = z.object({
  toolkit: composioToolkitSlug,
  enabled: z
    .array(composioActionSlug)
    .max(MAX_SLUGS_PER_TOOLKIT, `At most ${MAX_SLUGS_PER_TOOLKIT} slugs per toolkit.`),
});

export type SetAllowedToolSlugsInput = z.infer<typeof setAllowedToolSlugsInput>;
