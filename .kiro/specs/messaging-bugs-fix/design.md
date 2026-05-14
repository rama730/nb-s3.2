# Messaging Bugs Fix — Bugfix Design

## Overview

Three interrelated bugs degrade the messaging experience: (1) stale timestamps in the conversation list after sending or receiving messages, (2) ghost conversations cluttering the inbox when a user opens a DM without sending a message, and (3) unreliable/sluggish reactions due to JSONB-only updates that Supabase real-time cannot detect. The fix strategy patches the React Query cache layer for timestamps, defers conversation creation until first send for ghost conversations, and introduces a dedicated `message_reactions` table with proper optimistic mutation patterns for reactions.

## Glossary

- **Bug_Condition (C)**: The set of conditions that trigger one of the three bugs — stale timestamp display, ghost conversation appearance, or reaction inconsistency
- **Property (P)**: The desired correct behavior — timestamps update immediately, empty conversations are hidden, reactions appear instantly and reliably
- **Preservation**: Existing behaviors that must remain unchanged — historical timestamps, existing conversation delivery, mouse/tap interactions, 1:1 reaction display
- **`patchConversationLastMessageFromMessage`**: Cache utility in `v2-cache.ts` that updates the inbox conversation's last message preview from a message payload
- **`normalizeConversationRows`**: Sort function in `v2-cache.ts` that orders inbox conversations by `updatedAt` descending
- **`ensureDirectConversationV2`**: Server action in `v2.ts` that calls `getOrCreateDMConversation()` to find or create a DM conversation record
- **`toggleMessageReactionSummary`**: Pure function in `reactions.ts` that computes the next reaction summary after toggling an emoji
- **Outbox Store**: Zustand store (`messagesV2OutboxStore.ts`) that persists pending messages for offline-first delivery
- **Draft State**: A client-only conversation state where the target user is known but no database conversation record exists yet

## Bug Details

### Bug Condition

The bugs manifest across three distinct input conditions that share a common root in the cache/persistence layer:

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type MessagingEvent
  OUTPUT: boolean
  
  // Bug 1: Stale Timestamps
  LET isTimestampBug = (input.type == 'MESSAGE_SENT' OR input.type == 'REALTIME_INSERT')
                       AND inboxConversation(input.conversationId).lastMessage.createdAt != input.message.createdAt
                       AND inboxSortPosition(input.conversationId) != 0

  // Bug 2: Ghost Conversations
  LET isGhostBug = input.type == 'DM_OPENED'
                   AND input.messageCount == 0
                   AND conversationExistsInDatabase(input.conversationId)

  // Bug 3: Reaction Inconsistency
  LET isReactionBug = input.type == 'REACTION_TOGGLED'
                      AND (reactionNotVisibleAfterToggle(input.messageId, input.emoji)
                           OR reactionDelayedByStaleRefetch(input.messageId)
                           OR reactionMissingUserAttribution(input.messageId, input.emoji))

  RETURN isTimestampBug OR isGhostBug OR isReactionBug
