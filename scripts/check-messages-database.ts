import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: ".env.local" });

const disposableUrl =
  process.env.E2E_DATABASE_URL
  || process.env.DATABASE_URL_FRESH
  || process.env.DATABASE_URL_REPLAY_FRESH;

if (!disposableUrl) {
  throw new Error(
    "Messaging database integration requires E2E_DATABASE_URL, DATABASE_URL_FRESH, "
      + "or DATABASE_URL_REPLAY_FRESH. The primary database is never used.",
  );
}
if (process.env.DATABASE_URL && disposableUrl === process.env.DATABASE_URL) {
  throw new Error("Refusing to run messaging integration checks against DATABASE_URL.");
}

const sql = postgres(disposableUrl, { max: 6, prepare: false });

function requireContract(label: string, passed: boolean) {
  if (!passed) throw new Error(`Messaging database contract failed: ${label}`);
}

async function expectDenied(label: string, run: () => Promise<unknown>) {
  let denied = false;
  try {
    await run();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    denied = code === "42501" || code === "23502" || code === "23514" || code === "23503";
  }
  requireContract(label, denied);
}

function isInsufficientPrivilege(error: unknown) {
  return (error as { code?: string } | null)?.code === "42501";
}

async function asApiRole<T>(
  role: "anon" | "authenticated",
  userId: string | null,
  run: (tx: typeof sql) => Promise<T>,
) {
  return sql.begin(async (connection) => {
    const tx = connection as unknown as typeof sql;
    await tx.unsafe(`SET LOCAL ROLE ${role}`);
    await tx`SELECT set_config('request.jwt.claim.sub', ${userId ?? ""}, true)`;
    return run(tx);
  });
}

