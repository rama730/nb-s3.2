
import { config } from 'dotenv';
// Load environment variables locally
config({ path: '.env.local' });

import { startWorker } from '../workers/import-worker';

console.log('🚀 Starting Background Workers...');

const worker = startWorker();

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Closing worker...');
    await worker.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received. Closing worker...');
    await worker.close();
    process.exit(0);
});
