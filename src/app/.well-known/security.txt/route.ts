import { getLegalIdentity } from "@/lib/legal/config";

const SITE_ORIGIN = "https://networkbase.in";
const SECURITY_POLICY_PATH = "/security-reporting";

export function GET() {
  const identity = getLegalIdentity();
  const body = [
    `Contact: mailto:${identity.supportEmail}`,
    "Expires: 2027-09-04T23:59:59.000Z",
    "Preferred-Languages: en",
    `Canonical: ${SITE_ORIGIN}/.well-known/security.txt`,
    `Policy: ${SITE_ORIGIN}${SECURITY_POLICY_PATH}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
