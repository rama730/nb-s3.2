import { Server } from '@hocuspocus/server';
import { Redis } from '@hocuspocus/extension-redis';
import { SQLite } from '@hocuspocus/extension-sqlite';
import { config as loadDotenv } from "dotenv";
import * as path from 'node:path';
import {
    isDocCollaborationDocumentName,
    parseDocCollaborationDocumentName,
} from '../../../src/lib/realtime/doc-collaboration-document';
import {
    verifyDocCollaborationToken,
    MissingDocCollaborationSecretError,
} from '../../../src/lib/realtime/doc-collaboration-token';
import { db } from '../../../src/lib/db';
import { profiles, projectMarkdowns } from '../../../src/lib/db/schema';
import { eq, and } from 'drizzle-orm';

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

async function saveDraft(projectId: string, docSlug: string, content: string) {
    try {
        await db
            .update(projectMarkdowns)
            .set({
                draftContent: content,
                draftUpdatedAt: new Date(),
            })
            .where(
                and(
                    eq(projectMarkdowns.projectId, projectId),
                    eq(projectMarkdowns.slug, docSlug)
                )
            );
    } catch (err) {
        console.error(`[Hocuspocus] Failed to auto-save draft for ${projectId}:${docSlug}:`, err);
    }
}

function joinRoomQueue(document: any, userId: string, userName: string) {
    const collabState = document.getMap('collaborationState');
    let activeEditors = (collabState.get('activeEditors') as any[]) || [];
    let spectators = (collabState.get('spectators') as any[]) || [];

    const editorIndex = activeEditors.findIndex((e: any) => e.userId === userId);
    if (editorIndex !== -1) {
        activeEditors[editorIndex].userName = userName;
    } else {
        const spectatorIndex = spectators.findIndex((s: any) => s.userId === userId);
        if (spectatorIndex !== -1) {
            spectators[spectatorIndex].userName = userName;
        } else {
            if (activeEditors.length < 5) {
                activeEditors.push({
                    userId,
                    userName,
                    joinedAt: Date.now()
                });
            } else {
                spectators.push({
                    userId,
                    userName,
                    joinedAt: Date.now()
                });
            }
        }
    }

    document.transact(() => {
        collabState.set('activeEditors', activeEditors);
        collabState.set('spectators', spectators);
    }, 'server-queue-join');
}

async function checkRoomEvictionAndPromotion(documentName: string, document: any) {
    const collabState = document.getMap('collaborationState');
    let activeEditors = (collabState.get('activeEditors') as any[]) || [];
    let spectators = (collabState.get('spectators') as any[]) || [];
    let pendingPromotion = collabState.get('pendingPromotion') as any || null;

    if (activeEditors.length === 0 && spectators.length === 0 && !pendingPromotion) return;

    const states = Array.from(document.awareness.getStates().entries()) as [number, any][];
    const now = Date.now();
    let evictedUserIds: string[] = [];

    const remainingEditors = activeEditors.filter((editor: any) => {
        const userStateEntry = states.find(([_, s]) => s.user?.id === editor.userId);
        if (!userStateEntry) {
            evictedUserIds.push(editor.userId);
            return false;
        }
        
        const state = userStateEntry[1];
        const lastActive = state.lastActiveAt || 0;
        const heartbeat = state.heartbeat || 0;

        if (now - lastActive > 45000 || now - heartbeat > 45000) {
            evictedUserIds.push(editor.userId);
            return false;
        }

        return true;
    });

    if (evictedUserIds.length > 0) {
        console.log(`[Hocuspocus] Evicting idle editors: ${evictedUserIds.join(', ')} from ${documentName}`);
        
        const content = document.getText('markdown').toString();
        const parsed = parseDocCollaborationDocumentName(documentName);
        if (parsed) {
            await saveDraft(parsed.projectId, parsed.docSlug, content);
            console.log(`[Hocuspocus] Auto-saved draft content for ${documentName} on eviction`);
        }

        evictedUserIds.forEach((evictedId) => {
            const evictedEditor = activeEditors.find((e: any) => e.userId === evictedId);
            if (evictedEditor && !spectators.some((s: any) => s.userId === evictedId)) {
                spectators.push({
                    userId: evictedEditor.userId,
                    userName: evictedEditor.userName,
                    joinedAt: Date.now(),
                });
            }
        });

        activeEditors = remainingEditors;
    }

    if (pendingPromotion) {
        const promotedUserStateEntry = states.find(([_, s]) => s.user?.id === pendingPromotion.userId);
        const promotedState = promotedUserStateEntry?.[1];

        if (promotedState?.acceptPromotion) {
            const spectatorObj = spectators.find((s: any) => s.userId === pendingPromotion.userId);
            if (spectatorObj) {
                activeEditors.push({
                    userId: spectatorObj.userId,
                    userName: spectatorObj.userName,
                    joinedAt: Date.now(),
                });
                spectators = spectators.filter((s: any) => s.userId !== pendingPromotion.userId);
            }
            pendingPromotion = null;
        } else if (now - pendingPromotion.promotedAt > 10000) {
            console.log(`[Hocuspocus] Promotion expired for user ${pendingPromotion.userId} in ${documentName}`);
            const spectatorObj = spectators.find((s: any) => s.userId === pendingPromotion.userId);
            if (spectatorObj) {
                spectators = spectators.filter((s: any) => s.userId !== pendingPromotion.userId);
                spectators.push({
                    ...spectatorObj,
                    joinedAt: Date.now(),
                });
            }
            pendingPromotion = null;
        }
    }

    if (!pendingPromotion && activeEditors.length < 5 && spectators.length > 0) {
        const nextSpectator = spectators[0];
        pendingPromotion = {
            userId: nextSpectator.userId,
            promotedAt: Date.now(),
        };
        console.log(`[Hocuspocus] Offering promotion slot to user ${nextSpectator.userId} in ${documentName}`);
    }

    document.transact(() => {
        collabState.set('activeEditors', activeEditors);
        collabState.set('spectators', spectators);
        collabState.set('pendingPromotion', pendingPromotion);
    }, 'server-queue-tick');
}

