"use server";

import { getIncomingApplicationsAction, getMyApplicationsAction } from "@/app/actions/applications";

export async function getPeopleApplications(limit = 100) {
  const [my, incoming] = await Promise.all([
    getMyApplicationsAction({ limit }),
    getIncomingApplicationsAction({ limit }),
  ]);
  if (!my.success && !incoming.success) return { success: false as const, my: [], incoming: [], error: "Failed to load applications" };
  return {
    success: true as const,
    my: my.applications ?? [],
    incoming: incoming.applications ?? [],
    warning: !my.success ? "Outgoing applications are unavailable" : !incoming.success ? "Incoming applications are unavailable" : null,
  };
}
