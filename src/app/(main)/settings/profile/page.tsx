import ProfileFormShell from "@/components/profile/ProfileFormShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";

export default async function ProfileSettingsPage() {
    const supabase = await createSupabaseServerClient();

    // Verified user (avoid using session.user from getSession(), which Supabase warns can be insecure on the server)
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) redirect("/login");

    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (!profile) return <div>Profile not found</div>;

    return (
        <div className="space-y-6">
            <SettingsPageHeader
                title="Profile"
                description="Manage how you appear across the product."
            />

            <SettingsSectionCard
                title="Public profile"
                description="These details are visible to others on your profile."
            >
                <ProfileFormShell initialData={profile} />
            </SettingsSectionCard>
        </div>
    );
}
