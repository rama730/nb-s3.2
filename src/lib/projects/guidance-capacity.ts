export const GUIDANCE_WARNING_LIMIT = 10;
export const GUIDANCE_BLOCK_LIMIT = 12;

export function getGuidanceCapacityState(activeAppointments: number) {
    if (activeAppointments >= GUIDANCE_BLOCK_LIMIT) return "blocked" as const;
    if (activeAppointments >= GUIDANCE_WARNING_LIMIT) return "warning" as const;
    return "available" as const;
}
