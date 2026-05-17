import { z } from "zod";

export const getToolkitToolsInput = z.object({
  toolkit: z.string().min(1).toLowerCase(),
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
