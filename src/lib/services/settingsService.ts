import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Export user data
export async function exportUserData() {
    const supabase = createSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) throw new Error("Not authenticated");

    // Fetch profile data
    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    // Fetch user's projects
    const { data: projects } = await supabase
        .from("projects")
        .select("*")
        .eq("created_by", user.id);

    // Fetch user's connections
    const { data: connections } = await supabase
        .from("connections")
        .select("*")
        .or(`user_id.eq.${user.id},connected_user_id.eq.${user.id}`);

    // Combine all data
    const exportData = {
        exportedAt: new Date().toISOString(),
        user: {
            id: user.id,
            email: user.email,
        },
        profile,
        projects: projects || [],
        connections: connections || [],
    };

    return exportData;
}

// Download user data as JSON file
export function downloadUserData(data: any) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `user-data-export-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Delete user account
export async function deleteAccount(confirmationText: string): Promise<{ success: boolean; message?: string }> {
    try {
        const res = await fetch("/api/v1/account/delete", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmationText }),
        });

        const json = await res.json();

        if (!res.ok) {
            return { success: false, message: json.message || "Failed to delete account" };
        }

        return { success: true };
    } catch (error) {
        console.error("Error deleting account:", error);
        return { success: false, message: "An error occurred while deleting account" };
    }
}

export type ReservedUsernameItem = {
    username: string
    reason: string | null
    createdAt: string
}

export async function listReservedUsernames(): Promise<{ success: boolean; items: ReservedUsernameItem[]; message?: string }> {
    try {
        const response = await fetch('/api/v1/account/reserved-usernames', { method: 'GET' })
        const payload = await response.json()
        if (!response.ok) {
            return { success: false, items: [], message: payload?.message || 'Failed to load reserved usernames' }
        }
        return { success: true, items: payload?.data?.items || [] }
    } catch (error) {
        console.error('Error loading reserved usernames:', error)
        return { success: false, items: [], message: 'Failed to load reserved usernames' }
    }
}

export async function addReservedUsername(username: string, reason?: string): Promise<{ success: boolean; message?: string }> {
    try {
        const response = await fetch('/api/v1/account/reserved-usernames', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, reason }),
        })
        const payload = await response.json()
        if (!response.ok) {
            return { success: false, message: payload?.message || 'Failed to reserve username' }
        }
        return { success: true }
    } catch (error) {
        console.error('Error reserving username:', error)
        return { success: false, message: 'Failed to reserve username' }
    }
}

export async function removeReservedUsername(username: string): Promise<{ success: boolean; message?: string }> {
    try {
        const response = await fetch('/api/v1/account/reserved-usernames', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username }),
        })
        const payload = await response.json()
        if (!response.ok) {
            return { success: false, message: payload?.message || 'Failed to remove reserved username' }
        }
        return { success: true }
    } catch (error) {
        console.error('Error removing reserved username:', error)
        return { success: false, message: 'Failed to remove reserved username' }
    }
}
