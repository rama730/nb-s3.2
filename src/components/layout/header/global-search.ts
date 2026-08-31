import { normalizeSearchQuery, tokenizeSearchQuery } from "@/lib/search/query";
import { settingsTabHref } from "@/constants/routes";

export type GlobalSearchContext =
    | "default"
    | "hub"
    | "people"
    | "messages"
    | "project"
    | "settings";

export type SearchContext = {
    context: GlobalSearchContext;
    placeholder: string;
    title: string;
    description: string;
};

export type PeopleSearchScope = "discover" | "network";

export function getPeopleSearchScope(searchParams?: URLSearchParams | null): PeopleSearchScope {
    return searchParams?.get("tab") === "network" ? "network" : "discover";
}

export type SettingsSearchItem = {
    id: string;
    title: string;
    section: string;
    description: string;
    href: string;
    keywords: string;
    featured?: boolean;
};

const RECENT_GLOBAL_SEARCH_STORAGE_PREFIX = "nb:global-search:recent:v1";
export const MAX_RECENT_GLOBAL_SEARCHES = 5;

type RecentGlobalSearchStore = Record<string, unknown>;

export type RecentGlobalSearchItem =
    | { kind: "query"; key: string; label: string; query: string }
    | { kind: "preview"; key: string; label: string; preview: unknown };

function readRecentGlobalSearchStore(ownerId: string): RecentGlobalSearchStore {
    if (typeof window === "undefined" || !ownerId) return {};
    try {
        const parsed = JSON.parse(window.localStorage.getItem(`${RECENT_GLOBAL_SEARCH_STORAGE_PREFIX}:${ownerId}`) || "{}") as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RecentGlobalSearchStore : {};
    } catch {
        return {};
    }
}

export function getGlobalSearchRecentScope(
    context: GlobalSearchContext,
    peopleScope: PeopleSearchScope,
    projectIdentifier: string | null,
) {
    if (context === "default" || context === "hub") return "hub";
    if (context === "people") return `people:${peopleScope}`;
    if (context === "project") return `project:${projectIdentifier || "unknown"}`;
    return context;
}

function recentQueryItem(query: string): RecentGlobalSearchItem | null {
    const normalized = normalizeGlobalSearchQuery(query);
    if (!normalized) return null;
    return {
        kind: "query",
        key: `query:${normalized.toLocaleLowerCase()}`,
        label: normalized,
        query: normalized,
    };
}