const server = new Server({
    port,
    extensions,
    async onConnect(data) {
        assertAllowedOrigin(data.requestHeaders);
        if (!isDocCollaborationDocumentName(data.documentName)) {
            throw new Error("Unsupported collaboration document");
        }
        console.log(`[Hocuspocus] User connected to room: ${data.documentName}`);
    },
    async onAuthenticate(data) {
        assertAllowedOrigin(data.requestHeaders);
        const claims = verifyDocCollaborationToken(data.token);
        if (claims.documentName !== data.documentName) {
            throw new Error("Doc collaboration token does not match document");
        }

        let userName = "Teammate";
        try {
            const [profile] = await db
                .select({ name: profiles.fullName, username: profiles.username })
                .from(profiles)
                .where(eq(profiles.id, claims.userId))
                .limit(1);
            if (profile?.name) {
                userName = profile.name;
            } else if (profile?.username) {
                userName = profile.username;
            }
        } catch (err) {
            console.error(`[Hocuspocus] Failed to fetch profile name for ${claims.userId}:`, err);
        }

        const document = data.instance.documents.get(data.documentName);
        if (document) {
            joinRoomQueue(document, claims.userId, userName);

            const collabState = document.getMap('collaborationState');
            const activeEditors = (collabState.get('activeEditors') as any[]) || [];
            const isActive = activeEditors.some((e: any) => e.userId === claims.userId);
            data.connectionConfig.readOnly = !isActive;
        } else {
            data.connectionConfig.readOnly = false;
        }

        return {
            userId: claims.userId,
            userName,
            sessionId: claims.sessionId,
            projectId: claims.projectId,
            role: claims.role,
        };
    },
    async afterLoadDocument(data) {
        const { document } = data;
        const collabState = document.getMap('collaborationState');
        collabState.observe(() => {
            const activeEditors = (collabState.get('activeEditors') as any[]) || [];
            document.connections.forEach((conn: any) => {
                const connUserId = conn.context?.userId;
                if (connUserId) {
                    const isActive = activeEditors.some((e: any) => e.userId === connUserId);
                    conn.connectionConfig.readOnly = !isActive;
                }
            });
        });
    },
    async onDisconnect(data) {
        const userId = data.context?.userId;
        if (!userId) return;

        const document = data.instance.documents.get(data.documentName);
        if (!document) return;

        const collabState = document.getMap('collaborationState');
        let activeEditors = (collabState.get('activeEditors') as any[]) || [];
        let spectators = (collabState.get('spectators') as any[]) || [];

        activeEditors = activeEditors.filter((e: any) => e.userId !== userId);
        spectators = spectators.filter((s: any) => s.userId !== userId);

        let pendingPromotion = collabState.get('pendingPromotion') as any || null;
        if (pendingPromotion?.userId === userId) {
            pendingPromotion = null;
        }

        document.transact(() => {
            collabState.set('activeEditors', activeEditors);
            collabState.set('spectators', spectators);
            collabState.set('pendingPromotion', pendingPromotion);
        }, 'server-queue-leave');

        console.log(`[Hocuspocus] User disconnected: ${userId} from room: ${data.documentName}`);
    }
});

setInterval(async () => {
    for (const [documentName, document] of server.hocuspocus.documents.entries()) {
        try {
            await checkRoomEvictionAndPromotion(documentName, document);
        } catch (err) {
            console.error(`[Hocuspocus] Error in periodic check for ${documentName}:`, err);
        }
    }
}, 15000);

server.listen().then(() => {
    console.log(`Stable Hocuspocus Yjs backend running on ws://127.0.0.1:${port}`);
}).catch((error) => {
    const message = error instanceof MissingDocCollaborationSecretError
        ? error.message
        : error instanceof Error
            ? error.message
            : String(error);
    console.error(`[Hocuspocus] Failed to start: ${message}`);
    process.exit(1);
});

// Native memory monitor to protect against heap leaks
const MEMORY_LIMIT_MB = 1500;
setInterval(() => {
  const heapUsed = process.memoryUsage().heapUsed / 1024 / 1024;
  if (heapUsed > MEMORY_LIMIT_MB) {
    console.warn(`[Yjs] heap footprint (${Math.round(heapUsed)}MB) exceeded threshold. Gracefully restarting.`);
    process.exit(1);
  }
}, 30000).unref();
