import { z } from "zod";

// Composio's toolkit slugs are lowercase alphanumeric (verified against the
// live catalog at backend.composio.dev/api/v3/tools). The regex prevents
// arbitrary strings from being used as Map keys or URL params downstream.
const composioToolkitSlug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+$/i, "toolkit must be lowercase alphanumeric")
  .toLowerCase();

export const getToolkitToolsInput = z.object({
  toolkit: composioToolkitSlug,
});

export const toolkitToolItem = z.object({
  slug: z.string(),
  label: z.string(),
  description: z.string().optional(),
  /** "Advanced" if the slug is not in the curated default for this toolkit. */
  category: z.string(),
  isDestructive: z.boolean(),
  /** True if this slug ships in the curated default for the toolkit. */
  isInDefault: z.boolean(),
  /** True if the user has enabled this slug in `allowedToolSlugs`. */
  isEnabled: z.boolean(),
});

export const getToolkitToolsOutput = z.object({
  items: z.array(toolkitToolItem),
});

export type ToolkitToolItem = z.infer<typeof toolkitToolItem>;
