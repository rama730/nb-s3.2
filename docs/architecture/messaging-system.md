# Messaging System

This document is the ownership map for the messaging surface. The intended rule is simple: page and popup shells compose features, hooks own client state and synchronization, server actions own authorization and writes, and `src/lib/messages` owns reusable domain logic.

## Canonical Runtime Flow

```text
/messages or chat popup
  -> MessagesWorkspaceV2 / ChatPopupV2
  -> useMessagesV2 (React Query) + messagesV2 stores
  -> app/actions/messaging/v2.ts
  -> canonical actions in _all.ts, features.ts, collaboration.ts, linked-work.ts
  -> Drizzle schema + Postgres/RLS
  -> useMessagesV2Realtime + presence client
  -> query cache reconciliation
```

The media path is deliberately narrower:

```text
file selection/drop/paste
  -> useMessageComposerAttachments
  -> image compression + media dimension extraction
  -> uploadAttachment
  -> private chat-attachments bucket + attachment_uploads lifecycle row
  -> sendMessageWithAttachments transaction + message_attachments row
  -> authenticated attachment access route
  -> message-attachments.tsx (contain, never crop)
```

## Source Inventory

### Entrypoints and runtime providers

- `src/app/(main)/messages/page.tsx` renders the full page surface.
- `src/components/providers/MainRuntimeProviders.tsx` mounts messaging outbox synchronization and shared runtime providers.
- `src/components/chat/ChatProvider.tsx` owns popup chat state.
- `src/components/chat/TypingIndicator.tsx` is the shared typing presentation.
- `src/components/chat/index.ts` is the public component barrel.

### Messaging UI

The canonical UI folder is `src/components/chat/v2`:

- Shells: `MessagesClientV2.tsx`, `MessagesWorkspaceV2.tsx`, `ChatPopupV2.tsx`.
- Conversation navigation: `ConversationHeaderV2.tsx`, `ConversationListV2.tsx`, `NewMessageModalV2.tsx`, `ProjectGroupsListV2.tsx`, `ApplicationsListV2.tsx`.
- Thread: `MessageThreadV2.tsx`, `MessageBubbleV2.tsx`, `ScrollToBottomFab.tsx`, `EmptyConversation.tsx`, `MessagesSurfaceSkeletons.tsx`.
- Message content: `message-rendering.tsx`, `message-attachments.tsx`, `LinkPreviewCard.tsx`, `StructuredMessageCardV2.tsx`, `ApplicationSystemCardV2.tsx`, `MessageContextChipRowV2.tsx`.
- Composer: `MessageComposerV2.tsx`, `ComposerAttachmentsPanel.tsx`, `ComposerContextPanel.tsx`, `ComposerFirstContactGuidance.tsx`, `ComposerReplyBanner.tsx`, `ComposerSlashMenu.tsx`, `ComposerWorkflowNotice.tsx`, `DropZoneOverlay.tsx`, `MentionDropdown.tsx`, `message-composer-v2-shared.ts`, `useMessageComposerActions.ts`, `useMessageComposerAttachments.ts`, `useMessageComposerCommands.ts`.
- Reactions, receipts, and moderation: `ReactionQuickBar.tsx`, `ReactionPillRow.tsx`, `ReactionDetailSheet.tsx`, `ReadReceiptPopover.tsx`, `ReportMessageDialog.tsx`.

### Client data, state, and synchronization

- Primary queries and mutations: `src/hooks/useMessagesV2.ts`.
- Durable realtime reconciliation: `src/hooks/useMessagesV2Realtime.ts`.
- Offline/outbox replay: `src/hooks/useMessagesV2OutboxSync.ts`, `src/stores/messagesV2OutboxStore.ts`.
- UI selection, filters, drafts, and tabs: `src/stores/messagesV2UiStore.ts`.
- Thread anchoring and virtualization: `src/hooks/useMessageThreadAnchor.ts`.
- Read/delivery acknowledgement: `src/hooks/useMarkMessagesRead.ts`, `src/hooks/useDeliveryAcks.ts`.
- Attention/unread model: `src/hooks/useMessageAttentionState.ts`.
- Linked work: `src/hooks/useMessageWorkLinks.ts`.
- Typing: `src/hooks/useChatTypingState.ts`, `src/hooks/useConversationTypingIndex.ts`, `src/hooks/useTypingChannel.ts`.
- Presence: `src/hooks/usePresenceHealth.ts`, `src/hooks/usePresenceStatus.ts`, `src/hooks/usePublishOnlinePresence.ts`.
- Shortcuts and supporting reads: `src/hooks/useMessagingShortcuts.ts`, `src/hooks/useLinkPreview.ts`.

