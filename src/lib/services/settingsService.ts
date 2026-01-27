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
export async function deleteAccount(): Promise<{ success: boolean; message?: string }> {
    try {
        const res = await fetch("/api/v1/account/delete", {
            method: "DELETE",
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
