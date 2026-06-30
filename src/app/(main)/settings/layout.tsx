import SettingsShell from "@/components/settings/SettingsLayout";
import { getSettingsBootstrap } from "@/lib/settings/bootstrap";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const bootstrap = await getSettingsBootstrap();

  return (
    <div className="h-full min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <SettingsShell initialBootstrap={bootstrap}>{children}</SettingsShell>
    </div>
  );
}
