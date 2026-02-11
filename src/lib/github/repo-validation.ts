const GITHUB_HOST = "github.com";
const BRANCH_MAX_LENGTH = 255;

export function normalizeGithubRepoUrl(raw: string): string | null {
  const input = (raw || "").trim();
  if (!input) return null;

  const withScheme = input.startsWith("http://") || input.startsWith("https://")
    ? input.replace(/^http:\/\//i, "https://")
    : input.startsWith("github.com/")
      ? `https://${input}`
      : /^[^/\s]+\/[^/\s]+$/.test(input)
        ? `https://github.com/${input}`
        : input;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.hostname.toLowerCase() !== GITHUB_HOST) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");

  if (!/^[A-Za-z0-9_.-]+$/.test(owner)) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(repo)) return null;

  return `https://${GITHUB_HOST}/${owner}/${repo}`;
}

export function isValidGithubBranchName(branch: string | null | undefined): boolean {
  if (!branch) return true;
  const ref = branch.trim();
  if (!ref) return false;
  if (ref.length > BRANCH_MAX_LENGTH) return false;
  if (ref.startsWith("/") || ref.endsWith("/")) return false;
  if (ref.startsWith(".") || ref.endsWith(".")) return false;
  if (ref.includes("..")) return false;
  if (ref.includes("@{")) return false;
  if (ref.endsWith(".lock")) return false;
  if (/[\s~^:?*[\]\\]/.test(ref)) return false;

  const parts = ref.split("/");
  return parts.every((p) => p.length > 0 && !p.endsWith(".") && !p.includes(".."));
}

export function normalizeGithubBranch(branch: string | null | undefined): string | undefined {
  if (!branch) return undefined;
  const v = branch.trim();
  if (!v) return undefined;
  return isValidGithubBranchName(v) ? v : undefined;
}
