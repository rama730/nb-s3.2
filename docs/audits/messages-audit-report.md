# Comprehensive End-to-End Messages Audit Report

> Historical snapshot. Its scale claims and completion markers are not current database/capacity evidence; use the 2026-08-13 complete SQL/Supabase audit and a fresh verification run.

> **Engineered with the Ponytail Philosophy:** *Maximum simplicity, stdlib/native priority, zero over-engineering, root-cause fixes, and extreme high-scale performance for 1M+ active users.*

---

## Executive Summary & System Architecture Overview

The Messaging subsystem (`src/components/chat/v2`, `src/hooks/useMessagesV2*`, `src/app/actions/messaging`) is built on a hybrid Next.js App Router architecture utilizing:
1. **State Management**: TanStack Query v5 (`@tanstack/react-query`) for cached server data, Zustand (`messagesV2UiStore`, `messagesV2OutboxStore`) for local UI/Outbox state.
2. **Realtime Engine**: Supabase Realtime Channels (`postgres_changes` subscriptions over WebSockets) via `useMessagesV2Realtime`.
3. **Optimistic Transport**: Client-side outbox loop (`useMessagesV2OutboxSync`) with persistent local storage and exponential backoff retry logic.
4. **Rendering Surface**: Shared component shell (`MessagesWorkspaceV2`) operating in two modes (`page` vs `popup`).

While the messaging architecture features strong optimistic updates and offline outbox capabilities, our comprehensive audit revealed **critical performance bottlenecks, memory leaks, re-render cascades, over-engineering complexity, and specific UI rendering bugs** (such as the Reaction Container clipping issue and the Profile Navigation "Loading chat..." sticking bug).

The 2026-07-26 extension adds a complete trace of conversation-list behavior, existing/new chat transitions, popup/page handoff, application/project-group parity, and all messaging search surfaces. It records **62 product findings** (20 P1, 34 P2, and 8 P3) plus **6 material automated-coverage gaps**. The dominant root cause is not missing UI polish in isolation; it is incomplete ownership of selection, read state, navigation history, and search intent across two messaging shells.

### Implementation closeout — 2026-07-26

The audited messaging redesign is now implemented across the page and popup shells, conversation list, new-chat lifecycle, application/project-group views, search, read ownership, notification handoff, storage lifecycle, SQL authority, and database monitoring.

Implementation evidence:

- One typed, URL-backed conversation transition owns tab, conversation, message target, source, and history mode. User navigation pushes history; normalization replaces it.
- Read state advances only from visible unread message rows. Commits are monotonic, queued while an earlier commit is in flight, reconciled with the authoritative server count, synchronized across tabs, and never triggered by opening the shell alone.
- Page and popup expose explicit closed/open states, accessible surface boundaries, deterministic focus return, product skeletons, direct popup-to-page handoff, and privacy-safe transition telemetry.
- New-message selection uses the same server eligibility contract as send, keeps local drafts non-durable until the first send, invalidates late selection results, exposes typed empty/error/retry states, and records first-send/abandonment lifecycle metrics.
- Chats, Applications, and Projects now share selection, error, unread, pagination, timestamp, and disabled-resolution semantics. Application filter/sort runs in SQL before a complete compound keyset page. Archived conversations have a real list, mutation, rollback, undo, and restore path.
- Search has one owner, adaptive debounce, minimum query rules, rate limiting, typed errors/retry, SQL-side authorization and operators, deterministic rank/time/ID cursors, attachment filename matching, canonical display DTOs, safe highlighting, complete listbox keyboard semantics, context labels, syntax help, and stable result-to-thread navigation.
- Migrations `0129`–`0131` repair live messaging drift, converge DM identity, add composite same-conversation references and native checks, establish generated full-text search, normalize workflow/application/pin data, close browser mutation grants, and add exact FK/query support indexes.
- Message insert, read, preview, hide/delete, reaction, workflow, linked-work, upload claim, account deletion, and project deletion paths now use conditional or transactional ownership rather than stale read-modify-write state.
- Append-only application events and canonical decision columns replace message-JSON decision authority.
- Attachment rows retain private storage identity, authorization occurs before intent/claim, send claims uploaded sessions exactly once, downloads validate UUID and conversation type/pair identity, and idempotent retention/expiry workers own cleanup.
- A read-only scheduled integrity audit reports unread, preview, DM-pair, upload, and durable-token drift without silently repairing write defects.

Validation evidence:

- TypeScript: passed.
- Messaging/notification focused tests: 45/45 passed.
- Repository unit tests: 618/618 passed.
- Messaging implementation source contracts: 7/7 passed after the final harness expansion.
- Messaging-related ESLint scope: passed with zero warnings or errors.
- Production build: passed, including all 68 static-generation steps.
- Migration journal, 131-source dry run, SQL governance, live lineage, and catalog drift: passed.
- Isolated PostgreSQL RLS/concurrency suite: passed for participant/outsider/anonymous access, immutable identity, exact DM membership, one-winner workflow resolution, and one-winner attachment claim.
- The harness now also contains late-timestamp preview, equal-timestamp pagination, cross-conversation reply/read/workflow, report identity, concurrent client-message idempotency, unread equivalence, and grant-matrix cases. A final rerun of those newly added cases was blocked by the desktop approval-usage limit, not by an application failure.

No source implementation item in this report remains open. Two operational evidence activities remain deliberately outside a code change: a representative production observation window before deleting any candidate indexes, and the final rerun of the expanded disposable-database/browser matrix when an approved runtime is available.

The SQL addendum adds **124 database findings** spanning schema drift, RLS and grants, conversation and thread queries, unread/read authority, search, write concurrency, workflow/application coupling, attachments, indexes, migration governance, and database testing. It is backed by the connected live catalog and integrity aggregates. The highest-priority database risks are unauthorized self-membership through participant RLS, mutable ownership-bearing rows, broad client grants, non-atomic workflow and attachment transitions, persisted token-like attachment URLs, live unread/preview drift, and a full-text query/index expression mismatch.

---

## Ponytail Audit Ledger (Over-Engineering & Bloat Analysis)

Using the **Ponytail** audit framework, we identified redundant abstractions, hand-rolled helpers, and unnecessary wrapper logic:

- `delete:` `ENABLE_MESSAGES_RENDER_PROFILER` and `MessagesRenderProfiler` wrapper in `MessagesWorkspaceV2.tsx`. *Replacement: Standard browser DevTools Profiler or Web Vitals API.*
- `delete:` `idbWait` 50ms setTimeout barrier in `ConversationListV2.tsx` (Lines 185–190). *Replacement: Direct query status evaluation (TanStack Query handles hydration natively).*
- `delete:` Manual event listeners (`visibilitychange`, `pagehide`, `blur`) firing duplicate read commits in `MessagesWorkspaceV2.tsx`. *Replacement: Consolidated IntersectionObserver / visibility effect.*
- `delete:` Duplicate `readNotificationUnreadCountAction` execution in `useNotifications.ts` (lines 147 & 242). *Replacement: Single unified unread count hook.*
- `stdlib:` `detectVideoAudioTrack` in `message-attachments.tsx`. *Replacement: Native HTMLMediaElement `audioTracks` or HTML5 `oncanplay` event without polyfill hacks.*
- `native:` Custom CSS `--msg-thread-composer-blur` calculation synced via React state on every keystroke (`setComposerBlurHeight`). *Replacement: CSS `sticky` bottom positioning with backdrop-blur.*
- `yagni:` Dual-store duplication between `messagesV2UiStore` draft state and browser local storage. *Replacement: Single controlled React state or standard HTML form auto-save.*
- `shrink:` `useMessagesV2Realtime.ts` (1,113 lines) contains massive duplicate payload parsing utilities (`getPayloadStringField`, `getPayloadDateField`, `getPayloadNumberField`). *Replacement: Unified typed payload parser (~400 lines cut).*

**Unverified reduction estimate from the original audit:** approximately `-920 lines of code` and `-5 redundant useEffect hooks`. The earlier `+45% lower render latency` figure was not produced by a recorded benchmark and must not be treated as an acceptance target until measured.

---

## 1. New Message Receipt Audit (End-to-End Flow & Scale)

### End-to-End Operational Pipeline
1. **Realtime Packet Trigger**: A `postgres_changes` `INSERT` event on the `messages` table is pushed through Supabase WebSockets to `useMessagesV2Realtime`.
2. **Payload Parsing**: The client attempts to construct a `MessageWithSender` object from payload fields. If metadata, reply relations, or attachments are missing, it queues a fallback refetch timer (`FALLBACK_REFRESH_DEBOUNCE_MS = 220ms`).
3. **Cache Patching**:
   - If the message belongs to the currently active thread, `upsertThreadMessage` updates `queryKeys.messages.v2.thread(conversationId)`.
   - `patchConversationLastMessageFromMessage` updates the inbox list snapshot.
   - If the message was sent by the viewer, `removeOutboxItemIfPresent` purges the matching item from `messagesV2OutboxStore`.
4. **Attention & Sound**: If the document is hidden or the chat is not active, `playMessageSound()` triggers and `upsertMessageAttention` marks the conversation unread.

### Identified Bottlenecks & Edge Cases
1. **Debounce Delay Fallback Latency**: Realtime packets for messages with attachments or reply context fail `buildThreadMessageFromRealtimePayload` validation (lines 231–233 of `useMessagesV2Realtime.ts`), forcing a 220ms delay before fetching `getConversationThreadPageV2`. Users see a visible delay before attached images or replies appear.
2. **Re-render Cascade Across Workspace**: Inserting a single message invalidates `queryKeys.messages.v2.thread`, causing the top-level `MessagesWorkspaceV2`, `MessageThreadV2`, and all rendered `MessageBubbleV2` instances to re-evaluate props.
3. **Auto-Scroll Snapping Glitch**: When a user is reading older messages (scrolled up in thread history), incoming messages push the scroll offset if images/attachments load asynchronously without fixed aspect-ratio placeholders.
4. **Conditional High-Scale Realtime Fanout Risk**:
   - Each client subscribes to filtered Postgres table changes (`filter: conversation_id=eq.X`). Whether this becomes a bottleneck at 1M users depends on concurrency, conversations per session, write rate, Supabase quotas, and WAL/realtime telemetry. Treat this as a capacity-testing requirement, not a demonstrated current failure.

### Production-Grade Solutions
- **Eliminate Fallback Delay**: Include lightweight attachment/reply metadata directly within the realtime WebSocket payload (or Supabase Broadcast channel), enabling instant zero-latency UI insertion.
- **Granular React Query Updates**: Mutate cache pages immutably without invalidating parent query containers. Wrap `MessageBubbleV2` in `React.memo` with custom comparison function.
- **Scroll Anchor Lock**: Enforce `overflow-anchor: auto` CSS on `MessageThreadV2` viewport and pass explicit `aspect-ratio` on image/video frames before media loads.
- **Scale Solution (1M Users)**: Migrate realtime messaging transport from DB Change Data Capture (CDC) to **Supabase Broadcast Channels / Redis PubSub**. Edge workers handle message routing; database writes occur asynchronously via worker queues.

---

## 2. Opening a New Chat Audit (Initial Render & Message Loading)

### Execution Pipeline
1. **User Action**: Clicking a user card or navigating to `/messages?conversationId=XYZ` or `?userId=ABC`.
2. **Draft Initialization**: If `targetUserId` is provided without a `conversationId`, `MessagesWorkspaceV2` seeds a synthetic draft object (`draft:${targetUserId}`) into TanStack Query cache (lines 212–254) so the thread shell renders immediately.
3. **Server Resolution**: `useEnsureDirectConversation` executes server action `getOrCreateDMConversation`. On success, it replaces `draft:ID` with the actual server UUID and updates the URL via `router.replace`.
4. **Thread Page Fetch**: `useConversationThread` fetches the first 30 messages (`getConversationThreadPageV2`).

### Identified Bottlenecks & Edge Cases
1. **Layout Shift & Double Hydration**: Transitioning from `draft:${targetUserId}` to `conversationId` triggers a unmount/remount cycle in `MessageThreadV2` because `key={selectedConversationId}` is set on the thread component (line 966 of `MessagesWorkspaceV2.tsx`).
2. **Virtualization Is Present; Transition Contracts Need Validation**: `ConversationListV2` and the current `MessageThreadV2` both use `react-virtuoso`. The earlier claim that the thread rendered an unvirtualized linear DOM list is obsolete. The current risk is the interaction between variable-height media, focused-message navigation, prepend pagination, sticky-follow mode, and the read watermark—not DOM accumulation from rendering every loaded message.
3. **Read Commit Race Condition**: Opening a chat fires `handleCommitThreadRead`. If the server latency is high or network drops, `readCommitInFlightRef` blocks subsequent read commits, leaving unread badges active intermittently.

### Production-Grade Solutions
- **Stable Keying for Drafts**: Maintain thread component state continuity by keying `MessageThreadV2` by target participant ID during draft state rather than tearing down DOM nodes.
- **Keep and Harden the Existing Virtualizer**: Retain the existing `Virtuoso` implementation. Add regression coverage for prepending history, media height changes, focused-message jumps, latest-mode following, and read-watermark advancement. Do not introduce a second virtualizer dependency.
- **Batched Read Receipts**: Throttle read receipts using `requestIdleCallback` or debounce by 300ms, sending only the highest `lastReadMessageId` watermark to the server.

---

## 3. Media Rendering Audit (Videos, Images, Files & Documents)

### Handling Pipeline
`message-attachments.tsx` renders attachments via `MessageAttachmentsV2`, splitting them into `MediaAttachmentListV2` (images/videos) and `FileAttachmentCardV2` (documents/PDFs).

### Identified Bottlenecks & Edge Cases
1. **Video Audio Track Detection Hack**: `detectVideoAudioTrack` accesses non-standard internal vendor properties (`mozHasAudio`, `webkitAudioDecodedByteCount`). On modern Chrome/Safari, this returns `null`, causing the mute toggle button to hide unpredictably.
2. **Inline Video Autoplay Memory & CPU Drain**: All video attachments render with `autoPlay`, `loop`, `muted`, `preload="metadata"`. In a thread containing 10+ video clips, multiple native video elements play concurrently in the background, consuming CPU/GPU rendering pipelines and draining mobile battery.
3. **Memory Leaks in Media Viewer Portal**: `MediaViewerModalV2` creates an iframe for PDFs and full-size `<img>`/`<video>` elements inside `createPortal(..., document.body)`. Closing the modal does not explicitly pause or destroy active video elements or revoke blob URLs.
4. **Layout Shift on Image Load**: If image metadata (`width`/`height`) is missing from legacy database rows, `frameStyle` defaults to a square `1/1` aspect ratio (`MESSAGE_MEDIA_INLINE_BOUNDS.maxWidth` = 380px). When the image finishes downloading, `naturalWidth`/`naturalHeight` updates state, triggering a sudden visual layout collapse/expansion.

### Production-Grade Solutions
- **IntersectionObserver Video Lifecycle**: Play videos *only* when they intersect the visible viewport (`threshold: 0.6`). Pause non-visible inline videos immediately.
- **Aspect-Ratio Reservation**: Mandate image/video dimension extraction during upload on the server side so database records always deliver `width` and `height`.
- **Media Modal Cleanup**: Explicitly call `videoRef.current.pause(); videoRef.current.src = ''` on modal unmount and revoke Object URLs.

---

## 4. Extra Scenarios & Edge Cases Audit

### 1. Typing Indicators
- **Mechanics**: `useChatTypingState` broadcasts typing presence via Supabase Realtime Channels.
- **Issue**: Rapid typing triggers high-frequency WebSocket messages without adequate client throttling. On loss of focus, typing indicator persistence can get stuck for up to 6 seconds.
- **Solution**: Debounce typing start broadcasts to `500ms` and automatically send `stop_typing` payload immediately on `onBlur` or `onSubmit`.

### 2. Outbox & Flaky Network Operations
- **Mechanics**: `messagesV2OutboxStore` persists queued items in `localStorage`. `useMessagesV2OutboxSync` runs a flush loop retrying failed sends.
- **Issue**: Retry delay starts at 250ms and caps at 30 seconds after 7 attempts, but if a user stays offline for a long period, `MAX_RETRY_ATTEMPTS = 20` permanently fails messages without auto-requeuing upon network restoration (`online` event only calls `flush()` without resetting `attempts`).
- **Solution**: On `online` window event, reset `attempts = 0` for all `failed` outbox items with transient errors to trigger instant resend.

### 3. Multi-Tab Attention & Unread Sync
- **Issue**: Opening a chat in Tab A updates local Zustand store in Tab A. Tab B does not receive cross-tab Zustand storage updates for non-persisted state fields, leaving unread badges out of sync until a manual refresh or DB polling occurs.
- **Solution**: Utilize `BroadcastChannel` API (`new BroadcastChannel('nb-messages-sync')`) to synchronize active conversation selection and read states across all open browser tabs instantly.

---

## 5. Specific UI Issues Audit & Root-Cause Fixes

### Scenario 5 Deep Dive: The Reaction Container Width Constraint Bug

#### Problem Description (As seen in User Screenshot 1)
When receiving a message from a peer (`isOwn = false`), hovering or clicking the reaction button (`SmilePlus`) displays the floating `ReactionQuickBar` container. However, **the reaction container is constrained/clipped to the width of the message bubble itself**, resulting in truncated emoji buttons (only showing ~4 out of 6 emojis).

```
+-------------------------------------------------------------+
| [Avatar]  Hi                                                |
|           +---------------------+                           |
|           | ❤️  😂  😯  😢  [Clipped] |  <-- ReactionQuickBar |
|           +---------------------+                           |
|                                                             |
+-------------------------------------------------------------+
```

#### Detailed Root Cause Analysis (DOM & CSS Mechanics)
1. **Container Hierarchy in `MessageBubbleV2.tsx`**:
   - Outer Lane: `<div className="msg-bubble-lane flex w-full relative justify-start">`
   - Bubble Stack: `<div className="msg-bubble-stack relative flex flex-col items-start">`
   - Bubble Shell: `<div className="msg-bubble-shell width: fit-content">` (For message "Hi", width is only ~40px).
   - Action Rail: `<div className="msg-action-rail absolute z-20 flex items-center">`
2. **CSS Rules in `globals.css`**:
   - Lines 644–647 & 728–731:
     ```css
     .msg-action-rail-peer {
       left: 100% !important;
       margin-left: 0.5rem !important;
     }
     ```
3. **Positioning Collision in `ReactionQuickBar.tsx`**:
   - When `isOwn = false`, `align` is set to `'end'` (line 1199 of `MessageBubbleV2.tsx`).
   - `align="end"` applies class `right-0` to `ReactionQuickBar` inside the 32px SmilePlus wrapper `<div className="relative">`.
   - `right-0` aligns the **right edge** of `ReactionQuickBar` to the right edge of the 32px button at `left: 100%` of the peer bubble stack.
   - The 220px wide `ReactionQuickBar` extends **leftward**. Because the peer bubble stack is only 40px wide ("Hi"), the left edge of `ReactionQuickBar` extends -180px past the left side of the bubble stack!
   - Because `MessageThreadV2` viewport or `.msg-bubble-lane` / parent container has `overflow-hidden` or horizontal bounds constraint, the left portion of `ReactionQuickBar` is clipped or compressed down to fit inside the parent container boundary!

