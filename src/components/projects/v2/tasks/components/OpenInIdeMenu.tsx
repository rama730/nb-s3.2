"use client";

/**
 * Row-action dropdown for task-file rows. Surfaces four ways to open a file:
 *
 *   • Open in Cursor          — launches `cursor://file/<local-path>`
 *   • Open in VS Code         — launches `vscode://file/<local-path>`
 *   • Open in Workspace       — navigates to the internal Monaco editor
 *                               (clearly labelled "basic editing")
 *   • Download                — plain signed-URL `<a download>`
 *
 * For the two protocol-handler options we:
 *   1. Mint a signed URL via `getProjectFileSignedUrl`.
 *   2. Stream the bytes, compute a SHA-256 (see `lib/files/content-hash`).
 *   3. Trigger a browser download to the user's Downloads folder, tagged
 *      with a `NB-Workspace` prefix so the file is discoverable even when
 *      the protocol handler silently fails.
 *   4. Record an IDB "open session" keyed by `(nodeId, filename)` — so that
 *      when the user drops the edited file back onto the Files tab, we can
 *      recognise it via filename + hash.
 *   5. Launch the IDE URL via the iframe trick in `ide-launcher.ts`.
 *
 * Username / OS are only used to compose the expected absolute path for the
 * protocol URL. If we don't know either (unknown OS, or user hasn't set a
 * username yet), we prompt once and cache in `localStorage` under
 * `NB_IDE_USERNAME`. The download itself always succeeds regardless.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ChevronDown,
  Download,
  ExternalLink,
  FileCode2,
  Loader2,
  MoreHorizontal,
  SquareTerminal,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui-custom/Toast";
import { getProjectFileSignedUrl } from "@/app/actions/files/content";
import {
  buildIdeUrl,
  buildLocalPath,
  detectPlatform,
  launchIdeChain,
  type IdeKind,
  type Platform,
} from "@/lib/files/ide-launcher";
import { computeContentHash } from "@/lib/files/content-hash";
import {
  pruneStaleSessions,
  recordOpenSession,
} from "@/lib/files/open-file-sessions";
import type { ProjectNode } from "@/lib/db/schema";

const USERNAME_CACHE_KEY = "NB_IDE_USERNAME";
const SAFE_USERNAME_FALLBACK = "user";

function readCachedUsername(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(USERNAME_CACHE_KEY) || null;
  } catch {
    return null;
  }
}

function writeCachedUsername(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(USERNAME_CACHE_KEY, value);
  } catch {
    // localStorage might be unavailable in private mode — ignore.
  }
}

function promptForUsername(platform: Platform): string | null {
  if (typeof window === "undefined") return null;
  const hint =
    platform === "windows"
      ? "Windows username (the folder under C:\\Users\\…)"
      : "Account username (the folder under /Users or /home)";
  const answer = window.prompt(
    `To open files directly in your IDE we need your local ${hint}. This is stored only in this browser.`,
    "",
  );
  const trimmed = answer?.trim();
  if (!trimmed) return null;
  writeCachedUsername(trimmed);
  return trimmed;
}

function sanitizeFilenameForDownload(filename: string): string {
  // Browsers that support nested `download` attributes (Chromium) create
  // the folder; others flatten it. Either way the file ends up reachable.
  return filename.replace(/[\\]/g, "_");
}

export interface OpenInIdeMenuProps {
  projectId: string;
  projectSlug?: string;
  taskId: string;
  node: ProjectNode;
  /** Parent-supplied callback for the "Open in Workspace" option. */
  onOpenInWorkspace?: (node: ProjectNode) => void;
  /** Triggered after a successful download so parent can toast / log. */
  onAfterDownload?: (node: ProjectNode) => void;
  /** Optional custom trigger. Default is a compact icon button. */
  trigger?: React.ReactNode;
  /** Disable the whole menu (e.g. viewer role). */
  disabled?: boolean;
  /**
   * Visual treatment for the default trigger.
   *  - "compact" (default): tiny icon-button with chevron, used in dense lists
   *  - "primary": solid project-blue button labeled "Open ▾", used as the
   *    primary row action in the task panel Files tab
   *
   * Ignored when `trigger` is supplied (caller provides their own).
   */
  variant?: "compact" | "primary";
}

