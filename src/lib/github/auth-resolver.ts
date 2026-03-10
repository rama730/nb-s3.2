import crypto from "crypto";

import { runInFlightDeduped } from "@/lib/async/inflight-dedupe";
import { logger } from "@/lib/logger";

import { parseGithubRepo } from "@/lib/github/repo-preview";
import { openGithubImportToken } from "@/lib/github/repo-security";
import { normalizeGithubRepoUrl } from "@/lib/github/repo-validation";
import { buildProjectImportEventId } from "@/lib/import/idempotency";

const GITHUB_API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = (() => {
  const v = Number(process.env.GITHUB_API_TIMEOUT_MS || 12000);
  return Number.isFinite(v) && v >= 1000 ? Math.floor(v) : 12000;
})();

const APP_JWT_TTL_SECONDS = 8 * 60;
const TOKEN_EXPIRY_SAFETY_MS = 30_000;
const INSTALLATION_ID_CACHE_TTL_MS = 5 * 60_000;
const RETRYABLE_STATUS = new Set([403, 429, 500, 502, 503, 504]);

type GithubAppConfig = {
  appId: string;
  privateKeyPem: string;
};

type CachedInstallationToken = {
  token: string;
  expiresAtMs: number;
};

type CachedInstallationId = {
  installationId: number;
  expiresAtMs: number;
};

const installationTokenCache = new Map<number, CachedInstallationToken>();
const installationIdByRepoCache = new Map<string, CachedInstallationId>();

export type GithubAuthSource = "app" | "oauth" | "sealed" | "none";

export type GithubResolvedAccess = {
  source: GithubAuthSource;
  token: string | null;
  installationId: number | null;
  normalizedRepoUrl: string | null;
};

export type ResolveGithubRepoAccessInput = {
  repoUrl: string;
  preferredInstallationId?: number | string | null;
  oauthToken?: string | null;
  sealedImportToken?: unknown;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toBase64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function parseInstallationId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function normalizeGithubAppPrivateKey(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";

  if (trimmed.includes("-----BEGIN")) {
    return trimmed.replace(/\\n/g, "\n");
  }

  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
    if (decoded.includes("-----BEGIN")) {
      return decoded.replace(/\\n/g, "\n");
    }
  } catch {
    // Ignore and use raw value.
  }

  return trimmed.replace(/\\n/g, "\n");
}

function getGithubAppConfig(): GithubAppConfig | null {
  const appId = (process.env.GITHUB_APP_ID || "").trim();
  const privateKeyPem = normalizeGithubAppPrivateKey(process.env.GITHUB_APP_PRIVATE_KEY || "");
  if (!appId || !privateKeyPem) return null;
  return { appId, privateKeyPem };
}

function createGithubAppJwt(config: GithubAppConfig): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iat: nowSeconds - 30,
    exp: nowSeconds + APP_JWT_TTL_SECONDS,
    iss: config.appId,
  };
  const header = { alg: "RS256", typ: "JWT" };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(config.privateKeyPem);
  return `${signingInput}.${toBase64Url(signature)}`;
}

type FetchGithubJsonOptions = {
  retries?: number;
  timeoutMs?: number;
};

