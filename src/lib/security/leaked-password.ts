import { createHash } from "node:crypto";

const PWNED_PASSWORD_RANGE_URL = "https://api.pwnedpasswords.com/range";
const PWNED_PASSWORD_TIMEOUT_MS = 3_500;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// ponytail: Free-plan fallback; native Supabase enforcement should replace this after a Pro upgrade.
export async function isLeakedPassword(password: string, fetcher: Fetcher = fetch) {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const response = await fetcher(`${PWNED_PASSWORD_RANGE_URL}/${prefix}`, {
    cache: "no-store",
    headers: {
      "Add-Padding": "true",
      "User-Agent": "nb-s3-password-safety",
    },
    signal: AbortSignal.timeout(PWNED_PASSWORD_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`Pwned Passwords returned ${response.status}`);

  const matches = (await response.text()).split(/\r?\n/);
  return matches.some((line) => {
    const [candidate, count] = line.split(":", 2);
    return candidate?.toUpperCase() === suffix && Number(count) > 0;
  });
}