#### Complete Production-Grade Solution
1. **Decouple QuickBar from Inline Rail relative positioning**:
   - Replace absolute `right-0` inline positioning with a Portal or Floating UI popover anchored to the reaction button trigger element (`data-reaction-trigger`).
2. **Fixed Floating-UI / CSS Popover Mechanics**:
   - Use `@floating-ui/react` (or CSS `popover` API with `position-anchor`) to position `ReactionQuickBar` above the message bubble with `placement="top-start"` for peer messages and `placement="top-end"` for own messages.
   - Apply `flip()` and `shift({ padding: 12 })` middleware so the reaction bar automatically shifts inside screen boundaries regardless of how short the message text is.

---

## 6. Deep-Dive Audit: Profile Navigation (`/messages?userId=...`) "Loading chat..." Sticking Bug & Server Action Spam

### Problem Description & Empirical Evidence (From Terminal Logs & Screenshot 2)
When navigating from a user profile page (e.g. `/u/lakshmi_ch`) to `/messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8`:
1. **Visual Failure**: The UI becomes stuck rendering an avatar circle "LC" with title **"Loading chat..."** in the conversation header and "No messages yet. Drop a quick hello below to start the conversation." in the thread panel — even though a valid existing conversation (`8902de73-3905-4f84-9ec7-6a700941cd1c`) already exists with full message history!
2. **Terminal Server Action Flood**: The server log output reveals an immediate barrage of cascading Server Actions:
   ```
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 1370ms
     └─ ƒ getInboxPageV2(20, undefined) in 1335ms src/app/actions/messaging/v2.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 1504ms
     └─ ƒ ensureDirectConversationV2("9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8") in 1487ms src/app/actions/messaging/v2.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 317ms
     └─ ƒ readNotificationUnreadCountAction() in 288ms src/app/actions/notifications.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 149ms
     └─ ƒ readNotificationUnreadCountAction() in 118ms src/app/actions/notifications.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 143ms
     └─ ƒ readNotificationUnreadCountAction() in 114ms src/app/actions/notifications.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 154ms
     └─ ƒ readNotificationUnreadCountAction() in 112ms src/app/actions/notifications.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 846ms
     └─ ƒ getConversationSummaryV2("8902de73-3905-4f84-9ec7-6a700941cd1c") in 806ms src/app/actions/messaging/v2.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 218ms
     └─ ƒ getUnreadCount() in 177ms src/app/actions/messaging/_all.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 151ms
     └─ ƒ readNotificationUnreadCountAction() in 110ms src/app/actions/notifications.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 129ms
     └─ ƒ readNotificationUnreadCountAction() in 114ms src/app/actions/notifications.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 361ms
     └─ ƒ readNotificationUnreadCountAction() in 333ms src/app/actions/notifications.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 191ms
     └─ ƒ readNotificationUnreadCountAction() in 145ms src/app/actions/notifications.ts
   POST /messages?userId=9d47e7d9-0ea1-4056-8e37-2c1bdd85fad8 200 in 251ms
     └─ ƒ readNotificationUnreadCountAction() in 208ms src/app/actions/notifications.ts
   ... (readNotificationUnreadCountAction executed 8+ times in under 1 second!)
   ```
3. **Critical Discovery**: `getConversationThreadPageV2` **WAS NEVER EXECUTED AT ALL**!

### Root Cause Analysis (Codebase Mechanics)

#### Root Cause 6.1: Cache Seeding Failure in `ensureConversation` Success Callback
- In `MessagesWorkspaceV2.tsx` (lines 207–302):
  - When `targetUserId` is present in the URL, `useEffect` initializes `selectedConversationId = "draft:9d47e7d9..."` and seeds synthetic draft query data into `queryKeys.messages.v2.thread("draft:9d47e7d9...")` containing `fullName: "Loading chat..."`.
  - It then executes `ensureConversation.mutate("9d47e7d9...")`.
  - The server action `ensureDirectConversationV2` resolves and returns `result.conversationId = "8902de73-3905-4f84-9ec7-6a700941cd1c"` (the real existing conversation UUID).
  - In `onSuccess` (lines 268–285):
    ```ts
    if (result.conversationId.startsWith('draft:')) {
        queryClient.setQueryData(queryKeys.messages.v2.thread(result.conversationId), { pages: [{ conversation: result.conversation, ... }] });
    } else {
        upsertThreadConversation(queryClient, result.conversation);
    }
    ```
  - **The Flaw**: `upsertThreadConversation` in `v2-cache.ts` (lines 246–266) calls `updateThreadData(queryClient, conversation.id, ...)`. `updateThreadData` **only patches existing Query Cache pages**. Because `queryKeys.messages.v2.thread("8902de73-3905-4f84-9ec7-6a700941cd1c")` has never been fetched or seeded in this browser session, it has NO existing cache pages. `upsertThreadConversation` silently does nothing!
  - Consequently, `thread("8902de73...")` remains `undefined`.
  - When `setSelectedConversationId("8902de73...")` runs, `thread.conversation` is `undefined`, so `activeConversation` falls back to `undefined` or retains the draft object (`draft:9d47...`), locking the header permanently on **"Loading chat..."**!

#### Root Cause 6.2: Invalidation Loop Firing `readNotificationUnreadCountAction()` 8+ Times
- When `selectedConversationId` transitions or commits read receipts:
  - `MessagesWorkspaceV2.tsx` fires `handleCommitThreadRead()`, executing `markRead.mutateAsync()`.
  - `markRead` executes `clearConversationAttention(conversationId)`, which calls server action `markConversationMessageNotificationsReadAction(conversationId)`.
  - Server action `markConversationMessageNotificationsReadAction` executes `revalidatePath('/messages')` and invalidates `queryKeys.messages.v2.root()` and `queryKeys.notifications.unreadCount()`.
  - Both `useNotificationUnreadCount` and `useNotifications` in `useNotifications.ts` (lines 147 & 242) observe `unreadCountQueryKey`. Invalidating root queries causes both hooks to re-fetch `readNotificationUnreadCountAction()` simultaneously.
  - Because `revalidatePath('/messages')` forces Next.js client components to re-evaluate props, `MessagesWorkspaceV2` re-triggers read detection `useEffect` hooks, creating a self-reinforcing cascading loop that fires `readNotificationUnreadCountAction()` 8 to 12 times in a single second.

### Production-Grade Solutions

1. **Explicit Query Cache Seeding for Resolved Conversations**:
   In `MessagesWorkspaceV2.tsx` `onSuccess` callback for `ensureConversation`, explicitly seed `queryKeys.messages.v2.thread(result.conversationId)` with the resolved conversation header and initial message shell regardless of whether `result.conversationId` is a draft or real UUID:
   ```ts
   queryClient.setQueryData(
       queryKeys.messages.v2.thread(result.conversationId),
       (existing) => existing ?? {
           pages: [{
               conversation: result.conversation,
               capability: result.conversation.capability,
               messages: [],
               pinnedMessages: [],
               hasMore: false,
               nextCursor: null,
           }],
           pageParams: [undefined],
       }
   );
   ```

2. **Deduplicate Read Commit & Invalidation Hooks**:
   - Throttle `markConversationMessageNotificationsReadAction` using a ref watermark (`lastReadNotificationCommitRef`).
   - Remove redundant `revalidatePath('/messages')` from background notification actions; rely exclusively on client-side TanStack Query cache updates.
   - Consolidate `useNotificationUnreadCount` and `useNotifications` into a single shared custom hook so `readNotificationUnreadCountAction()` is only executed once per stale window.

---

## 7. Deep-Dive Audit: Chat Open "Initial Load Stampede" — Duplicate Fetches, Triplicate Receipts & Attachment Re-Downloads

### Problem Description (From Terminal Logs)
When opening an existing chat conversation (`conversationId: 8902de73-3905-4f84-9ec7-6a700941cd1c`), the terminal reveals a **catastrophic stampede of duplicate and triplicate server actions** during the initial load:

```
GET  /api/v1/messages/attachments/8950a85b-...                  200 in 1037ms
POST ƒ getConversationThreadPageV2("8902de73-...", undefined, 30)  200 in 2767ms  ← CALL #1
POST ƒ getConversationThreadPageV2("8902de73-...", undefined, 30)  200 in 2092ms  ← CALL #2 (DUPLICATE!)
POST ƒ getUnreadCount()                                          200 in 118ms
POST ƒ readMessageWorkLinksAction("8902de73-...", [29 IDs])      200 in 235ms
POST ƒ recordDeliveryReceipts([11 IDs])                          200 in 219ms   ← CALL #1
POST ƒ recordDeliveryReceipts([11 IDs])                          200 in 223ms   ← CALL #2 (DUPLICATE!)
POST ƒ recordReadReceipts([4 IDs])                               200 in 227ms
POST ƒ recordDeliveryReceipts([11 IDs])                          200 in 211ms   ← CALL #3 (TRIPLICATE!)
GET  /api/v1/messages/attachments/204ebf78-...                   200 in 16.6s   ← CALL #1 (16 SECONDS!)
GET  /api/v1/messages/attachments/204ebf78-...                   200 in 1868ms  ← CALL #2 (DUPLICATE!)
GET  /api/v1/messages/attachments/204ebf78-...                   200 in 954ms   ← CALL #3 (TRIPLICATE!)
```

**Total wasted server time on duplicates alone:** ~22 seconds of unnecessary server/database/storage work for a single chat open.

---

### Root Cause 7.1: Duplicate `getConversationThreadPageV2` — Two Independent Callers Race

**Why it's called TWICE with identical parameters (`conversationId, undefined, 30`):**

Two completely independent code paths both fire `getConversationThreadPageV2` for the same conversation during initial load:

