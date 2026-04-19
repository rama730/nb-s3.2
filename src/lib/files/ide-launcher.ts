/**
 * Launch a local IDE from the browser via its registered URL scheme.
 *
 * Chrome, Firefox, and Safari all let web pages open `cursor://…` or
 * `vscode://…` when the corresponding app is installed. The browser silently
 * no-ops if the scheme has no handler — there is no reliable error callback
 * to detect that case. We paper over this by (a) always downloading the file
 * to a conventional location *first*, so the user can open it manually even
 * if the protocol silently fails, and (b) timing out the navigation and
 * reverting UI state if we can tell the tab never left (not reliable on all
 * browsers; used as a best-effort hint only).
 *
 * See `docs/tasks/files-and-mentions.md` for the full re-upload loop.
 */

export type IdeKind = "cursor" | "vscode";

export type Platform = "macos" | "windows" | "linux" | "unknown";

export const NB_WORKSPACE_DIR = "NB-Workspace";

/**
 * Best-effort platform detection for building absolute local paths.
 *
 * We can't read the OS exactly from a browser — `navigator.platform` is being
 * deprecated and `userAgentData` isn't universal. This returns "unknown" if
 * nothing matches, in which case the caller should prompt the user for their
 * username + OS once and cache the answer.
 */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const hint = (
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ""
  ).toLowerCase();
  if (hint.includes("mac")) return "macos";
  if (hint.includes("win")) return "windows";
  if (hint.includes("linux")) return "linux";
  return "unknown";
}

/**
 * Build the local absolute path that a protocol handler would be able to
 * open, given the user's username and which OS they're on. This path is
 * ALSO the location we'll download the file to, so the two ends of the loop
 * agree.
 *
 *   macOS:  /Users/<user>/Downloads/NB-Workspace/<project>/<filename>
 *   Win:    C:\Users\<user>\Downloads\NB-Workspace\<project>\<filename>
 *   Linux:  /home/<user>/Downloads/NB-Workspace/<project>/<filename>
 *
 * The filename argument is joined as-is; callers are responsible for
 * sanitizing it (strip path separators, NUL, etc.) before passing.
 */
export function buildLocalPath(opts: {
  platform: Platform;
  username: string;
  projectSlug: string;
  filename: string;
}): string {
  const { platform, username, projectSlug, filename } = opts;
  const safeUser = sanitizePathSegment(username);
  const safeProject = sanitizePathSegment(projectSlug);
  const safeFilename = sanitizePathSegment(filename);

  if (platform === "windows") {
    return `C:\\Users\\${safeUser}\\Downloads\\${NB_WORKSPACE_DIR}\\${safeProject}\\${safeFilename}`;
  }
  if (platform === "linux") {
    return `/home/${safeUser}/Downloads/${NB_WORKSPACE_DIR}/${safeProject}/${safeFilename}`;
  }
  // macOS and unknown both default to the POSIX layout.
  return `/Users/${safeUser}/Downloads/${NB_WORKSPACE_DIR}/${safeProject}/${safeFilename}`;
}

function sanitizePathSegment(input: string): string {
  // Strip characters that would break either POSIX or Windows paths, or that
  // could allow a path-traversal injection via the file name.
  return input.replace(/[/\\:*?"<>|\u0000]/g, "_").trim();
}

/**
 * Build the `cursor://` / `vscode://` URL for a given local absolute path.
 *
 * Both IDEs share the same scheme shape: `<scheme>://file/<absolute-path>`.
 * The path is URI-encoded component-by-component so spaces and unicode work
 * on all three OSes. Windows drive letters (`C:`) encode cleanly because `:`
 * is allowed in path components.
 */
export function buildIdeUrl(ide: IdeKind, localPath: string): string {
  const scheme = ide === "cursor" ? "cursor" : "vscode";
  // Split on both separators so we encode each segment independently.
  const segments = localPath.split(/[\\/]/).map((segment) => encodeURIComponent(segment));
  // Preserve a leading slash on POSIX paths.
  const joined = segments.join("/");
  const encoded = localPath.startsWith("/") ? joined : joined.replace(/^\//, "");
  return `${scheme}://file/${encoded}`;
}

/**
 * Try to launch the IDE via its protocol handler. Returns immediately after
 * the navigation is initiated. There is no reliable success signal — the
 * caller should have already saved the file to disk and shown a "file is at
 * <localPath>" affordance so a failed launch isn't a dead-end.
 *
 * Implementation note: we use a hidden iframe + location change rather than
 * `window.location.href` so a blocked scheme doesn't navigate the whole tab
 * to `about:blank` on some browsers.
 */
export function launchIdeUrl(url: string): void {
  if (typeof document === "undefined") return;

  // Test seam: e2e specs install `window.__nbIdeLaunchHook` to capture the
  // launched URL deterministically (the iframe path is fire-and-forget and
  // browsers offer no success signal). Production code never sets the hook,
  // so this branch is dead in real usage.
  if (typeof window !== "undefined") {
    const hook = (
      window as unknown as { __nbIdeLaunchHook?: (url: string) => void }
    ).__nbIdeLaunchHook;
    if (typeof hook === "function") {
      try {
        hook(url);
      } catch {
        // Hook errors must never break the user flow.
      }
      return;
    }
  }

  // Chrome and Firefox both accept iframe.src = 'cursor://…' without tearing
  // the current page. Safari sometimes requires a top-level navigation;
  // fall through to that path if the iframe trick is no-op.
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");
  iframe.src = url;
  document.body.appendChild(iframe);
  // Cleanup after a short delay. The protocol handler fires synchronously;
  // the iframe is no longer needed.
  window.setTimeout(() => {
    iframe.remove();
  }, 1500);
}

/**
 * Try a chain of IDE URLs in order, invoking a per-step fallback if the
 * previous step "appears to fail". This is intentionally fuzzy — browsers
 * don't report protocol-handler success — so we rely on `document.hidden`
 * as a proxy: if the tab didn't blur within `timeoutMs`, the scheme was
 * probably unhandled and we try the next option.
 *
 * The caller supplies `onExhausted()` for the "nothing worked" branch so we
 * can show a toast like "Install Cursor or VS Code to use this option" and
 * point the user at the already-downloaded file.
 */
export async function launchIdeChain(opts: {
  urls: string[];
  onExhausted: () => void;
  timeoutMs?: number;
}): Promise<void> {
  const { urls, onExhausted, timeoutMs = 800 } = opts;
  for (const url of urls) {
    launchIdeUrl(url);
    const blurred = await waitForVisibilityChange(timeoutMs);
    if (blurred) return;
  }
  onExhausted();
}

function waitForVisibilityChange(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(false);
      return;
    }
    let done = false;
    const onChange = () => {
      if (done) return;
      if (document.hidden) {
        done = true;
        document.removeEventListener("visibilitychange", onChange);
        resolve(true);
      }
    };
    document.addEventListener("visibilitychange", onChange);
    window.setTimeout(() => {
      if (done) return;
      done = true;
      document.removeEventListener("visibilitychange", onChange);
      resolve(false);
    }, timeoutMs);
  });
}
