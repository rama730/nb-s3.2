-- ============================================================================
-- SEC-H3: Bind recovery codes to the MFA factor that was active when they
--         were issued so that rotating / removing the TOTP factor
--         automatically invalidates any codes minted against the old factor.
--
-- Without this binding, an attacker who exfiltrated the recovery codes when
-- the user first set up MFA would retain step-up capability forever, even
-- after the user rotated the TOTP secret in response to a compromise.
--
-- `recovery_codes_factor_id` stores the Supabase auth factor UUID as text
-- (not a FK — the authoritative row lives in auth.mfa_factors which we do
-- not reference from public schemas) plus a monotonically increasing
-- `recovery_codes_generation` counter. The generation counter lets us
-- invalidate codes even in edge cases where the factor ID is unknown
-- (e.g. bulk admin rotation).
-- ============================================================================

ALTER TABLE "profile_security_states"
    ADD COLUMN IF NOT EXISTS "recovery_codes_factor_id" text;

--> statement-breakpoint

ALTER TABLE "profile_security_states"
    ADD COLUMN IF NOT EXISTS "recovery_codes_generation" integer NOT NULL DEFAULT 0;
