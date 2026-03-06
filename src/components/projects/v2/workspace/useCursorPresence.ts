/**
 * Phase 5 Optimization #7: Binary-Packed Cursor Presence Hook
 *
 * Wires the binary cursor protocol into Supabase Realtime Broadcast.
 * Uses a dedicated broadcast channel for cursor positions, throttled at 16ms
 * to simulate WebTransport-style UDP flow.
 *
 * Usage:
 *   const { remoteCursors, broadcastCursor } = useCursorPresence({
 *     projectId, currentUserId, currentUserName, enabled
 *   });
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
    createCursorThrottle,
    createPresenceManager,
    type CursorPresenceMap,
} from "./cursorProtocol";

const EMPTY_CURSOR_MAP: CursorPresenceMap = new Map();

interface UseCursorPresenceOptions {
    projectId: string;
    currentUserId: string;
    currentUserName?: string;
    enabled: boolean;
}

// FNV-1a 32-bit (duplicated to avoid circular imports in hot path)
function fnv1a(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash;
}

export function useCursorPresence({
    projectId,
    currentUserId,
    currentUserName,
    enabled,
}: UseCursorPresenceOptions) {
    const [version, setVersion] = useState(0);
    const [remoteMap, setRemoteMap] = useState<CursorPresenceMap>(EMPTY_CURSOR_MAP);
    const presenceRef = useRef<ReturnType<typeof createPresenceManager> | null>(null);
    const throttleRef = useRef<ReturnType<typeof createCursorThrottle> | null>(null);
    const versionBumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!enabled || !currentUserId) return;

        const supabase = createClient();
        const myHash = fnv1a(currentUserId);
        const presence = createPresenceManager();
        presenceRef.current = presence;
        setRemoteMap(presence.cursors);

        presence.registerUser(currentUserId, currentUserName);
        presence.startGC();

        // Supabase Broadcast channel for cursor events
        const channelName = `cursors:${projectId}`;
        const channel = supabase.channel(channelName, {
            config: { broadcast: { self: false } },
        });

        // Throttled broadcaster
        const throttle = createCursorThrottle((payload) => {
            // Convert Uint8Array to base64 for Supabase JSON transport
            const base64 = btoa(String.fromCharCode(...payload));
            channel.send({
                type: "broadcast",
                event: "cursor",
                payload: { d: base64 },
            });
        });
        throttleRef.current = throttle;

        // Receive handler
        channel.on("broadcast", { event: "cursor" }, (msg: any) => {
            try {
                const base64 = msg.payload?.d;
                if (!base64) return;
                // Decode base64 → Uint8Array
                const binaryString = atob(base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const frame = presence.processIncoming(bytes, myHash);
                if (frame) {
                    // Throttle version bumps to max 4/sec to prevent excessive re-renders
                    if (!versionBumpTimer.current) {
                        versionBumpTimer.current = setTimeout(() => {
                            setVersion((v) => v + 1);
                            if (presenceRef.current) setRemoteMap(new Map(presenceRef.current.cursors));
                            versionBumpTimer.current = null;
                        }, 250);
                    }
                }
            } catch {
                // Silently drop malformed frames
            }
        });

        channel.subscribe();

        return () => {
            throttle.destroy();
            presence.destroy();
            supabase.removeChannel(channel);
            if (versionBumpTimer.current) clearTimeout(versionBumpTimer.current);
            presenceRef.current = null;
            throttleRef.current = null;
            versionBumpTimer.current = null;
        };
    }, [enabled, projectId, currentUserId, currentUserName]);

    /** Broadcast the local user's cursor position (throttled at 16ms). */
    const broadcastCursor = useCallback(
        (nodeId: string, line: number, column: number, selStart = 0, selEnd = 0) => {
            if (!throttleRef.current || !currentUserId) return;

            // Register node for reverse hash lookup
            presenceRef.current?.registerNode(nodeId);

            throttleRef.current.send({
                userId: currentUserId,
                userName: currentUserName,
                nodeId,
                line,
                column,
                selectionStart: selStart,
                selectionEnd: selEnd,
                timestamp: Date.now(),
            });
        },
        [currentUserId, currentUserName]
    );

    return {
        remoteCursors: remoteMap,
        broadcastCursor,
        cursorVersion: version,
    };
}
