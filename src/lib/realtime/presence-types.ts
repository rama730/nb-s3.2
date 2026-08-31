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

export type PresenceTypingUser = {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

export function toPresenceTypingUser(member: PresenceMemberState): PresenceTypingUser {
  return {
    id: member.userId,
    username: member.profile?.username ?? null,
    fullName: member.profile?.fullName ?? member.userName ?? null,
    avatarUrl: member.profile?.avatarUrl ?? null,
  };
}

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
      ackType: "auth" | "heartbeat" | "cursor" | "typing";
      roomType: PresenceRoomType;
      roomId: string;
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
      userId?: string;
      isTyping: boolean;
      profile?: PresenceMemberProfile | null;
      context?: PresenceTypingContext | null;
    };
