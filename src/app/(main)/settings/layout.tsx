import SettingsShell from "@/components/settings/SettingsLayout";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SettingsShell>{children}</SettingsShell>;
}
