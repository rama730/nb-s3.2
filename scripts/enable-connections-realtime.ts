import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Load environment variables
config({ path: '.env.local' });

async function enableConnectionsRealtime() {
    const connectionString = process.env.DATABASE_URL!;

    // Create a postgres client
    const client = postgres(connectionString);
    const db = drizzle(client);

    try {
        console.log('Enabling realtime for connections table...');

        // Run the ALTER PUBLICATION command
        await client`ALTER PUBLICATION supabase_realtime ADD TABLE connections;`;

        console.log('✅ Realtime enabled for connections table');
    } catch (error) {
        console.error('❌ Error:', error);
        throw error;
    } finally {
        await client.end();
    }
}

enableConnectionsRealtime();
