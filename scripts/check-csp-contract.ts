import fs from "node:fs";
import path from "node:path";

function assertIncludes(source: string, pattern: RegExp, message: string, errors: string[]) {
  if (!pattern.test(source)) {
    errors.push(message);
  }
}

function main() {
  const root = process.cwd();
  const middlewarePath = path.join(root, "proxy.ts");
  const nextConfigPath = path.join(root, "next.config.ts");
  const layoutPath = path.join(root, "src/app/layout.tsx");
  const providerPath = path.join(root, "src/components/providers/SecurityRuntimeProvider.tsx");
  const turnstilePath = path.join(root, "src/components/auth/TurnstileWidget.tsx");

  const middlewareSource = fs.readFileSync(middlewarePath, "utf8");
  const nextConfigSource = fs.readFileSync(nextConfigPath, "utf8");
  const layoutSource = fs.readFileSync(layoutPath, "utf8");
  const providerSource = fs.readFileSync(providerPath, "utf8");
  const turnstileSource = fs.readFileSync(turnstilePath, "utf8");

  const errors: string[] = [];

  assertIncludes(middlewareSource, /Content-Security-Policy/, "proxy.ts must set Content-Security-Policy", errors);
  if (/Content-Security-Policy/.test(nextConfigSource)) {
    errors.push("next.config.ts must not define a second Content-Security-Policy; proxy.ts is the single owner");
  }
  if (/script-src[^\n]*unsafe-inline/.test(middlewareSource)) {
    errors.push("middleware script-src must not allow unsafe-inline");
  }
  assertIncludes(middlewareSource, /x-nonce/, "proxy.ts must forward a nonce header", errors);
  assertIncludes(middlewareSource, /CSRF_COOKIE_NAME/, "proxy.ts must issue the CSRF cookie", errors);
  assertIncludes(layoutSource, /headers\(\)/, "src/app/layout.tsx must read the CSP nonce from request headers", errors);
  assertIncludes(layoutSource, /SecurityRuntimeProvider/, "src/app/layout.tsx must wrap the app in SecurityRuntimeProvider", errors);
  assertIncludes(layoutSource, /nonce=\{nonce\}/, "src/app/layout.tsx must nonce the inline theme script", errors);
  assertIncludes(providerSource, /CSRF_HEADER_NAME/, "SecurityRuntimeProvider must attach the CSRF header", errors);
  assertIncludes(providerSource, /window\.fetch = async/, "SecurityRuntimeProvider must patch same-origin browser fetch calls", errors);
  assertIncludes(turnstileSource, /nonce=\{nonce \?\? undefined\}/, "TurnstileWidget must pass the CSP nonce to next/script", errors);
  assertIncludes(middlewareSource, /https:\/\/accounts\.google\.com/, "middleware CSP must permit Google Identity Services", errors);

  if (errors.length > 0) {
    console.error("[csp-contract] failed:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log("[csp-contract] ok");
}

main();
