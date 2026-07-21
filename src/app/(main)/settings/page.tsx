import AccountSettings from "@/components/settings/AccountSettings";
import AppearanceSettings from "@/components/settings/AppearanceSettings";
import IntegrationsSettings from "@/components/settings/IntegrationsSettings";
import NotificationsSettings from "@/components/settings/NotificationsSettings";
import PrivacySettings from "@/components/settings/PrivacySettings";
import SecuritySettings from "@/components/settings/SecuritySettings";
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
    case "security":
      return <SecuritySettings />;
    case "privacy":
      return <PrivacySettings />;
    case "notifications":
      return <NotificationsSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "integrations":
      return <IntegrationsSettings />;
    default:
      return <AccountSettings />;
  }
}
