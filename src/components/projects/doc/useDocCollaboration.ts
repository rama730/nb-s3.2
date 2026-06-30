import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";

import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import { buildDocCollaborationDocumentName } from "@/lib/realtime/doc-collaboration-document";

export function useDocCollaboration(
    projectId: string,
    docSlug: string,
    currentUserId?: string | null,
    currentUserName?: string,
    enabled = false
) {
    const normalizedDocSlug = useMemo(() => normalizeProjectDocSlug(docSlug), [docSlug]);
    const ydoc = useMemo(() => new Y.Doc(), [projectId, normalizedDocSlug]);
    const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
    const [status, setStatus] = useState<"disabled" | "connecting" | "connected" | "disconnected">("disabled");
    const [synced, setSynced] = useState(true);
    const [roomFull, setRoomFull] = useState(false);

    useEffect(() => {
        if (!enabled) {
            setProvider(null);
            setStatus("disabled");
            setSynced(true);
            setRoomFull(false);
            return;
        }

        const url = process.env.NEXT_PUBLIC_YJS_WEBSOCKET_URL?.trim();
        if (!url) {
            setProvider(null);
            setStatus("disabled");
            setSynced(true);
            setRoomFull(false);
            return;
        }

        setStatus("connecting");
        setSynced(false);
        setRoomFull(false);

        const wsProvider = new HocuspocusProvider({
            url,
            name: buildDocCollaborationDocumentName(projectId, normalizedDocSlug),
            document: ydoc,
            token: async () => {
                const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/doc-collaboration-token`, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ docSlug: normalizedDocSlug }),
                });
                const body = await response.json().catch(() => null);
                const token = body?.data?.token;
                if (!response.ok || typeof token !== "string" || token.length === 0) {
                    throw new Error(body?.message || "Unable to join Doc collaboration");
                }
                return token;
            },
            onAuthenticationFailed: () => {
                setStatus("disconnected");
                setSynced(true);
            },
            onClose: ({ event }) => {
                if (event && (event.reason === "ROOM_FULL" || event.reason?.includes("ROOM_FULL"))) {
                    setRoomFull(true);
                }
            },
        });
        setProvider(wsProvider);

        const handleStatus = ({ status }: { status: "connecting" | "connected" | "disconnected" }) => {
            setStatus(status);
        };
        const handleSynced = () => {
            setSynced(true);
        };
        wsProvider.on('status', handleStatus);
        wsProvider.on('synced', handleSynced);

        return () => {
            wsProvider.off('status', handleStatus);
            wsProvider.off('synced', handleSynced);
            wsProvider.destroy();
        };
    }, [enabled, ydoc, projectId, normalizedDocSlug]);

    useEffect(() => {
        return () => {
            ydoc.destroy();
        };
    }, [ydoc]);

    useEffect(() => {
        if (!provider || !currentUserName) return;
        provider.setAwarenessField('user', {
            id: currentUserId,
            name: currentUserName,
            color: '#3b82f6',
        });
    }, [provider, currentUserId, currentUserName]);

    return {
        ydoc,
        provider,
        status,
        synced,
        roomFull,
    };
}
