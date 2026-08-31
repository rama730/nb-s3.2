import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

export type MessageThreadReadScope = {
  viewerId: string;
  conversationId: string;
  conversationType: "dm" | "group" | "project_group";
  otherParticipantId: string | null;
};

const threadReadScope = new AsyncLocalStorage<MessageThreadReadScope>();

export function runWithMessageThreadReadScope<T>(
  scope: MessageThreadReadScope,
  operation: () => Promise<T>,
) {
  return threadReadScope.run(scope, operation);
}

export function getMessageThreadReadScope(conversationId: string) {
  const scope = threadReadScope.getStore();
  return scope?.conversationId === conversationId ? scope : null;
}
