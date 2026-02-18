export const APPLICATION_BANNER_HIDE_AFTER_MS = 5 * 60 * 1000;

type ApplicationStatus = "pending" | "accepted" | "rejected";

type BannerMessage = {
  createdAt: string | Date;
  metadata?: Record<string, unknown> | null;
};

function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function isApplicationLifecycleMessageForId(message: BannerMessage, applicationId: string): boolean {
  const metadata = message.metadata || {};
  if (metadata.applicationId !== applicationId) return false;
  if (metadata.isApplication === true) return true;
  if (metadata.isApplicationUpdate === true) return true;
  const kind = metadata.kind;
  return kind === "application" || kind === "application_update";
}

export function getLatestApplicationEventAt(
  messages: ReadonlyArray<BannerMessage>,
  applicationId: string
): number | null {
  let latest: number | null = null;

  for (const message of messages) {
    if (!isApplicationLifecycleMessageForId(message, applicationId)) continue;
    const metadata = message.metadata || {};
    const candidate = Math.max(
      toTimestamp(message.createdAt) ?? 0,
      toTimestamp(metadata.decisionAt) ?? 0,
      toTimestamp(metadata.reopenedAt) ?? 0
    );
    if (latest === null || candidate > latest) {
      latest = candidate;
    }
  }

  return latest;
}

export function hasLaterNonApplicationMessage(
  messages: ReadonlyArray<BannerMessage>,
  afterTimestampMs: number,
  applicationId: string
): boolean {
  for (const message of messages) {
    if (isApplicationLifecycleMessageForId(message, applicationId)) continue;
    const createdAtMs = toTimestamp(message.createdAt);
    if (createdAtMs !== null && createdAtMs > afterTimestampMs) {
      return true;
    }
  }
  return false;
}

export function shouldHideTerminalApplicationBanner(params: {
  status: ApplicationStatus;
  applicationId: string;
  messages: ReadonlyArray<BannerMessage>;
  nowMs?: number;
  hideAfterMs?: number;
}): boolean {
  const { status, applicationId, messages, nowMs = Date.now(), hideAfterMs = APPLICATION_BANNER_HIDE_AFTER_MS } = params;
  if (status === "pending") {
    return false;
  }

  const latestEventAt = getLatestApplicationEventAt(messages, applicationId);
  if (latestEventAt === null) {
    return false;
  }

  if (nowMs - latestEventAt >= hideAfterMs) {
    return true;
  }

  return hasLaterNonApplicationMessage(messages, latestEventAt, applicationId);
}
