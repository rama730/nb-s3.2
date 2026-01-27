import IntegrationsSettings from "@/components/settings/IntegrationsSettings";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";

export default function IntegrationsPage() {
    return (
        <div className="space-y-6">
            <SettingsPageHeader
                title="Integrations"
                description="Connect services to enhance your workflow."
            />
            <IntegrationsSettings />
        </div>
    );
}
