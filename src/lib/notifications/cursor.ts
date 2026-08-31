export type NotificationCursor = {
    activityAt: string;
    id: string;
};

const UUID_CURSOR_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidNotificationCursorError extends Error {
    constructor() {
        super("Invalid notification cursor");
        this.name = "InvalidNotificationCursorError";
    }
}

export function encodeNotificationCursor(cursor: NotificationCursor) {
    return Buffer.from(`${cursor.activityAt}:::${cursor.id}`, "utf8").toString("base64");
}

export function decodeNotificationCursor(raw: string | null | undefined): NotificationCursor | null {
    if (!raw) return null;

    try {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        const parts = decoded.split(":::");
        if (parts.length !== 2) throw new InvalidNotificationCursorError();

        const [activityAt, id] = parts;
        if (!activityAt || !id || !UUID_CURSOR_RE.test(id)) {
            throw new InvalidNotificationCursorError();
        }

        const parsedActivityAt = new Date(activityAt);
        if (Number.isNaN(parsedActivityAt.getTime())) {
            throw new InvalidNotificationCursorError();
        }

        return { activityAt: parsedActivityAt.toISOString(), id };
    } catch (error) {
        if (error instanceof InvalidNotificationCursorError) throw error;
        throw new InvalidNotificationCursorError();
    }
}
