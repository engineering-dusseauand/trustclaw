import { z } from "zod";
import { ALLOWED_ANTHROPIC_MODELS } from "./createInstance.schema";

const ianaTimezone = z
  .string()
  .refine(
    (tz) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid IANA timezone" },
  );

/**
 * Per-prompt limits — chars, not tokens. Picked to fit ~3 prompts inside
 * a small fraction of the model's context window while leaving room for
 * conversation history. The agent's system prompt assembles these +
 * memories + recent messages, so blowing the cap here cascades into
 * compaction pressure on every turn.
 */
const PROMPT_MAX_LENGTH = 8000;

const promptField = z
  .string()
  .max(PROMPT_MAX_LENGTH, `Prompt must be ${PROMPT_MAX_LENGTH} characters or less`)
  .nullable()
  .optional();

export const updateSettingsInput = z.object({
  anthropicModel: z.enum(ALLOWED_ANTHROPIC_MODELS).optional(),
  timezone: ianaTimezone.optional(),
  /** Personality / values. Drives tone, posture, behaviour. Null = use default. */
  soulPrompt: promptField,
  /** Who the agent is, name, backstory, persona detail. Null = use default. */
  identityPrompt: promptField,
  /** User-supplied instructions ("you are managing my Reliance projects..."). Null = none. */
  userPrompt: promptField,
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;
