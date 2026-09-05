import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { getLegalIdentity } from "@/lib/legal/config";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata: Metadata = { title: "Subprocessors | NetworkBase", description: "Service providers that support NetworkBase." };

const providers = [
  ["Cloudflare", "DNS, content delivery, network security", "Connection and request data"],
  ["Railway", "Application hosting and runtime", "Account, project, communication, and operational data processed by the application"],
  ["Supabase", "Authentication, PostgreSQL database, object storage, realtime", "Account, profile, project, file, message, session, and integration data"],
  ["Inngest", "Background jobs and scheduled lifecycle work", "Job identifiers, scoped payloads, status, and operational metadata"],
  ["Upstash", "Rate limiting and cache infrastructure", "Pseudonymous identifiers, request counters, and cached application results"],
  ["Google", "OAuth sign-in and Gemini AI assistance", "Identity data; prompts and generated responses when AI is requested"],
  ["GitHub", "Repository connection, import, sync, commits, and pull requests", "GitHub identity, repository content, contributor metadata, tokens, and operation data"],
  ["OpenStreetMap Nominatim", "Optional reverse geocoding", "Coordinates supplied for location detection"],
  ["ipapi.co", "Optional approximate location", "IP address and returned location"],
  ["Browser push services", "Device notifications", "Push endpoint, encryption keys, and notification payload"],
] as const;

export default function SubprocessorsPage() {
  const i = getLegalIdentity();
  return <LegalDocumentPage eyebrow="Legal · Service providers" title="Subprocessors" summary="These providers help NetworkBase deliver infrastructure, authentication, integrations, notifications, location, and AI features." version={LEGAL_VERSIONS.subprocessors} sections={[
    { id: "list", title: "Current provider list", content: <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse text-left text-sm"><thead><tr className="border-b border-zinc-300 dark:border-zinc-700"><th className="py-3 pr-4 font-semibold">Provider</th><th className="py-3 pr-4 font-semibold">Purpose</th><th className="py-3 font-semibold">Data involved</th></tr></thead><tbody>{providers.map(([name, purpose, data]) => <tr key={name} className="border-b border-zinc-200 align-top dark:border-zinc-800"><td className="py-4 pr-4 font-medium text-zinc-950 dark:text-white">{name}</td><td className="py-4 pr-4">{purpose}</td><td className="py-4">{data}</td></tr>)}</tbody></table></div> },
    { id: "transfers", title: "Locations and safeguards", content: <p>Provider processing locations depend on account region, network routing, and the feature used. {i.operatorName} uses available contractual, access-control, encryption, minimisation, and vendor-review safeguards and assesses transfer requirements under applicable law. Contact <a className="underline" href={`mailto:${i.privacyEmail}`}>{i.privacyEmail}</a> for a current location or transfer inquiry.</p> },
    { id: "changes", title: "Provider changes", content: <p>We update this list when a provider materially changes. Optional or disabled components are not treated as active processors merely because their software package exists. Material changes that create a new privacy risk will receive proportionate notice.</p> },
  ]} />;
}
