import IntegrationsSettings from "@/components/settings/IntegrationsSettings";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";

export default function IntegrationsPage() {
    return (
        <div className="space-y-6">
            <SettingsPageHeader
                title="Integrations"
                description="See how this account was created, which sign-in methods are attached, and which services are actively connected."
            />
            <IntegrationsSettings />
        </div>
    );
}
