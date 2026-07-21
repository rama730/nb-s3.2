import { handlePrivacySettingPatch } from "@/app/api/v1/privacy/_update";

export function PATCH(request: Request) {
  return handlePrivacySettingPatch(request, {
    kind: "connectionPrivacy",
    bodyKey: "connectionPrivacy",
    responseKey: "connectionPrivacy",
    values: ["everyone", "mutuals_only", "nobody"] as const,
    invalidMessage: "Invalid connection request privacy",
    failureMessage: "Failed to update connection request privacy",
  });
}