END FUNCTION
```

### Examples

- **Timestamp Bug**: User sends "Hello" in a conversation last active 4 days ago → inbox still shows "4d" instead of "just now"; conversation stays at its old position in the list
- **Timestamp Bug (real-time)**: Another user sends a message → real-time INSERT fires → preview text updates to new content but timestamp remains stale
- **Ghost Conversation**: User taps "Message" on a profile, views the empty chat screen, then navigates away → an empty conversation with "no message" preview appears in their inbox
- **Reaction Bug (delay)**: User taps 👍 on a message → reaction appears after 1-2s delay because optimistic update is overwritten by a stale `invalidateQueries` refetch
- **Reaction Bug (missing)**: User taps ❤️ → reaction never appears because Supabase `postgres_changes` does not fire for JSONB-only column updates
- **Reaction Bug (attribution)**: In a group chat, user sees "👍 3" but cannot determine which participants reacted

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Conversations with existing messages continue to display their correct historical timestamps
- Sending messages in existing conversations continues to deliver, update threads, and show delivery indicators
- Navigating to an existing conversation (with messages) loads directly without any draft state
- Conversations with at least one message continue to appear in the inbox
- Reactions in 1:1 conversations continue to show emoji + count on message bubbles
- Real-time reactions from other users continue to update the display for all participants
- Inbox list continues to sort by `updatedAt` descending (existing `normalizeConversationRows` behavior)
- Outbox store persistence and migration logic remains unchanged
- `targetUserId` field on outbox items continues to work for deferred-send scenarios

**Scope:**
All inputs that do NOT involve the three bug conditions should be completely unaffected by this fix. This includes:
- Reading messages in existing conversations
- Archiving/muting conversations
- Search functionality
- Message editing and deletion
- Pinned messages
- Typing indicators and presence

## Hypothesized Root Cause

Based on the bug analysis and code review:

### Bug 1 — Stale Timestamps

1. **Missing `updatedAt` patch on optimistic send**: When the outbox store queues a message, the optimistic cache insert adds the message to the thread but does not call `patchConversationLastMessageFromMessage` with the correct `createdAt`, leaving the inbox conversation's `updatedAt` stale.

2. **Incomplete real-time handler**: The `useMessagesV2Realtime` INSERT handler calls `upsertThreadMessage` but the `patchConversationLastMessageFromMessage` call does not propagate the message's `createdAt` to the conversation's `updatedAt` field — or the propagation happens but `normalizeConversationRows` is not triggered because `updateInboxData` is not called in the correct code path.

3. **Sort not triggered after patch**: Even if `updatedAt` is patched, the inbox data may not be re-partitioned through `normalizeConversationRows` if the patch goes through `patchThreadConversation` → `patchInboxConversation` without calling `updateInboxData` (which applies the sort).

### Bug 2 — Ghost Conversations

1. **Eager conversation creation**: `ensureDirectConversationV2` is called when the user navigates to the chat view (on profile tap), not when the first message is sent. The `getOrCreateDMConversation()` Postgres function creates the conversation record immediately.

2. **No server-side filter**: The `getConversations` query in `_all.ts` does not filter out conversations where `last_message_id IS NULL`, so empty conversations are returned in the inbox page.

### Bug 3 — Reaction Inconsistency

1. **JSONB-only updates invisible to real-time**: Supabase `postgres_changes` subscription fires on row-level changes. When reactions are stored as `metadata.reactionSummary` JSONB on the `messages` table, an UPDATE to only the `metadata` column may not reliably trigger the subscription (known Supabase limitation with JSONB-only updates).

2. **No optimistic mutation pattern**: The current reaction toggle likely calls a mutation and then relies on `invalidateQueries` or real-time to update the UI, causing a visible delay. There is no `onMutate` → optimistic patch → `onError` rollback pattern.

3. **No per-user attribution**: The `MessageReactionSummary` type stores `{emoji, count, viewerReacted}` without tracking which users reacted, making it impossible to show a reaction detail sheet in group conversations.

## Correctness Properties

Property 1: Bug Condition — Timestamp Updates on Message Events

_For any_ messaging event where a new message is sent (optimistic or confirmed) or received via real-time INSERT, the fixed cache patching SHALL update the inbox conversation's `updatedAt` and `lastMessage.createdAt` to reflect the message's timestamp, AND the inbox list SHALL re-sort so the conversation appears at the correct position (top for newest).

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Bug Condition — Ghost Conversation Prevention

_For any_ navigation event where a user opens a DM chat without sending a message, the fixed system SHALL NOT create a database conversation record, AND the inbox query SHALL exclude conversations where no message has been sent (`last_message_id IS NULL`).

**Validates: Requirements 2.4, 2.5**

Property 3: Bug Condition — Reaction Reliability and Attribution

_For any_ reaction toggle event, the fixed system SHALL apply the optimistic update immediately (visible in <16ms frame), persist the reaction in a dedicated `message_reactions` table that Supabase real-time can detect, roll back on error, and provide per-user attribution for group conversation reaction details.

**Validates: Requirements 2.6, 2.7, 2.8, 2.9**

Property 4: Preservation — Existing Conversation Behavior

_For any_ input where the bug condition does NOT hold (existing conversations with messages, non-reaction interactions, direct navigation to existing chats), the fixed code SHALL produce the same result as the original code, preserving historical timestamps, message delivery, inbox sorting, and outbox persistence.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

#### Bug 1 — Stale Timestamps

**File**: `src/lib/messages/v2-cache.ts`

**Function**: `patchConversationLastMessageFromMessage`

**Specific Changes**:
1. **Ensure `updatedAt` is always set from message `createdAt`**: The function already computes `nextUpdatedAtEpoch` via `Math.max(...)` — verify this propagates correctly through `patchThreadConversation` → `patchInboxConversation` → `updateInboxData` which calls `normalizeConversationRows` (the sort).

**File**: `src/hooks/useMessagesV2.ts` (send mutation `onMutate`)

2. **Optimistic timestamp patch on send**: In the send mutation's optimistic update path, after inserting the optimistic message into the thread, call `patchConversationLastMessageFromMessage` with the optimistic message's `createdAt` (set to `new Date()`) so the inbox immediately reflects the new timestamp and re-sorts.

**File**: `src/hooks/useMessagesV2Realtime.ts` (INSERT handler)

3. **Real-time INSERT timestamp propagation**: After calling `upsertThreadMessage`, ensure `patchConversationLastMessageFromMessage` is called with the incoming message so the inbox conversation's `updatedAt` and `lastMessage.createdAt` are updated and the list re-sorts.

#### Bug 2 — Ghost Conversations

**File**: `src/app/actions/messaging/v2.ts`

**Function**: `ensureDirectConversationV2` → refactor callers

**Specific Changes**:
1. **Defer `getOrCreateDMConversation()`**: Remove the call to `ensureDirectConversationV2` from the "open chat" navigation path. Instead, return a draft conversation object with the target user's profile info but no database ID.

2. **Create on first send**: In `sendConversationMessageV2`, when `conversationId` is null and `targetUserId` is provided, call `ensureDirectConversationV2` at that point (this path already exists — just ensure the navigation path no longer calls it eagerly).

**File**: `src/app/actions/messaging/_all.ts`

**Function**: `getConversations`

3. **Server-side filter**: Add `AND cp.last_message_id IS NOT NULL` to the WHERE clause of the inbox query to exclude empty conversations.

**File**: `src/components/chat/v2/ConversationListV2.tsx`

4. **Client-side safety net**: In the `filteredConversations` memo, add a filter: `conversation.lastMessage != null` to skip rendering conversations without a last message (guards against race conditions).

**File**: `src/stores/messagesV2OutboxStore.ts`

5. **Support draft sends**: The outbox already supports `targetUserId` for deferred conversation creation — no changes needed to the store itself, but the UI layer that enqueues items must pass `targetUserId` instead of `conversationId` for draft conversations.

#### Bug 3 — Reaction Inconsistency

**File**: `drizzle/0004_message_reactions.sql` (new migration)

**Specific Changes**:
1. **Create `message_reactions` table**:
   ```sql
   CREATE TABLE IF NOT EXISTS message_reactions (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
       user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
       emoji TEXT NOT NULL,
       created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
       UNIQUE(message_id, user_id, emoji)
   );
   ```
   Add RLS policies, indexes, and add to `supabase_realtime` publication.

**File**: `src/app/actions/messaging/v2.ts` (or new `reactions-v2.ts`)

2. **Server action `toggleReactionV2`**: INSERT or DELETE from `message_reactions` table. Recompute `metadata.reactionSummary` on the message row for backward compatibility.

**File**: `src/hooks/useMessagesV2.ts`

3. **Optimistic mutation pattern**: Implement `useToggleReaction` mutation with:
   - `onMutate`: Call `patchThreadMessage` to apply `toggleMessageReactionSummary` optimistically, save previous state for rollback
   - `onError`: Restore previous message state via `patchThreadMessage`
   - `onSettled`: Optionally invalidate to sync

**File**: `src/hooks/useMessagesV2Realtime.ts`

4. **Real-time subscription for `message_reactions`**: Subscribe to INSERT/DELETE on `message_reactions` table. On events from other users, recompute the reaction summary for the affected message and patch the thread cache.

**File**: `src/lib/messages/reactions.ts`

5. **Extend reaction types**: Add `MessageReactionDetail` type with `userId`, `username`, `avatarUrl` for the reaction detail sheet. Add `buildReactionDetails` function.

**File**: New component `src/components/chat/v2/ReactionDetailSheet.tsx`

6. **Reaction detail sheet**: Bottom sheet component that displays per-emoji user lists (avatar + name) for group conversations. Triggered by long-press on a reaction pill.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write unit tests that simulate the cache patching, conversation creation, and reaction flows. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Timestamp — Optimistic Send**: Simulate sending a message via the outbox and assert that the inbox conversation's `updatedAt` matches the message's `createdAt` (will fail on unfixed code)
2. **Timestamp — Real-time INSERT**: Simulate a real-time INSERT event and assert that `patchConversationLastMessageFromMessage` updates both preview AND timestamp (will fail on unfixed code)
3. **Timestamp — Sort Position**: After patching a conversation's timestamp, assert it moves to position 0 in the sorted list (will fail on unfixed code)
4. **Ghost — Eager Creation**: Call the "open chat" flow without sending a message and assert no database record is created (will fail on unfixed code)
5. **Ghost — Inbox Filter**: Insert a conversation with `last_message_id = NULL` and assert it does not appear in `getConversations` results (will fail on unfixed code)
6. **Reaction — Optimistic Visibility**: Toggle a reaction and assert the UI state updates within the same tick (will fail on unfixed code)
7. **Reaction — Real-time Detection**: Insert a row into `message_reactions` and assert the subscription fires (will fail on unfixed code — table doesn't exist yet)

**Expected Counterexamples**:
- Inbox conversation `updatedAt` remains stale after optimistic send
- `getConversations` returns conversations with null `last_message_id`
- Reaction toggle does not update cache until refetch completes
- Possible causes: missing `patchConversationLastMessageFromMessage` call in optimistic path, no WHERE filter on `last_message_id`, no `onMutate` in reaction mutation

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  IF input.type IN ['MESSAGE_SENT', 'REALTIME_INSERT'] THEN
    result := patchConversationLastMessageFromMessage_fixed(input)
    ASSERT result.conversation.updatedAt == input.message.createdAt
    ASSERT inboxSortPosition(result.conversationId) == 0
  END IF

  IF input.type == 'DM_OPENED' AND input.messageCount == 0 THEN
    result := openDMChat_fixed(input.targetUserId)
    ASSERT NOT conversationExistsInDatabase(result)
    ASSERT NOT appearsInInbox(result)
  END IF

  IF input.type == 'REACTION_TOGGLED' THEN
    result := toggleReaction_fixed(input.messageId, input.emoji)
    ASSERT reactionVisibleImmediately(result)
    ASSERT reactionPersistedInTable(input.messageId, input.emoji)
    ASSERT reactionHasUserAttribution(input.messageId, input.emoji, input.userId)
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed functions produce the same result as the original functions.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many conversation states and message configurations automatically
- It catches edge cases in timestamp sorting that manual tests might miss
- It provides strong guarantees that inbox ordering is unchanged for non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for existing conversations, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Timestamp Preservation**: For conversations where no new message is sent, verify `updatedAt` and sort position remain unchanged after the fix
2. **Inbox Content Preservation**: For conversations with at least one message, verify they continue to appear in the inbox after adding the `last_message_id IS NOT NULL` filter
3. **Existing Chat Navigation**: For conversations that already have messages, verify navigation loads directly without draft state
4. **Reaction Display Preservation**: For 1:1 conversations, verify existing reaction display (emoji + count) continues to work
5. **Outbox Persistence**: Verify outbox items with `targetUserId` continue to persist and migrate correctly

### Unit Tests

- Test `patchConversationLastMessageFromMessage` updates `updatedAt` and triggers re-sort
- Test `normalizeConversationRows` correctly sorts after timestamp patch
- Test `getConversations` excludes `last_message_id IS NULL` conversations
- Test `toggleMessageReactionSummary` produces correct optimistic state
- Test `buildReactionSummaryByMessage` correctly aggregates per-user reactions
- Test draft conversation state transitions (draft → active on first send)
- Test optimistic reaction rollback on error

### Property-Based Tests

- Generate random inbox states (varying `updatedAt` values) and verify `normalizeConversationRows` always produces descending order after timestamp patches
- Generate random conversation sets with/without messages and verify the filter correctly partitions them
- Generate random reaction toggle sequences and verify `toggleMessageReactionSummary` maintains invariants (count ≥ 0, no duplicate emojis, `viewerReacted` consistency)
- Generate random message events and verify `patchConversationLastMessageFromMessage` always advances (never regresses) the `updatedAt` field

### Integration Tests

- End-to-end test: Send a message and verify the conversation moves to the top of the inbox list within one render cycle
- End-to-end test: Open a DM from a profile, navigate away without sending, verify no conversation appears in inbox
- End-to-end test: Toggle a reaction in a group chat, verify it appears immediately, then verify another user sees it via real-time
- End-to-end test: Verify the reaction detail sheet shows correct user attribution in group conversations
- End-to-end test: Verify backward compatibility — old messages with JSONB `reactionSummary` still display correctly after migration
