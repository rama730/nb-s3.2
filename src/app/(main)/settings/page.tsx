import { SETTINGS_TABS, type SettingsTab } from "@/constants/routes";

function resolveSettingsTab(value: string | string[] | undefined): SettingsTab {
  const tab = Array.isArray(value) ? value[0] : value;
  return SETTINGS_TABS.includes(tab as SettingsTab) ? (tab as SettingsTab) : "account";
}

export default async function SettingsRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tab = resolveSettingsTab((await searchParams)?.tab);

  switch (tab) {
    case "security": {
      const { default: SecuritySettings } = await import("@/components/settings/SecuritySettings");
      return <SecuritySettings />;
    }
    case "privacy": {
      const { default: PrivacySettings } = await import("@/components/settings/PrivacySettings");
      return <PrivacySettings />;
    }
    case "notifications": {
      const { default: NotificationsSettings } = await import("@/components/settings/NotificationsSettings");
      return <NotificationsSettings />;
    }
    case "appearance": {
      const { default: AppearanceSettings } = await import("@/components/settings/AppearanceSettings");
      return <AppearanceSettings />;
    }
    case "integrations": {
      const { default: IntegrationsSettings } = await import("@/components/settings/IntegrationsSettings");
      return <IntegrationsSettings />;
    }
    default: {
      const { default: AccountSettings } = await import("@/components/settings/AccountSettings");
      return <AccountSettings />;
    }
  }
}
