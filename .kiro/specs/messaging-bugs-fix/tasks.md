# Implementation Plan

## Overview

This task list implements fixes for three messaging bugs in priority order: (1) ghost conversations (simplest — server-side filter + defer creation), (2) stale timestamps (cache patching + sort), and (3) reaction inconsistency (most complex — new table, migration, optimistic pattern, detail sheet). Each bug follows the exploratory bugfix workflow: write tests before fix, preserve existing behavior, implement, then validate.

## Tasks

- [x] 1. Write bug condition exploration test — Ghost Conversations
  - **Property 1: Bug Condition** - Ghost Conversation Creation on DM Open
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **GOAL**: Surface counterexamples that demonstrate ghost conversations are created when a user opens a DM without sending a message
  - **Scoped PBT Approach**: Scope the property to the concrete failing case: user taps "Message" on a profile, navigates to chat view, then navigates away without sending
  - Test that opening a DM chat without sending a message does NOT create a database conversation record (from Bug Condition in design: `input.type == 'DM_OPENED' AND input.messageCount == 0 AND conversationExistsInDatabase(input.conversationId)`)
  - Test that `getConversations` excludes conversations where `last_message_id IS NULL`
  - Run test on UNFIXED code — expect FAILURE (confirms ghost conversations are eagerly created and appear in inbox)
  - Document counterexamples found (e.g., "`ensureDirectConversationV2` creates a DB record immediately on navigation; `getConversations` returns conversations with null `last_message_id`")
  - _Requirements: 2.4, 2.5_

- [x] 2. Write preservation property tests — Ghost Conversations (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Conversation Navigation and Inbox Display
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: Navigating to an existing conversation (with messages) loads directly without draft state
  - Observe: Conversations with at least one message continue to appear in the inbox list
  - Observe: Outbox items with `targetUserId` continue to persist and migrate correctly
  - Write property-based test: for all conversations where `last_message_id IS NOT NULL`, they continue to appear in `getConversations` results
  - Write property-based test: for all existing conversations with messages, navigation loads directly without draft state
  - Verify tests pass on UNFIXED code
  - _Requirements: 3.3, 3.4, 3.8_

- [x] 3. Fix for Ghost Conversations

  - [x] 3.1 Add server-side filter to exclude empty conversations
    - In `src/app/actions/messaging/_all.ts`, add `AND cp.last_message_id IS NOT NULL` to the WHERE clause of `getConversations` query
    - This prevents empty conversations from appearing in inbox results
    - _Bug_Condition: isBugCondition(input) where input.type == 'DM_OPENED' AND input.messageCount == 0 AND conversationExistsInDatabase(input.conversationId)_
    - _Expected_Behavior: getConversations excludes conversations where last_message_id IS NULL_
    - _Preservation: Conversations with at least one message continue to appear in inbox (Req 3.4)_
    - _Requirements: 2.5_

  - [x] 3.2 Defer conversation creation until first message send
    - Remove the call to `ensureDirectConversationV2` from the "open chat" navigation path
    - Return a draft conversation object with target user's profile info but no database ID
    - In `sendConversationMessageV2`, when `conversationId` is null and `targetUserId` is provided, call `ensureDirectConversationV2` at that point
    - Update UI layer to pass `targetUserId` instead of `conversationId` for draft conversations
    - _Bug_Condition: isBugCondition(input) where input.type == 'DM_OPENED' AND input.messageCount == 0_
    - _Expected_Behavior: No database record created until first message is sent_
    - _Preservation: Outbox store targetUserId support unchanged (Req 3.8)_
    - _Requirements: 2.4_

  - [x] 3.3 Add client-side safety net filter
    - In `src/components/chat/v2/ConversationListV2.tsx`, add filter in `filteredConversations` memo: `conversation.lastMessage != null`
    - Guards against race conditions where server filter hasn't applied yet
    - _Requirements: 2.5_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Ghost Conversation Prevention
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (no DB record on DM open, no empty conversations in inbox)
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms ghost conversations are prevented)
    - _Requirements: 2.4, 2.5_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Conversation Navigation and Inbox Display
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions for existing conversations)
    - Confirm existing conversations with messages still appear in inbox and navigate correctly

