export type LegalIdentity = {
  productName: string;
  operatorName: string;
  postalAddress: string;
  serviceAddress: string;
  country: string;
  supportEmail: string;
  privacyEmail: string;
  grievanceOfficer: string;
  grievanceEmail: string;
  governingLaw: string;
  venue: string;
  identityComplete: boolean;
};

function value(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

/**
 * Public legal identity. Production operators should replace the role-based
 * defaults with the registered entity and full service address in Railway.
 */
export function getLegalIdentity(): LegalIdentity {
  const operatorName = value("LEGAL_OPERATOR_NAME", "NetworkBase");
  const postalAddress = value("LEGAL_OPERATOR_ADDRESS", "India");
  const grievanceOfficer = value(
    "LEGAL_GRIEVANCE_OFFICER_NAME",
    "Grievance Officer, NetworkBase",
  );
  const country = value("LEGAL_OPERATOR_COUNTRY", "India");
  const privacyEmail = value("LEGAL_PRIVACY_EMAIL", "privacy@networkbase.in");
  const serviceAddress = postalAddress.toLowerCase() === country.toLowerCase()
    ? country
    : `${postalAddress}, ${country}`;

  return {
    productName: "NetworkBase",
    operatorName,
    postalAddress,
    serviceAddress,
    country,
    supportEmail: value("LEGAL_SUPPORT_EMAIL", "support@networkbase.in"),
    privacyEmail,
    grievanceOfficer,
    grievanceEmail: value("LEGAL_GRIEVANCE_EMAIL", privacyEmail),
    governingLaw: value("LEGAL_GOVERNING_LAW", "the laws of India"),
    venue: value("LEGAL_DISPUTE_VENUE", "the competent courts of India"),
    identityComplete: Boolean(
      process.env.LEGAL_OPERATOR_NAME?.trim()
      && process.env.LEGAL_OPERATOR_ADDRESS?.trim()
      && process.env.LEGAL_GRIEVANCE_OFFICER_NAME?.trim(),
    ),
  };
}
