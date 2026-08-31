import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeActiveResource,
  type DbRealtimePayload,
} from "@/lib/realtime/subscriptions";

export type TaskResourceEvent =
  | { kind: "task"; payload: DbRealtimePayload }
  | { kind: "comment"; payload: DbRealtimePayload }
  | { kind: "subtask"; payload: DbRealtimePayload }
  | { kind: "attachment_link"; payload: DbRealtimePayload };

type TaskResourceListener = (event: TaskResourceEvent) => void;
type TaskResourceStatusListener = (status: string) => void;

type TaskResourceEntry = {
  taskId: string;
  channel: RealtimeChannel | null;
  listeners: Set<TaskResourceListener>;
  statusListeners: Set<TaskResourceStatusListener>;
  generation: number;
};

const taskResourceEntries = new Map<string, TaskResourceEntry>();

function notifyStatus(entry: TaskResourceEntry, status: string) {
  for (const listener of entry.statusListeners) {
    listener(status);
  }
}

function cleanupEntry(taskId: string) {
  const entry = taskResourceEntries.get(taskId);
  if (!entry) return;

  // ponytail: invalidate callbacks from the channel we are intentionally closing.
  entry.generation += 1;

  if (entry.channel) {
    const supabase = createClient();
    void supabase.removeChannel(entry.channel);
    entry.channel = null;
  }

  taskResourceEntries.delete(taskId);
}

function openTaskResource(entry: TaskResourceEntry) {
  // ponytail: configuration changes replace the channel; native Realtime owns reconnects.
  const generation = entry.generation + 1;
  entry.generation = generation;

  if (entry.channel) {
    const supabase = createClient();
    void supabase.removeChannel(entry.channel);
    entry.channel = null;
  }

  const supabase = createClient();
  const bindings: Parameters<typeof subscribeActiveResource>[0]["bindings"] = [
    {
      event: "*",
      table: "tasks",
      filter: `id=eq.${entry.taskId}`,
      handler: (payload) => {
        for (const listener of entry.listeners) {
          listener({ kind: "task", payload });
        }
      },
    },
    {
      event: "*",
      table: "task_comments",
      filter: `task_id=eq.${entry.taskId}`,
      handler: (payload) => {
        for (const listener of entry.listeners) {
          listener({ kind: "comment", payload });
        }
      },
    },
    {
      event: "*",
      table: "task_subtasks",
      filter: `task_id=eq.${entry.taskId}`,
      handler: (payload) => {
        for (const listener of entry.listeners) {
          listener({ kind: "subtask", payload });
        }
      },
    },
    {
      event: "*",
      table: "task_node_links",
      filter: `task_id=eq.${entry.taskId}`,
      handler: (payload) => {
        for (const listener of entry.listeners) {
          listener({ kind: "attachment_link", payload });
        }
      },
    },
  ];
  entry.channel = subscribeActiveResource({
    supabase,
    resourceType: "task",
    resourceId: entry.taskId,
    bindings,
    onStatus: (status) => {
      if (entry.generation !== generation) return;
      notifyStatus(entry, status);
    },
  });
}

function ensureTaskEntry(taskId: string) {
  const existing = taskResourceEntries.get(taskId);
  if (existing) return existing;

  const entry: TaskResourceEntry = {
    taskId,
    channel: null,
    listeners: new Set(),
    statusListeners: new Set(),
    generation: 0,
  };
  taskResourceEntries.set(taskId, entry);
  openTaskResource(entry);
  return entry;
}

export function subscribeTaskResource(params: {
  taskId: string;
  onEvent: TaskResourceListener;
  onStatus?: TaskResourceStatusListener;
}) {
  const entry = ensureTaskEntry(params.taskId);
  entry.listeners.add(params.onEvent);
  if (params.onStatus) {
    entry.statusListeners.add(params.onStatus);
  }
  return () => {
    entry.listeners.delete(params.onEvent);
    if (params.onStatus) {
      entry.statusListeners.delete(params.onStatus);
    }
    if (entry.listeners.size === 0 && entry.statusListeners.size === 0) {
      cleanupEntry(params.taskId);
    }
  };
}