- [x] 4. Checkpoint — Ghost Conversations
  - Ensure all ghost conversation tests pass
  - Verify no regressions in conversation list rendering
  - Ask the user if questions arise

- [x] 5. Write bug condition exploration test — Stale Timestamps
  - **Property 1: Bug Condition** - Timestamp Staleness on Message Events
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **GOAL**: Surface counterexamples that demonstrate timestamps remain stale after message send/receive
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: (a) optimistic send does not update inbox `updatedAt`, (b) real-time INSERT does not propagate timestamp, (c) conversation does not re-sort to top
  - Test that after sending a message (optimistic outbox insert), the inbox conversation's `updatedAt` and `lastMessage.createdAt` match the message's `createdAt` (from Bug Condition: `input.type == 'MESSAGE_SENT' AND inboxConversation.lastMessage.createdAt != input.message.createdAt`)
  - Test that after a real-time INSERT event, `patchConversationLastMessageFromMessage` updates both preview AND timestamp
  - Test that after timestamp patch, `normalizeConversationRows` re-sorts the conversation to position 0
  - Run test on UNFIXED code — expect FAILURE (confirms timestamps remain stale and sort is not triggered)
  - Document counterexamples found (e.g., "inbox `updatedAt` remains at old value after optimistic send; conversation stays at old sort position")
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 6. Write preservation property tests — Stale Timestamps (BEFORE implementing fix)
  - **Property 2: Preservation** - Historical Timestamp and Sort Stability
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: Conversations with existing messages and no new activity retain their correct historical timestamps
  - Observe: Inbox list sorts by `updatedAt` descending via `normalizeConversationRows`
  - Observe: Sending a message in an existing conversation continues to deliver and show delivery indicators
  - Write property-based test: for all conversations where no new message is sent, `updatedAt` and sort position remain unchanged after cache operations
  - Write property-based test: generate random inbox states (varying `updatedAt` values) and verify `normalizeConversationRows` always produces descending order
  - Write property-based test: `patchConversationLastMessageFromMessage` never regresses `updatedAt` (always advances or stays same)
  - Verify tests pass on UNFIXED code
  - _Requirements: 3.1, 3.2, 3.7_

- [x] 7. Fix for Stale Timestamps

  - [x] 7.1 Patch `patchConversationLastMessageFromMessage` to propagate `updatedAt`
    - In `src/lib/messages/v2-cache.ts`, verify that `nextUpdatedAtEpoch` from `Math.max(...)` propagates correctly through `patchThreadConversation` → `patchInboxConversation` → `updateInboxData` → `normalizeConversationRows`
    - Ensure the function sets both `updatedAt` and `lastMessage.createdAt` from the message's `createdAt`
    - _Bug_Condition: isBugCondition(input) where input.type IN ['MESSAGE_SENT', 'REALTIME_INSERT'] AND inboxConversation.lastMessage.createdAt != input.message.createdAt_
    - _Expected_Behavior: conversation.updatedAt == input.message.createdAt AND inboxSortPosition == 0_
    - _Preservation: Historical timestamps for conversations with no new messages remain unchanged (Req 3.1)_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 7.2 Add optimistic timestamp patch on send
    - In `src/hooks/useMessagesV2.ts` send mutation `onMutate`, after inserting the optimistic message into the thread, call `patchConversationLastMessageFromMessage` with the optimistic message (set `createdAt` to `new Date()`)
    - This ensures the inbox immediately reflects the new timestamp and re-sorts
    - _Bug_Condition: isBugCondition(input) where input.type == 'MESSAGE_SENT'_
    - _Expected_Behavior: Inbox conversation updatedAt matches optimistic message createdAt immediately_
    - _Requirements: 2.1_

  - [x] 7.3 Ensure real-time INSERT handler propagates timestamp
    - In `src/hooks/useMessagesV2Realtime.ts` INSERT handler, after calling `upsertThreadMessage`, ensure `patchConversationLastMessageFromMessage` is called with the incoming message
    - This updates the inbox conversation's `updatedAt` and `lastMessage.createdAt` and triggers re-sort
    - _Bug_Condition: isBugCondition(input) where input.type == 'REALTIME_INSERT'_
    - _Expected_Behavior: Inbox conversation updatedAt matches real-time message createdAt_
    - _Requirements: 2.2, 2.3_

  - [x] 7.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Timestamp Updates on Message Events
    - **IMPORTANT**: Re-run the SAME test from task 5 — do NOT write a new test
    - The test from task 5 encodes the expected behavior (timestamps update, sort triggers)
    - Run bug condition exploration test from step 5
    - **EXPECTED OUTCOME**: Test PASSES (confirms timestamps update correctly)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 7.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Historical Timestamp and Sort Stability
    - **IMPORTANT**: Re-run the SAME tests from task 6 — do NOT write new tests
    - Run preservation property tests from step 6
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions for historical timestamps and sort order)
    - Confirm all tests still pass after fix (no regressions)

