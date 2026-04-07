import { usePeopleNotificationsContext } from "@/components/providers/PeopleNotificationsProvider";

interface UsePeopleNotificationsReturn {
  totalPending: number;
  pendingConnections: number;
  pendingInvites: number;
  refresh: () => Promise<void>;
}

export function usePeopleNotifications(): UsePeopleNotificationsReturn {
  return usePeopleNotificationsContext();
}
