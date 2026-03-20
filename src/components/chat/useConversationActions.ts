"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  setConversationArchived,
  setConversationMuted,
  type ConversationWithDetails,
} from "@/app/actions/messaging/conversations";
import { useChatStore } from "@/stores/chatStore";

export function useConversationActions(activeConversation: ConversationWithDetails | null) {
  const [conversationActionLoading, setConversationActionLoading] = useState(false);
  const refreshConversations = useChatStore((state) => state.refreshConversations);
  const openConversation = useChatStore((state) => state.openConversation);
  const closeConversation = useChatStore((state) => state.closeConversation);

  const handleToggleArchiveConversation = useCallback(async () => {
    if (!activeConversation) return;
    setConversationActionLoading(true);
    try {
      const nextArchived = activeConversation.lifecycleState !== "archived";
      const result = await setConversationArchived(activeConversation.id, nextArchived);
      if (!result.success) {
        toast.error(result.error || "Failed to update conversation");
        return;
      }
      await refreshConversations();
      if (nextArchived) {
        closeConversation();
      } else {
        await openConversation(activeConversation.id);
      }
    } finally {
      setConversationActionLoading(false);
    }
  }, [activeConversation, closeConversation, openConversation, refreshConversations]);

  const handleToggleMuteConversation = useCallback(async () => {
    if (!activeConversation) return;
    setConversationActionLoading(true);
    try {
      const result = await setConversationMuted(activeConversation.id, !activeConversation.muted);
      if (!result.success) {
        toast.error(result.error || "Failed to update mute state");
        return;
      }
      await refreshConversations();
      await openConversation(activeConversation.id);
    } finally {
      setConversationActionLoading(false);
    }
  }, [activeConversation, openConversation, refreshConversations]);

  return {
    conversationActionLoading,
    handleToggleArchiveConversation,
    handleToggleMuteConversation,
  };
}
