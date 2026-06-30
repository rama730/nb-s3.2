import fs from 'node:fs';
import path from 'node:path';

const journalPath = path.resolve('/Users/chrama/Downloads/nb-s3/drizzle/meta/_journal.json');
const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

// Find position of 0004_chat_storage
const chatStorageIndex = journal.entries.findIndex((entry: any) => entry.tag === '0004_chat_storage');

if (chatStorageIndex === -1) {
    console.error('0004_chat_storage not found in journal');
    process.exit(1);
}

const chatStorageEntry = journal.entries[chatStorageIndex];
const newEntry = {
    idx: chatStorageEntry.idx + 1,
    version: '7',
    when: chatStorageEntry.when + 1,
    tag: '0004_message_reactions',
    breakpoints: true
};

// Insert newEntry right after chatStorageEntry
journal.entries.splice(chatStorageIndex + 1, 0, newEntry);

// Shift idx for all subsequent entries
for (let i = chatStorageIndex + 2; i < journal.entries.length; i++) {
    journal.entries[i].idx = journal.entries[i].idx + 1;
}

fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2) + '\n', 'utf8');
console.log('Successfully patched journal!');
