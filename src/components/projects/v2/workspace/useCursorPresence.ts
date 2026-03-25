import { useCallback, useEffect, useRef, useState } from "react";

import { subscribePresenceRoom } from "@/lib/realtime/presence-client";
import type { PresenceMemberState, PresenceServerEvent } from "@/lib/realtime/presence-types";
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
  canBroadcast?: boolean;
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

function uint8ToBase64(payload: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.subarray(i, i + chunkSize);
    let chunkBinary = "";
    for (let j = 0; j < chunk.length; j++) {
      chunkBinary += String.fromCharCode(chunk[j]);
    }
    binary += chunkBinary;
  }
  return btoa(binary);
}

function base64ToUint8(payload: string) {
  try {
    const binaryString = atob(payload);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function useCursorPresence({
  projectId,
  currentUserId,
  currentUserName,
  enabled,
  canBroadcast = false,
}: UseCursorPresenceOptions) {
  const [version, setVersion] = useState(0);
  const [remoteMap, setRemoteMap] = useState<CursorPresenceMap>(EMPTY_CURSOR_MAP);
  const [isVisible, setIsVisible] = useState(() => typeof document === "undefined" ? true : !document.hidden);
  const presenceRef = useRef<ReturnType<typeof createPresenceManager> | null>(null);
  const throttleRef = useRef<ReturnType<typeof createCursorThrottle> | null>(null);
  const subscriptionRef = useRef<ReturnType<typeof subscribePresenceRoom> | null>(null);
  const versionBumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleVersionBump = useCallback(() => {
    if (versionBumpTimer.current) return;
    versionBumpTimer.current = setTimeout(() => {
      versionBumpTimer.current = null;
      setVersion((prev) => prev + 1);
      if (presenceRef.current) {
        setRemoteMap(new Map(presenceRef.current.cursors));
      }
    }, 250);
  }, []);

  const applyMemberCursor = useCallback((member: PresenceMemberState, event: PresenceServerEvent["type"]) => {
    const presence = presenceRef.current;
    if (!presence || member.userId === currentUserId) return;

    presence.registerUser(member.userId, member.userName ?? undefined);

    if (event === "presence.delta" && !member.cursorFrame) {
      return;
    }

    if (!member.cursorFrame) {
      presence.removeUser(member.userId);
      scheduleVersionBump();
      return;
    }

    const cursorFrame = base64ToUint8(member.cursorFrame);
    if (!cursorFrame) {
      return;
    }

    presence.processIncoming(cursorFrame, fnv1a(currentUserId));
    scheduleVersionBump();
  }, [currentUserId, scheduleVersionBump]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !currentUserId || !isVisible) {
      setRemoteMap(EMPTY_CURSOR_MAP);
      return;
    }

    const presence = createPresenceManager();
    presenceRef.current = presence;
    setRemoteMap(presence.cursors);
    presence.registerUser(currentUserId, currentUserName);
    presence.startGC();

    const subscription = subscribePresenceRoom({
      roomType: "workspace",
      roomId: projectId,
      role: canBroadcast ? "editor" : "viewer",
      onEvent: (event) => {
        if (event.type === "presence.state") {
          presence.cursors.clear();
          for (const member of event.members) {
            applyMemberCursor(member, event.type);
          }
          scheduleVersionBump();
          return;
        }

        if (event.type === "presence.delta") {
          if (event.action === "leave") {
            presence.removeUser(event.member.userId);
            scheduleVersionBump();
            return;
          }
          applyMemberCursor(event.member, event.type);
        }
      },
    });
    subscriptionRef.current = subscription;

    const throttle = createCursorThrottle((payload) => {
      subscription.send({
        type: "cursor",
        frame: uint8ToBase64(payload),
        userName: currentUserName ?? null,
      });
    });
    throttleRef.current = throttle;

    return () => {
      throttle.destroy();
      presence.destroy();
      subscription.unsubscribe();
      if (versionBumpTimer.current) clearTimeout(versionBumpTimer.current);
      presenceRef.current = null;
      throttleRef.current = null;
      subscriptionRef.current = null;
      versionBumpTimer.current = null;
    };
  }, [applyMemberCursor, canBroadcast, currentUserId, currentUserName, enabled, isVisible, projectId, scheduleVersionBump]);

  const broadcastCursor = useCallback(
    (nodeId: string, line: number, column: number, selStart = 0, selEnd = 0) => {
      if (!throttleRef.current || !currentUserId || !isVisible || !canBroadcast) return;

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
    [canBroadcast, currentUserId, currentUserName, isVisible],
  );

  return {
    remoteCursors: remoteMap,
    broadcastCursor,
    cursorVersion: version,
  };
}