async function fetchGithubJson<T>(
  url: string,
  init: RequestInit,
  options: FetchGithubJsonOptions = {},
): Promise<{ data: T; headers: Headers; status: number }> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("GitHub request timed out")), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.headers || {}),
        },
      });

      const bodyText = await response.text();
      let body: unknown = null;
      if (bodyText.trim().length > 0) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
      }

      if (response.ok) {
        return { data: body as T, headers: response.headers, status: response.status };
      }

      const message =
        typeof body === "object" && body && "message" in body
          ? String((body as Record<string, unknown>).message ?? "")
          : typeof body === "string"
            ? body
            : `HTTP ${response.status}`;

      const retryable = RETRYABLE_STATUS.has(response.status) || /rate limit/i.test(message);
      if (attempt < retries && retryable) {
        const retryAfterHeader = Number(response.headers.get("retry-after") || "0");
        const jitter = Math.floor(Math.random() * 150);
        const delayMs =
          retryAfterHeader > 0
            ? retryAfterHeader * 1000 + jitter
            : Math.min(2000, 250 * (attempt + 1) * (attempt + 1) + jitter);
        attempt += 1;
        await sleep(delayMs);
        continue;
      }

      const error = new Error(`GitHub request failed (${response.status}): ${message || "Unknown error"}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    } catch (error) {
      if (attempt < retries) {
        const jitter = Math.floor(Math.random() * 150);
        const delayMs = Math.min(2000, 250 * (attempt + 1) * (attempt + 1) + jitter);
        attempt += 1;
        await sleep(delayMs);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function getGithubAppInstallationToken(installationId: number): Promise<string | null> {
  const cached = installationTokenCache.get(installationId);
  if (cached && cached.expiresAtMs - TOKEN_EXPIRY_SAFETY_MS > Date.now()) {
    return cached.token;
  }

  const config = getGithubAppConfig();
  if (!config) return null;

  return await runInFlightDeduped(`github:app:installation-token:${installationId}`, async () => {
    const fresh = installationTokenCache.get(installationId);
    if (fresh && fresh.expiresAtMs - TOKEN_EXPIRY_SAFETY_MS > Date.now()) {
      return fresh.token;
    }

    const appJwt = createGithubAppJwt(config);
    const { data } = await fetchGithubJson<{ token?: string; expires_at?: string }>(
      `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appJwt}`,
        },
      },
    );

    const token = typeof data?.token === "string" ? data.token : null;
    if (!token) return null;

    const expiresAtMs = (() => {
      const parsed = Date.parse(String(data?.expires_at || ""));
      if (!Number.isFinite(parsed) || parsed <= Date.now()) return Date.now() + 50 * 60_000;
      return parsed;
    })();

    installationTokenCache.set(installationId, { token, expiresAtMs });
    return token;
  });
}

export async function resolveGithubRepoInstallationId(repoUrl: string): Promise<number | null> {
  const normalizedRepoUrl = normalizeGithubRepoUrl(repoUrl || "");
  if (!normalizedRepoUrl) return null;

  const cached = installationIdByRepoCache.get(normalizedRepoUrl);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.installationId;
  }

  const config = getGithubAppConfig();
  if (!config) return null;

  const parsed = parseGithubRepo(normalizedRepoUrl);
  if (!parsed) return null;

  return await runInFlightDeduped(`github:app:repo-installation:${normalizedRepoUrl}`, async () => {
    const fresh = installationIdByRepoCache.get(normalizedRepoUrl);
    if (fresh && fresh.expiresAtMs > Date.now()) return fresh.installationId;

    const appJwt = createGithubAppJwt(config);
    try {
      const { data } = await fetchGithubJson<{ id?: number }>(
        `${GITHUB_API_BASE}/repos/${parsed.owner}/${parsed.repo}/installation`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${appJwt}`,
          },
        },
      );
      const installationId = parseInstallationId(data?.id);
      if (!installationId) return null;

      installationIdByRepoCache.set(normalizedRepoUrl, {
        installationId,
        expiresAtMs: Date.now() + INSTALLATION_ID_CACHE_TTL_MS,
      });
      return installationId;
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 404) return null;
      logger.warn("github.app.installation.lookup.failed", {
        repoUrl: normalizedRepoUrl,
        status: status ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });
}

export async function resolveGithubRepoAccess(input: ResolveGithubRepoAccessInput): Promise<GithubResolvedAccess> {
  const normalizedRepoUrl = normalizeGithubRepoUrl(input.repoUrl || "");
  if (!normalizedRepoUrl) {
    return {
      source: "none",
      token: null,
      installationId: null,
      normalizedRepoUrl: null,
    };
  }

  const preferredInstallationId = parseInstallationId(input.preferredInstallationId);
  const appConfig = getGithubAppConfig();
  if (appConfig) {
    const installationId =
      preferredInstallationId ?? (await resolveGithubRepoInstallationId(normalizedRepoUrl));
    if (installationId) {
      try {
        const token = await getGithubAppInstallationToken(installationId);
        if (token) {
          return {
            source: "app",
            token,
            installationId,
            normalizedRepoUrl,
          };
        }
      } catch (error) {
        logger.warn("github.app.token.resolve.failed", {
          installationId,
          repoUrl: normalizedRepoUrl,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (input.oauthToken) {
    return {
      source: "oauth",
      token: input.oauthToken,
      installationId: preferredInstallationId,
      normalizedRepoUrl,
    };
  }

  const sealedToken = openGithubImportToken(input.sealedImportToken);
  if (sealedToken) {
    return {
      source: "sealed",
      token: sealedToken,
      installationId: preferredInstallationId,
      normalizedRepoUrl,
    };
  }

  return {
    source: "none",
    token: null,
    installationId: preferredInstallationId,
    normalizedRepoUrl,
  };
}

export function buildGithubImportEventId(projectId: string, repoUrl: string, branch?: string | null) {
  const normalizedRepoUrl = normalizeGithubRepoUrl(repoUrl || "") || repoUrl || "unknown";
  const normalizedBranch = (branch || "default").trim() || "default";
  return buildProjectImportEventId({
    projectId,
    source: "github",
    normalizedTarget: normalizedRepoUrl,
    branchOrManifestHash: normalizedBranch,
  });
}
