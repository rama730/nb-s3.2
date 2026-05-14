# Bugfix Requirements Document

## Introduction

Three related bugs in the messaging system degrade the user experience: stale timestamps in the conversation list, ghost conversations cluttering the inbox, and unreliable/sluggish reactions. These bugs span the real-time cache layer, conversation creation flow, and reaction persistence mechanism. Fixing them requires coordinated changes to the React Query cache patching, outbox store, server actions, and database schema.

## Bug Analysis

### Current Behavior (Defect)

**Bug 1 — Stale Timestamps:**

1.1 WHEN a new message is sent in a conversation THEN the conversation list continues to display the old `last_message_at` timestamp (e.g., "4 days ago") instead of updating to "just now"

1.2 WHEN a real-time INSERT event fires for a new message THEN `patchConversationLastMessageFromMessage` updates the message preview text but does not update the conversation's `updatedAt` / `lastMessage.createdAt` fields in the inbox cache

1.3 WHEN the inbox conversation timestamp is patched THEN the conversation list does not re-sort the updated conversation to the top of the list

**Bug 2 — Ghost Conversations:**

1.4 WHEN a user taps "Message" on another user's profile THEN `getOrCreateDMConversation()` is called immediately, creating a conversation record in the database even if no message is ever sent

1.5 WHEN an empty conversation exists (no messages sent) THEN it appears in the inbox list with "no message" preview, cluttering the user's conversation list

**Bug 3 — Reaction Inconsistency:**

1.6 WHEN a user taps a reaction emoji THEN the reaction sometimes does not appear because Supabase `postgres_changes` does not reliably fire for JSONB-only updates to `metadata.reactionSummary`

1.7 WHEN a reaction is toggled THEN there is a noticeable delay before it appears because the optimistic update is overwritten by a stale cache refetch that races with the mutation

1.8 WHEN viewing reactions in a group conversation THEN the user cannot see who reacted or the total count per reaction because only `{emoji, count, viewerReacted}` is stored in JSONB metadata without per-user attribution

### Expected Behavior (Correct)

**Bug 1 — Stale Timestamps:**

2.1 WHEN a new message is sent (optimistic outbox insert) THEN the system SHALL immediately patch the inbox conversation's `lastMessage.createdAt` and `updatedAt` to the current time in the React Query cache

2.2 WHEN a real-time INSERT event fires for a new message THEN the system SHALL update both the message preview AND the `updatedAt` / `lastMessage.createdAt` timestamp in the inbox cache via `patchConversationLastMessageFromMessage`

2.3 WHEN a conversation's timestamp is updated in the inbox cache THEN the system SHALL re-sort the conversation list so the updated conversation appears at the top

**Bug 2 — Ghost Conversations:**

2.4 WHEN a user taps "Message" on a profile THEN the system SHALL navigate to the chat view in a "draft" state with the target user's info without calling `getOrCreateDMConversation()` until the first message is actually sent

2.5 WHEN the inbox list is fetched THEN the system SHALL exclude conversations where `last_message_id IS NULL` (server-side filter) and skip rendering conversations where `lastMessage` is null (client-side safety net)

**Bug 3 — Reaction Inconsistency:**

2.6 WHEN a user taps a reaction emoji THEN the system SHALL apply the optimistic update immediately using `toggleMessageReactionSummary` to patch the local thread cache, making the reaction appear instantly

2.7 WHEN a reaction mutation is in flight THEN the system SHALL use the proper optimistic mutation pattern (`onMutate` patches cache, `onError` rolls back) and SHALL NOT rely on real-time for the sender's own reaction — only using real-time to sync other users' reactions

2.8 WHEN reactions are stored THEN the system SHALL persist them in a dedicated `message_reactions` table (`message_id`, `user_id`, `emoji`, `created_at`) with row-level changes that Supabase real-time can detect reliably, instead of JSONB metadata

2.9 WHEN a user long-presses or double-taps a reaction pill in a group conversation THEN the system SHALL display a bottom sheet listing each emoji with the users who reacted (avatar + name), and each reaction pill SHALL display the count

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a conversation has existing messages and no new messages are sent THEN the system SHALL CONTINUE TO display the correct historical timestamp for the last message

3.2 WHEN a user sends a message in an existing conversation THEN the system SHALL CONTINUE TO deliver the message, update the thread, and show delivery state indicators as before

3.3 WHEN a user navigates to an existing conversation (already has messages) THEN the system SHALL CONTINUE TO load the conversation directly without any "draft" state

3.4 WHEN a conversation has at least one message THEN the system SHALL CONTINUE TO display it in the inbox list regardless of the new filtering logic

3.5 WHEN a user reacts to a message in a 1:1 conversation THEN the system SHALL CONTINUE TO show the reaction emoji and count on the message bubble

3.6 WHEN another user adds a reaction via real-time THEN the system SHALL CONTINUE TO update the reaction display for all participants in the conversation

3.7 WHEN the inbox list is sorted THEN the system SHALL CONTINUE TO use `updatedAt` descending as the primary sort key (existing `normalizeConversationRows` behavior)

3.8 WHEN the outbox store persists items with `targetUserId` THEN the system SHALL CONTINUE TO support the existing outbox persistence and migration logic
