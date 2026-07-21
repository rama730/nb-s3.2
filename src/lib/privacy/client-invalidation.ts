"use client";

import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export async function invalidatePrivacyDependents(
  queryClient: QueryClient,
  profileTargetKey?: string | null,
) {
  const invalidations: Promise<unknown>[] = [
    queryClient.invalidateQueries({ queryKey: queryKeys.settings.privacy() }),
  ];

  invalidations.push(
    profileTargetKey
      ? queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(profileTargetKey) })
      : queryClient.invalidateQueries({ queryKey: queryKeys.profile.root() }),
  );

  invalidations.push(
    queryClient.invalidateQueries({ queryKey: queryKeys.messages.conversations() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.hub.root() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.connections.root() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.project.root() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.previewsRoot() }),
  );

  await Promise.all(invalidations);
}
