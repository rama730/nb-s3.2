type SessionLike = {
    id?: unknown;
    session_id?: unknown;
    access_token?: unknown;
} | null | undefined;

type JwtPayloadLike = {
    session_id?: unknown;
};

function decodeBase64UrlSegment(value: string): string | null {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const input = `${normalized}${padding}`;

    try {
        if (typeof Buffer !== "undefined") {
            return Buffer.from(input, "base64").toString("utf8");
        }

        if (typeof atob === "function") {
            return atob(input);
        }
    } catch {
        return null;
    }

    return null;
}

function tryDecodeJwtPayload(token: string): JwtPayloadLike | null {
    const parts = token.split(".");
    if (parts.length < 2 || parts[1].trim().length === 0) return null;

    const decoded = decodeBase64UrlSegment(parts[1]);
    if (!decoded) return null;

    try {
        return JSON.parse(decoded) as JwtPayloadLike;
    } catch {
        return null;
    }
}

export function getSessionIdentifierFromSession(session: SessionLike): string | null {
    if (!session) return null;

    const explicit = session.id;
    if (typeof explicit === "string" && explicit.trim().length > 0) {
        return explicit;
    }

    const directSessionId = session.session_id;
    if (typeof directSessionId === "string" && directSessionId.trim().length > 0) {
        return directSessionId;
    }

    const accessToken = session.access_token;
    if (typeof accessToken === "string" && accessToken.trim().length > 0) {
        const payload = tryDecodeJwtPayload(accessToken);
        const jwtSessionId = payload?.session_id;
        if (typeof jwtSessionId === "string" && jwtSessionId.trim().length > 0) {
            return jwtSessionId;
        }
    }

    return null;
}
