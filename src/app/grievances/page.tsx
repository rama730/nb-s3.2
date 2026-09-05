import type { Metadata } from "next";
import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { getLegalIdentity } from "@/lib/legal/config";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata: Metadata = { title: "Grievance Process | NetworkBase", description: "How to report a NetworkBase content, privacy, safety, or service grievance." };

export default function GrievancesPage() {
  const i = getLegalIdentity();
  const mailto = `mailto:${i.grievanceEmail}?subject=${encodeURIComponent("NetworkBase grievance")}`;
  return <LegalDocumentPage eyebrow="Trust · Complaints" title="Grievance Process" summary="A clear channel for content, privacy, safety, account, and service complaints." version={LEGAL_VERSIONS.grievances} sections={[
    { id: "contact", title: "1. Grievance contact", content: <p>{i.grievanceOfficer} receives grievances for NetworkBase at <a className="underline" href={mailto}>{i.grievanceEmail}</a>. Service address: {i.operatorName}, {i.serviceAddress}. This channel does not replace emergency services or a regulator’s official channel.</p> },
    { id: "include", title: "2. What to include", content: <LegalList><li>Your name and a reliable reply address.</li><li>The relevant profile, project, message, file, or URL and enough detail to locate it.</li><li>The category of complaint and the outcome requested.</li><li>Why you are entitled to act, including proof of identity, authority, or rights where necessary.</li><li>Supporting evidence. Do not email passwords, recovery codes, or unnecessary identity documents.</li></LegalList> },
    { id: "categories", title: "3. Correct route", content: <LegalList><li>Privacy or data-rights request: <a className="underline" href={`mailto:${i.privacyEmail}`}>{i.privacyEmail}</a>.</li><li>Copyright or intellectual-property claim: follow the <a className="underline" href="/copyright">Copyright & IP process</a>.</li><li>Security vulnerability: follow the <a className="underline" href="/security-reporting">Security Reporting Policy</a>.</li><li>Immediate danger or illegal emergency: contact local emergency services or the competent authority first.</li></LegalList> },
    { id: "process", title: "4. What happens next", content: <p>We acknowledge and assign a reference where required, verify the request, preserve necessary evidence, investigate proportionately, and communicate the outcome or next step. We may ask for clarification. We target the timelines required by applicable law; urgent, court-ordered, child-safety, intimate-image, impersonation, and security matters are prioritised.</p> },
    { id: "fairness", title: "5. Fair process and appeals", content: <p>We may temporarily restrict material while investigating. Unless prohibited or unsafe, we may notify the affected account and allow a response. You may reply to the outcome with the reference and explain the specific error. False, abusive, duplicative, or bad-faith notices may be rejected.</p> },
    { id: "records", title: "6. Records and privacy", content: <p>Complaint information is used to investigate, communicate, enforce policies, protect rights, and comply with law. Access is limited. Records are retained only as long as reasonably necessary for the complaint, appeals, security, legal duties, or preservation requests, as described in the Privacy Policy.</p> },
  ]} />;
}
