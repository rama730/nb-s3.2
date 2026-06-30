import postgres from 'postgres';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });
loadDotenv();

async function run() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('Missing DATABASE_URL');
        process.exit(1);
    }

    const sql = postgres(connectionString);

    try {
        console.log('Fetching conversation info...');
        const conversationId = '8902de73-3905-4f84-9ec7-6a700941cd1c';
        const convo = await sql`
            SELECT * FROM conversations WHERE id = ${conversationId}
        `;
        console.log('Conversation:', JSON.stringify(convo, null, 2));

        console.log('Fetching participants...');
        const participants = await sql`
            SELECT cp.*, p.full_name, p.username 
            FROM conversation_participants cp 
            JOIN profiles p ON p.id = cp.user_id 
            WHERE cp.conversation_id = ${conversationId}
        `;
        console.log('Participants:', JSON.stringify(participants, null, 2));

        console.log('Fetching messages...');
        const msgList = await sql`
            SELECT * FROM messages WHERE conversation_id = ${conversationId} ORDER BY created_at ASC
        `;
        console.log('Messages:', JSON.stringify(msgList, null, 2));

    } catch (err) {
        console.error('Database query failed:', err);
    } finally {
        await sql.end();
    }
}

run();