- [x] 8. Checkpoint — Stale Timestamps
  - Ensure all timestamp-related tests pass
  - Verify inbox sort order is correct after send and real-time events
  - Ask the user if questions arise

- [x] 9. Write bug condition exploration test — Reaction Inconsistency
  - **Property 1: Bug Condition** - Reaction Toggle Visibility and Persistence
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **GOAL**: Surface counterexamples that demonstrate reactions are delayed, missing, or lack attribution
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: (a) reaction toggle does not update cache optimistically, (b) JSONB-only update does not fire real-time event, (c) reaction summary lacks per-user attribution
  - Test that toggling a reaction immediately updates the local thread cache (from Bug Condition: `input.type == 'REACTION_TOGGLED' AND reactionNotVisibleAfterToggle`)
  - Test that `toggleMessageReactionSummary` produces correct optimistic state with proper count and `viewerReacted` flag
  - Test that reaction data includes user attribution (userId, emoji) for group conversation detail display
  - Run test on UNFIXED code — expect FAILURE (confirms reactions are delayed/missing and lack attribution)
  - Document counterexamples found (e.g., "reaction toggle does not patch cache optimistically; no `message_reactions` table exists; no per-user attribution in reaction summary")
  - _Requirements: 2.6, 2.7, 2.8, 2.9_