function parseRecentGlobalSearchItem(value: unknown): RecentGlobalSearchItem | null {
    if (typeof value === "string") return recentQueryItem(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (item.kind === "query" && typeof item.query === "string") return recentQueryItem(item.query);
    if (
        item.kind === "preview"
        && typeof item.key === "string"
        && typeof item.label === "string"
        && item.preview
        && typeof item.preview === "object"
        && !Array.isArray(item.preview)
    ) {
        return { kind: "preview", key: item.key, label: item.label, preview: item.preview };
    }
    return null;
}

export function mergeRecentGlobalSearches(current: readonly RecentGlobalSearchItem[], item: RecentGlobalSearchItem) {
    return [item, ...current.filter((recent) => recent.key !== item.key)].slice(0, MAX_RECENT_GLOBAL_SEARCHES);
}

export function readRecentGlobalSearches(ownerId: string, scope: string) {
    const value = readRecentGlobalSearchStore(ownerId)[scope];
    if (!Array.isArray(value)) return [];
    return value
        .map(parseRecentGlobalSearchItem)
        .filter((item): item is RecentGlobalSearchItem => Boolean(item))
        .slice(0, MAX_RECENT_GLOBAL_SEARCHES);
}

function writeRecentGlobalSearches(ownerId: string, scope: string, searches: readonly RecentGlobalSearchItem[]) {
    if (typeof window === "undefined" || !ownerId) return [];
    const store = readRecentGlobalSearchStore(ownerId);
    const next = searches.slice(0, MAX_RECENT_GLOBAL_SEARCHES);
    try {
        window.localStorage.setItem(
            `${RECENT_GLOBAL_SEARCH_STORAGE_PREFIX}:${ownerId}`,
            JSON.stringify({ ...store, [scope]: next }),
        );
    } catch {
        // ponytail: browser-local recents are best-effort; storage failures must never block search navigation.
    }
    return next;
}

export function rememberRecentGlobalSearch(ownerId: string, scope: string, query: string) {
    const item = recentQueryItem(query);
    if (!item) return readRecentGlobalSearches(ownerId, scope);
    return writeRecentGlobalSearches(
        ownerId,
        scope,
        mergeRecentGlobalSearches(readRecentGlobalSearches(ownerId, scope), item),
    );
}

export function rememberRecentGlobalSearchPreview<T extends { id: string; title: string }>(ownerId: string, scope: string, preview: T) {
    const item: RecentGlobalSearchItem = {
        kind: "preview",
        key: `preview:${preview.id}`,
        label: normalizeGlobalSearchQuery(preview.title) || "Search result",
        preview,
    };
    return writeRecentGlobalSearches(
        ownerId,
        scope,
        mergeRecentGlobalSearches(readRecentGlobalSearches(ownerId, scope), item),
    );
}

export function removeRecentGlobalSearch(ownerId: string, scope: string, key: string) {
    if (!key) return readRecentGlobalSearches(ownerId, scope);
    return writeRecentGlobalSearches(
        ownerId,
        scope,
        readRecentGlobalSearches(ownerId, scope).filter((item) => item.key !== key),
    );
}

const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
    { id: "account", title: "Account", section: "Account", description: "Account status, local app data, and account actions.", href: settingsTabHref("account"), keywords: "profile account status manage", featured: true },
    { id: "delete-account", title: "Delete account", section: "Account", description: "Review the permanent account deletion controls.", href: settingsTabHref("account"), keywords: "remove erase close danger irreversible" },
    { id: "security", title: "Security", section: "Security", description: "Protect your account and review sign-in activity.", href: settingsTabHref("security"), keywords: "protect login sign in", featured: true },
    { id: "authenticator", title: "Authenticator app", section: "Security", description: "Configure an authenticator app and 6-digit verification codes.", href: settingsTabHref("security"), keywords: "mfa 2fa two factor otp verification code" },
    { id: "password", title: "Password", section: "Security", description: "Manage your fallback password and password credential.", href: settingsTabHref("security"), keywords: "change reset credential sign in" },
    { id: "active-sessions", title: "Active sessions", section: "Security", description: "Review devices where your account is signed in.", href: settingsTabHref("security"), keywords: "device logout revoke trusted session" },
    { id: "login-activity", title: "Login and security activity", section: "Security", description: "Review recent sign-ins and security changes.", href: settingsTabHref("security"), keywords: "history audit recent device" },
    { id: "privacy", title: "Privacy", section: "Privacy", description: "Control profile visibility and interaction permissions.", href: settingsTabHref("privacy"), keywords: "visibility permissions interactions", featured: true },
    { id: "profile-visibility", title: "Profile visibility", section: "Privacy", description: "Choose who can open your full profile.", href: settingsTabHref("privacy"), keywords: "public private connections only hide profile" },
    { id: "messaging-privacy", title: "Messaging privacy", section: "Privacy", description: "Choose who can start direct messages with you.", href: settingsTabHref("privacy"), keywords: "message dm everyone connections permission" },
    { id: "request-privacy", title: "Connection request privacy", section: "Privacy", description: "Choose who can send connection requests.", href: settingsTabHref("privacy"), keywords: "mutuals nobody everyone builders network" },
    { id: "blocked-accounts", title: "Blocked accounts", section: "Privacy", description: "Review and unblock accounts you have blocked.", href: settingsTabHref("privacy"), keywords: "block unblock users people" },
    { id: "notifications", title: "Notifications", section: "Notifications", description: "Control notification categories and delivery.", href: settingsTabHref("notifications"), keywords: "alerts bell updates", featured: true },
    { id: "notification-categories", title: "In-app notification categories", section: "Notifications", description: "Choose which updates appear in the bell tray.", href: settingsTabHref("notifications"), keywords: "categories project connection message application" },
    { id: "quiet-hours", title: "Pause notifications and quiet hours", section: "Notifications", description: "Delay delivery temporarily or set a daily quiet window.", href: settingsTabHref("notifications"), keywords: "mute muted scopes snooze pause resume time" },
    { id: "desktop-push", title: "Desktop and push notifications", section: "Notifications", description: "Manage browser desktop and push delivery.", href: settingsTabHref("notifications"), keywords: "browser permission device delivery subscribe" },
    { id: "appearance", title: "Appearance", section: "Appearance", description: "Customize theme, accent color, density, and motion.", href: settingsTabHref("appearance"), keywords: "look display interface", featured: true },
    { id: "theme", title: "Theme mode", section: "Appearance", description: "Switch between light, dark, and system themes.", href: settingsTabHref("appearance"), keywords: "change color theme light dark system mode" },
    { id: "accent-color", title: "Accent color", section: "Appearance", description: "Change the action and selected-state color across the app.", href: settingsTabHref("appearance"), keywords: "change colour primary blue indigo green orange pink" },
    { id: "density", title: "Interface density", section: "Appearance", description: "Adjust spacing in navigation, lists, cards, and panels.", href: settingsTabHref("appearance"), keywords: "compact comfortable spacious size spacing" },
    { id: "reduce-motion", title: "Reduce motion", section: "Appearance", description: "Reduce non-essential interface animation.", href: settingsTabHref("appearance"), keywords: "accessibility animation transition movement" },
    { id: "integrations", title: "Integrations", section: "Integrations", description: "Manage sign-in methods, GitHub, and editor sessions.", href: settingsTabHref("integrations"), keywords: "connected services extensions", featured: true },
    { id: "account-connections", title: "Account connections", section: "Integrations", description: "Review Google, GitHub, email, and linked sign-in methods.", href: settingsTabHref("integrations"), keywords: "provider login oauth link unlink" },
    { id: "github", title: "GitHub access", section: "Integrations", description: "Review account-level GitHub repository access status.", href: settingsTabHref("integrations"), keywords: "repository repo source code connect" },
    { id: "editor-sessions", title: "Editor extension sessions", section: "Integrations", description: "Review or disconnect VS Code and other editor sessions.", href: settingsTabHref("integrations"), keywords: "vscode cursor kiro ide extension disconnect revoke active" },
    { id: "manual-token", title: "Manual editor token", section: "Integrations", description: "Generate a fallback token for an editor extension.", href: settingsTabHref("integrations"), keywords: "device authentication login extension" },
] as const;