### Server actions

The server action folder is `src/app/actions/messaging`:

- `index.ts` is the public server-action barrel.
- `v2.ts` exposes the current page/query contract and delegates to canonical actions.
- `_all.ts` owns core conversation, message, attachment, search, pin, edit, and delete operations.
- `features.ts` is the single implementation for reactions, reports, receipts, and conversation pinning.
- `collaboration.ts` owns structured messages, workflow resolution, task conversion, and follow-ups.
- `linked-work.ts` owns message-to-task/file/decision link reads and writes.

`reactions-v2.ts` was removed because it duplicated the same authorization, table writes, and metadata reconciliation already owned by `features.ts`.

`BulkActionsBar.tsx` and its thread state were removed because no UI path could enter selection mode; retaining the unreachable branch also kept duplicate delete/copy handling alive in the thread shell.

### APIs, storage, and presence

- `src/app/api/v1/messages/attachments/[attachmentId]/route.ts` authorizes and streams private attachments. Image previews are width-bounded and retain the original aspect ratio.
- `src/app/api/realtime/presence-token/route.ts` issues ephemeral presence credentials.
- `src/lib/realtime/presence-client.ts`, `presence-config.ts`, `presence-health.ts`, `presence-token.ts`, and `presence-types.ts` own the typing/presence transport.
- `src/lib/realtime/subscriptions.ts` is the durable Supabase subscription boundary.
- `services/presence/src/server.ts` is the dedicated ephemeral WebSocket service.
- Supabase Storage bucket: `chat-attachments` (private).

### Messaging domain modules

The reusable domain folder is `src/lib/messages`:

- Attachments/media: `attachment-access.ts`, `image-compression.ts`, `media-metadata.ts`.
- Rendering and previews: `code-snippets.ts`, `preview.ts`, `preview-authority.ts`, `reply-preview.ts`, `safe-links.ts`.
- Thread/cache lifecycle: `thread-items.ts`, `utils.ts`, `v2-cache.ts`, `v2-refresh.ts`, `v2-render-state.ts`.
- Delivery and attention: `attention.ts`, `delivery-state.ts`, `realtime-sender.ts`, `notification-sound.ts`.
- Reactions: `reactions.ts`.
- Structured and linked work: `structured.ts`, `linked-work.ts`, `linked-work-server.ts`.
- Search and grouping: `search-document.ts`, `date-buckets.ts`.

Supporting chat-domain modules live in `src/lib/chat`: `application-events.ts`, `banner-lifecycle.ts`, `composer-workflow.tsx`, `contracts.ts`, `typing-display.ts`, and `typing-state.ts`.

### Database ownership

`src/lib/db/schema/index.ts` is authoritative for:

- `conversations`, `dm_pairs`, and `conversation_participants`;
- `messages`, `message_attachments`, and `attachment_uploads`;
- `message_reactions`, `message_reports`, `message_read_receipts`, and `message_delivery_receipts`;
- `message_hidden_for_users`, `message_edit_logs`, `message_workflow_items`, and `message_work_links`.

Messaging database history is carried by the following migrations:

