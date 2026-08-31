import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractExportedFunction(source: string, functionName: string) {
    let start = source.indexOf(`export async function ${functionName}`);
    if (start === -1) {
        start = source.indexOf(`export function ${functionName}`);
    }
    assert.notEqual(start, -1, `${functionName} should exist`);
    const nextFunction = source.indexOf('\nexport ', start + functionName.length);
    return source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

test('applications barrel delegates the server boundary to its async implementation module', () => {
    const barrel = readProjectFile('src/app/actions/applications/index.ts');
    const internal = readProjectFile('src/app/actions/applications/internal.ts');

    assert.doesNotMatch(barrel, /^['"]use server['"];?/m);
    assert.match(internal, /^['"]use server['"];?/m);
    assert.doesNotMatch(internal, /^export (?!async function|type |interface )/m);
});

test('acceptProposedRoleAction uses pessimistic lock preventing double-booking', () => {
    const source = readProjectFile('src/app/actions/applications/internal.ts');
    const acceptProposed = extractExportedFunction(source, 'acceptProposedRoleAction');

    // Asserts that db transaction with FOR UPDATE locking is used
    assert.match(acceptProposed, /db\.transaction\(async \(tx\) => \{/);
    assert.match(acceptProposed, /\.for\('update'\)/);
    assert.match(acceptProposed, /tx\s*\.\s*update\(roleApplications\)/);
    assert.match(acceptProposed, /status:\s*'accepted'/);
});

test('declineProposedRoleAction reverts application back to pending', () => {
    const source = readProjectFile('src/app/actions/applications/internal.ts');
    const declineProposed = extractExportedFunction(source, 'declineProposedRoleAction');

    assert.match(declineProposed, /tx\s*\.\s*update\(roleApplications\)/);
    assert.match(declineProposed, /status:\s*'pending'/);
    assert.match(declineProposed, /proposedRoleId:\s*null/);
    assert.match(declineProposed, /decisionBy:\s*null/);
    assert.match(declineProposed, /decisionAt:\s*null/);
});

test('addProjectMemberInternal executes cascading sweeps to reject other applications when role is full', () => {
    const source = readProjectFile('src/lib/projects/collaborator-lifecycle.ts');
    const addMember = extractExportedFunction(source, 'addProjectMemberInternal');

    // Asserts sweep queries are executed when role is full
    assert.match(addMember, /role\.filled \+ 1 >= role\.count/);
    assert.match(addMember, /eq\(roleApplications\.status,\s*'pending'\)/);
    assert.match(addMember, /executor\s*\.\s*update\(roleApplications\)/);
    assert.match(addMember, /status:\s*'rejected'/);
    assert.match(addMember, /executor\s*\.\s*update\(messageWorkflowItems\)/);
    assert.match(addMember, /status:\s*'expired'/);
});

test('getProjectInviteOptionsAction queries and returns pendingApplicationRoleTitle and pendingInvitations', () => {
    const source = readProjectFile('src/app/actions/applications/internal.ts');
    const getInviteOptions = extractExportedFunction(source, 'getProjectInviteOptionsAction');

    assert.match(getInviteOptions, /roleTitle:\s*projectOpenRoles\.title/);
    assert.match(getInviteOptions, /messageWorkflowItems/);
    assert.match(getInviteOptions, /pendingApplicationRoleTitle:\s*pendingApp\?\.roleTitle\s*\|\|\s*null/);
    assert.match(getInviteOptions, /pendingInvitations:\s*connectionPendingInvites/);
});

test('sendStructuredMessageActionV2 validation guards for project invitations', () => {
    const source = readProjectFile('src/app/actions/messaging/collaboration.ts');
    const sendStructured = extractExportedFunction(source, 'sendStructuredMessageActionV2');

    // Asserts member check
    assert.match(sendStructured, /User is already a member of this project/);
    assert.match(sendStructured, /projectMembers/);

    // Asserts duplicate pending application check
    assert.match(sendStructured, /User has already applied for this role/);
    assert.match(sendStructured, /roleApplications/);

    // Asserts duplicate pending invitation check
    assert.match(sendStructured, /An invitation for this role is already active/);
    assert.match(sendStructured, /messageWorkflowItems/);
});

test('sendStructuredMessageActionV2 writes workflow invitations complete for realtime clients', () => {
    const source = readProjectFile('src/app/actions/messaging/collaboration.ts');
    const sendStructured = extractExportedFunction(source, 'sendStructuredMessageActionV2');

    const workflowIdIndex = sendStructured.indexOf('const workflowItemId = workflowKind ? crypto.randomUUID() : null;');
    const transactionIndex = sendStructured.indexOf('const result = await db.transaction');
    assert.ok(workflowIdIndex >= 0 && workflowIdIndex < transactionIndex);
    assert.match(sendStructured, /}, persistedStructured\), 'sent'\)/);
    assert.match(sendStructured, /\.values\(\{\s*id: workflowItemId,/s);
    assert.doesNotMatch(sendStructured, /\.update\(messages\)/);
    assert.doesNotMatch(sendStructured, /refreshConversationParticipantPreviews\(conversationId\)/);
    assert.match(sendStructured, /native message trigger owns participant previews\/unread state/);
});

test('getIncomingApplicationsAction queries and merges roleApplications and messageWorkflowItems project invites', () => {
    const source = readProjectFile('src/app/actions/applications/internal.ts');
    const getIncoming = extractExportedFunction(source, 'getIncomingApplicationsAction');

    assert.match(getIncoming, /db\.query\.roleApplications\.findMany/);
    assert.match(getIncoming, /db\.query\.messageWorkflowItems\.findMany/);
    assert.match(getIncoming, /isWorkflowItem:\s*true/);
    assert.match(getIncoming, /isWorkflowItem:\s*false/);
});

test('getInboxApplicationsAction queries and merges roleApplications and messageWorkflowItems project invites', () => {
    const source = readProjectFile('src/app/actions/applications/internal.ts');
    const getInbox = extractExportedFunction(source, 'getInboxApplicationsAction');

    assert.match(getInbox, /db\.query\.roleApplications\.findMany/);
    assert.match(getInbox, /db\.query\.messageWorkflowItems\.findMany/);
    assert.match(getInbox, /isWorkflowItem:\s*true/);
    assert.match(getInbox, /invite\.kind\s*=\s*'project_invite'/);
});

test('resolveStructuredWorkflowTransition handles cancel actions for creators', () => {
    const source = readProjectFile('src/lib/messages/structured.ts');
    const resolveTransition = extractExportedFunction(source, 'resolveStructuredWorkflowTransition');

    assert.match(resolveTransition, /action\s*===\s*'cancel'/);
    assert.match(resolveTransition, /actorRole\s*!==\s*'creator'/);
    assert.match(resolveTransition, /actorRole\s*!==\s*'assignee'/);
});
