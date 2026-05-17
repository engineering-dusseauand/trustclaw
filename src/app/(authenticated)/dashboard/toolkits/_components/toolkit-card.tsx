"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { trpc } from "~/clients/trpc";
import {
  trpcToastOnError,
} from "~/components/core/toast-notifications";
import type { RouterOutputs } from "~/clients/trpc";
import { SupabaseProjectPicker } from "./supabase-project-picker";
import { GithubRepoPicker } from "./github-repo-picker";
import { ToolsAllowlistDialog } from "./tools-allowlist-dialog";

/**
 * Bottom-of-card affordance to open the tools allowlist dialog. Shown
 * for any connected toolkit — Supabase/GitHub already have a pin badge
 * in the top-right corner for *resource* pinning; this is the parallel
 * surface for *tool-slug* pinning.
 */
function ManageToolsButton({
  toolkit,
  toolkitName,
}: {
  toolkit: string;
  toolkitName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Manage which tools the agent can use"
      >
        <Settings2 className="h-3 w-3" />
        Manage tools
      </button>
      <ToolsAllowlistDialog
        open={open}
        onOpenChange={setOpen}
        toolkit={toolkit}
        toolkitName={toolkitName}
      />
    </>
  );
}

type ToolkitItem = RouterOutputs["toolkits"]["getToolkits"]["items"][number];

interface ToolkitCardProps {
  toolkit: ToolkitItem;
}

/**
 * When the SUPABASE toolkit is connected, the "Connected" badge becomes a
 * button that opens the project picker. The badge changes color based on
 * whether a project is pinned — unpinned is amber (the agent will refuse
 * Supabase tool calls until configured).
 */
/**
 * When the GITHUB toolkit is connected, the "Connected" badge becomes a
 * button that opens the repo picker. Amber when no repos are pinned
 * (agent refuses Github tools); green with a count once pinned.
 */
function GithubPinBadge() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = trpc.toolkits.getGithubPinnedRepos.useQuery();
  const pinned = data?.pinnedRepos ?? [];

  if (isLoading) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Connected
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          pinned.length > 0
            ? "rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 transition-colors hover:bg-green-500/25 dark:text-green-400"
            : "rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/25 dark:text-amber-400"
        }
        title={
          pinned.length > 0
            ? `Agent restricted to ${pinned.length} repo${pinned.length === 1 ? "" : "s"}. Click to change.`
            : "Pick repos to allow the agent to use GitHub tools."
        }
      >
        {pinned.length > 0 ? `${pinned.length} repo${pinned.length === 1 ? "" : "s"}` : "Pick repos"}
      </button>
      <GithubRepoPicker open={open} onOpenChange={setOpen} />
    </>
  );
}

function SupabasePinBadge() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = trpc.toolkits.getSupabaseProjectRef.useQuery();
  const projectRef = data?.projectRef ?? null;

  if (isLoading) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Connected
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          projectRef
            ? "max-w-[160px] truncate rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 transition-colors hover:bg-green-500/25 dark:text-green-400"
            : "rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/25 dark:text-amber-400"
        }
        title={
          projectRef
            ? `Pinned project: ${projectRef}. Click to change.`
            : "Pick a Supabase project to allow the agent to use Supabase tools."
        }
      >
        {projectRef ? `Project: ${projectRef}` : "Pick project"}
      </button>
      <SupabaseProjectPicker open={open} onOpenChange={setOpen} />
    </>
  );
}

