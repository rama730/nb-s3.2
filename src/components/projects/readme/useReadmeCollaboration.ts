import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";

import { buildReadmeCollaborationDocumentName } from "@/lib/realtime/readme-collaboration-document";

export function useReadmeCollaboration(projectId: string, currentUserName?: string, enabled = false) {
    const ydoc = useMemo(() => new Y.Doc(), []);
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
            name: buildReadmeCollaborationDocumentName(projectId),
            document: ydoc,
            token: async () => {
                const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/readme-collaboration-token`, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json",
                    },
                });
                const body = await response.json().catch(() => null);
                const token = body?.data?.token;
                if (!response.ok || typeof token !== "string" || token.length === 0) {
                    throw new Error(body?.message || "Unable to join README collaboration");
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
    }, [enabled, ydoc, projectId]);

    useEffect(() => {
        if (!provider || !currentUserName) return;
        provider.setAwarenessField('user', {
            name: currentUserName,
            color: '#3b82f6',
        });
    }, [provider, currentUserName]);

    return {
        ydoc,
        provider,
        status,
        synced,
        roomFull,
    };
}
