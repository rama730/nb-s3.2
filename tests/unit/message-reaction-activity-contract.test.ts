import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('reaction activity is separate from messages and remains recipient-specific', () => {
    const action = readProjectFile('src/app/actions/messaging/features.ts');
    const emitters = readProjectFile('src/lib/notifications/emitters.ts');
    const schema = readProjectFile('src/lib/db/schema/index.ts');
    const migration = readProjectFile('drizzle/0134_message_reaction_activity.sql');

    assert.match(action, /hashtextextended\(\$\{`\$\{messageId\}:\$\{user\.id\}`\}/);
    assert.match(action, /lastReactionMessageId: messageRow\.id/);
    assert.match(action, /await emitMessageReactionNotification\(/);
    assert.match(emitters, /kind: 'message_reaction'/);
    assert.match(emitters, /message-reaction:\$\{params\.sourceMessageId\}:\$\{params\.actorUserId\}:\$\{params\.emoji\}/);
    assert.match(schema, /lastReactionAt: timestamp\(["']last_reaction_at["']/);
    assert.match(schema, /messageUserUnique: uniqueIndex\(["']message_reactions_message_user_unique["']\)/);
    assert.match(migration, /DROP INDEX IF EXISTS public\.message_reactions_message_user_emoji_unique/);
    assert.match(migration, /message_reactions_message_user_unique/);
});
