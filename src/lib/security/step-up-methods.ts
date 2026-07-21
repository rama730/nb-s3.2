export type SecurityStepUpMethod = "totp" | "recovery_code" | "password";

export function buildSecurityStepUpMethods(input: {
  hasTotp: boolean;
  hasRecoveryCodes: boolean;
  hasPassword: boolean;
}): SecurityStepUpMethod[] {
  return [
    ...(input.hasTotp ? ["totp" as const] : []),
    ...(input.hasRecoveryCodes ? ["recovery_code" as const] : []),
    ...(input.hasPassword ? ["password" as const] : []),
  ];
}
