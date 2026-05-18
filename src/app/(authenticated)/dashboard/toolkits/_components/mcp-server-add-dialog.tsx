"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Plus, Wifi } from "lucide-react";
import { trpc } from "~/clients/trpc";
import {
  showSuccessToast,
  showTrpcErrorToast,
} from "~/components/core/toast-notifications";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "~/components/ui/radio-group";

type DiscoveredTool = { name: string; description: string };
type TestResult =
  | { ok: true; tools: DiscoveredTool[]; truncated: boolean }
  | { ok: false; error: string }
  | null;

/**
 * "Add MCP server" modal. Three-step inline flow:
 *  1. Fill in name + URL + auth header (optional)
 *  2. Click "Test connection" → live probe shows the discovered tools
 *     with pre-checked checkboxes
 *  3. Click "Save" → server persisted with the currently-checked tool
 *     subset as the initial allowlist
 *
 * The test step is required before save: a server we can't connect to
 * isn't worth saving, and the discovered tool list is the seed for the
 * per-server allowedToolNames opt-in.
 */
export function McpServerAddDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"http" | "sse">("http");
  const [authHeader, setAuthHeader] = useState("");
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [enabledNames, setEnabledNames] = useState<Set<string>>(new Set());

  const utils = trpc.useUtils();

  const testMutation = trpc.mcp.testMcpConnection.useMutation({
    onError: showTrpcErrorToast,
  });

  const addMutation = trpc.mcp.addMcpServer.useMutation({
    onSuccess: () => {
      void utils.mcp.listMcpServers.invalidate();
      showSuccessToast(`Added "${name}"`);
      resetAndClose();
    },
    onError: showTrpcErrorToast,
  });

  const resetAndClose = () => {
    setOpen(false);
    setName("");
    setUrl("");
    setTransport("http");
    setAuthHeader("");
    setTestResult(null);
    setEnabledNames(new Set());
  };

  const handleTest = async () => {
    setTestResult(null);
    try {
      const result = await testMutation.mutateAsync({
        url,
        transport,
        authHeader: authHeader.trim() === "" ? null : authHeader,
      });
      setTestResult(result);
      if (result.ok) {
        // Pre-check every discovered tool. User can uncheck before save.
        setEnabledNames(new Set(result.tools.map((t) => t.name)));
      }
    } catch {
      // toast handled by onError; ensure UI doesn't show a stale "ok"
      setTestResult({ ok: false, error: "Network error testing connection." });
    }
  };

  const handleSave = async () => {
    if (!testResult?.ok) return;
    try {
      await addMutation.mutateAsync({
        name: name.trim(),
        url,
        transport,
        authHeader: authHeader.trim() === "" ? null : authHeader,
        allowedToolNames: Array.from(enabledNames),
      });
    } catch {
      // toast handled by onError
    }
  };

  const toggle = (toolName: string) => {
    setEnabledNames((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) next.delete(toolName);
      else next.add(toolName);
      return next;
    });
  };

  const canTest = name.trim() !== "" && url.trim() !== "" && !testMutation.isPending;
  const canSave = testResult?.ok === true && !addMutation.isPending;
  const isPending = testMutation.isPending || addMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetAndClose();
        else setOpen(true);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Add MCP server
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[600px]">
        <DialogHeader className="space-y-1 border-b px-6 py-4 text-left">
          <DialogTitle className="text-base">Add MCP server</DialogTitle>
          <DialogDescription className="text-sm">
            Connect a remote MCP server (DeepWiki, Nia, Devin, or your own).
            Tools from this server will be available to the agent on the next
            chat turn.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              placeholder="DeepWiki"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setTestResult(null);
              }}
              disabled={isPending}
              maxLength={80}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              placeholder="https://mcp.deepwiki.com/mcp"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setTestResult(null);
              }}
              disabled={isPending}
              type="url"
            />
            <p className="text-xs text-muted-foreground">
              HTTPS required. Private/loopback addresses are blocked.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Transport</Label>
            <RadioGroup
              value={transport}
              onValueChange={(v) => {
                setTransport(v as "http" | "sse");
                setTestResult(null);
              }}
              disabled={isPending}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id="t-http" value="http" />
                <Label htmlFor="t-http" className="cursor-pointer text-sm">
                  HTTP (recommended)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="t-sse" value="sse" />
                <Label htmlFor="t-sse" className="cursor-pointer text-sm">
                  SSE
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mcp-auth">Auth header (optional)</Label>
            <Input
              id="mcp-auth"
              placeholder="Bearer sk_..."
              value={authHeader}
              onChange={(e) => {
                setAuthHeader(e.target.value);
                setTestResult(null);
              }}
              disabled={isPending}
              type="password"
              autoComplete="off"
              maxLength={4096}
            />
            <p className="text-xs text-muted-foreground">
              Sent as the Authorization header. Encrypted at rest.
            </p>
          </div>

          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleTest()}
              disabled={!canTest}
            >
              {testMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Testing
                </>
              ) : (
                <>
                  <Wifi className="mr-1.5 h-4 w-4" />
                  Test connection
                </>
              )}
            </Button>
          </div>

          {testResult ? (
            testResult.ok ? (
              <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Found {testResult.tools.length} tool
                  {testResult.tools.length === 1 ? "" : "s"}
                  {testResult.truncated ? " (truncated to 200)" : ""}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Uncheck any tools you don't want the agent to call.
                </p>
                <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                  {testResult.tools.map((tool) => (
                    <label
                      key={tool.name}
                      className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        checked={enabledNames.has(tool.name)}
                        onChange={() => toggle(tool.name)}
                        className="mt-1 h-4 w-4 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{tool.name}</div>
                        {tool.description ? (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {tool.description}
                          </p>
                        ) : null}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Connection failed
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {testResult.error}
                </p>
              </div>
            )
          ) : null}
        </div>

        <DialogFooter className="flex-col gap-2 border-t px-6 py-3 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="ghost" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={() => void handleSave()}
            disabled={!canSave}
          >
            {addMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving
              </>
            ) : (
              "Add server"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
