import { inngest } from "@/inngest/client";
import { logger } from "@/lib/logger";

function profileImageStorageKey(value: string | null | undefined, userId: string) {
  if (!value) return null;
  try {
    const pathname = decodeURIComponent(new URL(value).pathname);
    const marker = ["/object/public/avatars/", "/render/image/public/avatars/"]
      .find((candidate) => pathname.includes(candidate));
    if (!marker) return null;
    const storageKey = pathname.slice(pathname.indexOf(marker) + marker.length);
    return storageKey.startsWith(`${userId}/`) && !storageKey.includes("..") ? storageKey : null;
  } catch {
    return null;
  }
}

export async function enqueueSupersededProfileImages(userId: string, urls: Array<string | null | undefined>) {
  const storageKeys = Array.from(new Set(urls
    .map((url) => profileImageStorageKey(url, userId))
    .filter((key): key is string => Boolean(key))));
  const results = await Promise.allSettled(storageKeys.map((storageKey) =>
    inngest.send({ name: "storage/profile-image.cleanup", data: { userId, storageKey } })
  ));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn("profile.image.cleanup_enqueue_failed", {
        module: "profile",
        userId,
        storageKey: storageKeys[index],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });
}
