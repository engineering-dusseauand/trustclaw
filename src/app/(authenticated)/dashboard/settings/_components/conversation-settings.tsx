"use client";

import { useState } from "react";
import { Loader2, MessageSquareDashed } from "lucide-react";
import { trpc } from "~/clients/trpc";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  showSuccessToast,
  trpcToastOnError,
} from "~/components/core/toast-notifications";

export function ConversationSettings() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const clearConversation = trpc.trustclaw.clearConversation.useMutation({
    onSuccess: ({ deletedMessageCount }) => {
      showSuccessToast(
        deletedMessageCount === 0
          ? "Conversation was already empty"
          : `Cleared ${deletedMessageCount} message${deletedMessageCount === 1 ? "" : "s"}`,
      );
      void utils.trustclaw.getHistory.invalidate();
      void utils.trustclaw.getStreamingMessage.invalidate();
      setOpen(false);
    },
    onError: trpcToastOnError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversation</CardTitle>
        <CardDescription>
          Manage the chat history the agent reads on every turn.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Clear conversation</p>
            <p className="text-muted-foreground text-sm">
              Deletes all chat messages and resets the compaction summary.
              Memories, cron jobs, pinned integrations, and settings are kept.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <Button
              variant="outline"
              onClick={() => setOpen(true)}
              disabled={clearConversation.isPending}
            >
              <MessageSquareDashed className="mr-2 h-4 w-4" />
              Clear conversation
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Clear conversation?</DialogTitle>
                <DialogDescription>
                  All chat messages will be deleted and the agent will start
                  the next reply with no prior context. Memories saved to
                  long-term storage, cron jobs, your pinned Supabase project,
                  and all other settings are preserved.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button
                    variant="ghost"
                    disabled={clearConversation.isPending}
                  >
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  onClick={() => void clearConversation.mutateAsync()}
                  disabled={clearConversation.isPending}
                >
                  {clearConversation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Clearing...
                    </>
                  ) : (
                    "Clear conversation"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