export function ToolkitCard({ toolkit }: ToolkitCardProps) {
  const [logoLoaded, setLogoLoaded] = useState(false);
  const router = useRouter();

  const utils = trpc.useUtils();
  const getAuthLink = trpc.toolkits.getAuthLink.useMutation({
    onError: trpcToastOnError,
    onSuccess: () => void utils.toolkits.getToolkits.invalidate(),
  });

  const isConnected = toolkit.connected || toolkit.noAuth;
  // Composio toolkit slugs are lowercase (e.g. "gmail", "slack", "supabase").
  // Tool *names* (e.g. SUPABASE_LIST_PROJECTS) are uppercase — different
  // namespace, don't conflate.
  const slugLower = toolkit.slug.toLowerCase();
  const isSupabase = slugLower === "supabase";
  const isGithub = slugLower === "github";
  const statusLabel = toolkit.connected
    ? "Connected"
    : toolkit.noAuth
      ? "Active"
      : null;

  const handleConnect = async (e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      const { redirectUrl } = await getAuthLink.mutateAsync({
        toolkit: toolkit.slug,
      });
      router.push(redirectUrl);
    } catch {
      // trpcToastOnError already handles the toast
    }
  };

  return (
    <article
      className="toolkit-card group relative cursor-pointer rounded-xl border-[2px] border-transparent outline outline-1 outline-border bg-card transition-[translate,scale] duration-100 ease-[cubic-bezier(.645,.045,.355,1)] active:translate-y-px active:scale-[0.99]"
      style={{ containerType: "size", aspectRatio: "1" }}
    >
      {/* Inner container with clip for glow containment */}
      <div className="absolute inset-0 overflow-hidden rounded-xl [clip-path:inset(0_round_12px)]">
        {/* Blurred glow copy of logo */}
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center will-change-transform"
          style={{
            filter: "url(#toolkit-blur) saturate(5) brightness(1.3)",
            translate:
              "calc(var(--pointer-x, -10) * 50cqi) calc(var(--pointer-y, -10) * 50cqh)",
            scale: "3.4",
            opacity: 0.25,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- external SVG from logos.composio.dev */}
          <img
            src={toolkit.logo}
            alt=""
            className="h-16 w-16"
            draggable={false}
          />
        </div>

        {/* Card content */}
        <div className="relative z-[2] flex h-full flex-col items-center justify-center gap-1.5 p-4 pt-10">
          {/* Top-right: status badge or connect button */}
          <div className="absolute right-3 top-3 z-[1]">
            {isConnected ? (
              isSupabase && toolkit.connected ? (
                <SupabasePinBadge />
              ) : isGithub && toolkit.connected ? (
                <GithubPinBadge />
              ) : (
                <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                  {statusLabel}
                </span>
              )
            ) : (
              <Button
                size="sm"
                className="h-7 px-2.5 text-xs transition-all duration-200 group-hover:scale-105 group-hover:shadow-md"
                onClick={handleConnect}
                disabled={getAuthLink.isPending}
              >
                {getAuthLink.isPending ? "Connecting..." : "Connect"}
              </Button>
            )}
          </div>

          {/* Sharp logo */}
          {/* eslint-disable-next-line @next/next/no-img-element -- external SVG from logos.composio.dev */}
          <img
            src={toolkit.logo}
            alt={`${toolkit.name} logo`}
            className="h-12 w-12 select-none transition-opacity duration-300 ease-in"
            style={{ opacity: logoLoaded ? 1 : 0 }}
            onLoad={() => setLogoLoaded(true)}
            draggable={false}
          />

          {/* Name */}
          <h3 className="select-none text-sm font-semibold text-foreground">
            {toolkit.name}
          </h3>

          {/* Tool-slug allowlist affordance — only meaningful when usable */}
          {isConnected ? (
            <ManageToolsButton
              toolkit={slugLower}
              toolkitName={toolkit.name}
            />
          ) : null}
        </div>
      </div>

      {/* Frosted glass border effect - uses longhands to prevent mask shorthand from resetting maskComposite */}
      <div
        className="pointer-events-none absolute inset-0 z-[3] rounded-xl [clip-path:inset(0_round_12px)]"
        style={{
          border: "2px solid transparent",
          backdropFilter: "saturate(4.2) brightness(2.5) contrast(2.5)",
          maskImage:
            "linear-gradient(#fff 0 100%), linear-gradient(#fff 0 100%)",
          maskOrigin: "border-box, padding-box",
          maskClip: "border-box, padding-box",
          maskComposite: "exclude",
          WebkitMaskImage:
            "linear-gradient(#fff 0 100%), linear-gradient(#fff 0 100%)",
          WebkitMaskOrigin: "border-box, padding-box",
          WebkitMaskClip: "border-box, padding-box",
          WebkitMaskComposite: "xor",
        }}
      />
    </article>
  );
}