async function main() {
  const userA = randomUUID();
  const userB = randomUUID();
  const outsider = randomUUID();
  const conversationId = randomUUID();
  const otherConversationId = randomUUID();
  const messageId = randomUUID();
  const otherMessageId = randomUUID();
  const workflowId = randomUUID();
  const uploadId = randomUUID();

  try {
    await sql`
      INSERT INTO profiles (id, email, username, onboarding_status)
      VALUES
        (${userA}, ${`messages-a-${userA}@example.test`}, ${`messages_a_${userA.replaceAll("-", "")}`}, 'completed'),
        (${userB}, ${`messages-b-${userB}@example.test`}, ${`messages_b_${userB.replaceAll("-", "")}`}, 'completed'),
        (${outsider}, ${`messages-c-${outsider}@example.test`}, ${`messages_c_${outsider.replaceAll("-", "")}`}, 'completed')
    `;

    await sql.begin(async (connection) => {
      const tx = connection as unknown as typeof sql;
      const low = userA < userB ? userA : userB;
      const high = userA < userB ? userB : userA;
      await tx`INSERT INTO conversations (id, type) VALUES (${conversationId}, 'dm')`;
      await tx`
        INSERT INTO conversation_participants (conversation_id, user_id)
        VALUES (${conversationId}, ${userA}), (${conversationId}, ${userB})
      `;
      await tx`
        INSERT INTO dm_pairs (user_low, user_high, conversation_id)
        VALUES (${low}, ${high}, ${conversationId})
      `;
      await tx`
        INSERT INTO messages (
          id, conversation_id, sender_id, client_message_id, content, type, metadata
        ) VALUES (
          ${messageId}, ${conversationId}, ${userA}, ${randomUUID()}, 'integration message', 'text', '{}'::jsonb
        )
      `;
      await tx`SET CONSTRAINTS ALL IMMEDIATE`;
    });

    const [recipientState] = await sql<{
      unread_count: number;
      last_message_id: string | null;
    }[]>`
      SELECT unread_count, last_message_id
      FROM conversation_participants
      WHERE conversation_id = ${conversationId} AND user_id = ${userB}
    `;
    requireContract(
      "incoming insert atomically advances unread and preview",
      recipientState?.unread_count === 1 && recipientState.last_message_id === messageId,
    );

    await sql.begin(async (connection) => {
      const tx = connection as unknown as typeof sql;
      await tx`INSERT INTO conversations (id, type) VALUES (${otherConversationId}, 'group')`;
      await tx`
        INSERT INTO conversation_participants (conversation_id, user_id)
        VALUES (${otherConversationId}, ${userA}), (${otherConversationId}, ${userB})
      `;
      await tx`
        INSERT INTO messages (
          id, conversation_id, sender_id, client_message_id, content, type, metadata
        ) VALUES (
          ${otherMessageId}, ${otherConversationId}, ${userA}, ${randomUUID()},
          'other conversation message', 'text', '{}'::jsonb
        )
      `;
    });

    await expectDenied("cross-conversation reply references are rejected", () =>
      sql.begin(async (connection) => {
        const tx = connection as unknown as typeof sql;
        await tx`
          UPDATE messages
          SET reply_to_message_id = ${otherMessageId}
          WHERE id = ${messageId}
        `;
        await tx`SET CONSTRAINTS ALL IMMEDIATE`;
      }),
    );
    await expectDenied("cross-conversation read watermarks are rejected", () =>
      sql.begin(async (connection) => {
        const tx = connection as unknown as typeof sql;
        await tx`
          UPDATE conversation_participants
          SET last_read_message_id = ${otherMessageId}
          WHERE conversation_id = ${conversationId} AND user_id = ${userB}
        `;
        await tx`SET CONSTRAINTS ALL IMMEDIATE`;
      }),
    );
    await expectDenied("cross-conversation workflow references are rejected", () =>
      sql.begin(async (connection) => {
        const tx = connection as unknown as typeof sql;
        await tx`
          INSERT INTO message_workflow_items (
            id, message_id, conversation_id, kind, scope, creator_id,
            assignee_user_id, status, payload
          ) VALUES (
            ${randomUUID()}, ${messageId}, ${otherConversationId}, 'feedback_request',
            'conversation', ${userA}, ${userB}, 'pending', '{}'::jsonb
          )
        `;
        await tx`SET CONSTRAINTS ALL IMMEDIATE`;
      }),
    );
    await expectDenied("a report cannot omit its conversation identity", () =>
      sql`
        INSERT INTO message_reports (message_id, reporter_id, reason)
        VALUES (${messageId}, ${userB}, 'spam')
      `,
    );

    const previewBeforeLateInsert = await sql<{ last_message_id: string | null }[]>`
      SELECT last_message_id
      FROM conversation_participants
      WHERE conversation_id = ${conversationId} AND user_id = ${userB}
    `;
    await sql`
      INSERT INTO messages (
        id, conversation_id, sender_id, client_message_id, content, type, metadata, created_at
      ) VALUES (
        ${randomUUID()}, ${conversationId}, ${userA}, ${randomUUID()},
        'late historical message', 'text', '{}'::jsonb, now() - interval '1 day'
      )
    `;
    const previewAfterLateInsert = await sql<{ last_message_id: string | null }[]>`
      SELECT last_message_id
      FROM conversation_participants
      WHERE conversation_id = ${conversationId} AND user_id = ${userB}
    `;
    requireContract(
      "a late older message cannot replace the current preview",
      previewBeforeLateInsert[0]?.last_message_id === previewAfterLateInsert[0]?.last_message_id,
    );

    const sharedCreatedAt = new Date(Date.now() + 1_000);
    const equalTimestampMessageOne = randomUUID();
    const equalTimestampMessageTwo = randomUUID();
    const equalTimestampMessageIds: string[] = [equalTimestampMessageOne, equalTimestampMessageTwo];
    await sql`
      INSERT INTO messages (
        id, conversation_id, sender_id, client_message_id, content, type, metadata, created_at
      ) VALUES
        (
          ${equalTimestampMessageOne}, ${conversationId}, ${userA}, ${randomUUID()},
          'same timestamp one', 'text', '{}'::jsonb, ${sharedCreatedAt}
        ),
        (
          ${equalTimestampMessageTwo}, ${conversationId}, ${userA}, ${randomUUID()},
          'same timestamp two', 'text', '{}'::jsonb, ${sharedCreatedAt}
        )
    `;
    const firstEqualPage = await sql<{ id: string; created_at: Date }[]>`
      SELECT id, created_at
      FROM messages
      WHERE conversation_id = ${conversationId}
        AND created_at = ${sharedCreatedAt}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    const secondEqualPage = await sql<{ id: string }[]>`
      SELECT id
      FROM messages
      WHERE conversation_id = ${conversationId}
        AND (created_at, id) < (${firstEqualPage[0]!.created_at}, ${firstEqualPage[0]!.id})
        AND created_at = ${sharedCreatedAt}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    requireContract(
      "equal-timestamp tuple pagination has no skip or duplicate",
      firstEqualPage.length === 1
        && secondEqualPage.length === 1
        && firstEqualPage[0]!.id !== secondEqualPage[0]!.id
        && equalTimestampMessageIds.includes(firstEqualPage[0]!.id)
        && equalTimestampMessageIds.includes(secondEqualPage[0]!.id),
    );

    const idempotentClientMessageId = randomUUID();
    const idempotentWinners = await Promise.all([
      sql<{ id: string }[]>`
        INSERT INTO messages (
          id, conversation_id, sender_id, client_message_id, content, type, metadata
        ) VALUES (
          ${randomUUID()}, ${conversationId}, ${userA}, ${idempotentClientMessageId},
          'idempotent send', 'text', '{}'::jsonb
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `,
      sql<{ id: string }[]>`
        INSERT INTO messages (
          id, conversation_id, sender_id, client_message_id, content, type, metadata
        ) VALUES (
          ${randomUUID()}, ${conversationId}, ${userA}, ${idempotentClientMessageId},
          'idempotent send', 'text', '{}'::jsonb
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `,
    ]);
    requireContract(
      "a concurrent client message identity produces exactly one message",
      idempotentWinners.reduce((count, rows) => count + rows.length, 0) === 1,
    );

    const [unreadProjection] = await sql<{ unread_count: number; derived_count: number }[]>`
      SELECT
        participant.unread_count,
        (
          SELECT count(*)::int
          FROM messages message
          WHERE message.conversation_id = participant.conversation_id
            AND message.deleted_at IS NULL
            AND message.sender_id IS DISTINCT FROM participant.user_id
            AND (
              participant.last_read_at IS NULL
              OR (message.created_at, message.id) > (
                participant.last_read_at,
                coalesce(participant.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
              )
            )
        ) AS derived_count
      FROM conversation_participants participant
      WHERE participant.conversation_id = ${conversationId}
        AND participant.user_id = ${userB}
    `;
    requireContract(
      "stored unread count matches the authoritative timeline",
      unreadProjection?.unread_count === unreadProjection?.derived_count,
    );

    const memberRows = await asApiRole("authenticated", userA, (tx) =>
      tx<{ id: string }[]>`
        SELECT id
        FROM messages
        WHERE id = ${messageId}
      `,
    );
    requireContract("participant can read an authorized message", memberRows.length === 1);

    const outsiderRows = await asApiRole("authenticated", outsider, (tx) =>
      tx<{ id: string }[]>`
        SELECT id
        FROM messages
        WHERE id = ${messageId}
      `,
    );
    requireContract("outsider cannot read a known message UUID", outsiderRows.length === 0);

    let anonymousRows: { id: string }[] = [];
    try {
      anonymousRows = await asApiRole("anon", null, (tx) =>
        tx<{ id: string }[]>`
          SELECT id
          FROM messages
          WHERE id = ${messageId}
        `,
      );
    } catch (error) {
      // Both supported contracts are secure: anon either has no table grant at
      // all or has SELECT with RLS reducing a known-ID lookup to zero rows.
      if (!isInsufficientPrivilege(error)) throw error;
    }
    requireContract("anonymous role cannot read a known message UUID", anonymousRows.length === 0);

    const [grantState] = await sql<{
      participant_update: boolean;
      message_update: boolean;
      application_update: boolean;
      message_truncate: boolean;
      message_trigger: boolean;
      message_references: boolean;
    }[]>`
      SELECT
        has_table_privilege('authenticated', 'conversation_participants', 'UPDATE') AS participant_update,
        has_table_privilege('authenticated', 'messages', 'UPDATE') AS message_update,
        has_table_privilege('authenticated', 'role_applications', 'UPDATE') AS application_update,
        has_table_privilege('authenticated', 'messages', 'TRUNCATE') AS message_truncate,
        has_table_privilege('authenticated', 'messages', 'TRIGGER') AS message_trigger,
        has_table_privilege('authenticated', 'messages', 'REFERENCES') AS message_references
    `;
    requireContract(
      "browser roles cannot mutate identities or own database infrastructure",
      grantState?.participant_update === false
        && grantState.message_update === false
        && grantState.application_update === false
        && grantState.message_truncate === false
        && grantState.message_trigger === false
        && grantState.message_references === false,
    );

    await expectDenied("outsider cannot self-join a known conversation", () =>
      asApiRole("authenticated", outsider, (tx) =>
        tx`
          INSERT INTO conversation_participants (conversation_id, user_id)
          VALUES (${conversationId}, ${outsider})
        `,
      ),
    );
    await expectDenied("sender cannot mutate immutable message identity through the API role", () =>
      asApiRole("authenticated", userA, (tx) =>
        tx`
          UPDATE messages
          SET conversation_id = ${randomUUID()}
          WHERE id = ${messageId}
        `,
      ),
    );

    await expectDenied("DM invariant rejects a third participant for server writers", () =>
      sql.begin(async (connection) => {
        const tx = connection as unknown as typeof sql;
        await tx`
          INSERT INTO conversation_participants (conversation_id, user_id)
          VALUES (${conversationId}, ${outsider})
        `;
        await tx`SET CONSTRAINTS ALL IMMEDIATE`;
      }),
    );

    await sql`
      INSERT INTO message_workflow_items (
        id, message_id, conversation_id, kind, scope, creator_id, assignee_user_id, status, payload
      ) VALUES (
        ${workflowId}, ${messageId}, ${conversationId}, 'feedback_request', 'conversation',
        ${userA}, ${userB}, 'pending', '{}'::jsonb
      )
    `;
    const workflowWinners = await Promise.all([
      sql.begin(async (connection) => {
        const tx = connection as unknown as typeof sql;
        return tx<{ id: string }[]>`
          UPDATE message_workflow_items
          SET status = 'accepted', resolved_at = now(), updated_at = now()
          WHERE id = ${workflowId} AND status = 'pending'
          RETURNING id
        `;
      }),
      sql.begin(async (connection) => {
        const tx = connection as unknown as typeof sql;
        return tx<{ id: string }[]>`
          UPDATE message_workflow_items
          SET status = 'declined', resolved_at = now(), updated_at = now()
          WHERE id = ${workflowId} AND status = 'pending'
          RETURNING id
        `;
      }),
    ]);
    requireContract(
      "concurrent workflow resolution has exactly one winner",
      workflowWinners.reduce((count, rows) => count + rows.length, 0) === 1,
    );

    await sql`
      INSERT INTO attachment_uploads (
        id, user_id, client_upload_id, conversation_id, storage_path, filename,
        mime_type, size_bytes, status, expires_at
      ) VALUES (
        ${uploadId}, ${userA}, ${randomUUID()}, ${conversationId},
        ${`integration/${uploadId}`}, 'integration.txt', 'text/plain', 16, 'uploaded', now() + interval '1 hour'
      )
    `;
    const claimWinners = await Promise.all([
      sql<{ id: string }[]>`
        UPDATE attachment_uploads
        SET status = 'committed', updated_at = now()
        WHERE id = ${uploadId} AND user_id = ${userA}
          AND conversation_id = ${conversationId} AND status = 'uploaded'
        RETURNING id
      `,
      sql<{ id: string }[]>`
        UPDATE attachment_uploads
        SET status = 'committed', updated_at = now()
        WHERE id = ${uploadId} AND user_id = ${userA}
          AND conversation_id = ${conversationId} AND status = 'uploaded'
        RETURNING id
      `,
    ]);
    requireContract(
      "concurrent attachment claim has exactly one winner",
      claimWinners.reduce((count, rows) => count + rows.length, 0) === 1,
    );

    console.log("[messages-database] ok");
  } finally {
    await sql`DELETE FROM conversations WHERE id = ${conversationId}`.catch(() => undefined);
    await sql`DELETE FROM conversations WHERE id = ${otherConversationId}`.catch(() => undefined);
    await sql`DELETE FROM profiles WHERE id IN (${userA}, ${userB}, ${outsider})`.catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error("[messages-database] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
