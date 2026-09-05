import type { Metadata } from "next";
import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { getLegalIdentity } from "@/lib/legal/config";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata: Metadata = { title: "Security Reporting Policy | NetworkBase", description: "How to report a security vulnerability responsibly." };

export default function SecurityReportingPage() {
  const i = getLegalIdentity();
  return <LegalDocumentPage eyebrow="Trust · Security" title="Security Reporting Policy" summary="Guidance for good-faith reporting of suspected vulnerabilities affecting NetworkBase." version={LEGAL_VERSIONS.security} sections={[
    { id: "report", title: "1. Report privately", content: <p>Email <a className="underline" href={`mailto:${i.supportEmail}?subject=${encodeURIComponent("Private security report")}`}>{i.supportEmail}</a> with “Private security report” in the subject. Include the affected URL or component, impact, reproducible steps, and a safe proof of concept. Do not include credentials or personal data that are not needed.</p> },
    { id: "rules", title: "2. Good-faith research rules", content: <LegalList><li>Test only accounts and projects you own or have explicit permission to test.</li><li>Do not access, retain, alter, or disclose another person’s data.</li><li>Do not use denial of service, destructive payloads, social engineering, spam, or automated high-volume scanning.</li><li>Stop when you demonstrate the issue and give us reasonable time to investigate before disclosure.</li></LegalList> },
    { id: "response", title: "3. Our response", content: <p>We aim to acknowledge a sufficiently detailed report, triage severity, coordinate validation and remediation, and keep the reporter informed when practical. We do not promise a bounty or a specific resolution date. Duplicate, theoretical, out-of-scope, or policy-only reports may be closed without action.</p> },
    { id: "safe-harbour", title: "4. Good-faith safe harbour", content: <p>Where legally permitted, {i.operatorName} will not pursue a claim solely for accidental, limited access that occurs during research complying with this policy, provided the researcher promptly stops, reports privately, avoids harm, and deletes any inadvertently obtained data. This does not authorise conduct prohibited by law or a third party.</p> },
    { id: "incidents", title: "5. Account incidents", content: <p>If you believe your account is compromised, change or reset credentials, revoke suspicious sessions and integrations in Settings, preserve relevant evidence, and contact support. A vulnerability report is not a substitute for law-enforcement or emergency reporting.</p> },
  ]} />;
}