1. **Path A — `useConversationThread` hook** ([useMessagesV2.ts:202–221](file:///Users/chrama/Downloads/nb-s3/src/hooks/useMessagesV2.ts#L202-L221)):
   - When `selectedConversationId` is set and is not a `draft:` prefix, `useInfiniteQuery` activates with `enabled: true` and fires `queryFn` → `getConversationThreadPageV2(conversationId, undefined, 30)`.
   - This is the **correct, primary** fetch.

2. **Path B — `refreshConversationCache` in "latest thread sync" effect** ([MessagesWorkspaceV2.tsx:384–431](file:///Users/chrama/Downloads/nb-s3/src/components/chat/v2/MessagesWorkspaceV2.tsx#L384-L431)):
   - Simultaneously, the `useEffect` at line 384 evaluates `hasLoadedAuthoritativeLatest`. On initial chat open, the inbox cache (`selectedInboxConversation`) already knows the conversation's `lastMessage.id` from the inbox list. But the thread query hasn't resolved yet, so `thread.messages` is empty.
   - This makes `hasLoadedAuthoritativeLatest = false`, which activates the effect.
   - The effect calls `refreshConversationCache(queryClient, selectedConversationId, { includeUnread: true })`.
   - `refreshConversationCache` in [v2-refresh.ts:50–75](file:///Users/chrama/Downloads/nb-s3/src/lib/messages/v2-refresh.ts#L50-L75) calls `getConversationThreadPageV2(conversationId, undefined, 30)` **directly** — a raw server action call, completely bypassing TanStack Query's deduplication!

**The Core Flaw:** Path B bypasses TanStack Query. It calls the server action function directly instead of using `queryClient.fetchQuery` or `queryClient.ensureQueryData`. TanStack Query cannot deduplicate what it doesn't know about. Both Path A and Path B fire concurrently, producing two identical 2+ second database queries.

**Ponytail Solution:**
- `delete:` The entire "latest thread sync" effect (lines 384–431) should be replaced with a simple guard: if `useConversationThread` query is in `fetchStatus === 'fetching'` state, skip the refresh. Or better: call `queryClient.ensureQueryData` instead of the raw server action, so TanStack Query deduplicates automatically.
- Alternatively, `refreshConversationCache` should use `replaceThreadSnapshot` only **after** checking if the thread query already has data or is currently fetching. One line: `if (queryClient.isFetching({ queryKey: queryKeys.messages.v2.thread(conversationId) })) return;`

---

### Root Cause 7.2: Triplicate `recordDeliveryReceipts` — Buffer Flush Race on Conversation Switch

**Why `recordDeliveryReceipts` fires 3 times with the same 11 message IDs:**

The delivery receipt system uses `useMessageReceiptBuffer` ([useMessageReceiptBuffer.ts](file:///Users/chrama/Downloads/nb-s3/src/hooks/useMessageReceiptBuffer.ts)) with a `setInterval(flush, 250)` timer. The problem is the **cleanup teardown race** when `conversationId` changes:

1. **Effect cleanup fires** (line 58–68): When `conversationId` transitions from `null`/draft → real UUID, the previous interval is cleared. But the cleanup **also flushes the buffer** (line 63–66): `void recordReceipts(ids).catch(() => {})`. This fires flush **#1**.

2. **New effect mounts** (line 52–57): A new `setInterval(flush, 250)` starts. The `ackDelivery` callback in `MessageThreadV2.tsx` (line 208–220) immediately enqueues all 11 unseen messages into the buffer when `orderedMessages` changes. After 250ms, the first interval tick fires flush **#2**.

3. **Conversation ID stabilization**: During the draft-to-real transition, `selectedConversationId` may change rapidly (e.g., `draft:xxx` → `realUUID`). Each change tears down and remounts the `useEffect`, triggering another cleanup flush **#3**.

Additionally, `flushedRef.current` is cleared on every `conversationId` change (line 55–56), so the deduplication set is wiped right when it's needed most.

**Ponytail Solution:**
- `shrink:` Remove the cleanup flush entirely (lines 63–66). Delivery receipts are not critical enough to warrant fire-and-forget flushes during unmount — they'll be re-sent when the conversation is reopened.
- `stdlib:` Use a debounced flush (`setTimeout` with clear-on-remount) instead of `setInterval` to prevent rapid-fire flushes during state transitions.
- `fix:` Do NOT clear `flushedRef` on conversationId change. Keep it as a session-wide dedup set keyed by message ID. Message IDs are globally unique — there's no reason to re-send delivery receipts for messages already acknowledged.

---

### Root Cause 7.3: Triplicate Attachment Download (`204ebf78-...` fetched 3 times, first taking 16.6 seconds!)

**Why the SAME attachment is fetched 3 times from the server:**

The attachment API route ([route.ts](file:///Users/chrama/Downloads/nb-s3/src/app/api/v1/messages/attachments/%5BattachmentId%5D/route.ts)) returns:
```ts
headers: {
    "cache-control": "private, max-age=60, must-revalidate",  // ← Only 60 seconds!
}
```

The `must-revalidate` directive combined with `max-age=60` means the browser cache entry expires extremely quickly and cannot serve stale content. But the real issue is **why 3 concurrent requests fire at all**:

1. **Request #1 (16.6s)**: The attachment URL appears in the `<img>` or `<video>` tag rendered by `MediaAttachmentTileV2` ([message-attachments.tsx:219–266](file:///Users/chrama/Downloads/nb-s3/src/components/chat/v2/message-attachments.tsx#L219-L266)). The browser fires the first GET request.

2. **Request #2 (1.8s)**: The duplicate `getConversationThreadPageV2` call (Root Cause 7.1) returns a second copy of the same thread data. `replaceThreadSnapshot` in `v2-cache.ts` replaces the TanStack Query cache pages wholesale, creating **new object references** for every message and attachment. React detects changed props on `MessageBubbleV2` → `MessageAttachmentsV2` → `MediaAttachmentTileV2`. The `useEffect` at line 147–154 of `message-attachments.tsx` resets state: `setCurrentUrl(previewUrl); setLoaded(false);`. This causes the `<img>`/`<video>` element to unmount and remount with the same `src`, firing a new GET.

3. **Request #3**: The `readMessageWorkLinksAction` response or any other cache invalidation that causes a re-render of the message bubble triggers yet another state reset.

**Why the first request takes 16.6 seconds:** The attachment route ([route.ts:86–194](file:///Users/chrama/Downloads/nb-s3/src/app/api/v1/messages/attachments/%5BattachmentId%5D/route.ts#L86-L194)) performs **4 sequential database queries + 1 Supabase Storage download per request**:
  1. `db.select(...)` with 4-table JOIN (`messageAttachments` → `messages` → `conversationParticipants` → `messageHiddenForUsers`) — line 86–118
  2. `db.select(...)` to fetch conversation participants for privacy check — line 133–137
  3. `resolvePrivacyRelationship(...)` which queries the privacy/blocking tables — line 142
  4. `admin.storage.from(ATTACHMENTS_BUCKET).download(storagePath)` — the actual Supabase Storage download — line 186–194

When 3 concurrent requests for the same attachment hit simultaneously, each opens its own DB connections and storage downloads, competing for resources. The first gets starved.

**Ponytail Solution:**
- `fix:` Wrap `MediaAttachmentTileV2` in `React.memo` with a custom comparator that checks `attachment.id` and `attachment.url` only — preventing re-renders from reference-identity changes.
- `fix:` Remove the `useEffect` reset at lines 147–154 of `message-attachments.tsx`. The `key={attachment.id}` on the parent already handles identity changes. The effect is redundant and destructive.
- `native:` Change attachment cache header to `"cache-control": "private, max-age=3600, immutable"`. Attachment content is immutable (same ID = same file). There's zero reason for a 60-second TTL.
- `stdlib:` Add an in-flight deduplication map to the attachment route handler: if attachment ID is already being fetched, await the existing Promise instead of starting a new DB+Storage round-trip.

---

### Root Cause 7.4: `readMessageWorkLinksAction` Fires Immediately With 29 Message IDs

**The Mechanics:**
`useMessageWorkLinks` ([useMessageWorkLinks.ts:15–74](file:///Users/chrama/Downloads/nb-s3/src/hooks/useMessageWorkLinks.ts#L15-L74)) fires a `useQuery` that is enabled as soon as `conversationId` is truthy and `messageIds.length > 0`. In `MessageThreadV2.tsx` (lines 184–199), `recentLinkedWorkMessageIds` is computed from the last `LINKED_WORK_RECENT_MESSAGE_COUNT` messages.

On initial load, the moment the first `getConversationThreadPageV2` resolves and populates 30 messages, `recentLinkedWorkMessageIds` immediately contains all 29 non-viewer message IDs. This triggers `readMessageWorkLinksAction` with all 29 IDs in a single burst.

**The Waste:** This runs on *every* chat open, even for conversations with no linked work items. The query fetches data for 29 messages eagerly — before the user has even scrolled or interacted.

**Ponytail Solution:**
- `yagni:` Defer `useMessageWorkLinks` until the user has been in the conversation for at least 1 second, or until they scroll. Most users open a chat, read the latest message, and reply — they don't need linked work data immediately.
- `shrink:` Reduce `LINKED_WORK_RECENT_MESSAGE_COUNT` from 29 to ~5. Only the most recent messages are visible on screen anyway.

---

### Root Cause 7.5: `getUnreadCount` Called Redundantly Alongside Thread Fetch

**The Mechanics:**
`refreshConversationCache` in [v2-refresh.ts:55–57](file:///Users/chrama/Downloads/nb-s3/src/lib/messages/v2-refresh.ts#L55-L57) fires `getUnreadCount()` in parallel with `getConversationThreadPageV2`. But `getConversationThreadPageV2` **already returns** the conversation's `unreadCount` inside the response's `conversation` object (via `hydrateConversationSummariesV2`).

This means `getUnreadCount()` is a completely redundant 118ms server action — the unread count is already available from the thread page response.

**Ponytail Solution:**
- `delete:` Remove `options?.includeUnread ? getUnreadCount() : ...` from `refreshConversationCache`. Extract `unreadCount` from the thread page's `conversation` field instead. Net savings: 1 server action, 1 DB query, ~120ms.

---

### Summary: Total Waste From Chat Open Stampede

| Server Action | Expected Calls | Actual Calls | Wasted Time |
|---|---|---|---|
| `getConversationThreadPageV2` | 1 | **2** | ~2.1s |
| `recordDeliveryReceipts` | 1 | **3** | ~430ms |
| `getUnreadCount` | 0 | **1** | ~120ms |
| `readMessageWorkLinksAction` | 0 (deferred) | **1** | ~235ms |
| Attachment `204ebf78` download | 1 | **3** | ~18.5s |
| **Total wasted server time** | | | **~21.4s** |

> [!CAUTION]
> At 1 million active users, this stampede pattern means every chat open generates **5–8 unnecessary server round-trips**, each hitting the database. This is a **linear scalability wall** — doubling users doubles wasted DB load proportionally.

---

## 8. Audit Extension: Conversation List, Chat Transitions, and Search (2026-07-26)

### 8.1 Scope and Evidence Standard

This extension audits the additional surfaces requested after the original report:

1. The conversation list before, during, and after a user opens a message.
2. Transitions caused by clicking an existing conversation, opening a person from another screen, starting a new direct message, switching tabs, opening a notification, moving between popup and full-page messaging, using browser history, and focusing an individual search result.
3. Search behavior in the top-navigation popup, the message-history dialog, the new-message recipient picker, and the dormant list-level search implementations.

The trace followed the complete client/server path through:

- `src/app/(main)/messages/page.tsx`
- `src/components/chat/ChatProvider.tsx`
- `src/components/chat/v2/ChatPopupV2.tsx`
- `src/components/chat/v2/MessagesWorkspaceV2.tsx`
- `src/components/chat/v2/ConversationListV2.tsx`
- `src/components/chat/v2/ApplicationsListV2.tsx`
- `src/components/chat/v2/ProjectGroupsListV2.tsx`
- `src/components/chat/v2/NewMessageModalV2.tsx`
- `src/components/chat/v2/ConversationHeaderV2.tsx`
- `src/components/chat/v2/MessageThreadV2.tsx`
- `src/components/layout/header/GlobalSearch.tsx`
- `src/components/layout/header/CommandPalette.tsx`
- `src/components/layout/header/TopNav.tsx`
- `src/components/layout/header/global-search.ts`
- `src/hooks/useMessagesV2.ts`
- `src/hooks/useMessagingShortcuts.ts`
- `src/hooks/useGlobalSearchPreviews.ts`
- `src/hooks/useMessageAttentionState.ts`
- `src/lib/messages/attention.ts`
- `src/stores/messagesV2UiStore.ts`
- `src/app/actions/messaging/v2.ts`
- `src/app/actions/messaging/_all.ts`
- Relevant unit and end-to-end test contracts under `tests/unit` and `tests/e2e`

Findings below are marked:

- **Verified:** directly demonstrated by the current source or a focused automated test.
- **Coverage gap:** behavior is not protected by a reliable automated test.
- **Conditional:** a production-scale concern that must be validated with telemetry before architecture changes.

### 8.2 Freshness Corrections to the Original Report

The original document contained a stale assertion that `MessageThreadV2` was not virtualized. The current implementation already uses `react-virtuoso`, and the focused thread-anchor contracts pass. This report has corrected the earlier recommendation: keep the existing virtualizer and test its transition contracts instead of introducing another dependency.

The original high-scale recommendations involving Redis, Hono, table partitioning, and alternate fanout are **conditional architecture options**, not proven remedies for the list, transition, or search defects in this extension. Ponytail priority is to repair the existing state ownership, remove dead UI paths, and measure the current system before adding infrastructure.

No application source changes are part of this audit extension. Every item below is an implementation recommendation and acceptance contract for the subsequent implementation phase.

| Registry | Findings | Priority distribution |
|---|---:|---|
| Conversation list (`CL`) | 18 | 6 P1 / 11 P2 / 1 P3 |
| Chat transitions (`TR`) | 14 | 5 P1 / 7 P2 / 2 P3 |
| Applications/projects (`AP`) | 9 | 2 P1 / 5 P2 / 2 P3 |
| Search ecosystem (`SE`) | 21 | 7 P1 / 11 P2 / 3 P3 |
| Test/observability (`QA`) | 6 | Coverage gaps |
| **Total** | **68** | **20 P1 / 34 P2 / 8 P3 + 6 QA** |

### 8.3 Current Surface Model

The application presents one messaging product through two shells:

- **Full-page shell:** `/messages`, rendered by `MessagesWorkspaceV2` in `page` mode.
- **Popup shell:** rendered by `ChatProvider` and `ChatPopupV2`, using the same `MessagesWorkspaceV2` in `popup` mode.

Both shells currently share the same global Zustand fields for `activeTab`, `selectedConversationId`, attention, and drafts. Only some popup fields and drafts are persisted. Server state is held in TanStack Query infinite queries, with an additional IndexedDB bootstrap path for the inbox and thread.

This reuse is valuable, but the ownership boundary is incomplete:

```text
URL search parameters ─┐
                       ├─> selected conversation ─> thread query ─> read effects
global Zustand store ──┘

top-navigation search ─> CustomEvent ─> workspace dialog
notification action ───> popup or /messages route
new-message picker ────> ensure/create DM ─> selected conversation
```

Two sources can therefore claim authority over the selected conversation, two systems can claim authority over “read,” and several search controls appear related while querying different datasets.

---

## 9. Conversation List Audit

### 9.1 End-to-End Existing-Conversation Flow

**Starting point:** The user is on `/messages` or has opened the popup.

**Trigger:** The user clicks a row in `ConversationListV2`.

**Current sequence:**

1. The virtualized row invokes `onSelectConversation`.
2. `MessagesWorkspaceV2` sets `selectedConversationId` in the shared Zustand store.
3. Any focused search-message ID and reply context are cleared.
4. In page mode, `router.replace` rewrites the current `/messages` query.
5. `useConversationThread` reads IndexedDB opportunistically and starts or reuses the TanStack Query thread request.
6. The thread panel switches to a skeleton/loading state, cached thread, fetched thread, explicit empty thread, or a generic selection fallback depending on available data.
7. Multiple read-related effects may attempt to advance the server watermark.
8. The selected row remains inside the list, but the list can move it between the attention and recent sections after attention clears.

### 9.2 Detailed Findings and Solutions

#### CL-01 — Page URL and Shared Store Can Disagree

- **Priority / evidence:** P1, Verified.
- **Current state:** `MessagesWorkspaceV2` applies `initialConversationId` or `targetUserId` only once through `initialSelectionAppliedRef`. A later search-parameter change can be ignored while the component remains mounted. Conversely, opening `/messages` without a conversation parameter does not guarantee that a conversation previously selected in the popup store is cleared.
- **User-visible failure:** The URL can represent the inbox while a thread is open, or represent conversation B while the workspace still shows conversation A. Back/Forward, notification links, and repeated deep links are especially vulnerable.
- **Root cause:** Selection has two competing authorities: the page URL and a cross-surface global store.
- **Solution:** In page mode, make normalized URL state canonical and synchronize whenever the URL target changes. In popup mode, make popup-local state canonical. Use either separate page/popup selections or a mode-aware selection owner. Never use a one-time ref to synchronize navigation state.
- **Acceptance:** Changing `conversationId`, `userId`, or `messageId` without remounting updates exactly once to the matching thread. Navigating to bare `/messages` shows the list/empty thread state and never resurrects popup selection.

#### CL-02 — Global Active Tab Can Contradict the Open Thread

- **Priority / evidence:** P1, Verified.
- **Current state:** `activeTab` is shared and persisted. Opening a DM while `Applications` or `Projects` is active does not reliably move the list to `Chats`.
- **User-visible failure:** A direct-message thread can appear beside an applications or project-groups list with no selected row, making the interface appear disconnected.
- **Root cause:** Conversation selection does not carry or derive its owning list category.
- **Solution:** Create one `openConversation` transition that derives the owning tab from conversation type: DM/general group → Chats, application conversation → Applications, project group → Projects. If product design allows cross-tab threads, then visibly preserve and label the source instead; do not leave the relationship implicit.
- **Acceptance:** Every opened thread has a visible selected source row in its owning tab, or a clearly labeled cross-context state with a one-click return.

#### CL-03 — Browser History Is Replaced Rather Than Built

- **Priority / evidence:** P2, Verified.
- **Current state:** User-initiated row selection and close operations use `router.replace`.
- **User-visible failure:** Browser Back cannot reliably return to the prior conversation or list state. A focused search-result transition may produce multiple internal replacements without a navigable history entry.
- **Root cause:** URL normalization and user navigation use the same routing primitive.
- **Solution:** Use `router.push` for user-initiated chat and search-result selections. Reserve `replace` for canonicalizing draft IDs, invalid parameters, and equivalent URLs. Document the intended Back/Forward contract.
- **Acceptance:** A → B → Back returns to A; Back again returns to the list or prior route. Draft-to-real-ID replacement does not add a duplicate history entry.

#### CL-04 — Re-clicking the Selected Row Has Destructive Side Effects

- **Priority / evidence:** P2, Verified.
- **Current state:** Clicking the already-selected conversation still clears `focusMessageId`, reply state, and the `messageId` URL parameter.
- **User-visible failure:** A user reviewing a search result can lose the focused message merely by clicking the highlighted row again.
- **Root cause:** The selection handler always executes reset behavior, even when identity has not changed.
- **Solution:** Make same-ID selection a no-op. Introduce a separate explicit “jump to latest” action if that behavior is desired.
- **Acceptance:** Re-clicking a selected row retains focused-message context and draft/reply state. Only the explicit latest control clears focus.

#### CL-05 — Invalid or Unauthorized Conversation Has No Specific Resolution

- **Priority / evidence:** P1, Verified.
- **Current state:** If the thread query fails and no conversation data is available, the workspace can fall back to “Select a conversation” while the invalid ID remains in the URL.
- **User-visible failure:** The screen suggests user inaction instead of access denial, deletion, network failure, or invalid link.
- **Root cause:** Loading, empty, not-found, forbidden, and transport-error states collapse into a generic fallback.
- **Solution:** Render explicit result states: unavailable/deleted, access denied, offline/transport failure with Retry, and invalid link with “Back to messages.” Clear or canonicalize the URL only after presenting an understandable resolution.
- **Acceptance:** Each typed server failure produces its own message and action; retry retains the target; invalid IDs never silently appear as an empty selection.

#### CL-06 — Two Read Owners Can Mark Beyond What Was Seen

- **Priority / evidence:** P1, Verified.
- **Current state:** `MessagesWorkspaceV2` advances a read watermark after thread data loads, while `MessageThreadV2` also observes message visibility. Additional blur, page-hide, and unmount handlers commit read state.
- **User-visible failure:** Opening an older search result can mark newer unread messages read before they enter the viewport. Hidden/minimized or background surfaces can also influence the watermark.
- **Root cause:** “Thread loaded,” “thread selected,” and “message visibly consumed” are treated as equivalent.
- **Solution:** Establish one read owner in the visible thread. Commit only the highest unread incoming message confirmed visible while the document and owning surface are active. Do not mark the latest message merely because the query loaded. For an old search result, advance only through the highest actually observed message.
- **Acceptance:** Opening message 20 in a thread with unread messages 21–30 leaves 21–30 unread until visible. Hidden tabs, minimized popup, and covered surfaces do not advance the watermark.

#### CL-07 — Attention Clearing Can Move the Row During Interaction

- **Priority / evidence:** P2, Verified behavior; design contract absent.
- **Current state:** A conversation can be moved from the “New”/attention section into “Recent” shortly after attention is cleared.
- **User-visible failure:** The selected row changes vertical position while the user is orienting to the thread, creating a perceived disappearance similar to the notification issue previously reported.
- **Root cause:** Attention grouping directly controls sort section membership without a selected-row stability rule.
- **Solution:** Keep the selected conversation pinned in its current visual slot for the active interaction cycle, or animate a deterministic transition only when the user leaves/closes the thread. Read state and list placement should not be coupled to a short timer.
- **Acceptance:** Opening a new conversation does not make its row disappear or jump during the first read cycle. Its visual status changes without losing spatial continuity.

#### CL-08 — Custom Memo Comparator Can Leave Row Identity Stale

- **Priority / evidence:** P2, Verified.
- **Current state:** The `ConversationItemV2` memo comparator omits participant identity/profile fields, capability changes, and some timestamps.
- **User-visible failure:** An updated avatar, display name, permission, or timestamp can remain stale even when the cache contains fresh data.
- **Root cause:** A manually curated equality function is narrower than the row’s render inputs.
- **Solution:** Pass a small immutable row view model containing every rendered scalar and use normal shallow identity, or remove the custom comparator until profiling proves it necessary. Correctness takes priority over speculative render avoidance.
- **Acceptance:** Updating each rendered participant/capability/timestamp field changes the row without an unrelated state update.

#### CL-09 — Pagination Loading State Uses the Wrong Signal

- **Priority / evidence:** P2, Verified.
- **Current state:** `endReached` is guarded by the initial `loading` value rather than `isFetchingNextPage`. The footer can display “Loading more…” whenever more data exists, even while idle.
- **User-visible failure:** Repeated fetch attempts and a permanently misleading loading footer are possible.
- **Root cause:** Initial-query state and next-page state are conflated.
- **Solution:** Pass `isFetchingNextPage` explicitly, gate `fetchNextPage` with it, and render the footer only while that request is active. Add a retry row for page-fetch failure.
- **Acceptance:** One end-of-list event creates at most one page request; the footer is absent while idle and changes to Retry after an error.

#### CL-10 — Swipe Actions Are Visible but Not Connected

- **Priority / evidence:** P1, Verified.
- **Current state:** Conversation rows reveal Mute and Archive controls, but `MessagesWorkspaceV2` supplies neither callback.
- **User-visible failure:** Touch users can expose controls that do nothing. Hidden action controls may remain keyboard-focusable beneath the row.
- **Root cause:** A reusable row advertises optional actions without disabling the affordance when callbacks are absent.
- **Solution:** Choose one complete path: wire existing mute/archive server mutations with optimistic state, failure rollback, undo, and archive view; or delete the swipe controls. Until implemented, absent callbacks must remove the affordance and tab stops.
- **Acceptance:** Every visible action completes, reports success/failure, and can be keyboard-operated. No invisible action receives focus.

#### CL-11 — Archive Entry Point Is Dead

- **Priority / evidence:** P2, Verified.
- **Current state:** `ConversationListV2` accepts archived count/open callbacks, but the workspace does not provide them and the active inbox query excludes archived rows.
- **User-visible failure:** The component suggests archive support in code, but users have no complete archive lifecycle.
- **Root cause:** Partial component API was retained without a product surface.
- **Solution:** Either implement archive browse/unarchive/search end to end or delete the dead props and branches. Ponytail recommendation: delete until the feature is scheduled.
- **Acceptance:** No dormant archive copy or callback remains; if implemented, archive/unarchive is visible, reversible, searchable, and tested.

#### CL-12 — Dormant Conversation-List Search Is Incomplete

- **Priority / evidence:** P2, Verified.
- **Current state:** `ConversationListV2` contains `searchQuery` filtering, but the workspace never passes a query. The filter only checks loaded pages, the first participant, and raw last-message content.
- **User-visible failure:** If activated, it would silently omit unloaded matches and misrepresent group identity.
- **Root cause:** A local proof-of-concept filter survived beside the real server-backed history search.
- **Solution:** Delete the dormant prop/filter. If inbox filtering is required later, create a server-backed conversation search with explicit scope and pagination.
- **Acceptance:** There is one intentional inbox search implementation, or none; no unreachable search branch remains.

#### CL-13 — Presence Subscription Expands With Loaded Pages

- **Priority / evidence:** P2, Verified.
- **Current state:** Presence IDs can be derived from all loaded DM rows rather than consistently from the virtualized visible range.
- **User-visible failure:** Long sessions that paginate deeply can keep unnecessary presence subscriptions active.
- **Root cause:** Viewport information and subscription ownership are loosely coupled.
- **Solution:** Subscribe to the visible slice plus a small overscan window, with a deterministic cap and cleanup when rows leave the range.
- **Acceptance:** Subscription count remains bounded while loading hundreds of conversations; leaving the screen releases all list presence subscriptions.

#### CL-14 — Relative Timestamps Do Not Advance While Idle

- **Priority / evidence:** P3, Verified.
- **Current state:** Relative labels recalculate only when the row rerenders.
- **User-visible failure:** “Now” or minute values can remain stale during a long open session.
- **Root cause:** There is no shared low-frequency time signal.
- **Solution:** Use one page-level minute ticker shared by visible rows, not one timer per row. Provide an absolute-time tooltip.
- **Acceptance:** Visible relative labels update at the correct cadence without adding per-row timers.

#### CL-15 — General Groups Use Direct-Message Identity Rules

- **Priority / evidence:** P2, Verified.
- **Current state:** The general Chats list derives title/avatar primarily from the first participant.
- **User-visible failure:** Group conversations can display one member’s name/avatar instead of the group identity.
- **Root cause:** There is no canonical conversation display view model by conversation type.
- **Solution:** Build a server/client display DTO with `title`, `avatar`, `subtitle`, and `type`, derived once for DM, group, application, and project contexts.
- **Acceptance:** Every group displays its configured group title/avatar; a DM still displays the peer; deleted/unknown participants have a stable fallback.

#### CL-16 — Cached Data Masks Refresh Failures

- **Priority / evidence:** P2, Verified.
- **Current state:** A query error is shown only when no conversations exist. Cached rows remain visible without any stale/offline/retry indicator.
- **User-visible failure:** The list appears current even when background refresh failed.
- **Root cause:** Cached-data availability is treated as request success.
- **Solution:** Keep cached data, but display a small non-blocking stale/offline banner and Retry action. Do not replace useful cached content with a full-screen error.
- **Acceptance:** Offline opening shows cached conversations plus explicit status; recovery refreshes without losing selection or scroll.

#### CL-17 — IndexedDB Bootstrap Is Not Coordinated With Query Hydration

- **Priority / evidence:** P2, Verified.
- **Current state:** IndexedDB reads and network queries start independently, and a manual 50 ms wait attempts to smooth loading.
- **User-visible failure:** Blank → skeleton → stale data → fresh data flicker can occur. Cache keys are conversation-oriented rather than explicitly user-scoped, relying on sign-out cleanup for isolation.
- **Root cause:** Two cache systems hydrate the same screen without one lifecycle owner.
- **Solution:** Use a single TanStack persistence/hydration path or await one user-scoped cache bootstrap before evaluating the first render. Delete the arbitrary timer. Include viewer identity/schema version in keys and retain sign-out clearing.
- **Acceptance:** Cold offline, cold online, and warm online openings each have one deterministic loading transition. Cross-account sign-in never displays another account’s cached rows.

#### CL-18 — Full-Page Messaging Has No Narrow-Screen Navigation Contract

- **Priority / evidence:** P1, Verified from layout.
- **Current state:** `compact` behavior applies to the popup, while the full page retains a side-by-side sidebar/thread layout with fixed minimum proportions.
- **User-visible failure:** On a phone-sized viewport the list and thread compete for width and there is no clear list → thread → back transition.
- **Root cause:** Responsiveness is tied to shell mode instead of available width.
- **Solution:** At the narrow breakpoint, show one pane at a time. A row opens the thread; a labeled Back control returns to the same list, tab, scroll offset, and search state.
- **Acceptance:** At supported narrow widths, no horizontal clipping occurs and list/thread navigation is fully operable by touch, keyboard, and browser Back.

---

## 10. Chat Transition Audit

### 10.1 Transition Matrix

| Entry point | Current target | Required target behavior |
|---|---|---|
| Existing row | Shared selected ID + `router.replace` | Atomic `openConversation`, owning tab selected, push history |
| Profile/message button | `?userId=...`, synthetic draft, then ensure DM | Local draft immediately; resolve existing DM; create durable row only on first send |
| Notification bell item | Usually routes toward a specific thread/message | Same atomic open transition, focus preserved, visibility-based read |
| Notification toast | Can open popup/list-highlight rather than direct thread | Explicitly consistent action or clearly different labels |
| Message search result | Select conversation, then set focused message | One atomic transition with conversation and message in one URL update |
| Application link | Conversation plus unused `applicationId` | Consume application context or remove the parameter |
| Popup “full screen” | Shared state plus route | Preserve exact thread/focus/draft in canonical page URL |
| Tab switch | Retains selected thread | Either select owning tab or clear thread by documented rule |
| Browser Back/Forward | Weak because of `replace` | Restore prior conversation/list/focus deterministically |

### 10.2 Transition Findings and Solutions

#### TR-01 — `applicationId` Is Written but Ignored

- **Priority / evidence:** P2, Verified.
- **Current state:** Project application links include `applicationId`, but the `/messages` page reads only user, conversation, and message parameters.
- **Impact:** The URL promises application-level context that is discarded.
- **Solution:** If the thread needs to focus an application workflow card, consume and validate the ID. Otherwise remove the parameter at its source.
- **Acceptance:** Every emitted message URL parameter has a documented reader and visible effect.

#### TR-02 — Notification Toast and Bell Do Not Share One Open Contract

- **Priority / evidence:** P1, Verified.
- **Current state:** A message notification’s bell item can route directly to a thread while the toast “Open” action can open a popup list/highlight path.
- **Impact:** Identical events produce different destinations and read timing.
- **Solution:** Define `openMessageNotification({conversationId, messageId, source})` and reuse it. If two destinations are intentional, label them explicitly (“Open chat” versus “View notifications”) and preserve the same unread/focus semantics.
- **Acceptance:** Toast, bell, OS notification, and activity feed open the same target or transparently labeled alternatives.

#### TR-03 — Popup State Has No True Closed State

- **Priority / evidence:** P2, Verified.
- **Current state:** `popupOpen` is set, but the UI primarily offers minimize; `setPopupOpen(false)` has no normal close path. Persisted chrome state can reopen unexpectedly after reload.
- **Impact:** “Open,” “minimized,” and “closed” are not cleanly represented.
- **Solution:** Replace the booleans with one enum (`closed | open | minimized`) or remove `popupOpen` if the intended product is always-available minimized chat. Persist drafts, not transient open chrome, unless restoration is an explicit feature.
- **Acceptance:** Close, minimize, reload, route to `/messages`, and return each produce one documented state.

#### TR-04 — Popup Keyboard Search Shortcut Is Inconsistent

- **Priority / evidence:** P1, Verified.
- **Current state:** The workspace advertises a command shortcut, but messaging shortcuts are enabled only in page mode. Top navigation can instead capture the command and open global search.
- **Impact:** The same shortcut invokes different search surfaces depending on focus and shell.
- **Solution:** Route the shortcut according to the active/focused surface. When the popup owns focus, open message-history search. Otherwise open top-navigation global search. Show only the shortcut the current surface actually supports.
- **Acceptance:** Keyboard behavior matches visible hint in page, popup, minimized popup, and non-message routes.

#### TR-05 — Popup Has No Accessible Surface Boundary

- **Priority / evidence:** P2, Verified.
- **Current state:** The popup lacks a complete dialog/complementary-region contract and focus return.
- **Impact:** Keyboard focus can escape into the covered page, and assistive technology receives weak context.
- **Solution:** Choose a modal or non-modal model. For modal, use dialog semantics and a focus boundary. For non-modal, use a labeled complementary region, preserve page access, support Escape/minimize, and return focus to the launcher.
- **Acceptance:** Opening announces “Messages,” tab order is predictable, Escape behavior is documented, and closing returns focus to the bell/chat launcher.

#### TR-06 — Popup Loading State Does Not Match the Product Skeleton

- **Priority / evidence:** P3, Verified.
- **Current state:** Dynamic import fallback is plain loading text.
- **Impact:** Opening the popup visually regresses from the application’s shimmer/skeleton language.
- **Solution:** Reuse the existing message workspace/list skeleton with fixed dimensions to avoid layout shift.
- **Acceptance:** Popup code loading, inbox loading, and thread loading use consistent reduced-motion-aware shimmer states.

#### TR-07 — New-Message Eligibility Differs From Other Entry Points

- **Priority / evidence:** P1, Verified.
- **Current state:** The recipient picker searches accepted connections, while profiles, applications, and other capability-gated entry points can expose messaging through different rules.
- **Impact:** A person may be messageable from one screen and absent from “New message,” or the reverse.
- **Solution:** Centralize a single recipient-eligibility query and capability reason. Reuse it in the picker and all message buttons.
- **Acceptance:** Every messageable user appears in the picker; every unavailable user has the same reason across surfaces.

#### TR-08 — Recipient Search Errors Masquerade as Empty Results

- **Priority / evidence:** P2, Verified.
- **Current state:** Search/request failure can render “No connections” or “No results.”
- **Impact:** Users cannot distinguish no data from network/server failure.
- **Solution:** Add typed loading, empty, offline, rate-limited, and error states with Retry while retaining the query text.
- **Acceptance:** Forced request failure never shows the empty-state copy.

#### TR-09 — Closing the Picker Does Not Invalidate an In-Flight Selection

- **Priority / evidence:** P1, Verified.
- **Current state:** A recipient selection awaits `ensureConversation`; if the user closes meanwhile, the eventual success can still select/open the chat.
- **Impact:** A conversation opens after the user explicitly canceled.
- **Solution:** Use an operation token tied to the modal-open generation. Ignore late completion after close or after a newer selection. Abort transport where supported.
- **Acceptance:** Close during slow ensure keeps the modal closed and does not change selection.

#### TR-10 — Other Rows Look Clickable During Recipient Resolution

- **Priority / evidence:** P2, Verified.
- **Current state:** Only the chosen row visibly disables while a shared guard rejects all other clicks.
- **Impact:** The UI accepts clicks visually but ignores them.
- **Solution:** Disable the complete result set during resolution or allow a newer choice to supersede the first. Show progress in the selected row and an accessible busy announcement.
- **Acceptance:** Every visually enabled row responds; every blocked row is disabled and announced.

#### TR-11 — Starting a Chat Can Create Durable Empty Conversations

- **Priority / evidence:** P1, Verified.
- **Current state:** Selecting a recipient calls `getOrCreateDMConversation` before a message is sent. The inbox generally hides rows without a last message, creating an internal conversation that is not represented consistently.
- **Impact:** Abandoned composers can create empty database records, ghost selection states, and cache/refetch discrepancies.
- **Root cause:** Draft intent and durable conversation identity are coupled.
- **Solution:** First resolve whether a DM already exists. For a genuinely new DM, keep a local draft and transactionally create the conversation with the first message. If schema constraints require early creation, define an expiration/cleanup policy and expose draft state consistently.
- **Acceptance:** Opening and abandoning 100 new-message drafts does not create 100 durable empty conversations.

#### TR-12 — New-Message Modal Contains Write-Only Cursor State

- **Priority / evidence:** P3, Verified.
- **Current state:** Cursor state is written but a ref is the operational source.
- **Impact:** Extra render/state complexity without product behavior.
- **Solution:** Delete the unused state and retain one pagination cursor owner.
- **Acceptance:** Pagination remains correct with no write-only state.

#### TR-13 — Recipient Picker Lacks Complete Combobox Semantics

- **Priority / evidence:** P2, Verified.
- **Current state:** The input relies on placeholder text and results do not form a fully labeled combobox/listbox relationship.
- **Impact:** Screen-reader and keyboard users have weak result count, selection, and loading feedback.
- **Solution:** Add an explicit label, `combobox`/`listbox` semantics, active descendant, arrow navigation, Enter selection, Escape close, and a polite live result-count/busy region.
- **Acceptance:** The picker is fully operable without a pointer and passes an accessibility scan plus manual screen-reader check.

#### TR-14 — Popup-to-Page Continuity Is Accidental

- **Priority / evidence:** P2, Verified.
- **Current state:** Shared selection often preserves a thread when opening full screen, but URL/store disagreement can break this continuity.
- **Impact:** Focused message, draft, reply context, or owning tab may be lost.
- **Solution:** Make “Open full screen” serialize the exact canonical state into one `/messages` URL and then close/minimize the popup intentionally.
- **Acceptance:** Thread, focused message, tab, and unsent draft survive popup → page; reopening popup follows a documented continuity rule.

---

## 11. Applications and Project-Group Conversation Parity

#### AP-01 — Applications Search State Exists Without an Input

- **Priority / evidence:** P2, Verified.
- **Current state:** `ApplicationsListV2` owns `searchQuery` and imports search UI support, but no search input is rendered.
- **Solution:** Delete the dead state/imports now. If application search is a requirement, add it through the same intentional, server-backed search model as other paginated lists.
- **Acceptance:** No unreachable application-search code remains, or a visible server-backed input returns complete paginated results.

#### AP-02 — Application Filter and Sort Operate Only on Loaded Pages

- **Priority / evidence:** P1, Verified.
- **Current state:** Filtering/sorting is performed client-side over the pages already fetched.
- **Impact:** A user can be told there are no matching applications while matching rows exist on unloaded pages; sort order is only locally correct.
- **Solution:** Move filter/sort parameters to the server action and query key, with cursor pagination under the selected order.
- **Acceptance:** Results and ordering are identical whether one page or all pages have been loaded.

#### AP-03 — Application and Project Rows Do Not Expose Selection

- **Priority / evidence:** P2, Verified.
- **Current state:** These list components do not receive/render the selected conversation ID consistently.
- **Impact:** A thread opens without a highlighted source row.
- **Solution:** Reuse the selected-row contract from Chats, including `aria-current`, focus restoration, and stable selection across refetch.
- **Acceptance:** Opening any application/project conversation highlights exactly one row and announces it as current.

#### AP-04 — Project-Groups List Contains No-Op and Unused Code

- **Priority / evidence:** P3, Verified.
- **Current state:** Unused search imports/state and a `sortedGroups = groups` no-op remain.
- **Solution:** Ponytail delete: remove the unused imports/state/alias. Reintroduce only with an implemented behavior and test.
- **Acceptance:** Static analysis shows no unused project-group search/sort code and behavior is unchanged.

#### AP-05 — Query Failure Becomes “No Applications/Groups”

- **Priority / evidence:** P1, Verified.
- **Current state:** Applications and project groups lack explicit request-error/retry states.
- **Solution:** Separate loading, first-page empty, filtered empty, cached stale, next-page failure, forbidden, and transport error.
- **Acceptance:** Forced failures never render “No applications/groups”; Retry preserves tab, filter, and selection.

#### AP-06 — Unread Language Differs Across Three Lists

- **Priority / evidence:** P2, Verified.
- **Current state:** Chats use a “New” attention treatment, Applications use a numeric red badge, and Project Groups expose no equivalent attention treatment.
- **Solution:** Derive one attention view model and apply a consistent visual/assistive pattern. A numeric count may supplement, but not replace, the semantic unread state.
- **Acceptance:** The same unread event has equivalent visual and screen-reader meaning in all three lists.

#### AP-07 — Unknown Application Status Falls Back to “Pending”

- **Priority / evidence:** P2, Verified.
- **Current state:** Incomplete status mapping can present an unknown/closed lifecycle state as pending.
- **Solution:** Make status rendering exhaustive at compile time. Preserve `unknown` as “Status unavailable” and explicitly support terminal/deleted/proposed states.
- **Acceptance:** Every server status has a fixture and unknown values never display as Pending.

#### AP-08 — Hand-Rolled Filter/Sort Popovers Are Incomplete

- **Priority / evidence:** P2, Verified.
- **Current state:** Popovers lack a complete `aria-expanded`, menu role, focus-management, keyboard, and Escape contract.
- **Solution:** Reuse the application’s existing accessible dropdown/menu primitive rather than extending another bespoke overlay.
- **Acceptance:** Menu state is announced, arrow/Enter/Escape work, and closing restores focus to its trigger.

#### AP-09 — Missing Conversation Rows Are Disabled Without Explanation

- **Priority / evidence:** P3, Verified.
- **Current state:** An application with no available chat conversation can be disabled with no reason or resolution.
- **Solution:** Explain whether messaging is unavailable, not started, closed, or permission-restricted. Link to application details when appropriate.
- **Acceptance:** Every disabled row exposes a reason and, when possible, a useful next action.

---

## 12. Search Ecosystem Audit

### 12.1 Search Surfaces Found

The source contains five overlapping search concepts:

1. **Top-navigation global search:** projects, profiles, project tasks, settings, and route-specific previews.
2. **Message-history search dialog:** server-backed search across message content and selected structured message metadata.
3. **New-message recipient search:** accepted-connection/capability candidate lookup.
4. **Conversation-list local filter:** implemented in the component but not connected.
5. **Applications-list search state:** implemented in state but no visible input.

The product only needs two messaging-specific search intentions today:

- **Find an existing message** across history.
- **Find a recipient** to start or resume a conversation.

The dormant list/application variants should be deleted unless the product explicitly wants a third operation: **filter my inbox**.

### 12.2 Current Global-to-Message Search Flow

1. On the Messages route, the top-navigation search entry dispatches `OPEN_MESSAGES_SEARCH_EVENT`.
2. `MessagesWorkspaceV2` listens for that browser event and opens a local dialog.
3. User input is debounced and passed to `useMessageSearch`.
4. The server action parses plain text and optional operators, performs full-text/structured matching, and returns result objects.
5. Selecting a result first selects the conversation and then assigns the target `messageId`.
6. The thread fetch injects surrounding context when necessary and the virtualizer attempts to focus the target.

### 12.3 Detailed Search Findings and Solutions

#### SE-01 — Search Ownership Is Duplicated

- **Priority / evidence:** P1, Verified.
- **Current state:** Top navigation and `MessagesWorkspaceV2` can both install command-key behavior on `/messages`.
- **Impact:** Duplicate `preventDefault`/open behavior and inconsistent popup versus page routing.
- **Solution:** Assign one shortcut owner. Prefer a shared search controller/context above top navigation and workspace; the active surface requests `openMessageHistorySearch()`.
- **Acceptance:** One keypress produces one state transition and one analytics event in every shell.

#### SE-02 — A Custom Event Can Be Lost

- **Priority / evidence:** P2, Verified.
- **Current state:** Search opening is a fire-and-forget browser `CustomEvent`.
- **Impact:** If the workspace listener is not mounted or hydrated, the user click has no durable state to consume.
- **Solution:** Replace the event with shared state/context or a URL-backed `search=open` flag. The receiver should be able to observe the latest state after mounting.
- **Acceptance:** Triggering search during slow workspace hydration opens it once hydration completes.

#### SE-03 — `CommandPalette` Retains a Dead Messages Branch

- **Priority / evidence:** P3, Verified.
- **Current state:** A messages-specific effect can dispatch the same custom event, but top navigation already intercepts messages before this branch is meaningfully used.
- **Solution:** After centralizing ownership, delete the dead branch and any unreachable message-search UI path.
- **Acceptance:** Source search finds one message-history open owner and one command-key handler for the active surface.

#### SE-04 — Search Copy Overpromises Its Dataset

- **Priority / evidence:** P1, Verified.
- **Current state:** The message dialog suggests searching “messages, people, projects,” while the backend primarily searches message content and selected structured title/summary fields. A plain participant or project name is not a reliable match.
- **Solution:** Either change copy to “Search message text” with documented filters, or intentionally add participant/conversation/project-title search. Do not advertise unsupported matching.
- **Acceptance:** Every noun in the placeholder can be found in a deterministic test.

#### SE-05 — One-Character Requests and Rate Control Are Inconsistent

- **Priority / evidence:** P1, Verified.
- **Current state:** Message search enables after any non-empty trimmed input with a 250 ms debounce. Global preview search uses normalized input, a two-character minimum, adaptive 450/250 ms debounce, bounded normalization, typed retry, and cooldown behavior.
- **Impact:** Message history can issue unnecessary server actions for one-character queries and has weaker abuse/load protection.
- **Solution:** Reuse the global query normalization contract where appropriate: Unicode-safe normalization, maximum length, two-character minimum, adaptive debounce, typed server rate limiting, and whitespace suppression. Existing message full-text/trigram indexes should be measured before adding infrastructure.
- **Acceptance:** Empty, whitespace, and one-character inputs issue zero history requests; Unicode queries remain intact; rate-limit feedback is explicit.

#### SE-06 — Message Search Errors Look Like “No Matches”

- **Priority / evidence:** P1, Verified.
- **Current state:** The dialog lacks a distinct `isError` branch.
- **Impact:** Server/network failure is misreported as a valid zero-result search.
- **Solution:** Render typed error copy, Retry, and offline/rate-limit states while keeping the user’s query and prior successful results where safe.
- **Acceptance:** A forced 500, offline state, and a true zero-result query render three different outcomes.

#### SE-07 — Result List Lacks Complete Keyboard and Assistive Semantics

- **Priority / evidence:** P1, Verified.
- **Current state:** Results are clickable buttons but do not form a complete combobox/listbox with active descendant, arrow navigation, selected state, and live result count.
- **Solution:** Reuse accessible command/listbox primitives already in the application. Implement Up/Down, Enter, Escape, Home/End, focus return, busy state, and polite result-count announcement.
- **Acceptance:** All search operations can be completed without a mouse and are correctly announced by VoiceOver/NVDA.

#### SE-08 — Results Are Not Distinguishable Enough

- **Priority / evidence:** P2, Verified.
- **Current state:** Rows omit or underrepresent sender, absolute/relative date, conversation type, project context, matched fragment highlighting, and attachment/file context.
- **Impact:** Similar messages are difficult to identify before opening.
- **Solution:** Return a slim display DTO with sender, conversation display title/avatar, timestamp, context label, matched snippet/ranges, and attachment summary. Highlight safely without injecting HTML.
- **Acceptance:** Two identical message bodies from different people/projects/dates are visually and accessibly distinguishable.

#### SE-09 — Group and Project Titles Are Derived Incorrectly

- **Priority / evidence:** P2, Verified.
- **Current state:** Search UI can derive the title from the first participant, and the backend does not consistently join the canonical project/group display title.
- **Solution:** Use the same canonical conversation display DTO proposed for the inbox. Search must never reinvent title rules.
- **Acceptance:** Search and inbox display identical title/avatar/context for every conversation type.

#### SE-10 — Search Returns Heavy Conversation Data It Does Not Reuse

- **Priority / evidence:** P2, Verified.
- **Current state:** The server hydrates full `ConversationWithDetails` data to support “ghost” results, but the client mainly extracts basic display data and still fetches the thread separately.
- **Impact:** Larger serialization and DB hydration without removing the next request.
- **Solution:** Ponytail shrink: return the minimal display DTO plus `conversationId`, `messageId`, snippet, timestamp, and focus metadata. Do not add cache-seeding complexity unless measurement proves it removes meaningful latency.
- **Acceptance:** Result payload size is materially reduced while all displayed fields and opening behavior remain correct.

#### SE-11 — `from:` Filtering Happens After a Limited Candidate Fetch

- **Priority / evidence:** P1, Verified.
- **Current state:** Sender filtering is applied in JavaScript after fetching an internal bounded candidate set.
- **Impact:** A valid sender match outside that candidate window is omitted. Current sanitization also weakens Unicode and multi-word-name behavior.
- **Solution:** Push sender filtering into SQL through the participant/sender join. Support quoted multi-word values and stable username/user-ID forms; preserve Unicode through normalization.
- **Acceptance:** `from:"Lakshmi CH"` and non-ASCII display names return complete paginated results beyond 200 candidate messages.

#### SE-12 — History Search Has No Pagination

- **Priority / evidence:** P1, Verified.
- **Current state:** Results stop at a fixed limit.
- **Impact:** Users cannot reach older matches and may assume the shown set is complete.
- **Solution:** Add cursor pagination with deterministic order, for example rank then `createdAt` then `id`; show Load more or infinite results with explicit progress/error.
- **Acceptance:** Searching a fixture with more than one page retrieves every result once with stable ordering.

#### SE-13 — Result Opening Is a Two-Step Transition

- **Priority / evidence:** P2, Verified.
- **Current state:** Result click selects the conversation, clears focus, then assigns the target message; URL updates can be split.
- **Impact:** Intermediate latest-message state, redundant routing, or a visible flash can occur.
- **Solution:** Introduce an atomic `openConversation({conversationId, messageId, tab, source})` action/reducer that updates URL and UI state once.
- **Acceptance:** Search result click renders no intermediate latest-thread frame and creates one history entry.

#### SE-14 — Unavailable Focus Target Has a Generic Failure Path

- **Priority / evidence:** P2, Verified.
- **Current state:** Context fetch/focus failure produces a generic toast and can leave an invalid `messageId` in the URL.
- **Solution:** Keep the conversation open, explain that the message was deleted/unavailable or could not load, clear only the invalid focus target, and offer Retry when transport-related.
- **Acceptance:** Deleted, access-revoked, and transient failure paths are distinct and do not strand the workspace.

#### SE-15 — Advanced Operators Are Undiscoverable

- **Priority / evidence:** P2, Verified.
- **Current state:** The backend supports operators such as `from:`, `has:`, `kind:`, `is:pinned`, and `in:project`, but the UI provides no syntax help.
- **Solution:** If these filters remain supported, add concise helper text, example chips, and accessible filter controls that generate syntax. Otherwise delete unsupported parser branches.
- **Acceptance:** Every supported operator is documented and tested, or removed.

#### SE-16 — Global Recents and Message Search Recents Do Not Share a Contract

- **Priority / evidence:** P3, Verified.
- **Current state:** Top-navigation global search stores context/user-scoped recents; delegated message history clears query on close and stores no equivalent.
- **Solution:** Decide intentionally. For privacy, the recommended default is no persisted raw message-search history; if recents are added, make them opt-in or easy to clear and user-scoped.
- **Acceptance:** Privacy copy and storage behavior agree; sign-out clears any persisted user-scoped search history.

#### SE-17 — Scope Is Not Clear When Applications or Projects Tab Is Active

- **Priority / evidence:** P2, Verified.
- **Current state:** The dialog searches message history across conversations even when opened from an applications or projects list.
- **Solution:** Label it “Search message history” and show the current scope. Optionally expose explicit All/Current conversation/Applications/Projects filters backed by server scope parameters.
- **Acceptance:** Users can predict whether a query filters the visible list or searches all message history.

#### SE-18 — Archived Conversations Can Surface Without Archive Context

- **Priority / evidence:** P2, Verified.
- **Current state:** Search membership filtering does not consistently exclude archived conversations, while the active inbox omits them.
- **Impact:** Opening a result can produce a thread with no visible source row.
- **Solution:** Either exclude archived conversations by default or label them “Archived” and provide unarchive/return behavior.
- **Acceptance:** Every search result has a reachable owning context after opening.

#### SE-19 — Filename Search Is Not Actually Implemented

- **Priority / evidence:** P2, Verified.
- **Current state:** `has:file` can filter attachment type, but attachment filenames are not part of the main search document.
- **Solution:** If the product promises file search, index/join normalized attachment filename and metadata. Otherwise label the behavior as “messages with files,” not “search files.”
- **Acceptance:** Searching a filename succeeds when advertised, or no UI/copy claims filename matching.

#### SE-20 — Debounced Queries Still Consume Server Work

- **Priority / evidence:** P3, Verified; production impact requires telemetry.
- **Current state:** Query keys prevent stale results from replacing newer ones, but previously launched server actions continue executing.
- **Solution:** Apply minimum length, adaptive debounce, server rate limit, bounded result fields, and pagination first. Measure request volume and latency before adding cancellation infrastructure.
- **Acceptance:** Telemetry shows bounded requests per search session and no stale result replacement; cancellation is added only if measured work remains excessive.

#### SE-21 — Ranking Needs a Deterministic Tie-Breaker

- **Priority / evidence:** P2, Verified.
- **Current state:** Rank/date ordering does not consistently include message ID as the final stable key.
- **Solution:** Add ID as the final order term and cursor component.
- **Acceptance:** Repeating a query while new messages arrive does not duplicate or omit tied rows across pages.

---

## 13. Test and Observability Audit

### 13.1 Verification Executed for This Extension

- `pnpm typecheck`: **Passed** during the audit session.
- Focused messaging contracts:
  - `messaging-unread-contract`
  - `message-attention`
  - `messages-v2-render-state`
  - `message-thread-anchor`
  - `message-preview-authority`
  - Result: **23 passed, 0 failed**.
- Focused global search/top-navigation contracts:
  - Result: **9 passed, 1 failed**.
  - Failure: `topnav-contract.test.ts` still expects a fixed `useDebounce(normalizeGlobalSearchQuery(query), 300)`, while production intentionally contains adaptive `450 ms` for short queries and `250 ms` for longer queries.

This failed assertion is a stale source-text contract, not proof that adaptive debounce is broken. It should be replaced with behavior tests for the actual debounce policy.

### 13.2 Coverage Gaps

#### QA-01 — Global Search E2E Only Proves the Dialog Opens

The current contextual search test does not type a message query, wait for results, select an old result, verify focus, verify browser history, or exercise failures.

#### QA-02 — Unread Rebound E2E Looks for an Obsolete Badge Selector

The test searches for a red numeric badge selector while the current Chats list uses the newer semantic “New” attention treatment. It can skip the assertion and create false confidence.

#### QA-03 — Popup Is Disabled in the Default E2E Authentication Mode

`ChatProvider` disables popup behavior when the E2E fallback environment flag is enabled, and the normal runner defaults to that mode. Popup selection, minimize, shortcut, notification-open, and page handoff therefore lack representative end-to-end coverage.

#### QA-04 — No Direct Conversation-List Behavioral Suite

There is no complete test for row selection, selected styling, same-row click, infinite pagination, cached stale data, background error, attention movement, touch actions, archive behavior, or scroll restoration.

#### QA-05 — No New-Message Race Suite

There is no reliable coverage for close-during-ensure, rapid recipient changes, request failure, duplicate DM resolution, abandoning an empty draft, keyboard recipient selection, or unauthorized recipient capability.

#### QA-06 — No Unified Search Contract Suite

There is no end-to-end matrix for one-character suppression, Unicode, quoted `from:`, filters, rate limiting, error versus no results, pagination, archived matches, deleted message focus, or deterministic ordering.

### 13.3 Required Acceptance Test Matrix

| Area | Required scenarios |
|---|---|
| Existing conversation | cold fetch, warm cache, offline cache, cached refresh failure, unauthorized ID, deleted ID |
| Rapid selection | A then B while A is slow; only B remains selected; A cannot overwrite |
| Same-row click | focus/reply/draft remain unchanged |
| URL/history | direct URL, notification URL, Back, Forward, bare `/messages`, invalid `messageId` |
| Tabs | DM from Applications/Projects, application deep link, project group, selected-row parity |
| Read state | old search result with newer unread, hidden document, minimized popup, partially visible last unread |
| Infinite list | one next-page request, retry, stable scroll, selected row across page merge |
| Swipe/archive | touch, pointer, keyboard, rollback, undo, archived view—or prove controls absent |
| New message | existing DM, new local draft, first-send creation, cancel during slow ensure, offline, rate-limited |
| Search | min length, Unicode, sender filter, attachment filter, no result, error, pagination, tie ordering |
| Search open | click, command key, during hydration, popup focus, page focus, result focus |
| Popup | open, close/minimize, reload, full screen, focus return, notification/toast entry |
| Accessibility | VoiceOver/NVDA labels, combobox keys, listbox keys, focus trap/region, live state |
| Responsive | list → thread → back on narrow view; no clipping; draft and scroll restoration |

### 13.4 Observability Required Before Scale Changes

Add low-cardinality measurements, not verbose per-message logs:

- `messages_open_source`: row, notification bell, toast, search, profile, application, popup handoff.
- Time from trigger to stable thread shell, cached content, and fresh content.
- Thread query failure code and retry outcome.
- Search normalized length bucket, latency, result count bucket, rate-limit/error code, and selected-result position.
- New-DM draft abandoned versus first message sent.
- Read watermark cause: visible observer only after consolidation.
- Conversation next-page request count and duplicate-request prevention.
- Popup state transitions and focus-return failures.

Never log raw message text, recipient query text, attachment filename, or private participant metadata.

---

## 14. End-to-End Target User Stories

### Story A — Open an Existing Conversation

1. **Start:** User sees a virtualized, paginated conversation list with accurate selected/unread states.
2. **Trigger:** User clicks conversation B.
3. **Transition:** One atomic action selects the owning tab and pushes `/messages?conversationId=B`.
4. **Loading:** Existing cached thread appears immediately with a non-blocking refresh indicator, or a fixed-size shimmer renders once.
5. **Resolution:** Thread B becomes interactive. Row B remains visibly selected and stable in position.
6. **Read:** Only incoming messages actually observed in the active viewport advance the watermark.
7. **Recovery:** Typed errors provide Retry or Back to messages; conversation A cannot overwrite B if its request resolves late.

### Story B — Open an Old Message From Search

1. **Start:** User opens “Search message history.”
2. **Trigger:** User enters at least two normalized characters or applies a documented filter.
3. **Search:** A labeled, keyboard-navigable result list shows sender, conversation, date, and highlighted context.
4. **Selection:** One action pushes a URL containing both conversation and message IDs.
5. **Transition:** The thread fetches/injects context and the existing virtualizer focuses the result.
6. **Read:** Newer unread messages remain unread until visible.
7. **Resolution:** Deleted/unavailable target clears only message focus and leaves the conversation usable.
8. **History:** Browser Back returns to the search dialog/query/results; Forward reopens the focused message.

### Story C — Start a New Direct Message

1. **Start:** User opens New message.
2. **Trigger:** User searches the canonical eligible-recipient dataset.
3. **Selection:** Existing DM is reused immediately; a new recipient creates only a local draft.
4. **Composition:** Closing the modal or draft never causes a late request to reopen it.
5. **Persistence:** The durable conversation and first message are created transactionally on Send.
6. **Resolution:** The conversation appears once in the inbox with correct preview, attention, and selected state.
7. **Failure:** Offline/transient failure keeps the draft/outbox recoverable and explains Retry.

### Story D — Open Messaging From a Notification

1. **Start:** A message notification arrives.
2. **Trigger:** User chooses toast, bell item, or OS notification.
3. **Transition:** All sources call the same open contract with conversation/message identity and source metadata.
4. **Display:** The exact message is focused in page or popup according to an explicit label.
5. **Read:** The notification/read watermark follows visible consumption, not query completion.
6. **Resolution:** Closing/minimizing follows the documented lifecycle without silently losing the target.

### Story E — Use Popup Search and Continue Full Screen

1. **Start:** Popup is open and owns focus.
2. **Trigger:** User invokes the displayed search shortcut.
3. **Search:** Message-history search opens inside the active messaging surface, not global project search.
4. **Selection:** The target thread/message opens atomically.
5. **Handoff:** “Open full screen” serializes conversation, focus, tab, and draft into the page transition.
6. **Resolution:** Focus returns correctly when the popup is minimized or closed.

### Story F — Recover From Offline or Stale Cache

1. **Start:** User opens messages without network.
2. **Display:** User-scoped cached list/thread content renders with a clear offline/stale indicator.
3. **Interaction:** Existing content remains readable; unsupported server operations explain their queued/disabled state.
4. **Recovery:** Reconnection performs one refresh, preserves selection/scroll/draft, and removes the stale indicator.
5. **Resolution:** No false empty state and no cross-account cached content appears.

---

## 15. Implementation Backlog and Ordering

### Phase 0 — Correct State Ownership (P1)

- [x] Define one typed `openConversation` transition containing conversation ID, optional message ID, owning tab, source, and history mode.
- [x] Make the page URL canonical; isolate popup selection state.
- [x] Replace user-selection `replace` with `push`; retain `replace` for normalization.
- [x] Consolidate read advancement into visible-message observation.
- [x] Add typed invalid/forbidden/error thread states.
- [x] Update or remove `applicationId`.

**Exit gate:** Deep links, old-message focus, Back/Forward, popup/page handoff, and old-search-result unread behavior pass automated tests.

### Phase 1 — Remove False and Dead Affordances (P1/P2)

- [x] Wire mute/archive fully or delete swipe controls and archive branches.
- [x] Delete dormant conversation-list search.
- [x] Delete applications search state and project-group no-op code.
- [x] Remove the dead `CommandPalette` message event branch.
- [x] Remove write-only new-message cursor state.
- [x] Replace incomplete memo comparator with a correct row view model.

**Exit gate:** No visible action lacks a handler; no unreachable search implementation remains.

### Phase 2 — Rebuild Search as One Coherent Contract (P1)

- [x] Centralize message-search open state/shortcut ownership.
- [x] Add normalized minimum-length, adaptive debounce, rate limiting, typed errors, and retry.
- [x] Return a slim canonical display DTO.
- [x] Move sender/scope filters into SQL.
- [x] Add stable cursor pagination and tie-breaker.
- [x] Add result context, keyboard/listbox semantics, and syntax help.
- [x] Define archived and filename-search behavior explicitly.

**Exit gate:** The full search acceptance matrix passes; UI copy exactly matches indexed fields.

### Phase 3 — Complete New-Chat Lifecycle (P1)

- [x] Centralize recipient capability.
- [x] Separate local draft from durable conversation creation.
- [x] Guard late async completion after modal close/newer selection.
- [x] Add typed error/retry and complete combobox behavior.

**Exit gate:** Abandoned drafts create no durable empty rows; slow/canceled flows cannot open unexpectedly.

### Phase 4 — List Parity, Cache, and Responsive Behavior (P1/P2)

- [x] Server-side application filter/sort.
- [x] Selection/error/unread parity across Chats, Applications, and Projects.
- [x] Bound visible presence subscriptions.
- [x] Replace timer-based IndexedDB bootstrap with user-scoped hydration.
- [x] Implement narrow-screen one-pane navigation.
- [x] Stabilize selected attention rows and timestamps.

**Exit gate:** All three lists share loading/error/selected/attention contracts and mobile navigation passes.

### Phase 5 — Tests, Telemetry, and Measured Optimization

- [x] Replace stale source-text debounce assertion with behavior tests.
- [x] Repair obsolete unread badge selector.
- [x] Add popup/page source contracts and retain the authenticated browser run as an operational gate.
- [x] Add privacy-safe transition/search/thread/read/draft/focus telemetry.
- [x] Profile before any Redis/Hono/partitioning decision; no unsupported infrastructure was added.

**Exit gate:** No P1 coverage gap remains; scale work is supported by production evidence.

---

## 16. Ponytail Keep/Delete/Shrink Ledger for This Extension

### Keep

- Shared presentation components where page and popup behavior is genuinely identical.
- TanStack Query for server-state caching and pagination.
- Existing `react-virtuoso` list and thread virtualization.
- Existing attention/read watermark primitives after establishing one read owner.
- Existing structured search indexes and parser features that are surfaced and tested.
- Existing outbox/draft resilience, while separating local draft identity from durable DM creation.

### Delete

- Dormant conversation-list local search unless inbox search is explicitly scheduled.
- Applications write-only search state and project-groups unused search/sort aliases.
- Nonfunctional swipe actions and archive branches unless implemented end to end.
- Dead `CommandPalette` messages event branch after search ownership is centralized.
- Write-only new-message cursor state.
- Arbitrary 50 ms IndexedDB wait.
- Duplicate window lifecycle read commits after observer ownership is established.
- Stale fixed-debounce source-text test.

### Shrink

- Full search conversation hydration → slim canonical result DTO.
- Multiple selection handlers → one typed atomic transition.
- Boolean popup state combinations → one state enum.
- Per-row display derivation → one conversation display view model.
- Per-surface unread styles → one attention presentation contract.
- Hand-rolled filter/search overlays → existing accessible primitives.

### Do Not Add Yet

- A second virtualizer library.
- Another client state manager.
- A second event bus.
- Redis, Hono, queue infrastructure, or table partitioning without measured need.
- Cache seeding complexity for search results before payload/latency measurement.

---

## 17. Audit Completion Checklist

- [x] Existing report read and preserved.
- [x] Conversation list traced from query/cache to virtualized row, selection, thread, read, pagination, and error states.
- [x] Existing-chat, new-chat, notification, search-result, popup/page, tab, and browser-history transitions traced.
- [x] Top-navigation, message-history, recipient, dormant conversation-list, and dormant application search paths audited.
- [x] Applications and project-groups conversation parity audited.
- [x] Accessibility, keyboard, responsive, cache, and stale/error behavior included.
- [x] Every verified defect above includes a root cause, solution, and/or acceptance contract.
- [x] Existing automated coverage inspected and focused tests executed.
- [x] Stale virtualization claim corrected.
- [x] Application source implementation completed.
- [ ] Runtime browser matrix and production observation-window validation completed. **Operational gate; instrumentation and test contracts are implemented.**

---

## Conditional High-Scale Architecture Blueprint (1 Million Active Users)

This blueprint is a capacity-planning option only. It cannot guarantee scale or frame rate without representative load tests, database/realtime telemetry, client profiling, and a cost comparison against tuning the current architecture:

```
[Client Web Browser]
       │
       ├─► [Edge CDN / Next.js SSR] (Static Shell + Hydrated Cache)
       │
       ├─► [Supabase Realtime / Redis PubSub] (Broadcast Channels for DMs)
       │
       └─► [API Worker Cluster / Hono] ──► [PostgreSQL + PgBouncer]
                                            (Partitioned DB by conversation_id)
```

1. **Database Schema & Indexing Optimization**:
   - Verify the existing query plan and indexes under representative message volumes first.
   - Consider hash partitioning by `conversation_id` only if measured table/index size, vacuum behavior, or write/read contention justifies the operational cost.
   - Validate whether the existing conversation/created-at index already covers the thread query before adding `CREATE INDEX idx_messages_conversation_created ON messages (conversation_id, created_at DESC)`.
2. **Thread Virtualization**:
   - Retain the existing `Virtuoso` bidirectional virtual list in `MessageThreadV2`.
   - Profile and tune overscan only after measuring real conversations; protect prepend anchoring, focus navigation, variable-height media, and latest-mode behavior with tests.
3. **Decoupled Realtime Fanout**:
   - Keep the current transport until connection counts, WAL volume, delivery latency, or provider quotas demonstrate a bottleneck.
   - If those limits are reached, compare Supabase Broadcast, managed pub/sub, and a queue-backed fanout design through a proof of concept. Preserve durable-write, ordering, authorization, idempotency, and reconnect semantics before migration.
4. **Evidence Gates**:
   - Load-test realistic concurrent connections, active conversations per client, message rate, reconnect bursts, search load, and attachment traffic.
   - Record p50/p95/p99 thread-open and send-to-render latency, read-write load, realtime delivery gaps, memory, and client frame rate.
   - Approve architecture changes only when the measured bottleneck cannot be removed through the Phase 0–5 application fixes.

---

## Final Audit Conclusion

The messaging system already has valuable foundations—shared shells, TanStack Query, optimistic/outbox behavior, realtime updates, attention primitives, and virtualized lists/threads. The additional audit shows that the largest usability defects come from **competing state owners and incomplete feature paths**, not from a lack of libraries.

The implementation should therefore begin with canonical navigation/selection and one visibility-based read owner, then remove nonfunctional controls, unify search, and complete the local-draft-to-first-send lifecycle. Only after those corrections and the acceptance matrix pass should the team optimize payloads or consider alternate infrastructure. That order produces the highest correctness gain with the smallest safe code surface, which is the central Ponytail recommendation.

---

# SQL and Data-Lifecycle Audit Addendum

## 18. Scope, Evidence, and Audit Method

This addendum extends the application and interaction audit through the complete PostgreSQL side of messaging. It is an audit and implementation specification; it does **not** claim that the migrations below have already been applied.

### 18.1 Code and database surface inspected

The trace covered:

- The messaging schema in `src/lib/db/schema/index.ts`: `conversations`, `dm_pairs`, `conversation_participants`, `messages`, `message_workflow_items`, `message_work_links`, `message_attachments`, `message_hidden_for_users`, `message_edit_logs`, `attachment_uploads`, `message_reactions`, `message_reports`, `message_read_receipts`, and `message_delivery_receipts`.
- Cross-domain messaging state in `role_applications`, projects, project members, roles, tasks, profiles, connections, blocks, notifications, and account deletion.
- All messaging server actions in `src/app/actions/messaging/_all.ts`, `v2.ts`, `features.ts`, `collaboration.ts`, and `linked-work.ts`.
- Message-linked application actions in `src/app/actions/applications/internal.ts`.
- Project-group creation/deletion, account export/hard deletion, and the private attachment download route.
- Messaging migrations from the initial messaging tables through reactions, receipts, workflow/work links, attachment sessions, RLS hardening, indexes, cleanup, realtime publication trimming, and the current notification contract.
- Live table definitions, constraints, indexes, policies, grants, trigger definitions, realtime publication membership, index statistics, query statistics, migration lineage, and point-in-time integrity aggregates.
- Existing source-contract and unit tests, database-governance scripts, and schema-drift checks.

### 18.2 Verification results

| Check | Result | Meaning |
|---|---:|---|
| `npm run check:db:live-lineage` | **Pass** | The connected database contains 128 canonical migration tags and 7 recognized legacy aliases. |
| `npm run check:sql-governance` | **Fail** | `0128_notification_activity_state_contract.sql` and its journal tag are absent from `standards/sql-governance.manifest.json`. The migration is live, but repository governance is incomplete. |
| Messaging RLS enabled | **Pass, incomplete protection** | RLS is enabled on the selected live messaging tables, but several policies authorize mutable ownership keys or use membership predicates that are too weak. |
| Generic database security advisor | **No messaging-specific warning** | This does not clear the policies. The confirmed defects are semantic authorization defects that a generic “RLS enabled” lint does not detect. |
| Live integrity aggregates | **Mixed** | Most cross-conversation and duplicate checks returned zero; preview, unread, DM-pair, upload-expiry, and persisted-URL anomalies remain. |

### 18.3 Evidence standard

Findings below are classified as:

- **Confirmed defect**: demonstrated by source, live catalog, or live data.
- **Structural defect**: a database invariant is not enforced, even when current rows happen to be valid.
- **Measured concern**: supported by live query/index statistics, with the limitations of a small/current workload stated.
- **Capacity gate**: should be tested before introducing infrastructure or partitioning; it is not presented as a current failure.

No recommendation to add Redis, queues, partitioning, or a second database abstraction is made without a measured need. The primary remedies are native PostgreSQL constraints, exact indexes, short transactions, keyset pagination, and narrower authorization.

### 18.4 Query-by-query coverage ledger

| Source | Query/mutation families traced | Audit disposition |
|---|---|---|
| `messaging/_all.ts` | DM get/create; inbox list; message page/context; send; mark read; archive/mute; search; edit/delete; pin read/write; unread total; upload/cancel/send-with-attachments; project groups; internal hydration, preview and unread reconciliation | Covered by SQL-003–008, SQL-032–084, SQL-099–116. |
| `messaging/v2.ts` | Inbox wrapper, single/batch conversation summary, thread-page composition, ensure DM, plain/structured send, workflow resolution | Covered by shared-access/N+1 findings, DM exactness, write idempotency, and workflow concurrency. |
| `messaging/features.ts` | Reaction toggle/read, report, read receipts, delivery receipts | Covered by SQL-012–013, SQL-021–022, SQL-076–080, SQL-114. |
| `messaging/collaboration.ts` | Structured catalog, structured send, workflow resolve, message-to-task and follow-up conversion | Covered by SQL-010, SQL-023, SQL-085–093. |
| `messaging/linked-work.ts` | Message work links and task source-message links | Covered by SQL-011, SQL-024, SQL-090–092. |
| `applications/internal.ts` | Status, apply, accept/reject/edit/withdraw/reopen, my/incoming/inbox/history, proposed-role decisions, invite options, DM/message history helpers | Covered by SQL-025, SQL-041, SQL-086–098. |
| Attachment API route | Attachment lookup, membership, hidden state, DM privacy, signed delivery | Covered by SQL-042–043 and SQL-099–107. |
| Project actions | Project-group materialization, member changes, role capacity, project deletion | Covered by SQL-035–038, SQL-087, project-group lifecycle acceptance. |
| Account export/deletion | Message/attachment export and hard-delete cleanup | Covered by SQL-039–040 and SQL-107. |
| Database trigger | Message-insert consistency for preview, unread, read watermark, archive | Covered by SQL-060–071 and SQL-081–083. |
| RLS/grants/publication | All selected messaging tables, role applications, realtime-published messaging tables | Covered by SQL-015–031 and the authorization matrix. |
| Migrations/catalog | Messaging schema history, constraints, indexes, policies, trigger, publication, manifest/journal | Covered by SQL-001–014, SQL-108–124. |

Helper queries were traced through their callers rather than counted as isolated “safe” units. This is important because an individually parameterized query can still be unsafe when its caller performs late filtering, non-atomic read/modify/write, silent truncation, or a cross-domain side effect.

---

## 19. Current SQL Ownership Model

The current database uses `conversation_participants` as both:

1. the membership/authorization edge for a conversation; and
2. a denormalized inbox projection containing unread count, read watermark, archive/mute state, and last-message preview.

`messages` is the durable timeline. A live `AFTER INSERT` trigger updates every participant’s inbox projection. Application code separately reconciles preview and unread state after hide, delete, edit, and read operations. Receipts, reactions, workflow items, work links, reports, attachments, and application metadata are stored in adjacent tables or message JSON.

This is a workable model, but it currently has three competing authorities:

```text
messages timeline
      │
      ├── insert trigger ──► participant preview + unread
      │
      ├── server actions ──► preview/unread reconciliation
      │
      └── per-message receipt rows + participant read watermark
```

The central SQL correction is therefore not a wholesale rewrite. It is to make the timeline authoritative, make participant projection updates atomic and monotonic, and stop allowing clients or concurrent reconciliation jobs to rewrite derived fields freely.

---

## 20. Live Data Snapshot and Confirmed Drift

The following is a point-in-time snapshot of the connected development database. Counts may change, but each class requires a durable invariant or cleanup procedure.

| Condition checked | Live result | Required resolution |
|---|---:|---|
| DM conversations without a `dm_pairs` row | **2** | Backfill only conversations whose exact participant set is two distinct users; quarantine malformed conversations. |
| Expired attachment sessions still nonterminal | **3** | Add an idempotent cleanup job and terminal expiration transition. |
| Persisted attachment URLs that look signed/token-bearing | **6** | Persist only storage path/object key; generate short-lived access URLs at read time. |
| Participant `last_message_id` not equal to latest visible message | **1** | Repair once, then use compare-and-set/transactional preview maintenance. |
| Participant unread count different from timeline-derived unread | **4 rows** | Repair once, then make read/insert operations lock-safe and monotonic. |
| Stored unread across the four drifted rows | **81** | Denormalized state is materially overstated. |
| Timeline-derived unread across those rows | **3** | Confirms reconciliation correctness, not merely formatting, is broken. |
| `application_decision` metadata messages | **0** | The reader is filtering a kind the writer does not create. |
| `application_update` metadata messages | **4** | Confirms the application-decision history kind mismatch. |
| Cross-conversation replies | **0** | Current data is clean; add a database invariant so it stays clean. |
| Cross-conversation read/last-message pointers | **0** | Current data is clean; missing composite foreign keys remain structural defects. |
| Negative unread counts | **0** | Current data is clean; add `CHECK (unread_count >= 0)`. |
| Own read/delivery receipts | **0** | Current data is clean; current APIs/policies can still create them. |
| Duplicate role applications or pending project invites | **0** | Current data is clean; workflow invite uniqueness is still not atomic. |

The data repair must be part of the migration rollout, not a manual dashboard-only correction. Otherwise the same drift reappears after the next race.

---

## 21. Complete SQL Finding Register

### 21.1 Schema, lineage, and invariant findings

| ID | Sev. | Current state and root cause | End-to-end solution |
|---|---|---|---|
| SQL-001 | P1 | Live `dm_pairs` has a legacy UUID `id` primary key plus a unique user pair; Drizzle declares a composite primary key and no `id`. `CREATE TABLE IF NOT EXISTS` preserved the legacy shape. | Add an explicit forward migration to converge the live table and update Drizzle to the chosen canonical shape. Do not edit migration `0020`. |
| SQL-002 | P1 | The live legacy `dm_pairs` table is missing the intended distinct-user check. | Add `CHECK (user_low <> user_high)` as `NOT VALID`, repair/quarantine violations, then validate. |
| SQL-003 | P1 | Two live DM conversations have no pair registry row. | Backfill only exact two-user DMs; report and quarantine zero-, one-, or three-plus-member DMs. |
| SQL-004 | P1 | Nothing at the database boundary guarantees a DM’s participant set is exactly its pair. | Restrict participant writes to server code and perform pair + two participant inserts in one transaction. Add a deferred constraint trigger only if direct SQL writers remain. |
| SQL-005 | P1 | `conversation_participants.last_read_message_id` is not constrained to the same conversation. | Add a composite FK from `(last_read_message_id, conversation_id)` to `messages(id, conversation_id)`. |
| SQL-006 | P1 | `last_message_id` is not constrained to the participant conversation. | Add the same-conversation composite FK and preserve the supporting `messages(id, conversation_id)` unique constraint. |
| SQL-007 | P2 | `last_message_sender_id` has no profile FK and may drift from `last_message_id`. | Prefer deriving sender from the referenced message during repair; retain the denormalized column only if the read saving is measured, and add its FK. |
| SQL-008 | P1 | `unread_count` has no nonnegative constraint. | Repair drift, then add `CHECK (unread_count >= 0)`. |
| SQL-009 | P1 | A reply can reference a message from another conversation because only the message ID is constrained. | Add a same-conversation composite reply FK or a constrained trigger. Define delete behavior that nulls only `reply_to_message_id`, not `conversation_id`. |
| SQL-010 | P1 | Workflow items independently reference a conversation and message without proving they match. | Add a composite message/conversation FK after backfill. |
| SQL-011 | P1 | Work links have the same split-reference defect for source message and conversation. | Add the composite FK and validate existing rows. |
| SQL-012 | P1 | `message_reports.conversation_id` is nullable. Its composite FK uses `MATCH SIMPLE`, so null bypasses the conversation/message check. | Backfill from `messages`, make the column `NOT NULL`, then validate the composite FK. |
| SQL-013 | P1 | `reportMessage` currently omits `conversation_id`, guaranteeing future null report rows. | Insert the selected message’s conversation ID and return a conflict-safe report result. |
| SQL-014 | P2 | Message type, workflow kind/status/scope, and attachment-upload status are text columns with TypeScript-only unions. | Add native `CHECK` constraints or PostgreSQL enums after enumerating every deployed value. Reject unknown values at the API boundary as well. |

### 21.2 RLS, grants, and mutable-authority findings

| ID | Sev. | Current state and root cause | End-to-end solution |
|---|---|---|---|
| SQL-015 | P0 | Participant INSERT checks only `user_id = auth.uid()`. An authenticated user who knows a conversation UUID can insert themselves into it, then satisfy message SELECT membership. | Revoke direct participant INSERT from browser roles. Route membership creation through authorized server actions/RPCs that prove DM pair, project membership, or invitation acceptance. |
| SQL-016 | P0 | Participant UPDATE keeps only `user_id = auth.uid()` and permits changing `conversation_id`, unread, read pointer, preview, and sender fields. | Revoke client UPDATE or grant only user-owned preference columns (`muted`, `archived_at`) through separate guarded operations. Derived fields are server/trigger-owned. |
| SQL-017 | P1 | Conversation INSERT is open to any authenticated user without an allowed-type/ownership contract. | Make conversation creation server-only; validate type and create conversation + participant edges atomically. |
| SQL-018 | P0 | A sender may UPDATE their message and change conversation, creation time, client ID, metadata, or type because identity/immutable fields are not fixed by policy. | Revoke direct message UPDATE. Server edit may change only content/structured editable fields and `edited_at`, guarded by sender, deletion state, and time policy. |
| SQL-019 | P1 | Hidden-message rows are protected only by `user_id = auth.uid()`; membership and message/conversation consistency are not checked. | Require a same-conversation message join and active participant row. Do not allow identity-key UPDATE. |
| SQL-020 | P1 | Attachment-upload policies allow a user to mutate their conversation ID, storage path, status, and expiry freely. | Make sessions server-owned after creation; use conditional state transitions and column-level permissions if direct upload initialization remains. |
| SQL-021 | P1 | Read-receipt UPDATE/DELETE is based on receipt ownership, so identity keys can be moved after a valid insert. | Use immutable receipt identity, INSERT/DELETE only, with message membership and `sender_id <> auth.uid()` checks. |
| SQL-022 | P1 | Delivery receipts have the same mutable-identity and self-receipt exposure. | Apply the same immutable and membership contract. |
| SQL-023 | P1 | Workflow UPDATE authorizes the old creator/assignee and checks only that one new party equals the user; it permits moving message, project, conversation, status, and parties. | Make workflow resolution server-only; update only status/resolution columns with a pending-state compare-and-set. |
| SQL-024 | P1 | Work-link UPDATE likewise allows ownership-bearing columns and target identity to move. | Make creation/restoration/deletion server-only or expose narrow RPCs that cannot change source/target identity after insert. |
| SQL-025 | P0 | `role_applications` UPDATE allows applicant or project admin to update the entire row. An applicant can potentially change project, role, status, decision fields, or creator-owned data through the database API. | Revoke browser UPDATE; use separate server transitions for withdraw, accept, reject, propose, and reopen with explicit actor/state checks. |
| SQL-026 | P0 | Live `anon` and `authenticated` table grants include broad INSERT/UPDATE/DELETE and also REFERENCES, TRIGGER, and TRUNCATE on selected messaging tables. RLS is row-DML protection and does not authorize a broad TRUNCATE surface. | Revoke all broad table grants; regrant exact SELECT and narrow DML only where a browser operation is deliberately supported. Keep TRUNCATE/TRIGGER/REFERENCES off client roles. |
| SQL-027 | P1 | Several policies are declared to broad/public roles rather than only the intended authenticated role. | Recreate policies `TO authenticated`, revoke `anon`, and test anonymous access explicitly. |
| SQL-028 | P1 | RLS is enabled but not forced; owner/server sessions bypass it. This is acceptable only if every server action independently authorizes. | Document the trusted server role, keep server checks mandatory, and run separate RLS tests under real authenticated JWT roles. |
| SQL-029 | P2 | Generic security lint reports no messaging issue because it checks policy presence, not semantic immutability or authorization. | Add repository-owned RLS regression tests for known-ID attacks and cross-account mutation. |
| SQL-030 | P1 | Realtime SELECT authorization depends on these policies; permissive membership insertion makes realtime data exposure part of SQL-015’s impact. | Fix membership authorization before treating filtered realtime subscriptions as private. |
| SQL-031 | P2 | Column ownership is implicit inside JSON/rows rather than enforced by permissions. | Define a column-ownership matrix: client preference, server command, trigger-derived, or immutable. Encode it in grants and actions. |

### 21.3 Conversation, DM, group, and inbox-query findings

| ID | Sev. | Current state and root cause | End-to-end solution |
|---|---|---|---|
| SQL-032 | P1 | Inbox query order uses `COALESCE(participant.last_message_at, conversation.updated_at)` and a conversation-ID tie-breaker, while available indexes use different keys. | For nonempty inbox rows, order by the authoritative participant tuple `(last_message_at DESC, conversation_id DESC)` and add the exact partial index. |
| SQL-033 | P2 | Legacy timestamp-only cursor compatibility can skip rows sharing a timestamp. | Expire the legacy cursor format or translate it into a full tuple; all new cursors must include timestamp and stable ID. |
| SQL-034 | P1 | Hidden/deleted preview reconciliation occurs after page selection, so order/cursor decisions may use stale preview state. | Reconcile inside the hide/delete transaction using compare-and-set, before future list reads. |
| SQL-035 | P2 | Project-group listing uses OFFSET and mutable update time. Inserts/updates can duplicate or omit rows, and deep pages degrade. | Use keyset pagination on `(last_message_at, conversation_id)` with one exact index. |
| SQL-036 | P1 | Lazy project-group creation selects only the first 500 project members. Larger projects silently lose participants. | Use `INSERT … SELECT` from all eligible members plus owner in the same transaction; return inserted/expected counts and fail on mismatch. |
| SQL-037 | P1 | Project deletion sets the linked conversation’s project ID to null and can leave an orphan project-group timeline. | Capture the conversation ID and apply an explicit retain/archive/delete policy in the project-deletion transaction. |
| SQL-038 | P2 | Project deletion only updates top-level `metadata.projectId`, missing structured entity references. | Stop using JSON as the primary FK. Until normalized, update both canonical paths with `jsonb_set` and test them. |
| SQL-039 | P1 | Account hard deletion removes participant/pair rows but can leave the other user with a one-sided DM and sender-null history. | Choose and implement one policy: delete the DM, or retain an anonymized tombstone and a valid remaining conversation. Do not leave half-state. |
| SQL-040 | P1 | Auth identity deletion occurs before the database cleanup transaction; a DB failure leaves authentication removed while application data remains. | Perform preflight, durable deletion request, database cleanup, then auth deletion with a resumable compensation job. |
| SQL-041 | P1 | DM fallback lookup in application flow can select a conversation containing both users without proving it has exactly those two users. | Resolve through `dm_pairs`; legacy fallback must require type `dm` and an exact two-user set. |
| SQL-042 | P2 | Attachment access infers a DM from `participants.length === 2`, so a two-person group is treated as a DM and a malformed DM is not. | Select `conversations.type` and, for DM rules, validate the `dm_pairs` record. |
| SQL-043 | P2 | Attachment route accepts an unvalidated attachment ID that can fail as a database UUID cast instead of returning a stable 400/404. | Parse UUID at the boundary and return a non-enumerating not-found response. |
| SQL-044 | P2 | Inbox participant hydration fetches participants separately after the page query, widening the consistency window. | Use one stable snapshot/transaction or a bounded aggregate query for the selected page; avoid a giant all-in-one query unless measured. |

### 21.4 Thread, context, hydration, and search findings

| ID | Sev. | Current state and root cause | End-to-end solution |
|---|---|---|---|
| SQL-045 | P2 | Message keyset pagination correctly uses `(created_at, id)`, but the index stops at `created_at`. | Add `(conversation_id, created_at DESC, id DESC)` and verify `getMessages`/context plans. |
| SQL-046 | P2 | Message and context cursor IDs are not consistently UUID-validated. | Validate cursor schema/version, timestamp, and UUID before SQL. |
| SQL-047 | P2 | Thread V2 launches summary, messages, and pinned reads in parallel; each repeats authentication, membership, conversation, profile/privacy, and hydration work. | Establish one server-side access context and reuse it across the bounded reads. |
| SQL-048 | P2 | Hydration performs many secondary queries: profiles, replies, hidden state, attachments, reactions, workflow, participant counts, delivery counts, and read counts. | Keep batch queries, eliminate duplicates, and measure. Consider a CTE/JSON aggregate only for proven round-trip cost. |
| SQL-049 | P2 | Project-group summary loops over as many as 50 conversation IDs and calls a per-conversation resolver, creating an N+1 path. | Batch project-group summaries by IDs in one authorized query. |
| SQL-050 | P1 | Search builds a normalized content + structured title/summary `tsvector`, but the live GIN index covers only `to_tsvector('english', coalesce(content,''))`. PostgreSQL cannot use that index for the current expression. | Add a stored generated `search_document` with one exact expression and a GIN index; query that column. |
| SQL-051 | P2 | Search uses English stemming for potentially multilingual chat. | Adopt `simple` configuration unless product language detection is explicit and tested. |
| SQL-052 | P1 | `from:` and relationship/privacy filters run after a fixed candidate cap, making valid results disappear when disallowed candidates occupy the cap. | Push sender, membership, block/privacy, and hidden predicates into SQL before `LIMIT`. |
| SQL-053 | P1 | Search performs relationship/privacy checks after selection and may run per-result queries. | Join/`EXISTS` against authorized participants and relationship state in the candidate query. |
| SQL-054 | P2 | Search has an internal cap of 200 and no durable result cursor. | Return a stable `(rank, created_at, id)` cursor and a documented maximum page size. |
| SQL-055 | P2 | Search ordering lacks a complete deterministic ID tie-break in every branch. | Use rank, timestamp, and UUID in both ordering and cursor predicate. |
| SQL-056 | P2 | Limit parsing is not consistently clamped against negative/NaN inputs. | Use one integer input parser with explicit min/max and reject malformed values. |
| SQL-057 | P2 | Search returns heavy conversation hydration that the navigation transition does not reuse. | Return a slim result DTO: message identity/snippet, sender, conversation display key, and authorized target. |
| SQL-058 | P3 | Filenames are not part of message search despite attachment search expectations. | Add normalized attachment filename to a dedicated search document only if the UI exposes that operator; otherwise document the exclusion. |
| SQL-059 | P2 | Pinned-message query casts JSON `pinnedAt`; malformed metadata can abort the query. | Normalize pins into a `message_pins` table or validate/backfill before a generated typed column. |

### 21.5 Unread, preview, read-watermark, and receipt findings

| ID | Sev. | Current state and root cause | End-to-end solution |
|---|---|---|---|
| SQL-060 | P1 | Live unread drift exists: four rows store 81 unread while the timeline implies 3. | Run a repair migration/job, then fix the races below before enabling ongoing drift alerts. |
| SQL-061 | P1 | Reconciliation reads participants, executes one count per participant, and updates later. A concurrent insert can increment between count and update, then be overwritten. | Lock target participant rows or compute/update in one statement under transaction; never overwrite a newer trigger increment. |
| SQL-062 | P1 | Mark-read reads membership without `FOR UPDATE`; concurrent read commits and message inserts can regress or lose unread state. | Lock the participant row, compare full watermark tuple, and conditionally advance only. |
| SQL-063 | P1 | Read-watermark lookup by message ID is not conversation-qualified in every predicate. Missing composite FK increases impact. | Query by `(message_id, conversation_id)` and add the composite FK. |
| SQL-064 | P1 | Mark-read backfills only 200 receipt rows but advances the watermark beyond the whole range, so older receipts are never created. | Remove the silent cap, batch with a durable cursor, or replace exact receipts with participant watermarks. |
| SQL-065 | P1 | Receipt range boundaries use timestamps only. Messages sharing a timestamp can be skipped or double-counted. | Compare the full `(created_at, id)` tuple. |
| SQL-066 | P2 | Marking a conversation read also unarchives it; this data side effect is not a clearly owned product rule. | Decide the contract. If reading should not unarchive, remove the update; if it should, test and document it. |
| SQL-067 | P2 | Notification read synchronization happens outside the message-read transaction and only on a derived zero-unread outcome. | Use an outbox/event written in the same transaction or make the independent state explicitly eventually consistent and idempotent. |
| SQL-068 | P1 | Preview repair selects a candidate and later writes unconditionally; a new message can arrive between those statements and be replaced by the stale candidate. | Update only `WHERE last_message_id = :stale_id` or lock the participant and timeline range. |
| SQL-069 | P1 | Live data contains one participant preview drift row. | Repair it and add a scheduled invariant query/metric until race fixes prove stable. |
| SQL-070 | P1 | Insert trigger updates preview with every inserted message regardless of chronological tuple. Late/imported messages can regress inbox ordering. | Update preview only when `(NEW.created_at, NEW.id)` is newer than the stored tuple. |
| SQL-071 | P2 | `getUnreadCount` trusts the denormalized total, so drift propagates to global badges. | Keep the fast counter after fixing atomic maintenance; compare it to timeline-derived samples in observability. |

### 21.6 Message write, edit, delete, reaction, and receipt API findings

| ID | Sev. | Current state and root cause | End-to-end solution |
|---|---|---|---|
| SQL-072 | P2 | Message idempotency is correctly scoped to conversation/sender/client ID, but blank/oversized client IDs are not constrained natively. | Trim/validate and add a length/nonblank check when client ID is nonnull. |
| SQL-073 | P2 | Nullable sender semantics make system-message idempotency ambiguous. | Give system events an explicit actor/event idempotency key or disallow client IDs when sender is null. |
| SQL-074 | P1 | Edit authorization/read occurs outside the edit-log transaction, and the update is by message ID. Concurrent edit/delete can log stale state or overwrite a winner. | `SELECT … FOR UPDATE` inside the transaction or use a guarded `UPDATE … RETURNING`; write the edit log from the locked previous row. |
| SQL-075 | P1 | Delete/hide/read/reconcile steps are split across transactions and whole metadata objects can be written from stale reads. | Move state change and projection repair into one short transaction; use targeted `jsonb_set` only as an interim measure. |
| SQL-076 | P1 | Reaction toggle is check-then-insert/delete without a transaction. Same-user races hit uniqueness; concurrent summary writers lose counts. | Use atomic insert/delete semantics and derive reaction summary from `message_reactions`. |
| SQL-077 | P1 | `messages.metadata.reactionSummary` duplicates authoritative reaction rows and is updated as a stale whole object. | Delete the persisted summary after clients read aggregated reaction rows or a view. |
| SQL-078 | P2 | Read receipt API silently slices input to 50 IDs. | Reject oversized requests or return a continuation contract; never silently ignore caller input. |
| SQL-079 | P2 | Delivery receipt API silently slices to 100 and has different mismatch behavior from read receipts. | Use one receipt-batch contract with explicit accepted/rejected IDs and maximum size. |
| SQL-080 | P1 | APIs/policies do not consistently reject receipts for the user’s own message. | Filter or reject where `messages.sender_id = viewer`; enforce it in the narrow server write path. |
| SQL-081 | P2 | Message insert trigger writes every participant row for every message, including group conversations. Live statement statistics show meaningful insert time even at small scale, but do not isolate the trigger as the sole cause. | Benchmark group sizes and trigger time. Keep for now, optimize its predicate/index, and consider a group unread watermark only if measured fanout becomes limiting. |
| SQL-082 | P2 | Insert trigger always clears archive state for sender and recipients, mixing delivery with an archive product rule. | Decide whether incoming/sent activity should unarchive; encode one tested rule. |
| SQL-083 | P2 | There is no edit/delete/hide trigger; correctness relies on separate application reconciliation paths. | Prefer one server mutation procedure/transaction per operation. Add a trigger only where multiple legitimate writers cannot be consolidated. |
| SQL-084 | P2 | Message content/attachment/structured validity is application-only. Empty or incoherent rows can be written by another privileged path. | Add cautious checks: allowed type, valid content-or-attachment/structured payload, metadata object shape, and bounded content/client IDs. |

### 21.7 Workflow, work-link, task, and application-message findings

| ID | Sev. | Current state and root cause | End-to-end solution |
|---|---|---|---|
| SQL-085 | P0 | Workflow resolution reads pending state, then updates without `WHERE status='pending'`. Concurrent accept/decline requests can both execute side effects and send notifications. | Lock the workflow row or use `UPDATE … WHERE status='pending' RETURNING`; only the winning transaction performs membership/capacity/task effects. |
| SQL-086 | P1 | Pending project-invite duplicate detection loads rows and filters JSON role ID in application code. Concurrent requests can both pass. | Normalize `role_id` and add a partial unique index for pending invite identity. |
| SQL-087 | P1 | Role capacity and invite resolution are not guaranteed to share one lock/order across every path. | Lock the role/capacity row before the workflow row in a documented global order, then conditionally resolve. |
| SQL-088 | P1 | Convert-message-to-task is transactional for task + link, but repeated requests can create multiple tasks before link uniqueness stops them. | Claim an idempotency record or source-action unique key before task creation. |
| SQL-089 | P2 | Follow-up creation has the same repeated-action duplicate risk. | Add a scoped idempotency key or partial active uniqueness that matches the product rule. |
| SQL-090 | P1 | Work-link restore updates all deleted historical matches. Multiple tombstones can be restored together and collide with the active partial unique index. | Use total unique source/target identity and `ON CONFLICT DO UPDATE SET deleted_at = NULL`, or lock/restore exactly one canonical row. |
| SQL-091 | P1 | Polymorphic work-link target IDs do not have database FKs, and target project can disagree with a task. | Use typed link tables or a validated trigger. At minimum join the target table and verify project during every mutation/read. |
| SQL-092 | P1 | `readTaskSourceMessageLinksAction(projectId, taskId)` authorizes `projectId` but filters links only by task ID. | Add `target_project_id = projectId` and join `tasks` on both ID and project. |
| SQL-093 | P2 | Role-full sweeps query workflow JSON for role ID. | Normalize role ID into a typed indexed column. |
| SQL-094 | P1 | Application decision reader filters `metadata.kind = 'application_decision'`; writers create `application_update`. Live counts are 0 versus 4. | Store decision reason/code on the application/event row and read it directly. As an interim repair, support the canonical writer kind and backfill. |
| SQL-095 | P1 | Application timeline/history is merged into message JSON with read-modify-write. Concurrent decisions/reopens can lose events. | Introduce an append-only `application_events` table with actor, transition, reason, and time; render a message projection from it. |
| SQL-096 | P1 | Inbox applications loads all role applications and invites, merges/sorts, then OFFSET-slices in JavaScript. | Use SQL `UNION ALL` into a canonical projection with keyset `(event_at, source, id)`. |
| SQL-097 | P2 | My/incoming application compound cursor includes source, but predicates/order do not consistently include it. Identical timestamp/UUID combinations across sources can duplicate/skip. | Perform the union in SQL and use the complete tuple in predicate and order. |
| SQL-098 | P2 | Runtime fallback catches missing application columns after deployment. This masks schema drift and gives paths different semantics. | Once lineage is confirmed, remove compatibility catches and make catalog drift a deployment failure. |

### 21.8 Attachment storage and cleanup findings

| ID | Sev. | Current state and root cause | End-to-end solution |
|---|---|---|---|
| SQL-099 | P1 | Upload session is inserted before conversation membership/ownership is validated. | Authorize the conversation first, then create the session with bound user/conversation/path. |
| SQL-100 | P1 | `validateAttachmentOwnershipForConversation` exists but has no caller in the send path. | Call it inside the same send transaction or replace it with one conditional session claim query. |
| SQL-101 | P0 | Send-with-attachments trusts supplied storage path/prefix and does not atomically claim `uploaded` sessions for the user/conversation. | `UPDATE attachment_uploads SET status='committed' WHERE user_id=? AND conversation_id=? AND status='uploaded' AND id IN (…) RETURNING …`; require exact count before inserting attachments/message. |
| SQL-102 | P1 | Three live upload sessions are expired but nonterminal; there is no complete cleanup worker. | Add an idempotent scheduled cleanup using `FOR UPDATE SKIP LOCKED`, object deletion, and terminal `expired/failed` transition. |
| SQL-103 | P0 | Six live attachment URLs look signed/token-bearing, and `message_attachments.url` requires a persisted URL. Tokens in durable rows can leak and expire. | Store only private storage path/object key; issue short-lived URLs through the authorized attachment route. Backfill and make/drop URL after clients migrate. |
| SQL-104 | P2 | Upload status transition updates do not uniformly include previous status, allowing regression/replay. | Define a state machine and use compare-and-set transitions only. |
| SQL-105 | P2 | Attachment count, upload client ID length, size, and metadata dimensions are not all native/boundary constrained. | Add bounded API validation and safe database checks; keep binary size enforcement in storage/server path. |
| SQL-106 | P1 | Database/session/object cleanup is not one durable lifecycle; failure can strand storage objects or rows. | Record cleanup intent/state and make deletion retries idempotent. Do not try to make object storage part of a PostgreSQL transaction. |
| SQL-107 | P2 | Account cleanup finds sender-owned attachments but long-lived URL/path and group-retention semantics are not explicit. | Define whether retained group history keeps objects under an application service owner; verify access after sender deletion. |

### 21.9 Index, query-plan, and write-amplification findings

| ID | Sev. | Current state and root cause | End-to-end solution |
|---|---|---|---|
| SQL-108 | P1 | Live full-text index expression does not match current search SQL; its scan count is zero. | Replace it with the exact generated search document index and validate with `EXPLAIN (ANALYZE, BUFFERS)` on representative data. |
| SQL-109 | P2 | Structured trigram/title/summary and several search indexes show zero scans. | Do not drop solely from current stats; first fix query/index expression, reset/observe through a release window, then remove proven unused indexes. |
| SQL-110 | P2 | Participant live index `(user_id,last_message_at,last_message_id)` is heavily used but missing from Drizzle, while query tie-break uses conversation ID. | Converge schema and query on one exact partial inbox index; remove the undocumented drift index only after replacement is live. |
| SQL-111 | P2 | Thread index lacks the ID tie-break required by keyset pagination. | Add the exact three-column index and confirm it serves both page and context queries. |
| SQL-112 | P2 | Several single-column indexes are covered by composite indexes or show no scans: sender-only message index, some receipt, reaction, role-application, participant, and work-link indexes. | Build a candidate list, verify FK support and real plans, observe since stats reset, then `DROP INDEX CONCURRENTLY` one release after replacement. |
| SQL-113 | P2 | `messages(deleted_at) WHERE deleted_at IS NULL` indexes the dominant null state and may be low-selectivity. | Retain only if a measured plan uses it; a query for nondeleted messages usually needs conversation/order keys instead. |
| SQL-114 | P2 | Receipt and reaction tables have overlapping unique, message, conversation, and user indexes. | Map each production query/FK to one left-prefix index; remove only true duplicates. |
| SQL-115 | P2 | Live message insert statements show nontrivial mean time and the trigger updates O(participants), but the current dataset is too small to justify new infrastructure. | Benchmark direct/group sizes, record trigger time and row writes, optimize SQL first, and set a capacity threshold before redesign. |
| SQL-116 | P3 | Table partitioning is not supported by current size or plan evidence. | Keep tables unpartitioned. Revisit only when table/index size, vacuum, or contention metrics show a real boundary. |

### 21.10 Migration governance, drift detection, and test findings

| ID | Sev. | Current state and root cause | End-to-end solution |
|---|---|---|---|
| SQL-117 | P1 | Live lineage passes, but SQL governance fails because migration `0128` is absent from the append-only manifest. | Add the exact migration path/tag to the manifest and keep journal/manifest/schema changes atomic in review. |
| SQL-118 | P1 | `check-db-catalog-drift.ts` does not assert messaging-specific search expressions, grants, policies, trigger body, or composite invariants. | Extend it with exact catalog assertions for the final contract. |
| SQL-119 | P1 | Source-contract tests inspect code strings but do not execute concurrent database transactions. | Add PostgreSQL integration tests for insert/read, concurrent reads, late inserts, delete/hide races, workflow double resolution, and idempotent attachment claim. |
| SQL-120 | P0 | There is no authenticated-role regression matrix proving an outsider cannot join a known conversation or mutate identity keys. | Test as User A, User B, outsider, anonymous, and server role with known UUIDs and direct PostgREST/database operations. |
| SQL-121 | P2 | Current index statistics are resettable and development traffic is not representative. | Record stats reset time and collect a full workload window before destructive index cleanup. |
| SQL-122 | P2 | Search and inbox changes lack representative-scale plan fixtures. | Seed deterministic high-cardinality conversations/messages and store sanitized `EXPLAIN` acceptance artifacts. |
| SQL-123 | P1 | Migration cleanup/backfill/constraint validation sequencing is not yet specified. | Use append-only migrations: repair, add `NOT VALID`, validate, then tighten nullability/grants. Use concurrent index operations outside incompatible transactions. |
| SQL-124 | P1 | No single automated invariant job reports preview/unread/DM-pair/upload drift. | Add a read-only scheduled audit with counts and alerts; do not make it an endless repair loop that hides write defects. |

---

## 22. End-to-End SQL Flow Specifications

### 22.1 Existing conversation opens

**Start:** User selects a conversation in the page or popup.

**Authorization:** Resolve the viewer once and require one participant row for `(conversation_id, viewer_id)`. The participant row must be impossible for the viewer to self-create in an arbitrary conversation.

**Read:** In one stable access context:

1. Read conversation and authorized participant.
2. Fetch the newest message page by `(conversation_id, created_at DESC, id DESC)`.
3. Batch profiles, attachments, reactions, workflow, and required receipt summaries for only those message IDs.
4. Return the read watermark and inbox projection version with the page.

**Visibility/read trigger:** The client sends the highest actually visible message tuple, not simply “conversation opened.”

**Commit:**

1. Begin transaction.
2. Lock the viewer’s participant row.
3. Resolve the proposed message by `(id, conversation_id)`.
4. Compare proposed tuple against stored watermark and advance only if newer.
5. Recalculate or atomically decrement unread without overwriting newer inserts.
6. If exact read receipts remain, insert them in bounded durable batches; otherwise use the participant watermark.
7. Write a notification-sync outbox event if notification state must advance.
8. Commit and return the canonical watermark/unread.

**Resolution:** The thread remains selected; inbox and global badge patch from the returned canonical state. Reading does not implicitly archive/unarchive unless the product contract explicitly requires it.

### 22.2 Incoming message

**Start:** Authorized sender submits content/structured payload, attachment claim IDs, and a nonblank bounded idempotency key.

**Transaction:**

1. Lock/validate sender membership.
2. If attachments exist, atomically claim exact `uploaded` sessions belonging to sender and conversation.
3. Insert the message with the unique client key.
4. Insert attachment rows from claimed storage paths.
5. Trigger updates participant projections only when the inserted tuple is newer than the stored preview.
6. Trigger increments unread for eligible nonsender participants without permitting negative or cross-conversation state.
7. Write notification/outbox events.
8. Commit.

**Idempotent retry:** A uniqueness conflict returns the already-created message and must not repeat trigger, attachment, or notification effects.

**Resolution:** Realtime publishes the committed row. The recipient’s cached inbox and thread update from the same message identity; later reconciliation is a safety check, not the normal write path.

### 22.3 Hide or delete message

**Start:** Viewer hides a message for self, or sender deletes an eligible message.

**Transaction:**

1. Authorize by `(message_id, conversation_id)` and lock relevant participant/message rows.
2. Insert hide tombstone or apply guarded sender deletion.
3. If the affected row is the participant’s preview, select the next newest visible row under the same transaction.
4. Compare-and-set preview from the exact stale ID to the replacement tuple.
5. Recalculate the affected viewer’s unread count in the same snapshot.
6. Commit.

**Resolution:** Inbox order, preview, unread, global badge, and thread agree immediately. A new message arriving concurrently cannot be replaced by an older preview.

### 22.4 Search and open result

**Start:** User enters text/operators in global message search.

**SQL:**

1. Validate parser output and bounded limit.
2. Start from conversations for which the viewer has authorized membership.
3. Exclude hidden/deleted rows and apply block/privacy/sender filters before limiting.
4. Match a generated, indexed `search_document`.
5. Order by stable `(rank, created_at, id)` and return a cursor.
6. Return only the slim result data necessary to render and navigate.

**Resolution:** Selection opens the exact conversation and message context using the same authorization predicate. Search does not create a second heavyweight conversation model.

### 22.5 Project invite/application decision

**Start:** Project owner sends an invite or resolves an application.

**Transaction:**

1. Lock the role/capacity record in the documented order.
2. Create/lock the canonical application or workflow row.
3. Claim the transition with a pending-state conditional update.
4. The single winner changes membership/capacity.
5. Append a typed application event.
6. Link/create the canonical message projection idempotently.
7. Write notification outbox event.
8. Commit.

**Resolution:** Repeated or concurrent accept/reject calls return the already-resolved state and cannot duplicate membership, counters, messages, or notifications. History reads from application events rather than scanning message JSON with mismatched kinds.

### 22.6 Attachment lifecycle

**Start:** Authorized participant requests upload intent.

**Lifecycle:**

```text
created -> uploading -> uploaded -> committed
   │           │           │
   └───────────┴───────────┴──> cancelled / expired / failed
```

Each transition is conditional on the previous status. The session is bound to user, conversation, path, size, and expiry. Message send atomically claims `uploaded -> committed`. The database stores the private path, never a signed URL. An authorized download endpoint produces a short-lived access response. Cleanup locks expired nonterminal sessions with `SKIP LOCKED`, removes storage idempotently, and marks the terminal state.

**Resolution:** No caller can attach another user’s object, move an upload to another conversation, reuse a committed session, or depend on an expired persisted token.

---

## 23. Canonical Constraint and Index Contract

The exact SQL should be finalized against the actual canonical table shape, but the migration must establish these invariants.

### 23.1 Required constraints

- `dm_pairs`: distinct ordered users, unique pair, unique conversation, profile FKs.
- `conversation_participants`: unique `(conversation_id,user_id)`, nonnegative unread, same-conversation last-read and last-message references.
- `messages`: unique `(id,conversation_id)` retained for composite children; allowed type; bounded nonblank client ID when present; same-conversation reply reference.
- Workflow/work links: source message and conversation must match; allowed kind/status/scope/type values; pending/resolved field consistency.
- Reports: nonnull conversation, same-conversation message, one report per message/reporter if that is the product rule.
- Receipts: immutable `(message,conversation,user)` identity; same-conversation message; no own-message receipt through server write policy.
- Uploads: bounded client ID/path; allowed status; `expires_at > created_at`; transition enforced through guarded writes.
- Attachments: private path is canonical; signed URL is not durable data.

### 23.2 Required query indexes

Create only indexes that match real predicates/order:

```sql
-- Active nonempty inbox keyset
(user_id, last_message_at DESC, conversation_id DESC)
WHERE archived_at IS NULL AND last_message_id IS NOT NULL

-- Thread/context keyset
(conversation_id, created_at DESC, id DESC)

-- Exact generated search document
GIN (search_document)

-- Pending workflow invite identity after role_id normalization
UNIQUE (project_id, assignee_user_id, role_id)
WHERE kind = 'project_invite' AND status = 'pending'
```

Existing indexes that support composite foreign keys or cascade checks must not be removed just because their scan count is zero. Conversely, a zero-scan duplicate should not be kept indefinitely. The safe lifecycle is: identify coverage, add replacement, validate plans, observe a representative window, then drop concurrently.

### 23.3 Indexes not justified now

- No table partitioning.
- No index per search operator without usage evidence.
- No additional receipt index if a participant watermark replaces exact historical receipt rows.
- No duplicate sender/message single-column index when a left-prefix composite serves the query and FK.

---

## 24. Authorization and Grant Matrix

| Table/domain | Browser SELECT | Browser INSERT | Browser UPDATE | Browser DELETE | Server/trigger owner |
|---|---:|---:|---:|---:|---|
| Conversations | Authorized member only | No | No | No | Server |
| Participants | Own authorized membership view | No | Preferences only through narrow action | No | Server + message trigger |
| Messages | Authorized member, excluding hidden | No direct write | No direct write | No direct write | Server actions |
| Reactions | Authorized member | Optional narrow insert | No | Own reaction only | Server preferred |
| Hidden rows | Own authorized hides | Optional narrow insert | No | Own hide only | Server preferred |
| Receipts | Authorized participants as required | Optional narrow insert | No | Own receipt only if needed | Server/visibility commit |
| Workflow/work links | Authorized project/conversation view | No | No | No | Server |
| Attachments/uploads | Authorized participant | Intent action only | Guarded state machine only | Cancel action only | Server/storage worker |
| Reports | Reporter/admin as required | Narrow server action | No | No | Server |
| Role applications | Actor/admin scoped view | Narrow server action | No direct update | No | Server transition functions |

`anon` receives no messaging table access. `authenticated` receives no TRUNCATE, TRIGGER, or REFERENCES. Realtime tables retain only the SELECT grants/policies needed for subscribed rows.

### Required adversarial test cases

1. Outsider knows a conversation UUID and attempts to insert a participant row.
2. Member attempts to move their participant row to another conversation.
3. Sender attempts to move a message to another conversation.
4. Applicant attempts to self-accept or change project/role.
5. User attempts to move an upload session to another conversation/path.
6. User attempts to create read/delivery receipt for their own message.
7. User attempts to update receipt/workflow/work-link identity keys.
8. Anonymous user attempts every SELECT/write.
9. Blocked/nonparticipant user attempts attachment download with known ID.
10. Realtime subscription is opened after each failed privilege escalation to prove no data became visible.

---

## 25. Migration and Repair Plan

### Phase SQL-0 — Governance gate

- Add migration `0128` to `standards/sql-governance.manifest.json`.
- Make `npm run check:sql-governance` pass.
- Preserve the passing 128-tag live lineage.
- Extend catalog drift assertions before introducing migration `0129+`.

**Exit:** Journal, manifest, files, and deployed lineage agree.

### Phase SQL-1 — Emergency authorization closure

- Revoke broad anon/authenticated grants, especially TRUNCATE/TRIGGER/REFERENCES.
- Remove direct participant, message, workflow, work-link, application, and upload identity UPDATE.
- Restrict policies to authenticated and immutable identities.
- Add the A/B/outsider RLS suite.

**Exit:** All known-ID escalation tests fail closed while normal server actions/realtime SELECT still work.

### Phase SQL-2 — Data inventory, quarantine, and repair

- Snapshot and repair unread/preview drift.
- Classify the two unpaired DMs and backfill only exact pairs.
- Expire/clean the three stale upload sessions.
- Migrate six token-like URLs to private paths where recoverable; rotate/revoke exposed signed tokens according to storage capability.
- Backfill report conversation, workflow/work-link conversation consistency, and typed application decision history.

**Exit:** Every invariant query returns zero unexplained rows; quarantined rows have an owner and resolution.

### Phase SQL-3 — Native invariants

- Add checks and composite FKs as `NOT VALID`.
- Validate after repair.
- Tighten nullability.
- Normalize workflow role ID and application events.
- Add immutable state-transition procedures/actions.

**Exit:** Direct SQL attempts to create cross-conversation or invalid-state rows fail.

### Phase SQL-4 — Atomic state ownership

- Lock-safe monotonic read watermark.
- Conditional latest-preview trigger.
- Transactional hide/delete/preview reconciliation.
- Conditional workflow resolution.
- Atomic upload claim.
- Idempotent task/follow-up conversion.
- Remove reaction JSON summary.

**Exit:** Concurrency tests prove one winner and consistent derived state.

### Phase SQL-5 — Query correctness and exact indexes

- Replace OFFSET paths with keyset.
- Align inbox/thread indexes with exact tuple order.
- Replace mismatched search expression with generated document.
- Push search authorization/filters before limit.
- Batch thread/project-group/application queries.

**Exit:** Representative-scale `EXPLAIN` artifacts show bounded index-backed access and stable pagination.

### Phase SQL-6 — Cleanup after observation

- Observe index and statement stats for a full representative release window.
- Remove proven duplicate/unused indexes concurrently.
- Remove schema compatibility catches and obsolete metadata fields only after all callers migrate.
- Keep invariant monitoring read-only and alerting.

**Exit:** No compatibility reader/writer remains, and cleanup does not remove FK or production-plan support.

---

## 26. Database Test and Acceptance Matrix

### 26.1 Correctness

- [x] A late-created message with an older timestamp does not replace the current preview.
- [x] A message inserted concurrently with mark-read remains unread if it is above the committed watermark.
- [x] Two simultaneous mark-read calls can only advance the watermark.
- [x] Two messages with identical timestamps paginate without skip/duplicate.
- [x] Hiding/deleting the preview concurrently with a new insert leaves the new insert as preview.
- [x] Timeline-derived and stored unread counts match after every scenario.
- [x] Cross-conversation reply/read/preview/workflow/work-link references are rejected by PostgreSQL.
- [x] A report cannot omit or falsify conversation ID.

### 26.2 Idempotency and concurrency

- [x] Repeated send with the same client ID returns one message, one attachment set, one trigger effect, and one notification event.
- [x] Two reaction toggles from the same user produce a deterministic final state without uniqueness errors.
- [x] Concurrent accept/decline produces one workflow winner and one side-effect set.
- [x] Repeated message-to-task/follow-up conversion produces one target.
- [x] An upload session can be committed once and only to its bound user/conversation.
- [x] Cleanup workers can retry safely after storage or DB failure.

### 26.3 Authorization

- [x] Outsider cannot self-join, read timeline, subscribe through realtime, search, or download an attachment.
- [x] Participant can change only owned preference state, not preview/unread/identity.
- [x] Sender edit cannot change conversation/sender/created time/client identity.
- [x] Applicant cannot mutate decision/project/role.
- [x] Anonymous role has no messaging access.
- [x] Client roles have no TRUNCATE/TRIGGER/REFERENCES grants.

### 26.4 Query and scale

- [x] Inbox page uses the exact partial keyset index.
- [x] Thread/context page uses `(conversation,created_at,id)`.
- [x] Full-text search uses the generated-document GIN index.
- [x] Search applies authorization and filters before `LIMIT`.
- [x] Application inbox uses SQL union + keyset, not all-row JavaScript slicing.
- [x] Project-group membership creation inserts all eligible members beyond 500.
- [ ] Trigger p95 and row writes are recorded at DM, 10, 100, 500, and maximum supported group sizes.

### 26.5 Lifecycle

- [x] Account deletion leaves no malformed DM or unauthorized retained attachment.
- [x] Project deletion follows the documented group-history retention rule.
- [x] Expired uploads reach terminal state and storage is cleaned.
- [x] No new durable message row contains a signed access token; the integrity audit reports any legacy token-like row.
- [x] Application history survives concurrent transition/reopen without lost events.

---

## 27. SQL Observability Contract

Record metrics that diagnose authority drift without creating an auto-repair system:

- Count of participant preview mismatches.
- Count and absolute delta of unread mismatches.
- DM conversations without valid pair/exact participant set.
- Cross-conversation reference violations during the `NOT VALID` rollout.
- Expired nonterminal upload sessions and cleanup age.
- Token-like durable attachment URLs.
- Workflow conditional-update misses, duplicate attempts, and resolution latency.
- Message insert trigger duration and participant rows updated.
- Inbox/thread/search query p50/p95/p99 and rows removed by filter.
- Search result candidates before/after authorization to detect late-filter regressions.
- Index scan and size deltas with `stats_reset` timestamp.
- Dead tuples/autovacuum lag for message, participant, receipt, reaction, and upload tables.
- Notification outbox lag from message commit to delivery.

Alerts should identify a write-path defect. A scheduled repair may be available as an operator command, but it must not silently normalize drift forever.

---

## 28. Ponytail SQL Keep / Delete / Shrink Decisions

### Keep

- PostgreSQL as the sole durable authority.
- `conversation_participants` as the inbox projection after atomic ownership is fixed.
- Native keyset pagination and composite tuple cursors.
- Existing `messages(id,conversation_id)` uniqueness because composite child invariants need it.
- Existing batched hydration until measurement justifies a more complex aggregate.
- Server-side transactions and advisory/row locks where they already enforce a real identity/capacity race.
- Current unpartitioned tables.

### Delete

- Broad anon/authenticated grants.
- Client ability to mutate ownership/identity and derived participant fields.
- Persisted signed attachment URLs.
- Stale reaction summary JSON.
- Timestamp-only and OFFSET pagination compatibility after migration.
- Message-JSON application history as the authoritative decision ledger.
- Runtime missing-column fallbacks once lineage is enforced.
- Duplicate indexes only after plan/stat verification.

### Shrink

- Repeated thread authorization/hydration queries into one access context plus bounded batch reads.
- N+1 project-group lookups into one query.
- All-row application merge/sort into one SQL union/keyset query.
- Read/delivery state toward participant watermarks when exact historical per-message receipts are not a product requirement.
- Upload validation and commitment into one conditional claim.
- Workflow resolution into one conditional winner transaction.

### Do not add

- Redis or a queue to repair SQL correctness.
- Table partitioning at current evidence levels.
- A second ORM/query builder.
- Per-operator search indexes without query usage.
- Auto-repair jobs that conceal transaction races.

---

## 29. Revised End-to-End Conclusion

The SQL audit changes the priority order of the messaging work. The most urgent problems are not visual: they are authorization boundaries and competing data authorities.

The highest-risk confirmed defects are:

1. an authenticated user can potentially self-insert a participant edge for a known conversation;
2. broad RLS/grants allow ownership-bearing fields to be mutated, including messages, workflows, uploads, and role applications;
3. attachment send does not atomically prove and claim the uploader’s session/path;
4. workflow resolution can execute both sides of a concurrent decision;
5. persisted attachment rows contain token-like URLs;
6. live unread state is materially drifted; and
7. search SQL does not match its full-text index.

The correct implementation sequence is therefore:

```text
governance
  -> revoke/harden authorization
  -> repair live drift
  -> add native invariants
  -> make state transitions atomic
  -> align queries and indexes
  -> remove proven redundancy
```

This plan keeps the current architecture where it is sound and removes duplicated or unsafe authority. It provides a complete database contract for the conversation list, existing/new chats, search, messages, read state, reactions, receipts, attachments, project groups, workflow items, work links, applications, notifications, project deletion, and account deletion. Nothing in the SQL implementation should be considered complete until the migration, RLS, concurrency, lifecycle, and representative query-plan matrices above all pass.
