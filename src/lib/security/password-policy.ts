export const PASSWORD_MIN_LENGTH = 12;

export type PasswordPolicyChecks = {
  minLength: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  symbol: boolean;
};

export type PasswordPolicyResult = {
  ok: boolean;
  checks: PasswordPolicyChecks;
  score: number;
  error: string | null;
};

export function getPasswordPolicyChecks(password: string): PasswordPolicyChecks {
  return {
    minLength: password.length >= PASSWORD_MIN_LENGTH,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^a-zA-Z0-9]/.test(password),
  };
}

export function getPasswordPolicyResult(password: string): PasswordPolicyResult {
  const checks = getPasswordPolicyChecks(password);
  const score = Object.values(checks).filter(Boolean).length;
  const requiredChecks = [checks.minLength, checks.uppercase, checks.lowercase, checks.number];

  if (requiredChecks.every(Boolean)) {
    return {
      ok: true,
      checks,
      score,
      error: null,
    };
  }

  const unmetLabels: string[] = [];
  if (!checks.minLength) unmetLabels.push(`${PASSWORD_MIN_LENGTH}+ characters`);
  if (!checks.uppercase) unmetLabels.push("an uppercase letter");
  if (!checks.lowercase) unmetLabels.push("a lowercase letter");
  if (!checks.number) unmetLabels.push("a number");

  return {
    ok: false,
    checks,
    score,
    error: `Password must include ${unmetLabels.join(", ")}.`,
  };
}