- [x] 10. Write preservation property tests — Reactions (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Reaction Display Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: `toggleMessageReactionSummary` correctly computes next state (add/remove emoji, update count, toggle `viewerReacted`)
  - Observe: Reactions in 1:1 conversations show emoji + count on message bubbles
  - Observe: Real-time reactions from other users update the display for all participants
  - Write property-based test: for all reaction toggle sequences, `toggleMessageReactionSummary` maintains invariants (count ≥ 0, no duplicate emojis per user, `viewerReacted` consistency)
  - Write property-based test: for all non-buggy reaction states (existing 1:1 reactions), display continues to show emoji + count
  - Verify tests pass on UNFIXED code
  - _Requirements: 3.5, 3.6_

- [x] 11. Fix for Reaction Inconsistency

  - [x] 11.1 Create `message_reactions` table migration
    - Create `drizzle/0004_message_reactions.sql` with: `id UUID PK`, `message_id UUID FK → messages(id) ON DELETE CASCADE`, `user_id UUID FK → profiles(id) ON DELETE CASCADE`, `emoji TEXT NOT NULL`, `created_at TIMESTAMPTZ DEFAULT NOW()`
    - Add UNIQUE constraint on `(message_id, user_id, emoji)`
    - Add indexes on `message_id` and `(message_id, emoji)`
    - Add RLS policies for authenticated users
    - Add table to `supabase_realtime` publication
    - _Bug_Condition: Supabase postgres_changes does not reliably fire for JSONB-only updates_
    - _Expected_Behavior: Row-level changes in dedicated table are reliably detected by real-time_
    - _Requirements: 2.8_

  - [x] 11.2 Implement `toggleReactionV2` server action
    - Create server action in `src/app/actions/messaging/reactions-v2.ts`
    - INSERT or DELETE from `message_reactions` table based on toggle state
    - Recompute `metadata.reactionSummary` on the message row for backward compatibility
    - _Bug_Condition: isBugCondition(input) where input.type == 'REACTION_TOGGLED'_
    - _Expected_Behavior: Reaction persisted in dedicated table with per-user attribution_
    - _Preservation: Backward-compatible reactionSummary JSONB still updated for existing consumers_
    - _Requirements: 2.8_

  - [x] 11.3 Implement optimistic mutation pattern for reactions
    - In `src/hooks/useMessagesV2.ts`, implement `useToggleReaction` mutation with:
      - `onMutate`: Call `patchThreadMessage` to apply `toggleMessageReactionSummary` optimistically, save previous state for rollback
      - `onError`: Restore previous message state via `patchThreadMessage`
      - `onSettled`: Optionally invalidate to sync
    - Do NOT rely on real-time for the sender's own reaction
    - _Bug_Condition: reactionDelayedByStaleRefetch(input.messageId)_
    - _Expected_Behavior: Reaction visible immediately (<16ms frame) via optimistic update_
    - _Requirements: 2.6, 2.7_

  - [x] 11.4 Add real-time subscription for `message_reactions` table
    - In `src/hooks/useMessagesV2Realtime.ts`, subscribe to INSERT/DELETE on `message_reactions` table
    - On events from OTHER users (filter out own userId), recompute reaction summary for affected message and patch thread cache
    - _Expected_Behavior: Other users' reactions sync via reliable row-level real-time events_
    - _Requirements: 2.7_

  - [x] 11.5 Extend reaction types and add `buildReactionDetails`
    - In `src/lib/messages/reactions.ts`, add `MessageReactionDetail` type with `userId`, `username`, `avatarUrl`
    - Add `buildReactionDetails` function that aggregates per-user reaction data from `message_reactions` rows
    - _Expected_Behavior: Per-user attribution available for group conversation reaction details_
    - _Requirements: 2.9_

  - [x] 11.6 Create ReactionDetailSheet component
    - Create `src/components/chat/v2/ReactionDetailSheet.tsx` — bottom sheet component
    - Display per-emoji user lists (avatar + name) for group conversations
    - Trigger on long-press or double-tap on a reaction pill
    - Each reaction pill displays the count
    - _Expected_Behavior: User can see who reacted and total count per reaction in group conversations_
    - _Requirements: 2.9_

  - [x] 11.7 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Reaction Toggle Visibility and Persistence
    - **IMPORTANT**: Re-run the SAME test from task 9 — do NOT write a new test
    - The test from task 9 encodes the expected behavior (optimistic update, table persistence, attribution)
    - Run bug condition exploration test from step 9
    - **EXPECTED OUTCOME**: Test PASSES (confirms reactions are reliable and attributed)
    - _Requirements: 2.6, 2.7, 2.8, 2.9_

  - [x] 11.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Reaction Display Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 10 — do NOT write new tests
    - Run preservation property tests from step 10
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions for existing reaction display)
    - Confirm 1:1 reaction display and real-time sync still work correctly

- [x] 12. Checkpoint — Reaction Inconsistency
  - Ensure all reaction-related tests pass
  - Verify optimistic updates, real-time sync, and detail sheet work correctly
  - Verify backward compatibility with existing JSONB reactionSummary data
  - Ask the user if questions arise

- [x] 13. Checkpoint — Full Integration
  - Run all property-based tests across all three bug fixes
  - Run existing test suite to confirm no regressions
  - Verify all three bugs are resolved end-to-end:
    - Sending a message updates timestamp and re-sorts inbox
    - Opening a DM without sending does not create ghost conversation
    - Toggling a reaction appears immediately with proper attribution
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Property-based tests use the observation-first methodology: observe behavior on unfixed code, then write tests capturing that behavior
- Bug condition exploration tests are expected to FAIL on unfixed code (this confirms the bug exists) and PASS after the fix
- Preservation tests are expected to PASS on both unfixed and fixed code (confirming no regressions)
- The reaction fix includes a backward-compatible JSONB `reactionSummary` update for existing consumers during the migration period
- Draft conversation state is client-only — no database record until first message send
