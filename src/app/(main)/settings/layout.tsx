import SettingsShell from "@/components/settings/SettingsLayout";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="h-full min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950">
            <SettingsShell>{children}</SettingsShell>
        </div>
    );
}
