import dns from "node:dns/promises";
import { URL } from "node:url";
import { logger } from "@/lib/logger";

const BLOCKED_SUBNETS = [
    /^127\./,       // Localhost IPv4
    /^10\./,        // Private Class A
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
    /^192\.168\./,  // Private Class C
    /^169\.254\./,  // AWS/Cloud Metadata Service
    /^0\./,         // Current network
];

/**
 * Checks if an IP address falls into a blocked/internal subnet.
 */
export function isInternalIp(ip: string): boolean {
    if (ip === "::1" || ip.toLowerCase().startsWith("fe80:")) {
        return true; // IPv6 localhost or link-local
    }
    return BLOCKED_SUBNETS.some((regex) => regex.test(ip));
}

/**
 * A hardened `fetch` wrapper that prevents SSRF by validating the target
 * IP address before executing the request.
 */
export async function safeFetch(urlStr: string, options?: RequestInit): Promise<Response> {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(urlStr);
    } catch {
        throw new Error("Invalid URL");
    }

    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        throw new Error("Invalid protocol. Only HTTP and HTTPS are allowed.");
    }

    // Resolve DNS to verify it doesn't point to an internal IP
    let addresses: { address: string }[];
    try {
        addresses = await dns.lookup(parsedUrl.hostname, { all: true });
    } catch (error) {
        logger.warn("ssrf.dns_resolution_failed", { url: parsedUrl.hostname });
        throw new Error("DNS resolution failed");
    }

    if (addresses.length === 0) {
        throw new Error("No DNS records found");
    }

    // Ensure NO resolved IP is internal
    for (const record of addresses) {
        if (isInternalIp(record.address)) {
            logger.error("ssrf.blocked_internal_ip_fetch", {
                hostname: parsedUrl.hostname,
                ip: record.address,
            });
            throw new Error("Fetching from internal IP addresses is forbidden (SSRF Blocked).");
        }
    }

    // All checks passed, perform the actual fetch
    return fetch(parsedUrl.toString(), options);
}
