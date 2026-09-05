import type { Metadata } from "next";
import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { getLegalIdentity } from "@/lib/legal/config";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata: Metadata = { title: "Cookie and Storage Notice | NetworkBase", description: "How NetworkBase uses cookies and device storage." };

export default function CookiesPage() {
  const i = getLegalIdentity();
  return <LegalDocumentPage eyebrow="Legal · Device storage" title="Cookie and Storage Notice" summary="NetworkBase uses a small set of essential cookies and local stores to keep accounts secure and collaborative work reliable." version={LEGAL_VERSIONS.cookies} sections={[
    { id: "essential", title: "1. Essential storage", content: <LegalList><li><strong>Authentication cookies</strong> keep you signed in and refresh sessions.</li><li><strong>Security values</strong> support CSRF protection, OAuth continuation, rate limiting, trusted redirects, and repository authorisation.</li><li><strong>Preferences</strong> remember theme, density, language, notification choices, and interface state.</li></LegalList> },
    { id: "local", title: "2. Local application data", content: <p>The browser may use localStorage, IndexedDB, Cache Storage, or similar technologies for cached application data, offline message delivery, unsaved work, file-editor state, onboarding drafts, and extension recovery. Some data may remain until it expires, is synchronised, you sign out, clear site data, or uninstall an extension.</p> },
    { id: "analytics", title: "3. Analytics", content: <p>The codebase supports deployment analytics, but analytics is rendered only when the production environment explicitly enables it. Where non-essential analytics requires consent, it must remain off until you opt in. NetworkBase does not authorise advertising cookies through this notice.</p> },
    { id: "control", title: "4. Your controls", content: <p>You can manage optional choices in Settings and browser controls. Blocking essential cookies may prevent sign-in, security, recovery, and workspace features. Signing out attempts to clear NetworkBase browser caches and push subscriptions. Browser, Google, GitHub, and push providers may maintain their own storage under their notices.</p> },
    { id: "contact", title: "5. Contact", content: <p>Questions or requests concerning device storage may be sent to <a className="underline" href={`mailto:${i.privacyEmail}`}>{i.privacyEmail}</a>.</p> },
  ]} />;
}