export function normalizeGlobalSearchQuery(query: string) {
    return normalizeSearchQuery(query);
}

export function isProjectDetailPath(pathname: string | null) {
    const segments = pathname?.split("/").filter(Boolean) ?? [];
    return segments.length === 2 && segments[0] === "projects" && segments[1] !== "new";
}

export function getProjectIdentifierFromPathname(pathname: string | null) {
    if (!isProjectDetailPath(pathname)) return null;
    const segment = pathname?.split("/").filter(Boolean)[1];
    if (!segment) return null;
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

export function resolveGlobalSearchContext(pathname: string | null, searchParams?: URLSearchParams | null): SearchContext {
    if (isProjectDetailPath(pathname)) {
        return {
            context: "project",
            placeholder: "Search this project's tasks...",
            title: "Search project tasks",
            description: "Search task keys, titles, and descriptions in this project.",
        };
    }
    if (pathname?.startsWith("/people")) {
        const scope = getPeopleSearchScope(searchParams);
        return {
            context: "people",
            placeholder: scope === "network" ? "Search your network..." : "Find builders & collaborators...",
            title: scope === "network" ? "Search your network" : "Find builders",
            description: scope === "network"
                ? "Search your accepted connections by name."
                : "Search people by name, skills, interests, or location.",
        };
    }
    if (pathname?.startsWith("/hub")) {
        return {
            context: "hub",
            placeholder: "Search projects...",
            title: "Search projects",
            description: "Search project names, descriptions, and technologies.",
        };
    }
    if (pathname?.startsWith("/messages")) {
        return {
            context: "messages",
            placeholder: "Use Messages search...",
            title: "Search messages",
            description: "Continue in the dedicated Messages search.",
        };
    }
    if (pathname?.startsWith("/settings")) {
        return {
            context: "settings",
            placeholder: "Search settings...",
            title: "Search settings",
            description: "Find a setting and go directly to its section.",
        };
    }
    return {
        context: "default",
        placeholder: "Search projects...",
        title: "Search projects",
        description: "Search projects from anywhere in the app.",
    };
}

export function getGlobalSearchQuery(searchParams: URLSearchParams, context: GlobalSearchContext) {
    if (context === "messages" || context === "settings") return "";
    if (context === "project") return normalizeGlobalSearchQuery(searchParams.get("search") || "");
    const query = searchParams.get("q");
    const tag = searchParams.get("tag");
    const technologies = context === "hub" || context === "default"
        ? searchParams.get("tech")?.split(",").map((item) => item.trim()).filter(Boolean) ?? []
        : [];
    return normalizeGlobalSearchQuery(query || (tag ? `#${tag}` : technologies.join(", ")));
}

export function searchSettings(query: string) {
    const normalized = normalizeGlobalSearchQuery(query).toLowerCase();
    if (!normalized) return SETTINGS_SEARCH_ITEMS.filter((item) => item.featured);

    const tokens = tokenizeSearchQuery(normalized);
    return SETTINGS_SEARCH_ITEMS
        .map((item) => {
            const title = item.title.toLowerCase();
            const haystack = `${title} ${item.section} ${item.description} ${item.keywords}`.toLowerCase();
            if (!tokens.every((token) => haystack.includes(token))) return null;
            const score = title === normalized ? 0 : title.startsWith(normalized) ? 1 : title.includes(normalized) ? 2 : 3;
            return { item, score };
        })
        .filter((result): result is { item: SettingsSearchItem; score: number } => Boolean(result))
        .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
        .map((result) => result.item);
}

export function buildGlobalSearchHref({
    pathname,
    searchParams,
    context,
    query,
}: {
    pathname: string;
    searchParams: URLSearchParams;
    context: GlobalSearchContext;
    query: string;
}) {
    const value = normalizeGlobalSearchQuery(query);
    if (!value || context === "messages" || context === "settings") return null;

    const params = context === "default" ? new URLSearchParams() : new URLSearchParams(searchParams);
    let targetPath = pathname;
    if (context === "project") {
        params.set("tab", "tasks");
        params.set("search", value);
        params.set("page", "1");
        params.delete("task");
        params.delete("taskId");
        params.delete("drawerType");
        params.delete("drawerId");
        params.delete("panelTab");
    } else {
        if (context === "default") targetPath = "/hub";
        if (context === "people" && params.get("tab") === "requests") params.set("tab", "discover");
        params.set("q", value);
        params.delete("tag");
    }
    const serialized = params.toString();
    return serialized ? `${targetPath}?${serialized}` : targetPath;
}

export function buildGlobalSearchClearHref({
    pathname,
    searchParams,
    context,
}: {
    pathname: string;
    searchParams: URLSearchParams;
    context: GlobalSearchContext;
}) {
    const params = new URLSearchParams(searchParams);
    if (context === "project") {
        const wasTaskSearch = params.get("tab") === "tasks" && params.has("search");
        params.delete("search");
        if (wasTaskSearch) params.set("page", "1");
    } else {
        params.delete("q");
        params.delete("tag");
        params.delete("tech");
    }
    const serialized = params.toString();
    return serialized ? `${pathname}?${serialized}` : pathname;
}
