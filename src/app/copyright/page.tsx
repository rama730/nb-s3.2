import type { Metadata } from "next";
import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { getLegalIdentity } from "@/lib/legal/config";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata: Metadata = { title: "Copyright and IP Complaints | NetworkBase", description: "How to report intellectual-property infringement on NetworkBase." };

export default function CopyrightPage() {
  const i = getLegalIdentity();
  const email = <a className="underline" href={`mailto:${i.grievanceEmail}`}>{i.grievanceEmail}</a>;
  return <LegalDocumentPage eyebrow="Legal · Rights protection" title="Copyright and IP Complaint Process" summary="Use this process to identify content on NetworkBase that you believe infringes copyright or another intellectual-property right." version={LEGAL_VERSIONS.copyright} sections={[
    { id: "notice", title: "1. Submit a notice", content: <><p>Send a notice to {email} containing:</p><LegalList><li>Your name, contact details, and authority to act.</li><li>A description of the protected work or right.</li><li>The exact NetworkBase URL, project, file, message, profile, or identifier.</li><li>Why the use is unauthorised, including relevant registration or licence information.</li><li>A good-faith statement that the information is accurate and that you are the owner or authorised representative.</li><li>Your physical or electronic signature.</li></LegalList></> },
    { id: "response", title: "2. Our response", content: <p>We may request clarification, preserve evidence, restrict access, notify the affected user, or reject incomplete or abusive requests. A restriction does not decide ownership. Repeated infringement or fraudulent complaints may lead to account action.</p> },
    { id: "counter", title: "3. Response or counter-notice", content: <p>An affected user may respond with identification, the removed location, the basis for lawful use, supporting evidence, contact details, and a signed good-faith statement. We may restore content where lawful unless the complainant begins appropriate proceedings or another legal restriction applies.</p> },
    { id: "urgent", title: "4. Privacy, impersonation, and urgent harm", content: <p>Copyright email is not an emergency channel. Clearly label complaints involving exposed private information, impersonation, intimate imagery, child safety, or imminent harm so they can follow the appropriate expedited process. Contact local emergency services where immediate physical safety is at risk.</p> },
  ]} />;
}
