import type { SettingsTab } from "@/constants/routes";

export const SETTINGS_SECTION_META: Record<SettingsTab, { title: string; description: string }> = {
    account: { title: "Account", description: "Account status and deletion controls" },
    security: { title: "Security", description: "Sign-in methods, trusted devices, and recent activity" },
    privacy: { title: "Privacy", description: "Profile visibility, interactions, and blocked accounts" },
    notifications: { title: "Notifications", description: "In-app and device delivery preferences" },
    appearance: { title: "Appearance", description: "Theme, accent color, and density" },
    integrations: { title: "Integrations", description: "Account sign-in methods and connected services" },
};
