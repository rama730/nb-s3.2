import { handlePrivacySettingPatch } from "@/app/api/v1/privacy/_update";

export function PATCH(request: Request) {
  return handlePrivacySettingPatch(request, {
    kind: "messagePrivacy",
    bodyKey: "messagePrivacy",
    responseKey: "messagePrivacy",
    values: ["everyone", "connections"] as const,
    invalidMessage: "Invalid messaging privacy",
    failureMessage: "Failed to update messaging privacy",
  });
}
