export const LEGAL_VERSIONS = {
  privacy: "2026-09-04",
  terms: "2026-09-04",
  eula: "2026-09-04",
  acceptableUse: "2026-09-04",
  cookies: "2026-09-04",
  subprocessors: "2026-09-04",
  copyright: "2026-09-04",
  grievances: "2026-09-04",
  security: "2026-09-04",
  dpa: "2026-09-04",
  openSource: "2026-09-04",
} as const;

export const LEGAL_EFFECTIVE_DATE = "4 September 2026";

export const CURRENT_LEGAL_ACCEPTANCE = {
  termsVersion: LEGAL_VERSIONS.terms,
  eulaVersion: LEGAL_VERSIONS.eula,
  privacyNoticeVersion: LEGAL_VERSIONS.privacy,
} as const;
