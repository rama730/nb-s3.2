import { Server } from '@hocuspocus/server';
import { Redis } from '@hocuspocus/extension-redis';
import { SQLite } from '@hocuspocus/extension-sqlite';
import { config as loadDotenv } from "dotenv";
import * as path from 'node:path';
import { isReadmeCollaborationDocumentName } from '../../../src/lib/realtime/readme-collaboration-document';
import {
    verifyReadmeCollaborationToken,
    MissingReadmeCollaborationSecretError,
} from '../../../src/lib/realtime/readme-collaboration-token';

loadDotenv({ path: ".env.local" });
loadDotenv();

const port = process.env.YJS_PORT ? parseInt(process.env.YJS_PORT, 10) : 1234;

function parseCommaList(value: string | undefined) {
    return (value || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function normalizeOrigin(value: string) {
    try {
        return new URL(value).origin;
    } catch {
        try {
            return new URL(`https://${value}`).origin;
        } catch {
            return null;
        }
    }
}

function resolveAllowedOrigins() {
    const configured = [
        ...parseCommaList(process.env.YJS_ALLOWED_ORIGINS),
        ...parseCommaList(process.env.NEXT_PUBLIC_APP_URL),
        ...parseCommaList(process.env.APP_URL),
        ...parseCommaList(process.env.VERCEL_URL),
    ];

    return new Set(
        configured
            .map(normalizeOrigin)
            .filter((origin): origin is string => Boolean(origin)),
    );
}

function assertAllowedOrigin(headers: Headers) {
    const allowedOrigins = resolveAllowedOrigins();
    if (allowedOrigins.size === 0) return;

    const origin = headers.get("origin");
    if (!origin) return;

    const normalized = normalizeOrigin(origin);
    if (!normalized || !allowedOrigins.has(normalized)) {
        throw new Error("Origin is not allowed");
    }
}

function createRedisExtension() {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (redisUrl) {
        const parsed = new URL(redisUrl);
        const options: any = {};
        if (parsed.username) options.username = decodeURIComponent(parsed.username);
        if (parsed.password) options.password = decodeURIComponent(parsed.password);
        if (parsed.protocol === "rediss:") options.tls = {};

        const dbNumber = parsed.pathname.replace("/", "");
        if (/^\d+$/.test(dbNumber)) options.db = Number(dbNumber);

        return new Redis({
            host: parsed.hostname,
            port: parsed.port ? parseInt(parsed.port, 10) : 6379,
            options,
        });
    }

    const redisHost = process.env.REDIS_HOST?.trim();
    if (!redisHost) {
        throw new Error("Yjs Redis is required in production. Set REDIS_URL or REDIS_HOST.");
    }

    return new Redis({
        host: redisHost,
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
        options: process.env.REDIS_PASSWORD
            ? { password: process.env.REDIS_PASSWORD }
            : undefined,
    });
}

let databasePath = process.env.YJS_SQLITE_DB_PATH;

if (!databasePath) {
    // @ts-ignore - __dirname is not defined in ESM but is injected by tsx
    const dir = typeof __dirname !== 'undefined' ? __dirname : undefined;
    if (dir) {
        databasePath = path.resolve(dir, '../../../yjs-local.sqlite');
    } else {
        databasePath = path.resolve(process.cwd(), 'yjs-local.sqlite');
    }
}

const extensions = [];
if (process.env.NODE_ENV === 'production') {
    extensions.push(createRedisExtension());
} else {
    extensions.push(
        new SQLite({
            database: databasePath,
        })
    );
}

const server = new Server({
    port,
    extensions,
    async onConnect(data) {
        assertAllowedOrigin(data.requestHeaders);
        if (!isReadmeCollaborationDocumentName(data.documentName)) {
            throw new Error("Unsupported collaboration document");
        }
        const document = data.instance.documents.get(data.documentName);
        const connectionCount = document ? document.getConnectionsCount() : 0;
        if (connectionCount >= 5) {
            throw new Error("ROOM_FULL");
        }
        console.log(`[Hocuspocus] User connected to room: ${data.documentName} (Current editors: ${connectionCount + 1})`);
    },
    async onAuthenticate(data) {
        assertAllowedOrigin(data.requestHeaders);
        const claims = verifyReadmeCollaborationToken(data.token);
        if (claims.documentName !== data.documentName) {
            throw new Error("README collaboration token does not match document");
        }

        data.connectionConfig.readOnly = false;

        return {
            userId: claims.userId,
            sessionId: claims.sessionId,
            projectId: claims.projectId,
            role: claims.role,
        };
    },
});

server.listen().then(() => {
    console.log(`Stable Hocuspocus Yjs backend running on ws://127.0.0.1:${port}`);
}).catch((error) => {
    const message = error instanceof MissingReadmeCollaborationSecretError
        ? error.message
        : error instanceof Error
            ? error.message
            : String(error);
    console.error(`[Hocuspocus] Failed to start: ${message}`);
    process.exit(1);
});
