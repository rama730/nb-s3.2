import { Monitor, Smartphone, Tablet, Globe, LucideIcon } from "lucide-react";

interface DeviceInfo {
    browser: string;
    os: string;
    icon: LucideIcon;
}

export function parseUserAgent(userAgent: string): DeviceInfo {
    // Default values
    let browser = "Unknown Browser";
    let os = "Unknown OS";
    let icon: LucideIcon = Globe;

    if (!userAgent) {
        return { browser, os, icon };
    }

    const ua = userAgent.toLowerCase();

    // Detect browser
    if (ua.includes("chrome") && !ua.includes("edg")) {
        browser = "Chrome";
    } else if (ua.includes("firefox")) {
        browser = "Firefox";
    } else if (ua.includes("safari") && !ua.includes("chrome")) {
        browser = "Safari";
    } else if (ua.includes("edg")) {
        browser = "Edge";
    } else if (ua.includes("opera") || ua.includes("opr")) {
        browser = "Opera";
    } else if (ua.includes("msie") || ua.includes("trident")) {
        browser = "Internet Explorer";
    }

    // Detect OS
    if (ua.includes("windows")) {
        os = "Windows";
        icon = Monitor;
    } else if (ua.includes("mac os") || ua.includes("macos")) {
        os = "macOS";
        icon = Monitor;
    } else if (ua.includes("linux") && !ua.includes("android")) {
        os = "Linux";
        icon = Monitor;
    } else if (ua.includes("android")) {
        os = "Android";
        icon = Smartphone;
    } else if (ua.includes("iphone") || ua.includes("ipad")) {
        os = ua.includes("ipad") ? "iPadOS" : "iOS";
        icon = ua.includes("ipad") ? Tablet : Smartphone;
    } else if (ua.includes("chromeos")) {
        os = "Chrome OS";
        icon = Monitor;
    }

    return { browser, os, icon };
}

export function getDeviceType(userAgent: string): "desktop" | "tablet" | "mobile" {
    const ua = userAgent.toLowerCase();

    if (ua.includes("mobile") || ua.includes("iphone") || (ua.includes("android") && !ua.includes("tablet"))) {
        return "mobile";
    }

    if (ua.includes("tablet") || ua.includes("ipad")) {
        return "tablet";
    }

    return "desktop";
}
