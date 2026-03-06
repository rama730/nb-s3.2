"use client";

export function useNotifications() {
    // Pure Optimization: The 'notifications' table was removed from the DB schema.
    // To prevent Supabase JS from throwing 404s in the console, we statically 
    // disable the query and realtime channel here until the architectural feature returns.
    return {
        unreadCount: 0,
        isLoading: false,
        refresh: () => { },
    };
}
