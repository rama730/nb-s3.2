"use client";

import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

type PrivacyInvalidationOptions = {
  profileTargetKey?: string | null;
  includeMessages?: boolean;
  includeDiscovery?: boolean;
  includeProjects?: boolean;
  includeConnections?: boolean;
};

export async function invalidatePrivacyDependents(
  queryClient: QueryClient,
  options: PrivacyInvalidationOptions = {},
) {
  const profileTargetKey = options.profileTargetKey ?? null;
  const includeMessages = options.includeMessages ?? true;
  const includeDiscovery = options.includeDiscovery ?? true;
  const includeProjects = options.includeProjects ?? true;
  const includeConnections = options.includeConnections ?? true;

  const invalidations: Promise<unknown>[] = [
    queryClient.invalidateQueries({ queryKey: queryKeys.settings.privacy() }),
  ];

  invalidations.push(
    profileTargetKey
      ? queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(profileTargetKey) })
      : queryClient.invalidateQueries({ queryKey: queryKeys.profile.root() }),
  );

  if (includeMessages) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.conversations() }),
    );
  }

  if (includeDiscovery) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.hub.root() }));
  }

  if (includeConnections) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.connections.root() }));
  }

  if (includeProjects) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.project.root() }));
  }

  await Promise.all(invalidations);
}
