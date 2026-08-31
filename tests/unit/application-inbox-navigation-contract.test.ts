import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('application inbox rows open the conversation without targeting a message', () => {
    const action = readProjectFile('src/app/actions/applications/internal.ts');
    const list = readProjectFile('src/components/chat/v2/ApplicationsListV2.tsx');
    const workspace = readProjectFile('src/components/chat/v2/MessagesWorkspaceV2.tsx');

    assert.doesNotMatch(action, /applicationMessageIdByApplicationId/);
    assert.doesNotMatch(action, /sourceMessageId:/);
    assert.match(list, /onSelectConversation\(application\.conversationId\)/);
    assert.match(workspace, /onSelectConversation=\{\(conversationId\) =>\s+openConversation\(conversationId, \{/);
});
