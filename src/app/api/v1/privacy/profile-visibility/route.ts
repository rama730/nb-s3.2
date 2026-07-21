import { handlePrivacySettingPatch } from "@/app/api/v1/privacy/_update";

export function PATCH(request: Request) {
  return handlePrivacySettingPatch(request, {
    kind: "profileVisibility",
    bodyKey: "visibility",
    responseKey: "visibility",
    values: ["public", "connections", "private"] as const,
    invalidMessage: "Invalid profile visibility",
    failureMessage: "Failed to update profile visibility",
  });
}
