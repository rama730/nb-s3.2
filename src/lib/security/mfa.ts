type AuthMfaFactor = {
  id: string;
  factor_type: string;
  friendly_name?: string;
  created_at?: string;
  status?: string;
};

export type SecurityMfaFactor = {
  id: string;
  type: "totp" | "phone";
  friendly_name?: string;
  created_at?: string;
  status: "verified" | "unverified";
};

export async function listSecurityMfaFactors(
  supabase: {
    auth?: {
      mfa?: {
        listFactors?: () => Promise<{
          data?: { all?: readonly AuthMfaFactor[] } | null;
          error?: unknown;
        }>;
      };
    };
  },
): Promise<SecurityMfaFactor[]> {
  const mfaApi = supabase.auth?.mfa;
  if (!mfaApi?.listFactors) {
    return [];
  }

  const result = await mfaApi.listFactors();
  const allFactors = Array.isArray(result?.data?.all) ? result.data.all : [];

  return allFactors
    .filter((factor) => factor?.factor_type === "totp" || factor?.factor_type === "phone")
    .map((factor) => ({
      id: String(factor.id),
      type: factor.factor_type === "phone" ? "phone" : "totp",
      friendly_name: factor.friendly_name || undefined,
      created_at: typeof factor.created_at === "string" ? factor.created_at : undefined,
      status: factor.status === "verified" ? "verified" : "unverified",
    }));
}

export function getVerifiedTotpFactors(factors: SecurityMfaFactor[]): SecurityMfaFactor[] {
  return factors.filter((factor) => factor.type === "totp" && factor.status === "verified");
}