type LaunchPhase = "idle" | "hashing" | "launching";

export function OpenInIdeMenu({
  projectId,
  projectSlug,
  taskId,
  node,
  onOpenInWorkspace,
  onAfterDownload,
  trigger,
  disabled,
  variant = "compact",
}: OpenInIdeMenuProps) {
  const { showToast } = useToast();
  const [phase, setPhase] = useState<LaunchPhase>("idle");

  // Platform is stable per page-load — detectPlatform reads navigator which
  // won't change. Memoize to avoid re-running sanitization.
  const platform = useMemo(() => detectPlatform(), []);
  const effectiveSlug = useMemo(() => {
    if (projectSlug && projectSlug.trim()) return projectSlug.trim();
    // Fall back to projectId so the IDE path is still unique. Not pretty,
    // but we never show this to the user.
    return projectId;
  }, [projectId, projectSlug]);

  const ensureUsername = useCallback((): string => {
    const cached = readCachedUsername();
    if (cached) return cached;
    const fresh = promptForUsername(platform);
    return fresh || SAFE_USERNAME_FALLBACK;
  }, [platform]);

  const fetchSignedBlob = useCallback(
    async (): Promise<{ blob: Blob; signedUrl: string } | null> => {
      if (!node.s3Key) {
        showToast("This file has no stored bytes yet.", "error");
        return null;
      }
      try {
        const res = await getProjectFileSignedUrl(projectId, node.s3Key);
        if (!res?.url) throw new Error("Missing signed URL");
        const response = await fetch(res.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        return { blob, signedUrl: res.url };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to fetch file";
        showToast(`Could not fetch file: ${message}`, "error");
        return null;
      }
    },
    [node.s3Key, projectId, showToast],
  );

  const triggerDownload = useCallback(
    (signedUrl: string, filename: string) => {
      const anchor = document.createElement("a");
      anchor.href = signedUrl;
      // Best-effort nested hint — Chromium creates `NB-Workspace/<slug>/…`
      // under Downloads; Firefox/Safari flatten to the basename but the
      // file still lands in Downloads.
      anchor.download = `NB-Workspace/${effectiveSlug}/${sanitizeFilenameForDownload(filename)}`;
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    [effectiveSlug],
  );

  const launchInIde = useCallback(
    async (primary: IdeKind) => {
      if (disabled) return;
      if (phase !== "idle") return;
      setPhase("hashing");

      try {
        const fetched = await fetchSignedBlob();
        if (!fetched) return;

        const { blob, signedUrl } = fetched;
        const hash = await computeContentHash(blob).catch(() => null);
        const username = ensureUsername();
        const localPath = buildLocalPath({
          platform,
          username,
          projectSlug: effectiveSlug,
          filename: node.name,
        });

        triggerDownload(signedUrl, node.name);

        await recordOpenSession({
          nodeId: node.id,
          taskId,
          projectId,
          filename: node.name,
          originalHash: hash?.kind === "full" ? hash.hashHex : null,
          localPath,
          ide: primary,
        });
        // Opportunistic GC — keeps the session store bounded.
        void pruneStaleSessions();

        setPhase("launching");

        // Try the preferred IDE first, then the other one, then give up.
        const fallback: IdeKind = primary === "cursor" ? "vscode" : "cursor";
        const urls = [
          buildIdeUrl(primary, localPath),
          buildIdeUrl(fallback, localPath),
        ];

        await launchIdeChain({
          urls,
          onExhausted: () => {
            showToast(
              `Saved to Downloads/NB-Workspace/${effectiveSlug}/. Install Cursor or VS Code to launch directly next time.`,
              "info",
            );
          },
        });

        onAfterDownload?.(node);
      } finally {
        setPhase("idle");
      }
    },
    [
      disabled,
      phase,
      fetchSignedBlob,
      ensureUsername,
      platform,
      effectiveSlug,
      node,
      triggerDownload,
      taskId,
      projectId,
      showToast,
      onAfterDownload,
    ],
  );

  const plainDownload = useCallback(async () => {
    if (disabled || phase !== "idle") return;
    const fetched = await fetchSignedBlob();
    if (!fetched) return;
    triggerDownload(fetched.signedUrl, node.name);
    onAfterDownload?.(node);
  }, [disabled, phase, fetchSignedBlob, triggerDownload, node, onAfterDownload]);

  const isBusy = phase !== "idle";

  const compactTrigger = (
    <button
      type="button"
      data-testid="open-in-ide-trigger"
      data-node-id={node.id}
      data-variant="compact"
      className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      disabled={disabled}
    >
      {isBusy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <MoreHorizontal className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">Open</span>
      <ChevronDown className="h-3 w-3 opacity-60" />
    </button>
  );

  // Primary trigger — used as the row's main action in the task Files tab.
  // Solid indigo, large enough that the affordance is unambiguous, and
  // explicitly labelled "Open with" so users understand this is a chooser
  // for IDEs, workspace editing, and download.
  const primaryTrigger = (
    <button
      type="button"
      data-testid="open-in-ide-trigger"
      data-node-id={node.id}
      data-variant="primary"
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:focus-visible:ring-indigo-500/50"
      disabled={disabled}
    >
      {isBusy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ExternalLink className="h-3.5 w-3.5" />
      )}
      <span>Open with</span>
      <ChevronDown className="h-3 w-3 opacity-90" />
    </button>
  );

  const defaultTrigger = variant === "primary" ? primaryTrigger : compactTrigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {trigger ?? defaultTrigger}
      </DropdownMenuTrigger>
      {/*
        z-[300] lifts the portal above the task detail panel (z-[201]) and
        its overlay (z-[200]). Without this override the menu opens behind
        the panel and looks silently broken — the click "does nothing"
        from the user's perspective.
      */}
      <DropdownMenuContent
        align="end"
        className="z-[300] w-64"
        data-testid="open-in-ide-menu"
      >
        <DropdownMenuLabel className="text-xs text-zinc-500">
          Open with
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isBusy}
          data-testid="open-in-ide-cursor"
          onSelect={(event) => {
            event.preventDefault();
            void launchInIde("cursor");
          }}
        >
          <SquareTerminal className="mr-2 h-4 w-4" />
          <div className="flex flex-col">
            <span>Open in Cursor</span>
            <span className="text-[10px] text-zinc-500">
              Launches via <code>cursor://</code> handler
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isBusy}
          data-testid="open-in-ide-vscode"
          onSelect={(event) => {
            event.preventDefault();
            void launchInIde("vscode");
          }}
        >
          <FileCode2 className="mr-2 h-4 w-4" />
          <div className="flex flex-col">
            <span>Open in VS Code</span>
            <span className="text-[10px] text-zinc-500">
              Launches via <code>vscode://</code> handler
            </span>
          </div>
        </DropdownMenuItem>
        {onOpenInWorkspace ? (
          <DropdownMenuItem
            disabled={isBusy}
            data-testid="open-in-ide-workspace"
            onSelect={(event) => {
              event.preventDefault();
              onOpenInWorkspace(node);
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            <div className="flex flex-col">
              <span>Open in Workspace</span>
              <span className="text-[10px] text-zinc-500">
                Leaves this panel and opens the project workspace editor
              </span>
            </div>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isBusy}
          data-testid="open-in-ide-download"
          onSelect={(event) => {
            event.preventDefault();
            void plainDownload();
          }}
        >
          <Download className="mr-2 h-4 w-4" />
          Download
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
