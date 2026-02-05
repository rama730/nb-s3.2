
import { Queue } from 'bullmq';
import { redisConnection } from '@/lib/redis/connection';
import { QUEUES, ImportJobData } from './config';

// Create a new Queue instance for project imports
// We reuse the redis connection to avoid opening too many during hot reloads if possible,
// though BullMQ prefers we pass connection *settings* or a dedicated connection.
// Here we pass the connection instance directly which works for producers.

export const importQueue = new Queue<ImportJobData>(QUEUES.PROJECT_IMPORTS, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: {
            age: 24 * 3600, // Keep for 24 hours
            count: 100,
        },
        removeOnFail: {
            age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        }
    },
});
