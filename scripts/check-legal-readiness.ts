const REQUIRED_PUBLIC_LEGAL_VALUES = [
  "LEGAL_OPERATOR_NAME",
  "LEGAL_OPERATOR_ADDRESS",
  "LEGAL_GRIEVANCE_OFFICER_NAME",
  "LEGAL_GOVERNING_LAW",
  "LEGAL_DISPUTE_VENUE",
] as const;

const REQUIRED_CONTACTS = [
  "LEGAL_SUPPORT_EMAIL",
  "LEGAL_PRIVACY_EMAIL",
] as const;

const OPTIONAL_CONTACTS = ["LEGAL_GRIEVANCE_EMAIL"] as const;

const missing = [...REQUIRED_PUBLIC_LEGAL_VALUES, ...REQUIRED_CONTACTS]
  .filter((name) => !process.env[name]?.trim());
const invalidContacts = [...REQUIRED_CONTACTS, ...OPTIONAL_CONTACTS].filter((name) => {
  const configured = process.env[name]?.trim();
  return configured && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configured);
});

if (missing.length || invalidContacts.length) {
  console.error("Legal readiness check failed.");
  if (missing.length) console.error(`Missing: ${missing.join(", ")}`);
  if (invalidContacts.length) console.error(`Invalid email values: ${invalidContacts.join(", ")}`);
  console.error("Configure these values in the production environment and confirm each mailbox is monitored.");
  process.exit(1);
}

console.log("Legal readiness check passed: public identity and monitored contact variables are configured.");