- Foundation/storage: `0003_messaging.sql`, `0003_ambitious_skin.sql`, `0004_chat_storage.sql`, `0004_message_reactions.sql`.
- Indexes/typing/application links: `0006_messages_performance_indexes.sql`, `0007_typing_indicators.sql`, `0018_role_applications_message_and_constraints.sql`.
- RLS/realtime/reliability: `0019_messaging_rls_and_realtime.sql`, `0020_dm_pairs.sql`, `0020_damp_shatterstar.sql`, `0021_add_project_conversation_id.sql`, `0022_messaging_reliability_and_scale.sql`.
- Attachments/actions/replies: `0023_message_attachments_storage_path.sql`, `0024_attachment_upload_sessions.sql`, `0025_message_actions_edit_delete.sql`, `0030_message_reply_and_preview.sql`.
- Scale/collaboration/receipts: `0053_database_partitioning.sql`, `0059_messaging_reactions_reports_receipts.sql`, `0060_messaging_collaboration_foundation.sql`, `0064_messaging_reactions_reports_receipts_rls.sql`, `0066_message_delivery_receipts.sql`, `0067_read_receipts_conversation_id.sql`.
- Notifications/scoping/optimization/hardening: `0072_user_notifications.sql`, `0073_message_reactions_conversation_scope.sql`, `0074_v2_schema_optimizations.sql`, `0075_review_optimization_indexes.sql`, `0078_public_rls_security_hardening.sql`.

`supabase-setup.sql` mirrors the deployable RLS/policy state. Historical migrations are append-only and should not be edited to change current runtime behavior.

### Cross-system dependencies

- Applications and connections can create or update conversations through `src/app/actions/applications/internal.ts` and `src/app/actions/connections.ts`.
- Notification emission and read state use `src/app/actions/notifications.ts` and `src/lib/notifications/*`.
- Structured messages integrate with project membership, tasks, files, and collaborator lifecycle through `src/lib/projects/*`, `src/lib/files/*`, and `src/lib/notifications/*`.
- Account deletion and retention cleanup touch messaging rows through `src/lib/account/hard-delete.ts` and `src/inngest/functions/account-cleanup.ts`.

### Direct package dependencies

- Next.js and React: page/server-action/runtime and component state.
- `@tanstack/react-query`: inbox/thread queries, mutations, optimistic reconciliation, and invalidation.
- `react-virtuoso`: virtualized message thread rendering.
- `@supabase/supabase-js`: Storage, Realtime, auth, and signed access.
- `drizzle-orm`: typed Postgres reads, writes, transactions, and schema.
- `zustand`: outbox and UI stores.
- `idb-keyval`: persisted inbox/thread cache support.
- `sonner`: user-visible operation feedback.
- `lucide-react`: messaging controls and status icons.
- `date-fns`: date groups and message timestamps.

## Media Invariants

1. The stored source is never cropped or rewritten for chat layout.
2. Preview transforms set a maximum width only; no fixed preview height is allowed.
3. Image natural dimensions and video metadata are captured before upload and persisted on `message_attachments`.
4. Legacy rows without dimensions recover them from the loaded media element.
5. Inline and modal media use `object-contain`; avatar and link-preview crops are separate presentation concerns.
6. Media can scale down to fit `320 x 360` inline, but it is never stretched or upscaled.
7. Multiple attachments are stacked as complete frames instead of being cropped into a mosaic.

## Validation Ownership

- Pure dimension and bounding behavior: `tests/unit/message-media-metadata.test.ts`.
- UI/storage no-crop contract: `tests/unit/message-bubble-layout-contract.test.ts`.
- Cache/realtime/thread behavior: `tests/unit/messages-v2-cache.test.ts`, `messages-v2-render-state.test.ts`, `message-thread-anchor.test.ts`, `message-thread-items.test.ts`, `realtime-sender.test.ts`.
- Reactions/receipts/unread: `tests/unit/message-reactions.test.ts`, `messaging-unread-contract.test.ts`, `reaction-inconsistency-bug-condition.test.ts`, `reaction-preservation.test.ts`.
- End-to-end surfaces: `tests/e2e/messaging-smoke.spec.ts`, `messages-tabs-matrix.spec.ts`, and `messaging-unread-rebound.spec.ts`.

## Decomposition Boundaries

The media path and reaction mutation have single owners. New server logic must land in responsibility-specific modules (conversation, message, attachment, search, workflow, or linked work), while `_all.ts` remains compatibility-only until all legacy imports have migrated. New database consumers should import from a domain schema barrel rather than adding cross-domain coupling to the root schema module.
