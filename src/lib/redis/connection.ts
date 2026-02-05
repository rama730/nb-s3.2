
import IORedis from 'ioredis';

const connectionURL = process.env.REDIS_URL || process.env.KV_URL;

if (!connectionURL) {
    console.warn('⚠️ No REDIS_URL or KV_URL found in environment variables. Worker may fail to connect.');
}

/**
 * Shared Redis connection options or instance for BullMQ
 * BullMQ recommends a new connection for each Queue/Worker, 
 * so we export a config object or a factory.
 */
export const redisConnection = new IORedis(connectionURL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null, // Required by BullMQ
});

export const createRedisConnection = () => {
    return new IORedis(connectionURL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
    });
};
