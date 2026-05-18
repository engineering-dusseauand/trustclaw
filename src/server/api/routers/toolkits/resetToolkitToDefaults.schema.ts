import { z } from "zod";

// Same shape constraint as `getToolkitTools.schema.ts` — Composio toolkit
// slugs are lowercase alphanumeric (verified against the live catalog).
const composioToolkitSlug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+$/i, "toolkit must be lowercase alphanumeric")
  .toLowerCase();

export const resetToolkitToDefaultsInput = z.object({
  toolkit: composioToolkitSlug,
});

export type ResetToolkitToDefaultsInput = z.infer<typeof resetToolkitToDefaultsInput>;
