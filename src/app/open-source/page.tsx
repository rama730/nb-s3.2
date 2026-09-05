import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { getLegalIdentity } from "@/lib/legal/config";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata: Metadata = { title: "Open-source Notices | NetworkBase", description: "Notices for open-source components used by NetworkBase." };

export default function OpenSourcePage() {
  const i = getLegalIdentity();
  return <LegalDocumentPage eyebrow="Legal · Software" title="Open-source Notices" summary="NetworkBase includes third-party open-source software whose licences remain in force." version={LEGAL_VERSIONS.openSource} sections={[
    { id: "notice", title: "1. Third-party software", content: <p>The NetworkBase web application, extension, and supporting services use open-source packages. Copyright remains with their respective authors. Each component is licensed under its own licence; nothing in the NetworkBase EULA restricts rights granted directly by an applicable open-source licence.</p> },
    { id: "copies", title: "2. Licence copies and attribution", content: <p>Package names and versions are recorded in the source distribution’s dependency manifests and lockfiles. Licence texts and required attribution supplied with a distributed component form part of this notice. Where source or notice delivery is required, request it from <a className="underline" href={`mailto:${i.supportEmail}`}>{i.supportEmail}</a> and identify the NetworkBase version you received.</p> },
    { id: "warranty", title: "3. Third-party terms", content: <p>Open-source components are provided under their respective licences, including their warranty and liability terms. The component authors do not endorse NetworkBase merely because their software is used.</p> },
  ]} />;
}
