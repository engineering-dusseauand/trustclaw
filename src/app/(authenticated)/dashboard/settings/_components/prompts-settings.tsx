"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { trpc } from "~/clients/trpc";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  showSuccessToast,
  trpcToastOnError,
} from "~/components/core/toast-notifications";

interface PromptsSettingsProps {
  currentSoulPrompt: string | null;
  currentIdentityPrompt: string | null;
  currentUserPrompt: string | null;
}

/**
 * One row per prompt — keeps state local so unsaved edits don't conflict
 * with each other, and the user can revert individual rows without
 * touching the others. The agent reads all three from the instance row
 * every turn (see prepareAgentRun → buildSystemPrompt), so saves take
 * effect on the next chat message — no restart required.
 */
const PROMPTS: ReadonlyArray<{
  field: "soulPrompt" | "identityPrompt" | "userPrompt";
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    field: "soulPrompt",
    label: "Soul prompt",
    hint: "Personality, values, communication style. Sets the agent's voice and posture. Leave blank to use the default soul.",
    placeholder: "## Who You Are\n\nYou are <name>...",
  },
  {
    field: "identityPrompt",
    label: "Identity prompt",
    hint: "Who the agent is in concrete terms — name, role, backstory, persona detail. Leave blank to use whatever onboarding generated.",
    placeholder: "## Identity\n\n**Name:** ...",
  },
  {
    field: "userPrompt",
    label: "User prompt",
    hint: "Your standing instructions to the agent — context about you, projects, workflows, rules to follow on every turn.",
    placeholder: "You are a project manager for my Reliance projects...",
  },
];

const PROMPT_MAX_LENGTH = 8000;

export function PromptsSettings({
  currentSoulPrompt,
  currentIdentityPrompt,
  currentUserPrompt,
}: PromptsSettingsProps) {
  const utils = trpc.useUtils();

  // Local edit state per row. `null` from the server is rendered as the
  // empty string; saves convert back to null when the textarea is empty
  // so the agent falls back to defaults.
  const [soulDraft, setSoulDraft] = useState(currentSoulPrompt ?? "");
  const [identityDraft, setIdentityDraft] = useState(currentIdentityPrompt ?? "");
  const [userDraft, setUserDraft] = useState(currentUserPrompt ?? "");

  const drafts = {
    soulPrompt: soulDraft,
    identityPrompt: identityDraft,
    userPrompt: userDraft,
  };
  const setters = {
    soulPrompt: setSoulDraft,
    identityPrompt: setIdentityDraft,
    userPrompt: setUserDraft,
  };
  const currents = {
    soulPrompt: currentSoulPrompt ?? "",
    identityPrompt: currentIdentityPrompt ?? "",
    userPrompt: currentUserPrompt ?? "",
  };

  const update = trpc.trustclaw.updateSettings.useMutation({
    onSuccess: () => {
      showSuccessToast("Prompts saved");
      void utils.trustclaw.getInstance.invalidate();
    },
    onError: trpcToastOnError,
  });

  const dirtyFields = PROMPTS.filter(
    (p) => drafts[p.field] !== currents[p.field],
  );
  const hasChanges = dirtyFields.length > 0;

  const tooLong = PROMPTS.some(
    (p) => drafts[p.field].length > PROMPT_MAX_LENGTH,
  );

  const handleSave = async () => {
    const payload: Record<string, string | null> = {};
    for (const p of dirtyFields) {
      const next = drafts[p.field];
      // Empty string → null so the agent falls back to defaults rather
      // than treating an empty prompt as "no system context."
      payload[p.field] = next.length === 0 ? null : next;
    }
    try {
      await update.mutateAsync(payload);
    } catch {
      // toast handled by onError
    }
  };

  const handleRevert = (field: "soulPrompt" | "identityPrompt" | "userPrompt") => {
    setters[field](currents[field]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompts</CardTitle>
        <CardDescription>
          Edit the system prompts the agent reads on every turn. Changes take
          effect on the next chat message — no restart needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {PROMPTS.map((p) => {
          const value = drafts[p.field];
          const isDirty = value !== currents[p.field];
          const overLimit = value.length > PROMPT_MAX_LENGTH;
          return (
            <div key={p.field} className="space-y-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <Label htmlFor={p.field} className="text-sm font-medium">
                  {p.label}
                </Label>
                <div className="flex items-center gap-3">
                  <span
                    className={
                      "text-xs " +
                      (overLimit
                        ? "text-destructive"
                        : "text-muted-foreground")
                    }
                  >
                    {value.length.toLocaleString()} / {PROMPT_MAX_LENGTH.toLocaleString()}
                  </span>
                  {isDirty && (
                    <button
                      type="button"
                      onClick={() => handleRevert(p.field)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Revert
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{p.hint}</p>
              <Textarea
                id={p.field}
                value={value}
                onChange={(e) => setters[p.field](e.target.value)}
                placeholder={p.placeholder}
                rows={p.field === "userPrompt" ? 10 : 8}
                className="font-mono text-xs"
                aria-invalid={overLimit}
              />
            </div>
          );
        })}

        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || tooLong || update.isPending}
          >
            {update.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              `Save${hasChanges ? ` ${dirtyFields.length} change${dirtyFields.length === 1 ? "" : "s"}` : ""}`
            )}
          </Button>
          {tooLong && (
            <span className="text-xs text-destructive">
              One or more prompts exceed the {PROMPT_MAX_LENGTH.toLocaleString()} character limit.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
