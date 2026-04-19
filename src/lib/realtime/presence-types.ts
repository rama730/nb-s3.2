export type PresenceRoomType = "conversation" | "workspace" | "user" | "task";
export type PresenceRoomRole = "viewer" | "editor";

export type PresenceTypingContext =
  | {
      scope: "conversation";
    }
  | {
      scope: "task_comment";
      parentCommentId?: string | null;
    };

export type PresenceMemberProfile = {
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

export type PresenceMemberState = {
  connectionId: string;
  userId: string;
  roomType: PresenceRoomType;
  roomId: string;
  role: PresenceRoomRole;
  lastSeenAt: number;
  cursorFrame: string | null;
  typing: boolean;
  typingContext: PresenceTypingContext | null;
  userName: string | null;
  profile: PresenceMemberProfile | null;
};

export type PresenceServerEvent =
  | {
      type: "presence.state";
      roomType: PresenceRoomType;
      roomId: string;
      members: PresenceMemberState[];
    }
  | {
      type: "presence.delta";
      action: "upsert" | "leave";
      roomType: PresenceRoomType;
      roomId: string;
      member: PresenceMemberState;
    }
  | {
      type: "ack";
      ackType: "auth" | "heartbeat" | "cursor" | "typing" | "delivered" | "read";
      roomType: PresenceRoomType;
      roomId: string;
      serverTime: number;
    }
  | {
      // Wave 2 Step 11: latency-optimized receipt broadcast.
      // Emitted by the server when a conversation participant sends a
      // `delivered` or `read` client event. Lets the sender's UI advance
      // the delivery tick (~100 ms) before the postgres_changes INSERT
      // from the receipt table propagates (~100–300 ms).
      type: "receipt.broadcast";
      receiptType: "delivered" | "read";
      roomType: PresenceRoomType;
      roomId: string;
      userId: string;
      messageIds: string[];
      serverTime: number;
    }
  | {
      type: "error";
      code:
        | "UNAUTHORIZED"
        | "TOKEN_EXPIRED"
        | "BAD_PAYLOAD"
        | "ROOM_NOT_FOUND"
        | "RATE_LIMITED"
        | "INTERNAL";
      message: string;
    };

export type PresenceClientEvent =
  | {
      type: "heartbeat";
    }
  | {
      type: "cursor";
      frame: string;
      userName?: string | null;
    }
  | {
      type: "typing";
      isTyping: boolean;
      profile?: PresenceMemberProfile | null;
      context?: PresenceTypingContext | null;
    }
  | {
      // Wave 2 Step 11: sent by the recipient's client to the conversation
      // presence room after writing delivery receipts to the DB. The server
      // broadcasts a `receipt.broadcast` to all room members so the sender
      // sees the tick advance within ~100 ms.
      type: "delivered";
      messageIds: string[];
    }
  | {
      // Wave 2 Step 11: same as `delivered` but for read receipts.
      type: "read";
      messageIds: string[];
    };
